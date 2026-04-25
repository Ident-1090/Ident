package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"net/http"
	"path"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 64 * 1024,
	CheckOrigin:     func(_ *http.Request) bool { return true },
}

const (
	maxClientMessageBytes         = 4096
	maxTrailBackfillRequestIDLen  = 80
	maxTrailBackfillRequestHexes  = 32
	maxTrailBackfillRequestHexLen = 32
	defaultTrailBackfillMaxPoints = 100_000
)

type TrailBackfillProvider interface {
	BackfillTrailEnvelope(TrailBackfillRequest) []byte
}

type Server struct {
	ctx                    context.Context
	hub                    *Hub
	basePath               string
	dataDir                string
	web                    fs.FS
	updates                *UpdateChecker
	trailBackfill          TrailBackfillProvider
	trailBackfillMaxWindow time.Duration
	trailBackfillMaxPoints int
	ready                  atomic.Bool
}

type ServerOptions struct {
	DataDir                string
	BasePath               string
	Web                    fs.FS
	UpdateChecker          *UpdateChecker
	TrailBackfill          TrailBackfillProvider
	TrailBackfillMaxWindow time.Duration
	TrailBackfillMaxPoints int
}

func NewServer(ctx context.Context, hub *Hub) *Server {
	return NewServerWithOptions(ctx, hub, ServerOptions{})
}

func NewServerWithOptions(ctx context.Context, hub *Hub, opts ServerOptions) *Server {
	basePath, err := normalizeBasePath(opts.BasePath)
	if err != nil {
		log.Printf("base path %q ignored: %v", opts.BasePath, err)
	}
	maxPoints := opts.TrailBackfillMaxPoints
	if maxPoints <= 0 {
		maxPoints = defaultTrailBackfillMaxPoints
	}
	return &Server{
		ctx:                    ctx,
		hub:                    hub,
		basePath:               basePath,
		dataDir:                opts.DataDir,
		web:                    opts.Web,
		updates:                opts.UpdateChecker,
		trailBackfill:          opts.TrailBackfill,
		trailBackfillMaxWindow: opts.TrailBackfillMaxWindow,
		trailBackfillMaxPoints: maxPoints,
	}
}

func (s *Server) SetReady(v bool) { s.ready.Store(v) }

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/ws", s.serveWS)
	mux.HandleFunc("/healthz", s.serveHealthz)
	mux.HandleFunc("/version", s.serveVersion)
	mux.HandleFunc("/api/update.json", s.serveUpdateStatus)
	if s.dataDir != "" {
		mux.HandleFunc("/api/data/", s.serveReceiverData)
	}
	mux.HandleFunc("/api/", http.NotFound)
	if s.web != nil {
		mux.HandleFunc("/", s.serveWeb)
	}
	if s.basePath != "" {
		outer := http.NewServeMux()
		outer.Handle(s.basePath+"/", http.StripPrefix(s.basePath, mux))
		outer.HandleFunc(s.basePath, func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, s.basePath+"/", http.StatusMovedPermanently)
		})
		return outer
	}
	return mux
}

func (s *Server) serveHealthz(w http.ResponseWriter, _ *http.Request) {
	if s.ready.Load() {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
		return
	}
	w.WriteHeader(http.StatusServiceUnavailable)
}

func (s *Server) serveVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, CurrentVersionInfo())
}

func (s *Server) serveUpdateStatus(w http.ResponseWriter, r *http.Request) {
	if s.updates == nil {
		writeJSON(w, UpdateStatus{
			Enabled: false,
			Status:  UpdateDisabled,
			Current: CurrentVersionInfo(),
		})
		return
	}
	writeJSON(w, s.updates.Status(r.Context()))
}

func (s *Server) serveWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("upgrade: %v", err)
		return
	}
	snaps := s.hub.Snapshots()
	// Size the send buffer to fit the full snapshot set plus live headroom —
	// routes accumulate in the cache and can exceed a fixed small depth.
	depth := defaultQueueDepth
	if n := len(snaps) + defaultQueueDepth; n > depth {
		depth = n
	}
	c := &Client{conn: conn, send: make(chan []byte, depth)}

	for _, snap := range snaps {
		c.send <- snap
	}

	s.hub.Add(c)
	go s.readPump(c)
	go s.writePump(c)
}

