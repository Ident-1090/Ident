package main

import (
	"context"
	"encoding/json"
	"io"
	"io/fs"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/gorilla/websocket"
)

func TestServerSnapshotOnConnect(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	hub := NewHub([]string{"aircraft", "stats"})
	hub.Publish("aircraft", []byte(`{"now":1,"aircraft":[]}`))
	hub.Publish("stats", []byte(`{"messages":42}`))

	srv := NewServer(ctx, hub)
	srv.SetReady(true)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	url := strings.Replace(ts.URL, "http://", "ws://", 1) + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	// Expect both snapshots in declared order.
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, first, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read 1: %v", err)
	}
	if string(first) != `{"type":"aircraft","data":{"now":1,"aircraft":[]}}` {
		t.Fatalf("frame 1 = %s", first)
	}
	_, second, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read 2: %v", err)
	}
	if string(second) != `{"type":"stats","data":{"messages":42}}` {
		t.Fatalf("frame 2 = %s", second)
	}
}

func TestServerVersionAndUpdateEndpoints(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	checker := NewUpdateChecker(UpdateCheckerOptions{
		Enabled: false,
		Current: VersionInfo{
			Version: "v1.0.0",
			Commit:  "abc123",
			Date:    "2026-04-23T00:00:00Z",
		},
	})
	srv := NewServerWithOptions(ctx, NewHub(nil), ServerOptions{UpdateChecker: checker})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	versionResp, err := ts.Client().Get(ts.URL + "/version")
	if err != nil {
		t.Fatal(err)
	}
	var versionBody VersionInfo
	if err := json.NewDecoder(versionResp.Body).Decode(&versionBody); err != nil {
		t.Fatal(err)
	}
	versionResp.Body.Close()
	if versionResp.StatusCode != 200 {
		t.Fatalf("version status = %d, want 200", versionResp.StatusCode)
	}
	if versionBody.Version == "" {
		t.Fatalf("empty version body: %#v", versionBody)
	}

	updateResp, err := ts.Client().Get(ts.URL + "/update.json")
	if err != nil {
		t.Fatal(err)
	}
	var updateBody UpdateStatus
	if err := json.NewDecoder(updateResp.Body).Decode(&updateBody); err != nil {
		t.Fatal(err)
	}
	updateResp.Body.Close()
	if updateResp.StatusCode != 200 {
		t.Fatalf("update status = %d, want 200", updateResp.StatusCode)
	}
	if updateBody.Status != UpdateDisabled {
		t.Fatalf("update status = %s, want %s", updateBody.Status, UpdateDisabled)
	}
}

func TestServerBroadcastAfterConnect(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	hub := NewHub([]string{"aircraft"})
	srv := NewServer(ctx, hub)
	srv.SetReady(true)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	url := strings.Replace(ts.URL, "http://", "ws://", 1) + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	time.Sleep(50 * time.Millisecond)
	hub.Publish("aircraft", []byte(`{"now":2}`))

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	mt, msg, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if mt != websocket.TextMessage {
		t.Fatalf("expected text message, got %d", mt)
	}
	if string(msg) != `{"type":"aircraft","data":{"now":2}}` {
		t.Fatalf("payload = %s", msg)
	}
}

// TestServerSnapshotExceedsDefaultQueueDepth guards against the "silent drop
// on connect" regression: if Snapshots() returns more envelopes than
// defaultQueueDepth, the pre-queue must still fit them all rather than
// closing the connection. Route cache snapshots routinely exceed 8.
func TestServerSnapshotExceedsDefaultQueueDepth(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	hub := NewHub([]string{"aircraft"})
	hub.Publish("aircraft", []byte(`{"now":1}`))

	// Register a multi-snapshot provider that returns many route envelopes —
	// well above defaultQueueDepth.
	const routeCount = defaultQueueDepth * 4
	hub.SetRouteProvider(func() [][]byte {
		out := make([][]byte, routeCount)
		for i := range out {
			out[i] = []byte(`{"type":"route","callsign":"UAL1"}`)
		}
		return out
	})

	srv := NewServer(ctx, hub)
	srv.SetReady(true)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	url := strings.Replace(ts.URL, "http://", "ws://", 1) + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	// Read every snapshot — the aircraft channel plus all routes — without
	// the connection closing on us mid-stream.
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	for i := 0; i < 1+routeCount; i++ {
		if _, _, err := conn.ReadMessage(); err != nil {
			t.Fatalf("read %d of %d: %v", i+1, 1+routeCount, err)
		}
	}
}

func TestHealthz(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv := NewServer(ctx, NewHub(nil))
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	resp, err := ts.Client().Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 503 {
		t.Fatalf("pre-ready status = %d, want 503", resp.StatusCode)
	}

	srv.SetReady(true)
	resp2, err := ts.Client().Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	resp2.Body.Close()
	if resp2.StatusCode != 200 {
		t.Fatalf("post-ready status = %d", resp2.StatusCode)
	}
}

func TestServerServesReceiverDataFiles(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "aircraft.json"), []byte(`{"aircraft":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	srv := NewServerWithOptions(ctx, NewHub(nil), ServerOptions{DataDir: dir})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	resp, err := ts.Client().Get(ts.URL + "/data/aircraft.json")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if string(body) != `{"aircraft":[]}` {
		t.Fatalf("body = %s", body)
	}
}

func TestServerServesChunkFiles(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dir := t.TempDir()
	chunkDir := filepath.Join(dir, "chunks")
	if err := os.Mkdir(chunkDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(chunkDir, "chunks.json"), []byte(`{"chunks":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	srv := NewServerWithOptions(ctx, NewHub(nil), ServerOptions{DataDir: dir, HistoryDataDir: chunkDir})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	resp, err := ts.Client().Get(ts.URL + "/chunks/chunks.json")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if string(body) != `{"chunks":[]}` {
		t.Fatalf("body = %s", body)
	}
}

func TestServerServesChunkFilesFromSeparateDirectory(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dataDir := t.TempDir()
	chunkDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(chunkDir, "chunks.json"), []byte(`{"chunks":["a.gz"]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	srv := NewServerWithOptions(ctx, NewHub(nil), ServerOptions{DataDir: dataDir, HistoryDataDir: chunkDir})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	resp, err := ts.Client().Get(ts.URL + "/chunks/chunks.json")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if string(body) != `{"chunks":["a.gz"]}` {
		t.Fatalf("body = %s", body)
	}
}

func TestServerRejectsReceiverDataTraversal(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv := NewServerWithOptions(ctx, NewHub(nil), ServerOptions{DataDir: t.TempDir()})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	resp, err := ts.Client().Get(ts.URL + "/data/../server.go")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 404 {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

func TestServerServesEmbeddedWebApp(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	web := fstest.MapFS{
		"index.html":     &fstest.MapFile{Data: []byte("<main>Ident</main>")},
		"assets/app.js":  &fstest.MapFile{Data: []byte("console.log('ident')")},
		"nested/app.css": &fstest.MapFile{Data: []byte("body{}")},
	}
	srv := NewServerWithOptions(ctx, NewHub(nil), ServerOptions{Web: fs.FS(web)})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	for _, tc := range []struct {
		path string
		want string
	}{
		{"/", "<main>Ident</main>"},
		{"/assets/app.js", "console.log('ident')"},
		{"/mobile/route", "<main>Ident</main>"},
	} {
		resp, err := ts.Client().Get(ts.URL + tc.path)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 200 {
			t.Fatalf("%s status = %d, want 200", tc.path, resp.StatusCode)
		}
		if string(body) != tc.want {
			t.Fatalf("%s body = %s", tc.path, body)
		}
	}
}
