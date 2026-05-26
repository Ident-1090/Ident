package main

import (
	"bytes"
	"context"
	"encoding/json"
	"html"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
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

type ReplayProvider interface {
	Manifest() ReplayManifest
	ServeBlock(http.ResponseWriter, *http.Request, string)
	RecentReplay() (replayBlockFile, bool)
}

type TrailProvider interface {
	SnapshotData() trailEnvelopeData
}

type recentData struct {
	Aircraft map[string][]trailPoint `json:"aircraft"`
	Replay   *replayBlockFile        `json:"replay,omitempty"`
}

type Server struct {
	ctx         context.Context
	hub         *Hub
	basePath    string
	web         fs.FS
	replay      ReplayProvider
	trails      TrailProvider
	card        *cardRenderer
	publicCard  bool
	stationName string
	publicURL   string
	ready       atomic.Bool
}

type ServerOptions struct {
	BasePath    string
	Web         fs.FS
	Replay      ReplayProvider
	Trails      TrailProvider
	Card        *cardRenderer
	PublicCard  bool
	StationName string
	PublicURL   string
}

func NewServer(ctx context.Context, hub *Hub) *Server {
	return NewServerWithOptions(ctx, hub, ServerOptions{})
}

func NewServerWithOptions(ctx context.Context, hub *Hub, opts ServerOptions) *Server {
	basePath, err := normalizeBasePath(opts.BasePath)
	if err != nil {
		slog.Warn("base path ignored", "path", opts.BasePath, "err", err)
	}
	return &Server{
		ctx:         ctx,
		hub:         hub,
		basePath:    basePath,
		web:         opts.Web,
		replay:      opts.Replay,
		trails:      opts.Trails,
		card:        opts.Card,
		publicCard:  opts.PublicCard,
		stationName: strings.TrimSpace(opts.StationName),
		publicURL:   strings.TrimRight(strings.TrimSpace(opts.PublicURL), "/"),
	}
}

func (s *Server) SetReady(v bool) { s.ready.Store(v) }

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/ws", s.serveWS)
	mux.HandleFunc("/healthz", s.serveHealthz)
	mux.HandleFunc("/api/trails/recent.json", s.serveRecentTrails)
	mux.HandleFunc("/api/replay/manifest.json", s.serveReplayManifest)
	mux.HandleFunc("/api/replay/blocks/", s.serveReplayBlock)
	if s.publicCard && s.card != nil {
		mux.HandleFunc("/api/og.png", s.serveOGCard)
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

func (s *Server) serveReplayManifest(w http.ResponseWriter, _ *http.Request) {
	if s.replay == nil {
		writeJSON(w, ReplayManifest{Enabled: false})
		return
	}
	writeJSON(w, s.replay.Manifest())
}

func (s *Server) serveReplayBlock(w http.ResponseWriter, r *http.Request) {
	if s.replay == nil {
		http.NotFound(w, r)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/api/replay/blocks/")
	s.replay.ServeBlock(w, r, name)
}

func (s *Server) serveRecentTrails(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	body := recentData{Aircraft: map[string][]trailPoint{}}
	if s.trails != nil {
		body.Aircraft = s.trails.SnapshotData().Aircraft
		if body.Aircraft == nil {
			body.Aircraft = map[string][]trailPoint{}
		}
	}
	if s.replay != nil {
		if replay, ok := s.replay.RecentReplay(); ok {
			body.Replay = &replay
		}
	}
	writeJSON(w, body)
}

func (s *Server) serveWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Warn("upgrade", "err", err, "addr", r.RemoteAddr)
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

func (s *Server) serveWeb(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	}
	if !cleanRelativePath(name, true) {
		http.NotFound(w, r)
		return
	}
	// Inject share-card metadata into the served page. The card image needs an
	// absolute URL, only known at request time, so this happens here rather than
	// at build. A single literal insert before </head>; the file's noindex (for
	// receiver-local privacy) is left untouched.
	if name == "index.html" && s.publicCard {
		if body, _, ok := readFSFile(s.web, name); ok {
			doc := strings.Replace(string(body), "</head>", s.shareMeta(r)+"</head>", 1)
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = io.WriteString(w, doc)
			return
		}
	}
	if serveFSFile(w, r, s.web, name) {
		return
	}
	http.NotFound(w, r)
}

// externalBase is the absolute origin (+ base path) for share links: the
// configured public URL when set, otherwise derived from the request, honoring
// reverse-proxy forwarding headers.
func (s *Server) externalBase(r *http.Request) string {
	if s.publicURL != "" {
		return s.publicURL
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if p := r.Header.Get("X-Forwarded-Proto"); p != "" {
		scheme = strings.TrimSpace(strings.Split(p, ",")[0])
	}
	host := r.Host
	if h := r.Header.Get("X-Forwarded-Host"); h != "" {
		host = strings.TrimSpace(strings.Split(h, ",")[0])
	}
	return scheme + "://" + host + s.basePath
}

func (s *Server) shareMeta(r *http.Request) string {
	base := s.externalBase(r)
	title := "Ident — live ADS-B from your receiver"
	if s.stationName != "" {
		title = s.stationName + " · Ident"
	}
	const desc = "Live traffic from your own ADS-B receiver, in a fast modern interface for desktop, tablet, and phone."
	img := html.EscapeString(base + "/api/og.png")
	page := html.EscapeString(base + "/")
	title = html.EscapeString(title)
	tags := []string{
		`<meta name="description" content="` + desc + `" />`,
		`<meta property="og:type" content="website" />`,
		`<meta property="og:site_name" content="Ident" />`,
		`<meta property="og:title" content="` + title + `" />`,
		`<meta property="og:description" content="` + desc + `" />`,
		`<meta property="og:url" content="` + page + `" />`,
		`<meta property="og:image" content="` + img + `" />`,
		`<meta property="og:image:width" content="1200" />`,
		`<meta property="og:image:height" content="630" />`,
		`<meta name="twitter:card" content="summary_large_image" />`,
		`<meta name="twitter:title" content="` + title + `" />`,
		`<meta name="twitter:description" content="` + desc + `" />`,
		`<meta name="twitter:image" content="` + img + `" />`,
	}
	return "    " + strings.Join(tags, "\n    ") + "\n  "
}

func (s *Server) serveOGCard(w http.ResponseWriter, r *http.Request) {
	body := s.card.Bytes()
	if len(body) == 0 {
		http.Error(w, "card not ready", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=60")
	http.ServeContent(w, r, "og.png", time.Time{}, bytes.NewReader(body))
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
		slog.Warn("json response", "err", err)
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
