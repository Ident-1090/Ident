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

type Server struct {
	ctx     context.Context
	hub     *Hub
	dataDir string
	web     fs.FS
	updates *UpdateChecker
	ready   atomic.Bool
}

type ServerOptions struct {
	DataDir       string
	Web           fs.FS
	UpdateChecker *UpdateChecker
}

func NewServer(ctx context.Context, hub *Hub) *Server {
	return NewServerWithOptions(ctx, hub, ServerOptions{})
}

func NewServerWithOptions(ctx context.Context, hub *Hub, opts ServerOptions) *Server {
	return &Server{
		ctx:     ctx,
		hub:     hub,
		dataDir: opts.DataDir,
		web:     opts.Web,
		updates: opts.UpdateChecker,
	}
}

func (s *Server) SetReady(v bool) { s.ready.Store(v) }

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.serveWS)
	mux.HandleFunc("/healthz", s.serveHealthz)
	mux.HandleFunc("/version", s.serveVersion)
	mux.HandleFunc("/update.json", s.serveUpdateStatus)
	if s.dataDir != "" {
		mux.HandleFunc("/data/", s.serveReceiverData)
		mux.HandleFunc("/chunks/", s.serveChunks)
	}
	if s.web != nil {
		mux.HandleFunc("/", s.serveWeb)
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
	c.conn.SetReadLimit(512)
	_ = c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		return nil
	})
	for {
		if _, _, err := c.conn.NextReader(); err != nil {
			return
		}
	}
}

func (s *Server) serveReceiverData(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/data/")
	file, ok := localFilePath(s.dataDir, name, false)
	if !ok {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, file)
}

func (s *Server) serveChunks(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/chunks/")
	file, ok := localFilePath(filepath.Join(s.dataDir, "chunks"), name, true)
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
	if path.Ext(name) == "" && serveFSFile(w, r, s.web, "index.html") {
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
	f, err := files.Open(name)
	if err != nil {
		return false
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil || info.IsDir() {
		return false
	}

	body, err := io.ReadAll(f)
	if err != nil {
		return false
	}
	http.ServeContent(w, r, name, info.ModTime(), bytes.NewReader(body))
	return true
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
