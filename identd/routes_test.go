package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type fakeHub struct {
	mu          sync.Mutex
	clients     int32
	publishedCh chan []byte
}

func newFakeHub(clientCount int) *fakeHub {
	return &fakeHub{
		clients:     int32(clientCount),
		publishedCh: make(chan []byte, 64),
	}
}

func (f *fakeHub) setClients(n int)      { atomic.StoreInt32(&f.clients, int32(n)) }
func (f *fakeHub) ClientCount() int      { return int(atomic.LoadInt32(&f.clients)) }
func (f *fakeHub) PublishRoute(b []byte) { f.publishedCh <- append([]byte(nil), b...) }
func (f *fakeHub) drainPublished() [][]byte {
	out := [][]byte{}
	for {
		select {
		case b := <-f.publishedCh:
			out = append(out, b)
		default:
			return out
		}
	}
}
func (f *fakeHub) waitPublished(t *testing.T, n int, d time.Duration) [][]byte {
	t.Helper()
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		out := f.drainPublished()
		if len(out) >= n {
			return out
		}
		for _, b := range out {
			f.publishedCh <- b
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("waited %s for %d publishes, got %d", d, n, len(f.drainPublished()))
	return nil
}

func newCache(hub routePublisher, upstream string, now func() time.Time, ttl time.Duration) *RouteCache {
	return NewRouteCache(hub, RouteCacheOptions{
		TTL:         ttl,
		BatchDelay:  20 * time.Millisecond,
		UpstreamURL: upstream,
		HTTPClient:  &http.Client{Timeout: 2 * time.Second},
		Now:         now,
	})
}

func TestTrackQueuesUnknownCallsigns(t *testing.T) {
	hub := newFakeHub(0)
	c := newCache(hub, "http://example.invalid", time.Now, time.Minute)
	c.Track([]string{"ual123", " swa44 ", "", "ual123"})

	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.pending["UAL123"]; !ok {
		t.Fatalf("expected UAL123 queued: %+v", c.pending)
	}
	if _, ok := c.pending["SWA44"]; !ok {
		t.Fatalf("expected SWA44 queued: %+v", c.pending)
	}
	if len(c.pending) != 2 {
		t.Fatalf("unexpected pending: %+v", c.pending)
	}
}

func TestTrackRefreshesLastSeenForKnown(t *testing.T) {
	hub := newFakeHub(0)
	t0 := time.Unix(1_700_000_000, 0)
	nowVal := t0
	c := newCache(hub, "http://example.invalid", func() time.Time { return nowVal }, 5*time.Minute)
	c.mu.Lock()
	c.entries["UAL123"] = &routeEntry{
		result:     RouteResult{Known: true, Origin: "SFO", Destination: "LAX"},
		fetchedAt:  t0,
		lastSeenAt: t0,
	}
	c.mu.Unlock()

	nowVal = t0.Add(30 * time.Second)
	c.Track([]string{"UAL123"})

	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.entries["UAL123"].lastSeenAt.Equal(nowVal) {
		t.Fatalf("lastSeenAt not refreshed: %v vs %v", c.entries["UAL123"].lastSeenAt, nowVal)
	}
	if len(c.pending) != 0 {
		t.Fatalf("known callsign should not be re-queued: %+v", c.pending)
	}
}

func TestNoUpstreamFetchWhenNoClients(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`[]`))
	}))
	defer srv.Close()

	hub := newFakeHub(0) // zero clients
	c := newCache(hub, srv.URL, time.Now, time.Minute)
	c.Track([]string{"UAL123"})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.runFetcher(ctx)

	time.Sleep(100 * time.Millisecond)
	if n := atomic.LoadInt32(&hits); n != 0 {
		t.Fatalf("expected zero upstream hits with no clients, got %d", n)
	}

	// Once a client connects, the queued callsign should flush.
	hub.setClients(1)
	time.Sleep(120 * time.Millisecond)
	if n := atomic.LoadInt32(&hits); n == 0 {
		t.Fatalf("expected upstream hit after client connected, got 0")
	}
}

func TestCachedEntryNotRefetched(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		raw, _ := io.ReadAll(r.Body)
		_ = raw
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`[{"callsign":"UAL123","_airport_codes_iata":"SFO-LAX"}]`))
	}))
	defer srv.Close()

	hub := newFakeHub(1)
	c := newCache(hub, srv.URL, time.Now, time.Minute)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.runFetcher(ctx)

	c.Track([]string{"UAL123"})
	hub.waitPublished(t, 1, time.Second)

	// Repeated Track calls for the same callsign should not re-queue.
	for i := 0; i < 5; i++ {
		c.Track([]string{"UAL123"})
	}
	time.Sleep(80 * time.Millisecond)

	if n := atomic.LoadInt32(&hits); n != 1 {
		t.Fatalf("expected 1 upstream hit, got %d", n)
	}
}

