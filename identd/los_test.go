package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeLOSAlts(t *testing.T) {
	got, err := normalizeLOSAlts("40000ft,12km,3000m,4500")
	if err != nil {
		t.Fatalf("normalize LOS alts: %v", err)
	}
	if got != "12192,12000,3000,1372" {
		t.Fatalf("alts = %q", got)
	}
}

func TestLOSCacheDownloadsAndCachesByResolvedURL(t *testing.T) {
	var requests int
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if got := r.URL.Query().Get("id"); got != "abc123" {
			t.Fatalf("id = %q", got)
		}
		if got := r.URL.Query().Get("alts"); got != "12192,3000" {
			t.Fatalf("alts = %q", got)
		}
		_, _ = w.Write([]byte(`{"rings":[{"alt":12192,"points":[[1,2],[3,4],[5,6]]}]}`))
	}))
	defer ts.Close()

	cache := NewLOSCache(LOSOptions{
		PanoramaID: "abc123",
		Alts:       "40000ft,3000m",
		CacheDir:   t.TempDir(),
		BaseURL:    ts.URL,
	})

	first, err := cache.Load(context.Background())
	if err != nil {
		t.Fatalf("first load: %v", err)
	}
	second, err := cache.Load(context.Background())
	if err != nil {
		t.Fatalf("second load: %v", err)
	}

	if requests != 1 {
		t.Fatalf("requests = %d, want 1", requests)
	}
	if string(first) != string(second) {
		t.Fatalf("cached payload mismatch")
	}
	if _, err := os.Stat(cache.OutputPath()); err != nil {
		t.Fatalf("missing LOS output: %v", err)
	}
}

func TestLOSCacheClearsStaleOutputWhenDisabled(t *testing.T) {
	cacheDir := t.TempDir()
	outFile := filepath.Join(cacheDir, "upintheair.json")
	if err := os.WriteFile(outFile, []byte(`{"rings":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	cache := NewLOSCache(LOSOptions{CacheDir: cacheDir})
	body, err := cache.Load(context.Background())
	if err != nil {
		t.Fatalf("load disabled LOS cache: %v", err)
	}
	if body != nil {
		t.Fatalf("body = %q, want nil", body)
	}
	if _, err := os.Stat(outFile); !os.IsNotExist(err) {
		t.Fatalf("expected stale LOS file to be removed, stat err = %v", err)
	}
}
