package main

import (
	"encoding/json"
	"testing"
	"time"
)

type trailEnvelopeForTest struct {
	Type      string `json:"type"`
	RequestID string `json:"request_id"`
	Truncated bool   `json:"truncated"`
	Data      struct {
		Aircraft map[string][]trailPointForTest `json:"aircraft"`
	} `json:"data"`
}

type trailPointForTest struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
	Alt any     `json:"alt"`
	Ts  int64   `json:"ts"`
}

func decodeTrailEnvelopeForTest(t *testing.T, b []byte) trailEnvelopeForTest {
	t.Helper()
	var env trailEnvelopeForTest
	if err := json.Unmarshal(b, &env); err != nil {
		t.Fatalf("unmarshal trail envelope: %v", err)
	}
	return env
}

func TestTrailStoreSamplesAndPrunesAircraftPositions(t *testing.T) {
	store := NewTrailStore(TrailOptions{
		MemoryWindow:   10 * time.Second,
		SampleInterval: 5 * time.Second,
	})

	delta := store.IngestAircraftJSON([]byte(`{"now":100,"aircraft":[{"hex":"abc123","lat":34.1,"lon":-118.2,"alt_baro":3000}]}`))
	env := decodeTrailEnvelopeForTest(t, delta)
	if env.Type != "trails" {
		t.Fatalf("type = %q, want trails", env.Type)
	}
	points := env.Data.Aircraft["abc123"]
	if len(points) != 1 {
		t.Fatalf("delta points = %d, want 1", len(points))
	}
	if points[0].Lat != 34.1 || points[0].Lon != -118.2 || points[0].Alt != float64(3000) || points[0].Ts != 100_000 {
		t.Fatalf("unexpected first point: %#v", points[0])
	}

	if delta := store.IngestAircraftJSON([]byte(`{"now":102,"aircraft":[{"hex":"abc123","lat":34.2,"lon":-118.3,"alt_baro":3100}]}`)); delta != nil {
		t.Fatalf("sample interval delta = %s, want nil", string(delta))
	}

	delta = store.IngestAircraftJSON([]byte(`{"now":106,"aircraft":[{"hex":"abc123","lat":34.3,"lon":-118.4,"alt_baro":"ground"}]}`))
	env = decodeTrailEnvelopeForTest(t, delta)
	points = env.Data.Aircraft["abc123"]
	if len(points) != 1 || points[0].Alt != "ground" || points[0].Ts != 106_000 {
		t.Fatalf("unexpected sampled point: %#v", points)
	}

	delta = store.IngestAircraftJSON([]byte(`{"now":120,"aircraft":[{"hex":"abc123","lat":34.4,"lon":-118.5,"alt_baro":3400}]}`))
	env = decodeTrailEnvelopeForTest(t, delta)
	points = env.Data.Aircraft["abc123"]
	if len(points) != 1 || points[0].Ts != 120_000 {
		t.Fatalf("unexpected pruning delta: %#v", points)
	}

	snaps := store.SnapshotEnvelopes()
	if len(snaps) != 1 {
		t.Fatalf("snapshots = %d, want 1", len(snaps))
	}
	snap := decodeTrailEnvelopeForTest(t, snaps[0])
	points = snap.Data.Aircraft["abc123"]
	if len(points) != 1 || points[0].Ts != 120_000 {
		t.Fatalf("snapshot points = %#v, want only latest point", points)
	}
}

func TestTrailStoreRestartCacheRoundTrip(t *testing.T) {
	dir := t.TempDir()
	store := NewTrailStore(TrailOptions{
		MemoryWindow:    2 * time.Hour,
		SampleInterval:  time.Second,
		RestartCacheDir: dir,
	})
	store.IngestAircraftJSON([]byte(`{"now":100,"aircraft":[{"hex":"abc123","lat":34.1,"lon":-118.2,"alt_baro":3000}]}`))
	if err := store.SaveRestartCache(); err != nil {
		t.Fatalf("save restart cache: %v", err)
	}

	restored := NewTrailStore(TrailOptions{
		MemoryWindow:    2 * time.Hour,
		SampleInterval:  time.Second,
		RestartCacheDir: dir,
	})
	if err := restored.LoadRestartCache(); err != nil {
		t.Fatalf("load restart cache: %v", err)
	}

	snaps := restored.SnapshotEnvelopes()
	if len(snaps) != 1 {
		t.Fatalf("snapshots = %d, want 1", len(snaps))
	}
	env := decodeTrailEnvelopeForTest(t, snaps[0])
	points := env.Data.Aircraft["abc123"]
	if len(points) != 1 || points[0].Ts != 100_000 {
		t.Fatalf("restored points = %#v", points)
	}
}

