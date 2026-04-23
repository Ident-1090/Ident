package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestUpdateCheckerReportsAvailableRelease(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/Ident-1090/Ident/releases/latest" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(githubRelease{
			TagName:     "v1.2.0",
			Name:        "Ident v1.2.0",
			HTMLURL:     "https://github.com/Ident-1090/Ident/releases/tag/v1.2.0",
			PublishedAt: mustTime(t, "2026-04-23T10:00:00Z"),
		})
	}))
	defer ts.Close()

	checker := NewUpdateChecker(UpdateCheckerOptions{
		Enabled: true,
		Repo:    "Ident-1090/Ident",
		APIBase: ts.URL,
		TTL:     time.Hour,
		Current: VersionInfo{Version: "v1.1.0", Commit: "abc123", Date: "2026-04-20T00:00:00Z"},
	})

	status := checker.Status(context.Background())
	if status.Status != UpdateAvailable {
		t.Fatalf("status = %s, want %s", status.Status, UpdateAvailable)
	}
	if status.Latest == nil || status.Latest.Version != "v1.2.0" {
		t.Fatalf("latest = %#v", status.Latest)
	}
	if status.Error != "" {
		t.Fatalf("error = %q", status.Error)
	}
}

func TestUpdateCheckerReportsCurrentRelease(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(githubRelease{TagName: "v1.2.0"})
	}))
	defer ts.Close()

	checker := NewUpdateChecker(UpdateCheckerOptions{
		Enabled: true,
		Repo:    "Ident-1090/Ident",
		APIBase: ts.URL,
		TTL:     time.Hour,
		Current: VersionInfo{Version: "v1.2.0"},
	})

	status := checker.Status(context.Background())
	if status.Status != UpdateCurrent {
		t.Fatalf("status = %s, want %s", status.Status, UpdateCurrent)
	}
}

func TestUpdateCheckerDoesNotFlagDevBuilds(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(githubRelease{TagName: "v9.9.9"})
	}))
	defer ts.Close()

	checker := NewUpdateChecker(UpdateCheckerOptions{
		Enabled: true,
		Repo:    "Ident-1090/Ident",
		APIBase: ts.URL,
		TTL:     time.Hour,
		Current: VersionInfo{Version: "dev"},
	})

	status := checker.Status(context.Background())
	if status.Status != UpdateUnknown {
		t.Fatalf("status = %s, want %s", status.Status, UpdateUnknown)
	}
}

func TestUpdateCheckerKeepsLastSuccessfulReleaseOnFailure(t *testing.T) {
	fail := false
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if fail {
			http.Error(w, "temporary outage", http.StatusBadGateway)
			return
		}
		_ = json.NewEncoder(w).Encode(githubRelease{TagName: "v1.2.0"})
	}))
	defer ts.Close()

	checker := NewUpdateChecker(UpdateCheckerOptions{
		Enabled: true,
		Repo:    "Ident-1090/Ident",
		APIBase: ts.URL,
		TTL:     time.Nanosecond,
		Current: VersionInfo{Version: "v1.1.0"},
	})

	first := checker.Status(context.Background())
	if first.Status != UpdateAvailable {
		t.Fatalf("first status = %s, want %s", first.Status, UpdateAvailable)
	}

	time.Sleep(time.Millisecond)
	fail = true
	second := checker.Status(context.Background())
	if second.Status != UpdateUnavailable {
		t.Fatalf("second status = %s, want %s", second.Status, UpdateUnavailable)
	}
	if second.Latest == nil || second.Latest.Version != "v1.2.0" {
		t.Fatalf("latest after failure = %#v", second.Latest)
	}
	if second.LastSuccessAt == "" {
		t.Fatalf("missing last success timestamp")
	}
	if second.Error == "" {
		t.Fatalf("missing failure detail")
	}
}

func TestUpdateCheckerUsesETagForRepeatedChecks(t *testing.T) {
	var sawETag bool
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("If-None-Match") == `"release-v1"` {
			sawETag = true
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `"release-v1"`)
		_ = json.NewEncoder(w).Encode(githubRelease{TagName: "v1.2.0"})
	}))
	defer ts.Close()

	checker := NewUpdateChecker(UpdateCheckerOptions{
		Enabled: true,
		Repo:    "Ident-1090/Ident",
		APIBase: ts.URL,
		TTL:     time.Nanosecond,
		Current: VersionInfo{Version: "v1.1.0"},
	})

	first := checker.Status(context.Background())
	if first.Status != UpdateAvailable {
		t.Fatalf("first status = %s, want %s", first.Status, UpdateAvailable)
	}
	time.Sleep(time.Millisecond)
	second := checker.Status(context.Background())
	if second.Status != UpdateAvailable {
		t.Fatalf("second status = %s, want %s", second.Status, UpdateAvailable)
	}
	if !sawETag {
		t.Fatal("second request did not include If-None-Match")
	}
}

func TestUpdateCheckerCoalescesConcurrentRefreshes(t *testing.T) {
	var requests int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&requests, 1)
		time.Sleep(25 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(githubRelease{TagName: "v1.2.0"})
	}))
	defer ts.Close()

	checker := NewUpdateChecker(UpdateCheckerOptions{
		Enabled: true,
		Repo:    "Ident-1090/Ident",
		APIBase: ts.URL,
		TTL:     time.Hour,
		Current: VersionInfo{Version: "v1.1.0"},
	})

	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			status := checker.Status(context.Background())
			if status.Status != UpdateAvailable {
				t.Errorf("status = %s, want %s", status.Status, UpdateAvailable)
			}
		}()
	}
	wg.Wait()

	if got := atomic.LoadInt32(&requests); got != 1 {
		t.Fatalf("requests = %d, want 1", got)
	}
}

func TestUpdateCheckerDisabledDoesNotCallGitHub(t *testing.T) {
	called := false
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))
	defer ts.Close()

	checker := NewUpdateChecker(UpdateCheckerOptions{
		Enabled: false,
		Repo:    "Ident-1090/Ident",
		APIBase: ts.URL,
		TTL:     time.Hour,
		Current: VersionInfo{Version: "v1.0.0"},
	})

	status := checker.Status(context.Background())
	if status.Status != UpdateDisabled {
		t.Fatalf("status = %s, want %s", status.Status, UpdateDisabled)
	}
	if called {
		t.Fatal("disabled checker called API")
	}
}

func mustTime(t *testing.T, raw string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}
