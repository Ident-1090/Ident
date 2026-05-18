package main

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestDiagnosticStoreNoteRejectsDuplicateIdentityAndUpdatesMutableFields(t *testing.T) {
	clock := newFakeClock(time.Unix(1_700_000_000, 0))
	store := NewDiagnosticStore(DiagnosticStoreOptions{Debounce: -1, Now: clock.Now})

	store.Note("aircraft", "aircraft.adapter.invalid_bool", severityWarning, "alert value not a bool")
	clock.Advance(time.Second)
	store.Note("aircraft", "aircraft.adapter.invalid_bool", severityWarning, "spi value not a bool")

	snap := store.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("re-emission duplicated identity: %d entries", len(snap))
	}
	if snap[0].Message != "spi value not a bool" {
		t.Fatalf("mutable message not updated: %#v", snap[0])
	}
}

func TestDiagnosticStoreNoteRefreshesTTLOnReEmission(t *testing.T) {
	clock := newFakeClock(time.Unix(1_700_000_000, 0))
	store := NewDiagnosticStore(DiagnosticStoreOptions{Debounce: -1, Now: clock.Now})

	store.Note("aircraft", "aircraft.adapter.clock_not_advanced", severityWarning, "stuck", WithTTL(30*time.Second))
	clock.Advance(20 * time.Second)
	store.Note("aircraft", "aircraft.adapter.clock_not_advanced", severityWarning, "stuck", WithTTL(30*time.Second))

	// Advance past the original 30s window. If TTL was refreshed by the
	// second Note, the entry must still be present.
	clock.Advance(20 * time.Second)
	snap := store.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("TTL not refreshed by re-emission: snapshot = %#v", snap)
	}

	// Stop re-emitting; advance past the most recent TTL deadline.
	clock.Advance(30 * time.Second)
	if snap := store.Snapshot(); len(snap) != 0 {
		t.Fatalf("entry persisted after TTL expiry: %#v", snap)
	}
}

func TestDiagnosticStoreNoteWithTTLZeroNeverExpires(t *testing.T) {
	clock := newFakeClock(time.Unix(1_700_000_000, 0))
	store := NewDiagnosticStore(DiagnosticStoreOptions{Debounce: -1, Now: clock.Now})

	store.Note("update", "update.release.available", severityInfo, "v1.0.0", WithTTL(0))
	clock.Advance(72 * time.Hour)

	if snap := store.Snapshot(); len(snap) != 1 {
		t.Fatalf("WithTTL(0) entry expired: %#v", snap)
	}
}

func TestDiagnosticStoreCapacityEvictsFIFOAndEmitsMetaDiagnostic(t *testing.T) {
	var buf bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	clock := newFakeClock(time.Unix(1_700_000_000, 0))
	store := NewDiagnosticStore(DiagnosticStoreOptions{
		Debounce: -1,
		Cap:      3,
		Now:      clock.Now,
	})

	store.Note("oldest", "oldest.code", severityWarning, "first", WithTTL(0))
	store.Note("middle", "middle.code", severityWarning, "second", WithTTL(0))
	store.Note("newest", "newest.code", severityWarning, "third", WithTTL(0))

	store.Note("overflow", "overflow.code", severityWarning, "fourth", WithTTL(0))

	codes := make(map[string]bool)
	snapshot := store.Snapshot()
	// Cap = 3 with one new insert evicts the single oldest entry. Meta is
	// allowed to overshoot cap by 1 (intentional — meta must stay visible).
	if len(snapshot) != 4 {
		t.Fatalf("snapshot length = %d, want cap+meta-sized snapshot: %#v", len(snapshot), snapshot)
	}
	for _, d := range snapshot {
		codes[d.Code] = true
	}
	if codes["oldest.code"] {
		t.Fatalf("oldest entry survived eviction: %#v", codes)
	}
	if !codes["middle.code"] {
		t.Fatalf("second-oldest entry was evicted but only the single oldest should drop: %#v", codes)
	}
	if !codes["overflow.code"] {
		t.Fatalf("overflow entry missing after eviction: %#v", codes)
	}
	if !codes["diagnostics.store.capacity_exceeded"] {
		t.Fatalf("meta-diagnostic missing: %#v", codes)
	}

	logged := buf.String()
	if !strings.Contains(logged, "cap reached") || !strings.Contains(logged, "channel=oldest") {
		t.Fatalf("eviction warn missing or wrong: %q", logged)
	}
}