func (s *Server) readPump(c *Client) {
	defer s.hub.drop(c)
	c.conn.SetReadLimit(maxClientMessageBytes)
	_ = c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		return nil
	})
	for {
		messageType, reader, err := c.conn.NextReader()
		if err != nil {
			return
		}
		if messageType != websocket.TextMessage {
			continue
		}
		body, err := io.ReadAll(reader)
		if err != nil {
			return
		}
		s.handleClientMessage(c, body)
	}
}

func (s *Server) handleClientMessage(c *Client, body []byte) {
	if s.trailBackfill == nil || len(body) == 0 {
		return
	}
	var req struct {
		Type  string   `json:"type"`
		ID    string   `json:"id"`
		Since int64    `json:"since"`
		Until int64    `json:"until"`
		Hex   []string `json:"hex"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		return
	}
	if req.Type != "trails.backfill" {
		return
	}
	if len(req.ID) > maxTrailBackfillRequestIDLen || len(req.Hex) > maxTrailBackfillRequestHexes {
		return
	}
	for _, hex := range req.Hex {
		if len(hex) > maxTrailBackfillRequestHexLen {
			return
		}
	}
	env := s.trailBackfill.BackfillTrailEnvelope(TrailBackfillRequest{
		RequestID: req.ID,
		SinceMs:   req.Since,
		UntilMs:   req.Until,
		Hex:       req.Hex,
		MaxWindow: s.trailBackfillMaxWindow,
		MaxPoints: s.trailBackfillMaxPoints,
	})
	if len(env) == 0 {
		return
	}
	select {
	case c.send <- env:
	default:
		log.Printf("server: dropping slow client on trail backfill response")
		s.hub.drop(c)
	}
}

func (s *Server) serveReceiverData(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/api/data/")
	file, ok := localFilePath(s.dataDir, name, false)
	if !ok {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, file)
}

func (s *Server) serveWeb(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	}
	if !cleanRelativePath(name, true) {
		http.NotFound(w, r)
		return
	}
	if serveFSFile(w, r, s.web, name) {
		return
	}
	http.NotFound(w, r)
}

func localFilePath(root, name string, allowSlash bool) (string, bool) {
	if root == "" || !cleanRelativePath(name, allowSlash) {
		return "", false
	}
	clean := strings.TrimPrefix(path.Clean("/"+name), "/")
	return filepath.Join(root, filepath.FromSlash(clean)), true
}

func normalizeBasePath(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "/" {
		return "", nil
	}
	trimmed := strings.Trim(raw, "/")
	if !cleanRelativePath(trimmed, true) {
		return "", path.ErrBadPattern
	}
	clean := path.Clean("/" + trimmed)
	if clean == "/" {
		return "", nil
	}
	return clean, nil
}

func cleanRelativePath(name string, allowSlash bool) bool {
	if name == "" || strings.Contains(name, "\x00") {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return allowSlash || !strings.Contains(name, "/")
}

func serveFSFile(w http.ResponseWriter, r *http.Request, files fs.FS, name string) bool {
	body, modTime, ok := readFSFile(files, name)
	if !ok {
		return false
	}
	http.ServeContent(w, r, name, modTime, bytes.NewReader(body))
	return true
}

func readFSFile(files fs.FS, name string) ([]byte, time.Time, bool) {
	f, err := files.Open(name)
	if err != nil {
		return nil, time.Time{}, false
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil || info.IsDir() {
		return nil, time.Time{}, false
	}

	body, err := io.ReadAll(f)
	if err != nil {
		return nil, time.Time{}, false
	}
	return body, info.ModTime(), true
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("json response: %v", err)
	}
}

func (s *Server) writePump(c *Client) {
	ping := time.NewTicker(30 * time.Second)
	defer func() {
		ping.Stop()
		s.hub.drop(c)
	}()
	for {
		select {
		case <-s.ctx.Done():
			_ = c.conn.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseGoingAway, "bye"),
				time.Now().Add(time.Second))
			return
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ping.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
