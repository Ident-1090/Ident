package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type trailEnvelopeForTest struct {
	Type string `json:"type"`
	Data struct {
		Aircraft map[string][]trailPointForTest `json:"aircraft"`
	} `json:"data"`
}

type trailPointForTest struct {
	Lat       float64 `json:"lat"`
	Lon       float64 `json:"lon"`
	Alt       any     `json:"alt"`
	Ts        int64   `json:"ts"`
	Ground    bool    `json:"ground"`
	Segment   int     `json:"segment"`
	GS        float64 `json:"gs"`
	Track     float64 `json:"track"`
	Source    string  `json:"source"`
	AltSource string  `json:"alt_source"`
	AltGeom   float64 `json:"alt_geom"`
}

func floatPtrForTest(v float64) *float64 {
	return &v
}

type trailFrameOptionForTest func(*identAircraft)

func trailFrameForTest(now float64, hex string, lat, lon float64, opts ...trailFrameOptionForTest) identAircraftFrame {
	ac := identAircraft{
		Hex:    hex,
		IDKind: aircraftIDKind(hex),
		Source: aircraftSource(""),
		Lat:    floatPtrForTest(lat),
		Lon:    floatPtrForTest(lon),
	}
	for _, opt := range opts {
		opt(&ac)
	}
	return identAircraftFrame{
		Schema:             "ident.aircraft.v1",
		ObservedAtEpochSec: now,
		Aircraft:           []identAircraft{ac},
	}
}

func trailBaroAltForTest(alt float64) trailFrameOptionForTest {
	return func(ac *identAircraft) {
		ac.AltBaroFt = floatPtrForTest(alt)
	}
}

func trailGeomAltForTest(alt float64) trailFrameOptionForTest {
	return func(ac *identAircraft) {
		ac.AltGeomFt = floatPtrForTest(alt)
	}
}

func trailGroundForTest() trailFrameOptionForTest {
	return func(ac *identAircraft) {
		ground := true
		ac.OnGround = &ground
	}
}

func trailGSForTest(gs float64) trailFrameOptionForTest {
	return func(ac *identAircraft) {
		ac.GsKt = floatPtrForTest(gs)
	}
}

func trailTrackForTest(track float64) trailFrameOptionForTest {
	return func(ac *identAircraft) {
		ac.TrackDeg = floatPtrForTest(track)
	}
}

func trailSeenPosForTest(seenPos float64) trailFrameOptionForTest {
	return func(ac *identAircraft) {
		ac.SeenPosSec = floatPtrForTest(seenPos)
	}
}