func TestTrailStoreRestartCacheRewritesPrunedState(t *testing.T) {
	dir := t.TempDir()
	store := NewTrailStore(TrailOptions{
		MemoryWindow:    10 * time.Second,
		SampleInterval:  time.Second,
		RestartCacheDir: dir,
	})
	store.IngestAircraftJSON([]byte(`{"now":100,"aircraft":[{"hex":"abc123","lat":34.1,"lon":-118.1,"alt_baro":3000}]}`))
	if err := store.SaveRestartCache(); err != nil {
		t.Fatalf("save first restart cache: %v", err)
	}

	store.IngestAircraftJSON([]byte(`{"now":120,"aircraft":[{"hex":"abc123","lat":34.2,"lon":-118.2,"alt_baro":3200}]}`))
	if err := store.SaveRestartCache(); err != nil {
		t.Fatalf("save second restart cache: %v", err)
	}

	restored := NewTrailStore(TrailOptions{
		MemoryWindow:    10 * time.Second,
		SampleInterval:  time.Second,
		RestartCacheDir: dir,
	})
	if err := restored.LoadRestartCache(); err != nil {
		t.Fatalf("load restart cache: %v", err)
	}
	env := decodeTrailEnvelopeForTest(t, restored.BackfillTrailEnvelope(TrailBackfillRequest{
		SinceMs: 0,
		UntilMs: 120_000,
	}))
	points := env.Data.Aircraft["abc123"]
	if len(points) != 1 || points[0].Ts != 120_000 {
		t.Fatalf("restored points = %#v, want only pruned latest point", points)
	}
}

func TestTrailStoreMemoryWindowPrunesRetainedPoints(t *testing.T) {
	store := NewTrailStore(TrailOptions{
		MemoryWindow:   10 * time.Second,
		SampleInterval: time.Second,
	})
	for _, frame := range []string{
		`{"now":100,"aircraft":[{"hex":"abc123","lat":34.1,"lon":-118.1,"alt_baro":3000}]}`,
		`{"now":105,"aircraft":[{"hex":"abc123","lat":34.2,"lon":-118.2,"alt_baro":3100}]}`,
		`{"now":112,"aircraft":[{"hex":"abc123","lat":34.3,"lon":-118.3,"alt_baro":3200}]}`,
	} {
		store.IngestAircraftJSON([]byte(frame))
	}

	env := decodeTrailEnvelopeForTest(t, store.BackfillTrailEnvelope(TrailBackfillRequest{
		SinceMs: 0,
		UntilMs: 112_000,
	}))
	points := env.Data.Aircraft["abc123"]
	if len(points) != 2 || points[0].Ts != 105_000 || points[1].Ts != 112_000 {
		t.Fatalf("points = %#v, want only points inside memory window", points)
	}
}

func TestTrailStoreSnapshotWindowIsSmallerThanMemoryWindow(t *testing.T) {
	store := NewTrailStore(TrailOptions{
		MemoryWindow:   2 * time.Hour,
		SnapshotWindow: 10 * time.Second,
		SampleInterval: time.Second,
	})
	for _, frame := range []string{
		`{"now":100,"aircraft":[{"hex":"abc123","lat":34.1,"lon":-118.1,"alt_baro":3000}]}`,
		`{"now":112,"aircraft":[{"hex":"abc123","lat":34.2,"lon":-118.2,"alt_baro":3100}]}`,
		`{"now":120,"aircraft":[{"hex":"abc123","lat":34.3,"lon":-118.3,"alt_baro":3200}]}`,
	} {
		store.IngestAircraftJSON([]byte(frame))
	}

	snaps := store.SnapshotEnvelopes()
	if len(snaps) != 1 {
		t.Fatalf("snapshots = %d, want 1", len(snaps))
	}
	env := decodeTrailEnvelopeForTest(t, snaps[0])
	points := env.Data.Aircraft["abc123"]
	if len(points) != 2 || points[0].Ts != 112_000 || points[1].Ts != 120_000 {
		t.Fatalf("snapshot points = %#v, want only last 10 seconds", points)
	}

	backfill := decodeTrailEnvelopeForTest(t, store.BackfillTrailEnvelope(TrailBackfillRequest{
		RequestID: "older",
		SinceMs:   100_000,
		UntilMs:   120_000,
	}))
	points = backfill.Data.Aircraft["abc123"]
	if len(points) != 3 {
		t.Fatalf("backfill points = %#v, want all retained points", points)
	}
}

func TestTrailStoreBackfillRequestClampsWindowAndPointCount(t *testing.T) {
	store := NewTrailStore(TrailOptions{
		MemoryWindow:   time.Hour,
		SnapshotWindow: 10 * time.Second,
		SampleInterval: time.Second,
	})
	for _, frame := range []string{
		`{"now":100,"aircraft":[{"hex":"abc123","lat":34.1,"lon":-118.1,"alt_baro":3000}]}`,
		`{"now":110,"aircraft":[{"hex":"abc123","lat":34.2,"lon":-118.2,"alt_baro":3100}]}`,
		`{"now":120,"aircraft":[{"hex":"abc123","lat":34.3,"lon":-118.3,"alt_baro":3200}]}`,
	} {
		store.IngestAircraftJSON([]byte(frame))
	}

	env := decodeTrailEnvelopeForTest(t, store.BackfillTrailEnvelope(TrailBackfillRequest{
		RequestID: "bounded",
		SinceMs:   100_000,
		UntilMs:   120_000,
		MaxWindow: 10 * time.Second,
		MaxPoints: 1,
	}))
	if env.RequestID != "bounded" {
		t.Fatalf("request id = %q", env.RequestID)
	}
	if !env.Truncated {
		t.Fatalf("expected truncated backfill response")
	}
	points := env.Data.Aircraft["abc123"]
	if len(points) != 1 || points[0].Ts != 110_000 {
		t.Fatalf("points = %#v, want first clamped point only", points)
	}
}