func TestDiagnosticStorePublishesOnStoreChange(t *testing.T) {
	var captured [][]byte
	var mu sync.Mutex
	store := NewDiagnosticStore(DiagnosticStoreOptions{
		Debounce: -1,
		Publish: func(env []byte) {
			mu.Lock()
			captured = append(captured, append([]byte(nil), env...))
			mu.Unlock()
		},
	})

	store.Note("trails", "trails.cache.unreadable", severityWarning, "broken", WithTTL(0))

	mu.Lock()
	defer mu.Unlock()
	if len(captured) != 1 {
		t.Fatalf("publish count = %d, want 1", len(captured))
	}
	envelope := decodeDiagnosticsEnvelopeForTest(t, captured[0])
	if envelope.Schema != "ident.diagnostics.v1" {
		t.Fatalf("schema = %q", envelope.Schema)
	}
	if len(envelope.Diagnostics) != 1 || envelope.Diagnostics[0].Code != "trails.cache.unreadable" {
		t.Fatalf("payload = %#v", envelope.Diagnostics)
	}
}

func TestDiagnosticStoreDebouncesBurstyNotes(t *testing.T) {
	var published int
	var mu sync.Mutex
	store := NewDiagnosticStore(DiagnosticStoreOptions{
		Debounce: 50 * time.Millisecond,
		Publish: func([]byte) {
			mu.Lock()
			published++
			mu.Unlock()
		},
	})

	for i := 0; i < 10; i++ {
		store.Note("burst", "burst.code", severityWarning, "msg", WithTTL(0), WithScope("scope-"+itoa(i)))
	}

	// Burst should NOT publish synchronously beyond at most one flush.
	mu.Lock()
	if published > 1 {
		mu.Unlock()
		t.Fatalf("debounce failed: published=%d before timer fires", published)
	}
	mu.Unlock()

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		done := published >= 1
		mu.Unlock()
		if done {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	mu.Lock()
	defer mu.Unlock()
	if published < 1 {
		t.Fatalf("debounced publish never fired")
	}
	if published > 2 {
		t.Fatalf("debounced publish fired too often: %d", published)
	}
}

func TestDiagnosticStoreScopeKeepsPerInstanceDiagnosticsIndependent(t *testing.T) {
	store := NewDiagnosticStore(DiagnosticStoreOptions{Debounce: -1})

	store.Note("replay", "replay.cache.unreadable", severityWarning, "block A", WithScope("block-a"), WithTTL(0))
	store.Note("replay", "replay.cache.unreadable", severityWarning, "block B", WithScope("block-b"), WithTTL(0))

	snap := store.Snapshot()
	if len(snap) != 2 {
		t.Fatalf("scoped entries collapsed: %#v", snap)
	}
	scopes := map[string]bool{}
	for _, d := range snap {
		scopes[d.Scope] = true
	}
	if !scopes["block-a"] || !scopes["block-b"] {
		t.Fatalf("scopes = %#v", scopes)
	}
}

func TestDiagnosticStoreTickPublishesAfterExpiry(t *testing.T) {
	clock := newFakeClock(time.Unix(1_700_000_000, 0))
	var published int
	store := NewDiagnosticStore(DiagnosticStoreOptions{
		Debounce: -1,
		Now:      clock.Now,
		Publish: func([]byte) {
			published++
		},
	})

	store.Note("aircraft", "aircraft.adapter.counter_reset", severityWarning, "reset", WithTTL(10*time.Second))
	beforeTick := published
	clock.Advance(20 * time.Second)
	store.Tick()
	if published <= beforeTick {
		t.Fatalf("Tick did not republish after expiry: before=%d after=%d", beforeTick, published)
	}
	if len(store.Snapshot()) != 0 {
		t.Fatalf("entry not pruned after Tick")
	}
}

func TestDiagnosticStoreNoteOnNilStoreIsSafe(t *testing.T) {
	// Adapter code paths that don't attach a store still call Note via
	// helpers. Calling Note on nil must be a no-op, not a panic.
	var store *DiagnosticStore
	store.Note("anything", "anything", severityWarning, "msg")
}

func TestDiagnosticStoreNoteRejectsEmptyIdentity(t *testing.T) {
	var buf bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	store := NewDiagnosticStore(DiagnosticStoreOptions{Debounce: -1})
	if store.Note("", "code", severityWarning, "msg") {
		t.Fatalf("Note with empty channel should be a no-op")
	}
	if store.Note("channel", "", severityWarning, "msg") {
		t.Fatalf("Note with empty code should be a no-op")
	}
	if snap := store.Snapshot(); len(snap) != 0 {
		t.Fatalf("empty-identity Notes still inserted: %#v", snap)
	}
	logged := buf.String()
	if !strings.Contains(logged, "level=ERROR") || !strings.Contains(logged, "empty") {
		t.Fatalf("expected programmer-error slog on empty identity, got %q", logged)
	}
}

func TestDiagnosticStoreEnvelopeMatchesWireSchema(t *testing.T) {
	store := NewDiagnosticStore(DiagnosticStoreOptions{Debounce: -1})
	store.Note("stats", "stats.adapter.malformed_file", severityError, "stats.json could not be parsed",
		WithTTL(0),
		WithActionLink("Inspect", "https://example.test"),
	)
	envelope, err := marshalDiagnosticsEnvelope(store.Snapshot())
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var outer struct {
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(envelope, &outer); err != nil {
		t.Fatalf("decode envelope: %v\n%s", err, envelope)
	}
	if outer.Type != "diagnostics" {
		t.Fatalf("type = %q", outer.Type)
	}
	var payload identDiagnostics
	if err := json.Unmarshal(outer.Data, &payload); err != nil {
		t.Fatalf("decode payload: %v\n%s", err, outer.Data)
	}
	if payload.Schema != "ident.diagnostics.v1" || len(payload.Diagnostics) != 1 {
		t.Fatalf("payload = %#v", payload)
	}
	got := payload.Diagnostics[0]
	if got.Action == nil || got.Action.Label != "Inspect" || got.Action.URL != "https://example.test" {
		t.Fatalf("action link not preserved: %#v", got)
	}
}

func TestDiagnosticStoreConcurrentNoteAndSnapshotIsRaceFree(t *testing.T) {
	store := NewDiagnosticStore(DiagnosticStoreOptions{Debounce: -1})
	const workers = 50
	const iterations = 200
	var wg sync.WaitGroup
	wg.Add(workers)
	for w := 0; w < workers; w++ {
		go func(id int) {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				store.Note("fuzz", "fuzz.code", severityWarning, "msg", WithTTL(0), WithScope("scope-"+itoa(id)))
				_ = store.Snapshot()
				store.Tick()
			}
		}(w)
	}
	wg.Wait()
	if got := len(store.Snapshot()); got != workers {
		t.Fatalf("scope count = %d, want %d", got, workers)
	}
}

func TestDiagnosticStoreMetaSurvivesMultipleOverflows(t *testing.T) {
	clock := newFakeClock(time.Unix(1_700_000_000, 0))
	store := NewDiagnosticStore(DiagnosticStoreOptions{
		Debounce: -1,
		Cap:      3,
		Now:      clock.Now,
	})

	store.Note("a", "a.code", severityWarning, "1", WithTTL(0))
	store.Note("b", "b.code", severityWarning, "2", WithTTL(0))
	store.Note("c", "c.code", severityWarning, "3", WithTTL(0))
	// First overflow creates meta.
	store.Note("d", "d.code", severityWarning, "4", WithTTL(0))
	// Second overflow must keep meta visible (meta is excluded from FIFO).
	store.Note("e", "e.code", severityWarning, "5", WithTTL(0))
	// Third overflow likewise.
	store.Note("f", "f.code", severityWarning, "6", WithTTL(0))

	snap := store.Snapshot()
	found := false
	for _, d := range snap {
		if d.Code == "diagnostics.store.capacity_exceeded" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("meta-diagnostic dropped after subsequent overflows: %#v", snap)
	}
}

func TestDiagnosticStoreEvictionLogIncludesFullAttributePayload(t *testing.T) {
	var buf bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	clock := newFakeClock(time.Unix(1_700_000_000, 0))
	store := NewDiagnosticStore(DiagnosticStoreOptions{
		Debounce: -1,
		Cap:      2,
		Now:      clock.Now,
	})
	store.Note("oldest", "oldest.code", severityWarning, "1", WithTTL(0))
	clock.Advance(7 * time.Second)
	store.Note("middle", "middle.code", severityWarning, "2", WithTTL(0))
	clock.Advance(2 * time.Second)
	store.Note("newest", "newest.code", severityWarning, "3", WithTTL(0))

	logged := buf.String()
	for _, attr := range []string{"channel=oldest", "code=oldest.code", "severity=warning", "ageSec="} {
		if !strings.Contains(logged, attr) {
			t.Fatalf("eviction log missing %q: %q", attr, logged)
		}
	}
}

func TestDiagnosticStoreWithActionLinkUpdatesAndClears(t *testing.T) {
	store := NewDiagnosticStore(DiagnosticStoreOptions{Debounce: -1})
	store.Note("update", "update.release.available", severityInfo, "v1",
		WithTTL(0),
		WithActionLink("Release notes", "https://example.test/v1"),
	)
	snap := store.Snapshot()
	if len(snap) != 1 || snap[0].Action == nil || snap[0].Action.Label != "Release notes" {
		t.Fatalf("initial action not attached: %#v", snap)
	}

	store.Note("update", "update.release.available", severityInfo, "v1",
		WithTTL(0),
		WithActionLink("New label", "https://new.url/"),
	)
	snap = store.Snapshot()
	if len(snap) != 1 || snap[0].Action == nil || snap[0].Action.Label != "New label" || snap[0].Action.URL != "https://new.url/" {
		t.Fatalf("re-emit did not update action: %#v", snap)
	}

	store.Note("update", "update.release.available", severityInfo, "v1",
		WithTTL(0),
		WithActionLink("", ""),
	)
	snap = store.Snapshot()
	if len(snap) != 1 || snap[0].Action != nil {
		t.Fatalf("empty action link did not clear Action: %#v", snap)
	}
}

type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func newFakeClock(start time.Time) *fakeClock {
	return &fakeClock{now: start}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func decodeDiagnosticsEnvelopeForTest(t *testing.T, env []byte) identDiagnostics {
	t.Helper()
	var outer struct {
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(env, &outer); err != nil {
		t.Fatalf("decode envelope: %v\n%s", err, env)
	}
	if outer.Type != "diagnostics" {
		t.Fatalf("type = %q", outer.Type)
	}
	var payload identDiagnostics
	if err := json.Unmarshal(outer.Data, &payload); err != nil {
		t.Fatalf("decode diagnostics payload: %v\n%s", err, outer.Data)
	}
	return payload
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var buf [16]byte
	pos := len(buf)
	negative := i < 0
	if negative {
		i = -i
	}
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	if negative {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}