func trailSourceForTest(source identAircraftSource) trailFrameOptionForTest {
	return func(ac *identAircraft) {
		ac.Source = source
	}
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

	delta := store.IngestAircraftFrame(trailFrameForTest(100, "abc123", 34.1, -118.2, trailBaroAltForTest(3000)))
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

	if delta := store.IngestAircraftFrame(trailFrameForTest(102, "abc123", 34.2, -118.3, trailBaroAltForTest(3100))); delta != nil {
		t.Fatalf("sample interval delta = %s, want nil", string(delta))
	}

	delta = store.IngestAircraftFrame(trailFrameForTest(106, "abc123", 34.3, -118.4, trailGroundForTest()))
	env = decodeTrailEnvelopeForTest(t, delta)
	points = env.Data.Aircraft["abc123"]
	if len(points) != 1 || points[0].Alt != nil || !points[0].Ground || points[0].Ts != 106_000 {
		t.Fatalf("unexpected sampled point: %#v", points)
	}

	delta = store.IngestAircraftFrame(trailFrameForTest(120, "abc123", 34.4, -118.5, trailBaroAltForTest(3400)))
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
	store.IngestAircraftFrame(trailFrameForTest(100, "abc123", 34.1, -118.2, trailBaroAltForTest(3000)))
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

func TestTrailStorePreservesTrailMetadata(t *testing.T) {
	store := NewTrailStore(TrailOptions{
		MemoryWindow:   2 * time.Hour,
		SampleInterval: time.Second,
	})

	delta := store.IngestAircraftFrame(trailFrameForTest(100, "abc123", 34.1, -118.2, trailSourceForTest(aircraftSourceADSBICAO), trailBaroAltForTest(3000), trailGSForTest(141.5), trailTrackForTest(275.2), trailSeenPosForTest(3)))
	env := decodeTrailEnvelopeForTest(t, delta)
	points := env.Data.Aircraft["abc123"]
	if len(points) != 1 {
		t.Fatalf("points = %#v, want one point", points)
	}
	if points[0].Ground || points[0].Segment != 0 || points[0].GS != 141.5 || points[0].Track != 275.2 || points[0].Source != "adsb_icao" || points[0].AltSource != "baro" {
		t.Fatalf("metadata = %#v", points[0])
	}
	if !bytes.Contains(delta, []byte(`"segment":0`)) {
		t.Fatalf("default segment was not serialized: %s", string(delta))
	}

	delta = store.IngestAircraftFrame(trailFrameForTest(106, "abc123", 34.2, -118.3, trailSourceForTest(aircraftSourceMLAT), trailGeomAltForTest(3200), trailGSForTest(130), trailTrackForTest(270), trailSeenPosForTest(24)))
	env = decodeTrailEnvelopeForTest(t, delta)
	points = env.Data.Aircraft["abc123"]
	if len(points) != 1 {
		t.Fatalf("points = %#v, want one point", points)
	}
	if points[0].Alt != float64(3200) || points[0].Ground || points[0].AltSource != "geom" || points[0].Source != "mlat" {
		t.Fatalf("geometric metadata = %#v", points[0])
	}
}

func TestTrailStorePreservesAlternateGeometricAltitude(t *testing.T) {
	store := NewTrailStore(TrailOptions{
		MemoryWindow:   2 * time.Hour,
		SampleInterval: time.Second,
	})

	delta := store.IngestAircraftFrame(trailFrameForTest(100, "abc123", 34.1, -118.2, trailBaroAltForTest(3000), trailGeomAltForTest(3175)))
	env := decodeTrailEnvelopeForTest(t, delta)
	points := env.Data.Aircraft["abc123"]
	if len(points) != 1 {
		t.Fatalf("points = %#v, want one point", points)
	}
	if points[0].Alt != float64(3000) || points[0].AltSource != "baro" || points[0].AltGeom != 3175 {
		t.Fatalf("altitude metadata = %#v", points[0])
	}
}

func TestTrailStoreStartsNewSegmentAfterGroundDwell(t *testing.T) {
	store := NewTrailStore(TrailOptions{
		MemoryWindow:   2 * time.Hour,
		SampleInterval: time.Second,
	})

	store.IngestAircraftFrame(trailFrameForTest(100, "abc123", 34.1, -118.2, trailBaroAltForTest(3000)))
	store.IngestAircraftFrame(trailFrameForTest(130, "abc123", 34.2, -118.3, trailGroundForTest(), trailGSForTest(12)))
	store.IngestAircraftFrame(trailFrameForTest(200, "abc123", 34.3, -118.4, trailGroundForTest(), trailGSForTest(0)))
	delta := store.IngestAircraftFrame(trailFrameForTest(206, "abc123", 34.4, -118.5, trailBaroAltForTest(1500), trailGSForTest(165)))

	env := decodeTrailEnvelopeForTest(t, delta)
	points := env.Data.Aircraft["abc123"]
	if len(points) != 1 {
		t.Fatalf("points = %#v, want one point", points)
	}
	if points[0].Segment != 1 || points[0].Ground {
		t.Fatalf("takeoff point = %#v, want segment 1 airborne", points[0])
	}
}

func TestTrailStoreDoesNotStartSegmentBeforeGroundDwell(t *testing.T) {
	store := NewTrailStore(TrailOptions{
		MemoryWindow:   2 * time.Hour,
		SampleInterval: time.Second,
	})

	store.IngestAircraftFrame(trailFrameForTest(100, "abc123", 34.1, -118.2, trailBaroAltForTest(3000)))
	store.IngestAircraftFrame(trailFrameForTest(130, "abc123", 34.2, -118.3, trailGroundForTest()))
	delta := store.IngestAircraftFrame(trailFrameForTest(189.999, "abc123", 34.3, -118.4, trailBaroAltForTest(1500)))

	env := decodeTrailEnvelopeForTest(t, delta)
	points := env.Data.Aircraft["abc123"]
	if len(points) != 1 || points[0].Segment != 0 {
		t.Fatalf("short dwell takeoff = %#v, want segment 0", points)
	}
}

func TestTrailStoreStartsSegmentAtGroundDwellBoundary(t *testing.T) {
	store := NewTrailStore(TrailOptions{
		MemoryWindow:   2 * time.Hour,
		SampleInterval: time.Second,
	})

	store.IngestAircraftFrame(trailFrameForTest(100, "abc123", 34.1, -118.2, trailBaroAltForTest(3000)))
	store.IngestAircraftFrame(trailFrameForTest(130, "abc123", 34.2, -118.3, trailGroundForTest()))
	delta := store.IngestAircraftFrame(trailFrameForTest(190, "abc123", 34.3, -118.4, trailBaroAltForTest(1500)))

	env := decodeTrailEnvelopeForTest(t, delta)
	points := env.Data.Aircraft["abc123"]
	if len(points) != 1 || points[0].Segment != 1 {
		t.Fatalf("boundary dwell takeoff = %#v, want segment 1", points)
	}
}

func TestTrailStoreKeepsGroundDwellAcrossTransientAirborneSample(t *testing.T) {
	store := NewTrailStore(TrailOptions{
		MemoryWindow:   2 * time.Hour,
		SampleInterval: time.Second,
	})

	store.IngestAircraftFrame(trailFrameForTest(100, "abc123", 34.1, -118.2, trailBaroAltForTest(3000)))
	store.IngestAircraftFrame(trailFrameForTest(130, "abc123", 34.2, -118.3, trailGroundForTest()))
	store.IngestAircraftFrame(trailFrameForTest(150, "abc123", 34.21, -118.31, trailBaroAltForTest(25)))
	store.IngestAircraftFrame(trailFrameForTest(170, "abc123", 34.22, -118.32, trailGroundForTest()))
	delta := store.IngestAircraftFrame(trailFrameForTest(195, "abc123", 34.3, -118.4, trailBaroAltForTest(1500)))

	env := decodeTrailEnvelopeForTest(t, delta)
	points := env.Data.Aircraft["abc123"]
	if len(points) != 1 || points[0].Segment != 1 {
		t.Fatalf("takeoff after transient airborne point = %#v, want segment 1", points)
	}
}

func TestTrailStoreKeepsGroundDwellAcrossDiscardedAirborneJitter(t *testing.T) {
	store := NewTrailStore(TrailOptions{
		MemoryWindow:   2 * time.Hour,
		SampleInterval: time.Second,
	})

	store.IngestAircraftFrame(trailFrameForTest(100, "abc123", 34.1, -118.2, trailBaroAltForTest(3000)))
	store.IngestAircraftFrame(trailFrameForTest(130, "abc123", 34.2, -118.3, trailGroundForTest()))
	store.IngestAircraftFrame(trailFrameForTest(130.5, "abc123", 34.21, -118.31, trailBaroAltForTest(25)))
	store.IngestAircraftFrame(trailFrameForTest(130.9, "abc123", 34.22, -118.32, trailBaroAltForTest(30)))
	store.IngestAircraftFrame(trailFrameForTest(131.5, "abc123", 34.23, -118.33, trailGroundForTest()))
	delta := store.IngestAircraftFrame(trailFrameForTest(190, "abc123", 34.3, -118.4, trailBaroAltForTest(1500)))

	env := decodeTrailEnvelopeForTest(t, delta)
	points := env.Data.Aircraft["abc123"]
	if len(points) != 1 || points[0].Segment != 1 {
		t.Fatalf("takeoff after discarded jitter = %#v, want segment 1", points)
	}
}

func TestTrailStoreKeepsGroundDwellAcrossMultipleAirborneBlips(t *testing.T) {
	store := NewTrailStore(TrailOptions{
		MemoryWindow:   2 * time.Hour,
		SampleInterval: time.Second,
	})

	store.IngestAircraftFrame(trailFrameForTest(100, "abc123", 34.1, -118.2, trailBaroAltForTest(3000)))
	store.IngestAircraftFrame(trailFrameForTest(130, "abc123", 34.2, -118.3, trailGroundForTest()))
	store.IngestAircraftFrame(trailFrameForTest(150, "abc123", 34.21, -118.31, trailBaroAltForTest(25)))
	store.IngestAircraftFrame(trailFrameForTest(155, "abc123", 34.22, -118.32, trailBaroAltForTest(30)))
	store.IngestAircraftFrame(trailFrameForTest(170, "abc123", 34.23, -118.33, trailGroundForTest()))
	delta := store.IngestAircraftFrame(trailFrameForTest(195, "abc123", 34.3, -118.4, trailBaroAltForTest(1500)))

	env := decodeTrailEnvelopeForTest(t, delta)
	points := env.Data.Aircraft["abc123"]
	if len(points) != 1 || points[0].Segment != 1 {
		t.Fatalf("takeoff after repeated airborne blips = %#v, want segment 1", points)
	}
}

func TestTrailStoreKeepsUnknownAltitudeUnknown(t *testing.T) {
	store := NewTrailStore(TrailOptions{
		MemoryWindow:   2 * time.Hour,
		SampleInterval: time.Second,
	})

	delta := store.IngestAircraftFrame(trailFrameForTest(100, "abc123", 34.1, -118.2, trailGSForTest(141.5)))
	env := decodeTrailEnvelopeForTest(t, delta)
	points := env.Data.Aircraft["abc123"]
	if len(points) != 1 {
		t.Fatalf("points = %#v, want one point", points)
	}
	if points[0].Alt != nil || points[0].Ground || points[0].AltSource != "" {
		t.Fatalf("unknown altitude point = %#v", points[0])
	}
}

func TestTrailStoreIgnoresUnreadableRestartCache(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, restartTrailCacheName)
	if err := os.WriteFile(path, []byte(`not gzip`), 0o644); err != nil {
		t.Fatalf("write cache: %v", err)
	}

	diagnostics := NewDiagnosticStore(DiagnosticStoreOptions{})
	store := NewTrailStore(TrailOptions{
		MemoryWindow:    2 * time.Hour,
		SampleInterval:  time.Second,
		RestartCacheDir: dir,
		Diagnostics:     diagnostics,
	})
	if err := store.LoadRestartCache(); err != nil {
		t.Fatalf("load restart cache: %v", err)
	}
	if snaps := store.SnapshotEnvelopes(); len(snaps) != 0 {
		t.Fatalf("unreadable cache snapshots = %d, want 0", len(snaps))
	}
	gotDiagnostics := diagnostics.Snapshot()
	if len(gotDiagnostics) != 1 || gotDiagnostics[0].Code != "trails.cache.unreadable" {
		t.Fatalf("diagnostics = %#v", gotDiagnostics)
	}
}

