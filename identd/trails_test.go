package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
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
	Stale     bool    `json:"stale"`
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
	if len(points) != 1 || points[0].Alt != nil || !points[0].Ground || points[0].Ts != 106_000 {
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

func TestTrailStorePreservesTrailMetadata(t *testing.T) {
	store := NewTrailStore(TrailOptions{
		MemoryWindow:   2 * time.Hour,
		SampleInterval: time.Second,
	})

	delta := store.IngestAircraftJSON([]byte(`{"now":100,"aircraft":[{"hex":"abc123","type":"adsb_icao","lat":34.1,"lon":-118.2,"alt_baro":3000,"gs":141.5,"track":275.2,"seen_pos":3}]}`))
	env := decodeTrailEnvelopeForTest(t, delta)
	points := env.Data.Aircraft["abc123"]
	if len(points) != 1 {
		t.Fatalf("points = %#v, want one point", points)
	}
	if points[0].Ground || points[0].Stale || points[0].Segment != 0 || points[0].GS != 141.5 || points[0].Track != 275.2 || points[0].Source != "adsb_icao" || points[0].AltSource != "baro" {
		t.Fatalf("metadata = %#v", points[0])
	}
	if !bytes.Contains(delta, []byte(`"segment":0`)) {
		t.Fatalf("default segment was not serialized: %s", string(delta))
	}

	delta = store.IngestAircraftJSON([]byte(`{"now":106,"aircraft":[{"hex":"abc123","type":"mlat","lat":34.2,"lon":-118.3,"alt_geom":3200,"gs":130,"track":270,"seen_pos":24}]}`))
	env = decodeTrailEnvelopeForTest(t, delta)
	points = env.Data.Aircraft["abc123"]
	if len(points) != 1 {
		t.Fatalf("points = %#v, want one point", points)
	}
	if points[0].Alt != float64(3200) || points[0].Ground || !points[0].Stale || points[0].AltSource != "geom" || points[0].Source != "mlat" {
		t.Fatalf("geometric/stale metadata = %#v", points[0])
	}
}

func TestTrailStorePreservesAlternateGeometricAltitude(t *testing.T) {
	store := NewTrailStore(TrailOptions{
		MemoryWindow:   2 * time.Hour,
		SampleInterval: time.Second,
	})

	delta := store.IngestAircraftJSON([]byte(`{"now":100,"aircraft":[{"hex":"abc123","lat":34.1,"lon":-118.2,"alt_baro":3000,"alt_geom":3175}]}`))
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

	store.IngestAircraftJSON([]byte(`{"now":100,"aircraft":[{"hex":"abc123","lat":34.1,"lon":-118.2,"alt_baro":3000}]}`))
	store.IngestAircraftJSON([]byte(`{"now":130,"aircraft":[{"hex":"abc123","lat":34.2,"lon":-118.3,"alt_baro":"ground","gs":12}]}`))
	store.IngestAircraftJSON([]byte(`{"now":200,"aircraft":[{"hex":"abc123","lat":34.3,"lon":-118.4,"alt_baro":"ground","gs":0}]}`))
	delta := store.IngestAircraftJSON([]byte(`{"now":206,"aircraft":[{"hex":"abc123","lat":34.4,"lon":-118.5,"alt_baro":1500,"gs":165}]}`))

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

	store.IngestAircraftJSON([]byte(`{"now":100,"aircraft":[{"hex":"abc123","lat":34.1,"lon":-118.2,"alt_baro":3000}]}`))
	store.IngestAircraftJSON([]byte(`{"now":130,"aircraft":[{"hex":"abc123","lat":34.2,"lon":-118.3,"alt_baro":"ground"}]}`))
	delta := store.IngestAircraftJSON([]byte(`{"now":189.999,"aircraft":[{"hex":"abc123","lat":34.3,"lon":-118.4,"alt_baro":1500}]}`))

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

	store.IngestAircraftJSON([]byte(`{"now":100,"aircraft":[{"hex":"abc123","lat":34.1,"lon":-118.2,"alt_baro":3000}]}`))
	store.IngestAircraftJSON([]byte(`{"now":130,"aircraft":[{"hex":"abc123","lat":34.2,"lon":-118.3,"alt_baro":"ground"}]}`))
	delta := store.IngestAircraftJSON([]byte(`{"now":190,"aircraft":[{"hex":"abc123","lat":34.3,"lon":-118.4,"alt_baro":1500}]}`))

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

	store.IngestAircraftJSON([]byte(`{"now":100,"aircraft":[{"hex":"abc123","lat":34.1,"lon":-118.2,"alt_baro":3000}]}`))
	store.IngestAircraftJSON([]byte(`{"now":130,"aircraft":[{"hex":"abc123","lat":34.2,"lon":-118.3,"alt_baro":"ground"}]}`))
	store.IngestAircraftJSON([]byte(`{"now":150,"aircraft":[{"hex":"abc123","lat":34.21,"lon":-118.31,"alt_baro":25}]}`))
	store.IngestAircraftJSON([]byte(`{"now":170,"aircraft":[{"hex":"abc123","lat":34.22,"lon":-118.32,"alt_baro":"ground"}]}`))
	delta := store.IngestAircraftJSON([]byte(`{"now":195,"aircraft":[{"hex":"abc123","lat":34.3,"lon":-118.4,"alt_baro":1500}]}`))

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

	store.IngestAircraftJSON([]byte(`{"now":100,"aircraft":[{"hex":"abc123","lat":34.1,"lon":-118.2,"alt_baro":3000}]}`))
	store.IngestAircraftJSON([]byte(`{"now":130,"aircraft":[{"hex":"abc123","lat":34.2,"lon":-118.3,"alt_baro":"ground"}]}`))
	store.IngestAircraftJSON([]byte(`{"now":130.5,"aircraft":[{"hex":"abc123","lat":34.21,"lon":-118.31,"alt_baro":25}]}`))
	store.IngestAircraftJSON([]byte(`{"now":130.9,"aircraft":[{"hex":"abc123","lat":34.22,"lon":-118.32,"alt_baro":30}]}`))
	store.IngestAircraftJSON([]byte(`{"now":131.5,"aircraft":[{"hex":"abc123","lat":34.23,"lon":-118.33,"alt_baro":"ground"}]}`))
	delta := store.IngestAircraftJSON([]byte(`{"now":190,"aircraft":[{"hex":"abc123","lat":34.3,"lon":-118.4,"alt_baro":1500}]}`))

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

	store.IngestAircraftJSON([]byte(`{"now":100,"aircraft":[{"hex":"abc123","lat":34.1,"lon":-118.2,"alt_baro":3000}]}`))
	store.IngestAircraftJSON([]byte(`{"now":130,"aircraft":[{"hex":"abc123","lat":34.2,"lon":-118.3,"alt_baro":"ground"}]}`))
	store.IngestAircraftJSON([]byte(`{"now":150,"aircraft":[{"hex":"abc123","lat":34.21,"lon":-118.31,"alt_baro":25}]}`))
	store.IngestAircraftJSON([]byte(`{"now":155,"aircraft":[{"hex":"abc123","lat":34.22,"lon":-118.32,"alt_baro":30}]}`))
	store.IngestAircraftJSON([]byte(`{"now":170,"aircraft":[{"hex":"abc123","lat":34.23,"lon":-118.33,"alt_baro":"ground"}]}`))
	delta := store.IngestAircraftJSON([]byte(`{"now":195,"aircraft":[{"hex":"abc123","lat":34.3,"lon":-118.4,"alt_baro":1500}]}`))

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

	delta := store.IngestAircraftJSON([]byte(`{"now":100,"aircraft":[{"hex":"abc123","lat":34.1,"lon":-118.2,"gs":141.5}]}`))
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

	store := NewTrailStore(TrailOptions{
		MemoryWindow:    2 * time.Hour,
		SampleInterval:  time.Second,
		RestartCacheDir: dir,
	})
	if err := store.LoadRestartCache(); err != nil {
		t.Fatalf("load restart cache: %v", err)
	}
	if snaps := store.SnapshotEnvelopes(); len(snaps) != 0 {
		t.Fatalf("unreadable cache snapshots = %d, want 0", len(snaps))
	}
}

func TestTrailStoreRestartCachePreservesSegmentContinuity(t *testing.T) {
	dir := t.TempDir()
	store := NewTrailStore(TrailOptions{
		MemoryWindow:    2 * time.Hour,
		SampleInterval:  time.Second,
		RestartCacheDir: dir,
	})

	store.IngestAircraftJSON([]byte(`{"now":100,"aircraft":[{"hex":"abc123","lat":34.1,"lon":-118.2,"alt_baro":3000}]}`))
	store.IngestAircraftJSON([]byte(`{"now":110,"aircraft":[{"hex":"abc123","lat":34.2,"lon":-118.3,"alt_baro":"ground"}]}`))
	store.IngestAircraftJSON([]byte(`{"now":170,"aircraft":[{"hex":"abc123","lat":34.3,"lon":-118.4,"alt_baro":1500}]}`))
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
	restored.IngestAircraftJSON([]byte(`{"now":200,"aircraft":[{"hex":"abc123","lat":34.4,"lon":-118.5,"alt_baro":"ground"}]}`))
	delta := restored.IngestAircraftJSON([]byte(`{"now":260,"aircraft":[{"hex":"abc123","lat":34.5,"lon":-118.6,"alt_baro":2000}]}`))

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
	delta := restored.IngestAircraftJSON([]byte(`{"now":190,"aircraft":[{"hex":"abc123","lat":34.3,"lon":-118.4,"alt_baro":1500}]}`))

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

	store.IngestAircraftJSON([]byte(`{"now":100,"aircraft":[{"hex":"abc123","lat":34.1,"lon":-118.2,"alt_baro":3000,"alt_geom":3175}]}`))
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

func TestTrailStoreLogsInvalidAltitudeOncePerHex(t *testing.T) {
	var buf bytes.Buffer
	prevWriter := log.Writer()
	prevFlags := log.Flags()
	log.SetOutput(&buf)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(prevWriter)
		log.SetFlags(prevFlags)
	})

	store := NewTrailStore(TrailOptions{
		MemoryWindow:   2 * time.Hour,
		SampleInterval: time.Second,
	})

	store.IngestAircraftJSON([]byte(`{"now":100,"aircraft":[{"hex":"abc123","lat":34.1,"lon":-118.2,"alt_baro":"FL340"}]}`))
	store.IngestAircraftJSON([]byte(`{"now":101,"aircraft":[{"hex":"abc123","lat":34.2,"lon":-118.3,"alt_baro":"FL350"}]}`))
	store.IngestAircraftJSON([]byte(`{"now":102,"aircraft":[{"hex":"def456","lat":34.3,"lon":-118.4,"alt_baro":"FL360"}]}`))

	lines := strings.Count(buf.String(), "trails: invalid alt_baro")
	if lines != 2 {
		t.Fatalf("invalid-alt log count = %d, want 2; log=%q", lines, buf.String())
	}
}
