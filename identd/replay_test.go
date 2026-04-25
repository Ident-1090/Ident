package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestReplayStoreFinalizesZstdBlockAndIndex(t *testing.T) {
	store := newTestReplayStore(t, 10_000_000)

	store.IngestAircraftJSON(replayFrameJSON(120, "abc123", 34.1, -118.1))
	if got := store.Manifest(); len(got.Blocks) != 0 {
		t.Fatalf("active block was published: %#v", got.Blocks)
	}
	store.IngestAircraftJSON(replayFrameJSON(181, "abc123", 34.2, -118.2))

	manifest := store.Manifest()
	if len(manifest.Blocks) != 1 {
		t.Fatalf("blocks = %d, want 1", len(manifest.Blocks))
	}
	block := manifest.Blocks[0]
	if block.Bytes <= 0 {
		t.Fatalf("block bytes = %d", block.Bytes)
	}
	if block.URL != replayBlockURLPrefix+block.Name {
		t.Fatalf("url = %q, name = %q", block.URL, block.Name)
	}
	if _, err := os.Stat(filepath.Join(store.dir, replayIndexName)); err != nil {
		t.Fatalf("index not written: %v", err)
	}
	body, err := readZstdReplayBlock(filepath.Join(store.blocksDir, block.Name))
	if err != nil {
		t.Fatalf("read block: %v", err)
	}
	if body.Version != 1 || len(body.Frames) != 1 {
		t.Fatalf("block body = %#v", body)
	}
}

func TestReplayStorePrunesOldestBlocksByByteBudget(t *testing.T) {
	store := newTestReplayStore(t, 10_000_000)
	store.IngestAircraftJSON(replayFrameJSON(120, "abc123", 34.1, -118.1))
	store.IngestAircraftJSON(replayFrameJSON(181, "abc123", 34.2, -118.2))
	first := store.Manifest().Blocks[0]

	store.maxBytes = first.Bytes + 20
	store.IngestAircraftJSON(replayFrameJSON(241, "def456", 35.1, -119.1))

	manifest := store.Manifest()
	if len(manifest.Blocks) != 1 {
		t.Fatalf("blocks = %d, want 1 after pruning", len(manifest.Blocks))
	}
	if manifest.Blocks[0].Name == first.Name {
		t.Fatalf("oldest block was not pruned")
	}
	if totalReplayBytes(manifest.Blocks) > store.maxBytes {
		t.Fatalf("total bytes %d exceeded budget %d", totalReplayBytes(manifest.Blocks), store.maxBytes)
	}
	if _, err := os.Stat(filepath.Join(store.blocksDir, first.Name)); !os.IsNotExist(err) {
		t.Fatalf("old block still exists: %v", err)
	}
}

func TestReplayStorePrunesByRetention(t *testing.T) {
	store := newTestReplayStore(t, 10_000_000)
	store.retention = time.Minute
	store.IngestAircraftJSON(replayFrameJSON(120, "abc123", 34.1, -118.1))
	store.IngestAircraftJSON(replayFrameJSON(181, "abc123", 34.2, -118.2))
	store.IngestAircraftJSON(replayFrameJSON(360, "def456", 35.1, -119.1))
	store.IngestAircraftJSON(replayFrameJSON(421, "def456", 35.2, -119.2))

	manifest := store.Manifest()
	if len(manifest.Blocks) != 1 {
		t.Fatalf("blocks = %d, want 1 after retention prune", len(manifest.Blocks))
	}
	if manifest.Blocks[0].Start < 180_000 {
		t.Fatalf("retained expired block: %#v", manifest.Blocks[0])
	}
}

func TestReplayStoreLoadCleansTempAndRebuildsIndex(t *testing.T) {
	dir := t.TempDir()
	blocksDir := filepath.Join(dir, replayBlocksDirName)
	if err := os.MkdirAll(blocksDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(blocksDir, ".partial.tmp"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, replayIndexName), []byte(`{"version":1,"blocks":[{"start":1,"end":2,"url":"/api/replay/blocks/1-2.json.zst","bytes":10}]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	store, err := NewReplayStore(ReplayOptions{
		Enabled:        true,
		Dir:            dir,
		Retention:      time.Hour,
		MaxBytes:       1_000_000,
		BlockDuration:  time.Minute,
		SampleInterval: 5 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Load(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(blocksDir, ".partial.tmp")); !os.IsNotExist(err) {
		t.Fatalf("temp file still exists: %v", err)
	}
	if len(store.Manifest().Blocks) != 0 {
		t.Fatalf("missing indexed block should be ignored")
	}
}

func TestReplayStoreLoadMergesBlocksMissingFromIndex(t *testing.T) {
	store := newTestReplayStore(t, 10_000_000)
	store.IngestAircraftJSON(replayFrameJSON(120, "abc123", 34.1, -118.1))
	store.IngestAircraftJSON(replayFrameJSON(181, "abc123", 34.2, -118.2))
	store.IngestAircraftJSON(replayFrameJSON(241, "def456", 35.1, -119.1))

	blocks := store.Manifest().Blocks
	if len(blocks) != 2 {
		t.Fatalf("seed blocks = %d, want 2", len(blocks))
	}
	if err := os.WriteFile(
		filepath.Join(store.dir, replayIndexName),
		[]byte(`{"version":1,"blocks":[{"start":120000,"end":180000,"url":"/api/replay/blocks/120000-180000.json.zst","bytes":`+fmt.Sprint(blocks[0].Bytes)+`}]}`),
		0o644,
	); err != nil {
		t.Fatal(err)
	}

	reloaded, err := NewReplayStore(ReplayOptions{
		Enabled:        true,
		Dir:            store.dir,
		Retention:      time.Duration(1 << 62),
		MaxBytes:       10_000_000,
		BlockDuration:  time.Minute,
		SampleInterval: 5 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := reloaded.Load(); err != nil {
		t.Fatal(err)
	}

	got := reloaded.Manifest().Blocks
	if len(got) != 2 {
		t.Fatalf("loaded blocks = %d, want 2: %#v", len(got), got)
	}
	if got[0].Name != blocks[0].Name || got[1].Name != blocks[1].Name {
		t.Fatalf("loaded block names = %q, %q; want %q, %q", got[0].Name, got[1].Name, blocks[0].Name, blocks[1].Name)
	}
}

func newTestReplayStore(t *testing.T, maxBytes int64) *ReplayStore {
	t.Helper()
	store, err := NewReplayStore(ReplayOptions{
		Enabled:        true,
		Dir:            t.TempDir(),
		Retention:      24 * time.Hour,
		MaxBytes:       maxBytes,
		BlockDuration:  time.Minute,
		SampleInterval: 5 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Load(); err != nil {
		t.Fatal(err)
	}
	return store
}

func replayFrameJSON(now float64, hex string, lat, lon float64) []byte {
	body, _ := json.Marshal(map[string]any{
		"now": now,
		"aircraft": []map[string]any{{
			"hex":      hex,
			"flight":   "UAL123",
			"r":        "N12345",
			"t":        "B738",
			"lat":      lat,
			"lon":      lon,
			"alt_baro": 12000,
			"gs":       420,
			"track":    90,
		}},
	})
	return body
}

func totalReplayBytes(blocks []ReplayBlockIndex) int64 {
	var total int64
	for _, block := range blocks {
		total += block.Bytes
	}
	return total
}