func TestTrailStoreIgnoresRestartCacheWithoutCurrentVersion(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, restartTrailCacheName)
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create cache: %v", err)
	}
	gz := gzip.NewWriter(f)
	encErr := json.NewEncoder(gz).Encode(struct {
		Aircraft map[string][]trailPoint `json:"aircraft"`
	}{
		Aircraft: map[string][]trailPoint{
			"abc123": {
				{Lat: 34.1, Lon: -118.2, Alt: floatPtrForTest(3000), Ts: 100_000, Segment: 0},
			},
		},
	})
	closeGzErr := gz.Close()
	closeFileErr := f.Close()
	if encErr != nil {
		t.Fatalf("encode cache: %v", encErr)
	}
	if closeGzErr != nil {
		t.Fatalf("close gzip: %v", closeGzErr)
	}
	if closeFileErr != nil {
		t.Fatalf("close file: %v", closeFileErr)
	}

	diagnostics := NewDiagnosticStore(DiagnosticStoreOptions{})
	store := NewTrailStore(TrailOptions{
		MemoryWindow:    2 * time.Hour,
		SampleInterval:  time.Second,
		RestartCacheDir: dir,
		Diagnostics:     diagnostics,
	})
	if err := store.LoadRestartCache(); err != nil {
		t.Fatalf("load restart cache: %v", err)
	}
	if snaps := store.SnapshotEnvelopes(); len(snaps) != 0 {
		t.Fatalf("unversioned cache snapshots = %d, want 0", len(snaps))
	}
	gotDiagnostics := diagnostics.Snapshot()
	if len(gotDiagnostics) != 1 || gotDiagnostics[0].Code != "trails.cache.unsupported_version" {
		t.Fatalf("diagnostics = %#v", gotDiagnostics)
	}
}

