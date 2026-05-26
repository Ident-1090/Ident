package main

import (
	"bytes"
	"context"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func testCardRenderer(t *testing.T) *cardRenderer {
	t.Helper()
	c, err := newCardRenderer(func() CardStats {
		return CardStats{Station: "TEST", Aircraft: 3}
	})
	if err != nil {
		t.Fatalf("newCardRenderer: %v", err)
	}
	if err := c.refresh(); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	return c
}

// Mirrors a real (non-demo) build: noindex present, no OpenGraph tags baked in
// (identd injects those at serve time).
const ogIndexHTML = `<html><head>` +
	`<meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />` +
	`</head><body></body></html>`

func TestServeOGCardServesPNG(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	web := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte(ogIndexHTML)}}
	srv := NewServerWithOptions(ctx, NewHub(nil), ServerOptions{
		Web:        fs.FS(web),
		Card:       testCardRenderer(t),
		PublicCard: true,
	})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	resp, err := ts.Client().Get(ts.URL + "/api/og.png")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "image/png" {
		t.Fatalf("Content-Type = %q, want image/png", ct)
	}
	body, _ := io.ReadAll(resp.Body)
	if !bytes.HasPrefix(body, []byte("\x89PNG\r\n\x1a\n")) {
		t.Fatal("body is not a PNG")
	}
}

func TestServeOGCardDisabledReturns404(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	web := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte(ogIndexHTML)}}
	srv := NewServerWithOptions(ctx, NewHub(nil), ServerOptions{
		Web:        fs.FS(web),
		Card:       testCardRenderer(t),
		PublicCard: false,
	})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	resp, err := ts.Client().Get(ts.URL + "/api/og.png")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 when public card disabled", resp.StatusCode)
	}
}

func TestIndexInjectsStationTitleKeepsNoindex(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	web := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte(ogIndexHTML)}}
	srv := NewServerWithOptions(ctx, NewHub(nil), ServerOptions{
		Web:         fs.FS(web),
		Card:        testCardRenderer(t),
		PublicCard:  true,
		StationName: "Test Station",
	})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	resp, err := ts.Client().Get(ts.URL + "/")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	doc := string(body)
	if !strings.Contains(doc, `<meta property="og:title" content="Test Station · Ident" />`) {
		t.Fatalf("og:title not personalized:\n%s", doc)
	}
	if !strings.Contains(doc, `<meta name="twitter:title" content="Test Station · Ident" />`) {
		t.Fatalf("twitter:title not personalized:\n%s", doc)
	}
	if !strings.Contains(doc, `<meta property="og:image" content="http`) ||
		!strings.Contains(doc, "/api/og.png") {
		t.Fatalf("og:image must be an absolute URL to /api/og.png:\n%s", doc)
	}
	if !strings.Contains(doc, "noindex") {
		t.Fatal("noindex must be preserved for receiver-local deployments")
	}
}

func TestShareMetaUsesConfiguredPublicURL(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	web := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte(ogIndexHTML)}}
	srv := NewServerWithOptions(ctx, NewHub(nil), ServerOptions{
		Web:        fs.FS(web),
		Card:       testCardRenderer(t),
		PublicCard: true,
		PublicURL:  "https://radar.example.test",
	})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	resp, err := ts.Client().Get(ts.URL + "/")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), `content="https://radar.example.test/api/og.png"`) {
		t.Fatalf("og:image should use configured public URL:\n%s", body)
	}
}