func TestStaleEntryDroppedByJanitor(t *testing.T) {
	hub := newFakeHub(1)
	t0 := time.Unix(1_700_000_000, 0)
	nowVal := t0
	c := newCache(hub, "http://example.invalid", func() time.Time { return nowVal }, 5*time.Minute)
	c.mu.Lock()
	c.entries["UAL123"] = &routeEntry{
		result:     RouteResult{Known: true, Origin: "SFO", Destination: "LAX", Route: "SFO-LAX"},
		fetchedAt:  t0,
		lastSeenAt: t0,
	}
	c.mu.Unlock()

	// Advance clock beyond TTL, sweep.
	nowVal = t0.Add(6 * time.Minute)
	c.sweep()

	c.mu.Lock()
	_, stillThere := c.entries["UAL123"]
	c.mu.Unlock()
	if stillThere {
		t.Fatalf("entry should have been evicted")
	}

	pubs := hub.drainPublished()
	if len(pubs) != 1 {
		t.Fatalf("expected 1 drop envelope, got %d", len(pubs))
	}
	var env map[string]any
	if err := json.Unmarshal(pubs[0], &env); err != nil {
		t.Fatalf("envelope parse: %v", err)
	}
	if env["type"] != "routes" {
		t.Fatalf("unexpected drop envelope type: %s", pubs[0])
	}
	data, ok := env["data"].([]any)
	if !ok || len(data) != 1 {
		t.Fatalf("expected data[1], got: %s", pubs[0])
	}
	entry, _ := data[0].(map[string]any)
	if entry["callsign"] != "UAL123" || entry["dropped"] != true {
		t.Fatalf("unexpected drop entry: %s", pubs[0])
	}
}

func Test404ShortCircuits(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	hub := newFakeHub(1)
	c := newCache(hub, srv.URL, time.Now, time.Minute)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.runFetcher(ctx)

	c.Track([]string{"UAL123"})
	// Wait for a fetch.
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) && atomic.LoadInt32(&hits) == 0 {
		time.Sleep(10 * time.Millisecond)
	}
	if atomic.LoadInt32(&hits) == 0 {
		t.Fatalf("no upstream hit observed")
	}

	// Further Track of same callsign should not trigger more fetches.
	for i := 0; i < 5; i++ {
		c.Track([]string{"UAL123"})
	}
	time.Sleep(80 * time.Millisecond)

	if n := atomic.LoadInt32(&hits); n != 1 {
		t.Fatalf("expected exactly 1 upstream hit after 404, got %d", n)
	}
}

func Test5xxRetriesNextTick(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&hits, 1)
		if n == 1 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`[{"callsign":"UAL123","_airport_codes_iata":"SFO-LAX"}]`))
	}))
	defer srv.Close()

	hub := newFakeHub(1)
	c := newCache(hub, srv.URL, time.Now, time.Minute)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.runFetcher(ctx)

	c.Track([]string{"UAL123"})
	hub.waitPublished(t, 1, time.Second)
	if n := atomic.LoadInt32(&hits); n < 2 {
		t.Fatalf("expected at least 2 hits (retry after 5xx), got %d", n)
	}
}

func TestRouteSnapshotsSortedAndExcludesNoRoute(t *testing.T) {
	hub := newFakeHub(0)
	c := newCache(hub, "http://example.invalid", time.Now, time.Minute)
	c.mu.Lock()
	c.entries["BBB"] = &routeEntry{result: RouteResult{Known: true, Origin: "JFK", Destination: "LAX", Route: "JFK-LAX"}}
	c.entries["AAA"] = &routeEntry{result: RouteResult{Known: true, Origin: "SFO", Destination: "SEA", Route: "SFO-SEA"}}
	c.entries["NOPE"] = &routeEntry{result: RouteResult{Known: true, NoRoute: true}}
	c.mu.Unlock()

	snaps := c.RouteSnapshots()
	if len(snaps) != 1 {
		t.Fatalf("expected 1 batched envelope, got %d", len(snaps))
	}
	var env map[string]any
	_ = json.Unmarshal(snaps[0], &env)
	if env["type"] != "routes" {
		t.Fatalf("unexpected type: %s", snaps[0])
	}
	data, ok := env["data"].([]any)
	if !ok || len(data) != 2 {
		t.Fatalf("expected two entries (NOPE excluded), got: %s", snaps[0])
	}
	first, _ := data[0].(map[string]any)
	second, _ := data[1].(map[string]any)
	if first["callsign"] != "AAA" || second["callsign"] != "BBB" {
		t.Fatalf("expected AAA, BBB sorted: %s", snaps[0])
	}
}

func TestParseRoutesetResponseShapes(t *testing.T) {
	cases := []struct {
		name string
		body string
		want RouteResult
	}{
		{
			name: "top-level array with callsign+airport_codes",
			body: `[{"callsign":"UAL123","_airport_codes_iata":"SFO-LAX"}]`,
			want: RouteResult{Origin: "SFO", Destination: "LAX", Route: "SFO-LAX"},
		},
		{
			name: "planes bucket with airport references",
			body: `{"_airports":[{"iata":"SFO"},{"iata":"LAX"}],"planes":[{"callsign":"UAL123","origin":0,"destination":1}]}`,
			want: RouteResult{Origin: "SFO", Destination: "LAX", Route: "SFO-LAX"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseRoutesetResponse([]byte(tc.body), []string{"UAL123"})
			r, ok := got["UAL123"]
			if !ok {
				t.Fatalf("no result: %+v", got)
			}
			if r.Origin != tc.want.Origin || r.Destination != tc.want.Destination || r.Route != tc.want.Route {
				t.Fatalf("got %+v want %+v", r, tc.want)
			}
		})
	}
}

func TestExtractAircraftCallsigns(t *testing.T) {
	body := []byte(`{"now":1,"aircraft":[{"hex":"abc","flight":"ual123"},{"hex":"def","flight":"  "},{"hex":"ghi","flight":"SWA44 "},{"hex":"jkl"}]}`)
	got := extractAircraftCallsigns(body)
	if len(got) != 2 || got[0] != "UAL123" || got[1] != "SWA44" {
		t.Fatalf("unexpected: %+v", got)
	}
}