func TestTrailStoreIgnoresRestartCacheWithUnknownFields(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, restartTrailCacheName)
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create cache: %v", err)
	}
	gz := gzip.NewWriter(f)
	encErr := json.NewEncoder(gz).Encode(struct {
		Version  int                     `json:"version"`
		Aircraft map[string][]trailPoint `json:"aircraft"`
		Extra    string                  `json:"extra"`
	}{
		Version: trailCacheVersion,
		Aircraft: map[string][]trailPoint{
			"abc123": {
				{Lat: 34.1, Lon: -118.2, Alt: floatPtrForTest(3000), Ts: 100_000, Segment: 0},
			},
		},
		Extra: "unexpected",
	})
	closeGzErr := gz.Close()
	closeFileErr := f.Close()
	if encErr != nil {
		t.Fatalf("encode cache: %v", encErr)
	}
	if closeGzErr != nil {
		t.Fatalf("close gzip: %v", closeGzErr)
	}
	if closeFileErr != nil {
		t.Fatalf("close file: %v", closeFileErr)
	}

	diagnostics := NewDiagnosticStore(DiagnosticStoreOptions{})
	store := NewTrailStore(TrailOptions{
		MemoryWindow:    2 * time.Hour,
		SampleInterval:  time.Second,
		RestartCacheDir: dir,
		Diagnostics:     diagnostics,
	})
	if err := store.LoadRestartCache(); err != nil {
		t.Fatalf("load restart cache: %v", err)
	}
	if snaps := store.SnapshotEnvelopes(); len(snaps) != 0 {
		t.Fatalf("unknown-field cache snapshots = %d, want 0", len(snaps))
	}
	gotDiagnostics := diagnostics.Snapshot()
	if len(gotDiagnostics) != 1 || gotDiagnostics[0].Code != "trails.cache.unreadable" {
		t.Fatalf("diagnostics = %#v", gotDiagnostics)
	}
}

func TestTrailStoreRestartCachePreservesSegmentContinuity(t *testing.T) {
	dir := t.TempDir()
	store := NewTrailStore(TrailOptions{
		MemoryWindow:    2 * time.Hour,
		SampleInterval:  time.Second,
		RestartCacheDir: dir,
	})

	store.IngestAircraftFrame(trailFrameForTest(100, "abc123", 34.1, -118.2, trailBaroAltForTest(3000)))
	store.IngestAircraftFrame(trailFrameForTest(110, "abc123", 34.2, -118.3, trailGroundForTest()))
	store.IngestAircraftFrame(trailFrameForTest(170, "abc123", 34.3, -118.4, trailBaroAltForTest(1500)))
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
	restored.IngestAircraftFrame(trailFrameForTest(200, "abc123", 34.4, -118.5, trailGroundForTest()))
	delta := restored.IngestAircraftFrame(trailFrameForTest(260, "abc123", 34.5, -118.6, trailBaroAltForTest(2000)))

	env := decodeTrailEnvelopeForTest(t, delta)
	points := env.Data.Aircraft["abc123"]
	if len(points) != 1 || points[0].Segment != 2 {
		t.Fatalf("post-restart takeoff = %#v, want segment 2", points)
	}
}

func TestTrailStoreRestartCachePreservesActiveGroundDwellState(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, restartTrailCacheName)
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create cache: %v", err)
	}
	gz := gzip.NewWriter(f)
	cache := trailCacheFile{
		Version: trailCacheVersion,
		Aircraft: map[string][]trailPoint{
			"abc123": {
				{Lat: 34.1, Lon: -118.2, Alt: floatPtrForTest(3000), Ts: 100_000, Segment: 0},
			},
		},
		States: map[string]trailAircraftState{
			"abc123": {Segment: 0, LastTs: 130_000, LastGround: true, GroundSince: 130_000},
		},
	}
	encErr := json.NewEncoder(gz).Encode(cache)
	closeGzErr := gz.Close()
	closeFileErr := f.Close()
	if encErr != nil {
		t.Fatalf("encode cache: %v", encErr)
	}
	if closeGzErr != nil {
		t.Fatalf("close gzip: %v", closeGzErr)
	}
	if closeFileErr != nil {
		t.Fatalf("close file: %v", closeFileErr)
	}

	restored := NewTrailStore(TrailOptions{
		MemoryWindow:    2 * time.Hour,
		SampleInterval:  time.Second,
		RestartCacheDir: dir,
	})
	if err := restored.LoadRestartCache(); err != nil {
		t.Fatalf("load restart cache: %v", err)
	}
	delta := restored.IngestAircraftFrame(trailFrameForTest(190, "abc123", 34.3, -118.4, trailBaroAltForTest(1500)))

	env := decodeTrailEnvelopeForTest(t, delta)
	points := env.Data.Aircraft["abc123"]
	if len(points) != 1 || points[0].Segment != 1 {
		t.Fatalf("post-restart active-dwell takeoff = %#v, want segment 1", points)
	}
}

func TestTrailStoreRestartCachePreservesAltGeom(t *testing.T) {
	dir := t.TempDir()
	store := NewTrailStore(TrailOptions{
		MemoryWindow:    2 * time.Hour,
		SampleInterval:  time.Second,
		RestartCacheDir: dir,
	})

	store.IngestAircraftFrame(trailFrameForTest(100, "abc123", 34.1, -118.2, trailBaroAltForTest(3000), trailGeomAltForTest(3175)))
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
	env := decodeTrailEnvelopeForTest(t, restored.SnapshotEnvelopes()[0])
	points := env.Data.Aircraft["abc123"]
	if len(points) != 1 || points[0].AltGeom != 3175 {
		t.Fatalf("restored alt_geom = %#v, want 3175", points)
	}
}
