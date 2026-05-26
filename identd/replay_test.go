package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/klauspost/compress/zstd"
)

func TestReplayStoreFinalizesZstdBlockAndIndex(t *testing.T) {
	store := newTestReplayStore(t, 10_000_000)

	store.IngestAircraftFrame(replayFrameForTest(120, "abc123", 34.1, -118.1))
	if got := store.Manifest(); len(got.Blocks) != 0 {
		t.Fatalf("active block was published: %#v", got.Blocks)
	}
	store.IngestAircraftFrame(replayFrameForTest(301, "abc123", 34.2, -118.2))

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
	body, err := readZstdReplayBlock(filepath.Join(store.blocksDir, filepath.FromSlash(block.Name)))
	if err != nil {
		t.Fatalf("read block: %v", err)
	}
	if body.Version != replayManifestVersion || len(body.Frames) != 1 {
		t.Fatalf("block body = %#v", body)
	}
	if len(body.Frames[0].Aircraft) != 1 {
		t.Fatalf("block aircraft = %d, want 1", len(body.Frames[0].Aircraft))
	}
	raw, err := os.ReadFile(filepath.Join(store.blocksDir, filepath.FromSlash(block.Name)))
	if err != nil {
		t.Fatalf("read raw block: %v", err)
	}
	decoded, err := decodeReplayBlockRawForTest(raw)
	if err != nil {
		t.Fatalf("decode raw block: %v", err)
	}
	if strings.Contains(decoded, "typeDesignator") || strings.Contains(decoded, "altBaroFt") || strings.Contains(decoded, "trackDeg") {
		t.Fatalf("replay block used full aircraft field names: %s", decoded)
	}
	if !strings.Contains(decoded, `"t":"B738"`) || !strings.Contains(decoded, `"alt_baro":12000`) || !strings.Contains(decoded, `"track":90`) {
		t.Fatalf("replay block missing compact aircraft fields: %s", decoded)
	}
}

func TestReplayStoreFinalizesDatePartitionedCoverageBlock(t *testing.T) {
	store := newTestReplayStore(t, 10_000_000)

	store.IngestAircraftFrame(identAircraftFrame{
		Schema:             "ident.aircraft.v1",
		ObservedAtEpochSec: 120,
		Aircraft:           []identAircraft{},
	})
	if got := store.Manifest(); len(got.Blocks) != 0 {
		t.Fatalf("active block was published: %#v", got.Blocks)
	}
	store.IngestAircraftFrame(replayFrameForTest(301, "abc123", 34.2, -118.2))

	manifest := store.Manifest()
	if len(manifest.Blocks) != 1 {
		t.Fatalf("blocks = %d, want 1", len(manifest.Blocks))
	}
	block := manifest.Blocks[0]
	wantName := "1970/01/01/0-300000.json.zst"
	if block.Name != wantName {
		t.Fatalf("block name = %q, want %q", block.Name, wantName)
	}
	if block.URL != replayBlockURLPrefix+wantName {
		t.Fatalf("url = %q, want %q", block.URL, replayBlockURLPrefix+wantName)
	}
	if _, err := os.Stat(filepath.Join(store.blocksDir, "manifest.cache.json")); err != nil {
		t.Fatalf("root cache not written: %v", err)
	}
	rootCacheRaw, err := os.ReadFile(filepath.Join(store.blocksDir, "manifest.cache.json"))
	if err != nil {
		t.Fatalf("read root cache: %v", err)
	}
	var rootCache map[string]json.RawMessage
	if err := json.Unmarshal(rootCacheRaw, &rootCache); err != nil {
		t.Fatalf("decode root cache: %v", err)
	}
	if _, hasBlocks := rootCache["blocks"]; hasBlocks {
		t.Fatalf("root cache should not contain per-block entries: %s", rootCacheRaw)
	}
	dayCachePath := filepath.Join(store.blocksDir, "1970", "01", "01", "manifest.cache.json")
	if _, err := os.Stat(dayCachePath); err != nil {
		t.Fatalf("day cache not written: %v", err)
	}
	var dayCache replayDayCacheFile
	dayCacheRaw, err := os.ReadFile(dayCachePath)
	if err != nil {
		t.Fatalf("read day cache: %v", err)
	}
	if err := json.Unmarshal(dayCacheRaw, &dayCache); err != nil {
		t.Fatalf("decode day cache: %v", err)
	}
	if len(dayCache.Blocks) != 1 {
		t.Fatalf("day cache blocks = %d, want 1", len(dayCache.Blocks))
	}
	body, err := readZstdReplayBlock(filepath.Join(store.blocksDir, filepath.FromSlash(block.Name)))
	if err != nil {
		t.Fatalf("read block: %v", err)
	}
	if len(body.Frames) != 1 || len(body.Frames[0].Aircraft) != 0 {
		t.Fatalf("block frames = %#v, want one empty coverage frame", body.Frames)
	}
}

func TestReplayStoreFinalizesBlockAtUTCDayBoundary(t *testing.T) {
	store := newTestReplayStore(t, 10_000_000)
	start := time.Date(2026, 5, 24, 23, 55, 0, 0, time.UTC).Unix()

	store.IngestAircraftFrame(replayFrameForTest(float64(start), "abc123", 34.1, -118.1))
	store.IngestAircraftFrame(replayFrameForTest(float64(start+replayBlockDurationSecs), "abc123", 34.2, -118.2))

	blocks := store.Manifest().Blocks
	if len(blocks) != 1 {
		t.Fatalf("blocks = %d, want 1", len(blocks))
	}
	wantName := "2026/05/24/1779666900000-1779667200000.json.zst"
	if blocks[0].Name != wantName {
		t.Fatalf("block name = %q, want %q", blocks[0].Name, wantName)
	}
	if _, _, ok := parseReplayBlockName(blocks[0].Name); !ok {
		t.Fatalf("boundary block did not parse: %q", blocks[0].Name)
	}
}

func TestReplayStorePrunesOldestBlocksByByteBudget(t *testing.T) {
	store := newTestReplayStore(t, 10_000_000)
	store.IngestAircraftFrame(replayFrameForTest(120, "abc123", 34.1, -118.1))
	store.IngestAircraftFrame(replayFrameForTest(301, "abc123", 34.2, -118.2))
	first := store.Manifest().Blocks[0]

	store.maxBytes = first.Bytes + 20
	store.IngestAircraftFrame(replayFrameForTest(601, "def456", 35.1, -119.1))

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
	if _, err := os.Stat(filepath.Join(store.blocksDir, filepath.FromSlash(first.Name))); !os.IsNotExist(err) {
		t.Fatalf("old block still exists: %v", err)
	}
}

func TestReplayStorePruneUnderHighWatermarkDeletesNothing(t *testing.T) {
	store := newTestReplayStore(t, 1_000)
	store.cleanupLowWatermark = 0.90
	store.blocks = []ReplayBlockIndex{
		{Start: 0, End: replayBlockDurationMS, Bytes: 450, Name: replayBlockName(0, replayBlockDurationMS)},
		{Start: replayBlockDurationMS, End: 2 * replayBlockDurationMS, Bytes: 450, Name: replayBlockName(replayBlockDurationMS, 2*replayBlockDurationMS)},
	}

	if changed := store.pruneByBudgetLocked(0); changed {
		t.Fatalf("pruned under high watermark")
	}
	if len(store.blocks) != 2 {
		t.Fatalf("blocks = %d, want 2", len(store.blocks))
	}
}

func TestReplayStorePrunesToCleanupLowWatermark(t *testing.T) {
	store := newTestReplayStore(t, 1_000)
	store.cleanupLowWatermark = 0.90
	store.blocks = []ReplayBlockIndex{
		{Start: 0, End: replayBlockDurationMS, Bytes: 100, Name: replayBlockName(0, replayBlockDurationMS)},
		{Start: replayBlockDurationMS, End: 2 * replayBlockDurationMS, Bytes: 100, Name: replayBlockName(replayBlockDurationMS, 2*replayBlockDurationMS)},
		{Start: 2 * replayBlockDurationMS, End: 3 * replayBlockDurationMS, Bytes: 850, Name: replayBlockName(2*replayBlockDurationMS, 3*replayBlockDurationMS)},
	}
	for _, block := range store.blocks {
		path := filepath.Join(store.blocksDir, filepath.FromSlash(block.Name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("block"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	store.pruneByBudgetLocked(0)

	if len(store.blocks) != 1 {
		t.Fatalf("blocks = %d, want 1 after pruning to low watermark: %#v", len(store.blocks), store.blocks)
	}
	if got := totalReplayBytes(store.blocks); got > int64(float64(store.maxBytes)*store.cleanupLowWatermark) {
		t.Fatalf("total bytes = %d, want <= low watermark", got)
	}
}

func TestReplayStoreCleanupFailureKeepsAccountingAndEmitsDiagnostic(t *testing.T) {
	diagnostics := NewDiagnosticStore(DiagnosticStoreOptions{})
	store := newTestReplayStoreWithOptions(t, 1_000, diagnostics, true)
	store.cleanupLowWatermark = 0.90
	block := ReplayBlockIndex{
		Start: 0,
		End:   replayBlockDurationMS,
		Bytes: 1_000,
		Name:  replayBlockName(0, replayBlockDurationMS),
	}
	store.blocks = []ReplayBlockIndex{block}
	blockPath := filepath.Join(store.blocksDir, filepath.FromSlash(block.Name))
	if err := os.MkdirAll(blockPath, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(blockPath, "kept"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	if changed := store.pruneByBudgetLocked(1); changed {
		t.Fatalf("prune changed accounting after remove failure")
	}
	if got := store.Manifest().Blocks; len(got) != 1 {
		t.Fatalf("blocks = %#v, want failed cleanup block retained", got)
	}
	assertReplayDiagnostic(t, diagnostics, "replay.cache.cleaning_failed", "1970-01-01")
}

func TestReplayStoreRepairsCacheWhenCachedBlockMissingOnServe(t *testing.T) {
	diagnostics := NewDiagnosticStore(DiagnosticStoreOptions{})
	store := newTestReplayStoreWithOptions(t, 10_000_000, diagnostics, true)
	store.IngestAircraftFrame(replayFrameForTest(120, "abc123", 34.1, -118.1))
	store.IngestAircraftFrame(replayFrameForTest(301, "abc123", 34.2, -118.2))
	block := store.Manifest().Blocks[0]
	if err := os.Remove(filepath.Join(store.blocksDir, filepath.FromSlash(block.Name))); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, replayBlockURLPrefix+block.Name, nil)
	rec := httptest.NewRecorder()
	store.ServeBlock(rec, req, block.Name)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if got := store.Manifest().Blocks; len(got) != 0 {
		t.Fatalf("manifest blocks after repair = %#v, want empty", got)
	}
	if got := readDayCacheForTest(t, store, "1970-01-01").Blocks; len(got) != 0 {
		t.Fatalf("day cache blocks after repair = %#v, want empty", got)
	}
	assertReplayDiagnostic(t, diagnostics, "replay.block.missing", "1970-01-01")
	assertReplayDiagnostic(t, diagnostics, "replay.cache.stale", "1970-01-01")
}

func TestReplayStoreRepairPreservesOtherBlocksInSameDayCache(t *testing.T) {
	diagnostics := NewDiagnosticStore(DiagnosticStoreOptions{})
	store := newTestReplayStoreWithOptions(t, 10_000_000, diagnostics, true)
	store.IngestAircraftFrame(replayFrameForTest(120, "abc123", 34.1, -118.1))
	store.IngestAircraftFrame(replayFrameForTest(301, "abc123", 34.2, -118.2))
	store.IngestAircraftFrame(replayFrameForTest(601, "def456", 35.1, -119.1))
	blocks := store.Manifest().Blocks
	if len(blocks) != 2 {
		t.Fatalf("seed blocks = %d, want 2", len(blocks))
	}
	missing := blocks[0]
	survivor := blocks[1]
	if err := os.Remove(filepath.Join(store.blocksDir, filepath.FromSlash(missing.Name))); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, replayBlockURLPrefix+missing.Name, nil)
	rec := httptest.NewRecorder()
	store.ServeBlock(rec, req, missing.Name)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	manifest := store.Manifest()
	if len(manifest.Blocks) != 1 || manifest.Blocks[0].Name != survivor.Name {
		t.Fatalf("manifest blocks after repair = %#v, want survivor %q", manifest.Blocks, survivor.Name)
	}
	dayBlocks := readDayCacheForTest(t, store, "1970-01-01").Blocks
	if len(dayBlocks) != 1 || dayBlocks[0].URL != survivor.URL || dayBlocks[0].Start != survivor.Start || dayBlocks[0].End != survivor.End {
		t.Fatalf("day cache blocks after repair = %#v, want survivor %q", dayBlocks, survivor.Name)
	}
	assertReplayDiagnostic(t, diagnostics, "replay.block.missing", "1970-01-01")
	assertReplayDiagnostic(t, diagnostics, "replay.cache.stale", "1970-01-01")
}

func TestReplayStoreCacheWriteFailureEmitsDiagnostic(t *testing.T) {
	dir := t.TempDir()
	fileDir := filepath.Join(dir, "replay-file")
	if err := os.WriteFile(fileDir, []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
	diagnostics := NewDiagnosticStore(DiagnosticStoreOptions{})
	store, err := NewReplayStore(ReplayOptions{
		Enabled:        true,
		Dir:            fileDir,
		MaxBytes:       1_000_000,
		CacheReindex:   true,
		SampleInterval: 5 * time.Second,
		Diagnostics:    diagnostics,
	})
	if err != nil {
		t.Fatal(err)
	}
	store.blocksDir = filepath.Join(dir, "blocks")

	store.IngestAircraftFrame(replayFrameForTest(120, "abc123", 34.1, -118.1))
	store.IngestAircraftFrame(replayFrameForTest(301, "abc123", 34.2, -118.2))

	assertReplayDiagnostic(t, diagnostics, "replay.cache.write_failed", "cache")
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
	if err := os.WriteFile(filepath.Join(dir, replayIndexName), []byte(`{"version":`+fmt.Sprint(replayManifestVersion)+`,"blocks":[{"start":1,"end":2,"url":"/api/replay/blocks/1-2.json.zst","bytes":10}]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	store, err := NewReplayStore(ReplayOptions{
		Enabled:        true,
		Dir:            dir,
		MaxBytes:       1_000_000,
		CacheReindex:   true,
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

func TestReplayStoreLoadBadRootCacheFallsBackToReindexWithDiagnostic(t *testing.T) {
	dir := t.TempDir()
	blocksDir := filepath.Join(dir, replayBlocksDirName)
	start := int64(0)
	end := start + replayBlockDurationMS
	name := replayBlockName(start, end)
	if err := writeReplayBlockForTest(filepath.Join(blocksDir, filepath.FromSlash(name)), replayBlockFile{
		Version: replayManifestVersion,
		Start:   start,
		End:     end,
		StepMS:  5000,
		Frames:  []ReplayFrame{{Ts: start}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(blocksDir, replayCacheName), []byte(`{"version":999,"block_sec":300,"days":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	diagnostics := NewDiagnosticStore(DiagnosticStoreOptions{})
	store, err := NewReplayStore(ReplayOptions{
		Enabled:        true,
		Dir:            dir,
		MaxBytes:       1_000_000,
		CacheReindex:   true,
		SampleInterval: 5 * time.Second,
		Diagnostics:    diagnostics,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Load(); err != nil {
		t.Fatal(err)
	}

	if got := store.Manifest().Blocks; len(got) != 1 {
		t.Fatalf("blocks = %#v, want reindexed block", got)
	}
	assertReplayDiagnostic(t, diagnostics, "replay.cache.unsupported_version", "cache")
}

func TestReplayStoreClearsReindexingDiagnosticAfterSuccessfulReindex(t *testing.T) {
	diagnostics := NewDiagnosticStore(DiagnosticStoreOptions{})
	store, err := NewReplayStore(ReplayOptions{
		Enabled:        true,
		Dir:            t.TempDir(),
		MaxBytes:       1_000_000,
		CacheReindex:   true,
		SampleInterval: 5 * time.Second,
		Diagnostics:    diagnostics,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Load(); err != nil {
		t.Fatal(err)
	}
	assertNoReplayDiagnostic(t, diagnostics, "replay.cache.reindexing", "cache")
}

func TestReplayStoreLoadWithoutCacheAndReindexDisabledEmitsDiagnostic(t *testing.T) {
	diagnostics := NewDiagnosticStore(DiagnosticStoreOptions{})
	store, err := NewReplayStore(ReplayOptions{
		Enabled:        true,
		Dir:            t.TempDir(),
		MaxBytes:       1_000_000,
		CacheReindex:   false,
		SampleInterval: 5 * time.Second,
		Diagnostics:    diagnostics,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Load(); err != nil {
		t.Fatal(err)
	}
	assertReplayDiagnostic(t, diagnostics, "replay.cache.reindex_disabled", "cache")
}

func TestReplayStoreLoadMergesBlocksMissingFromIndex(t *testing.T) {
	store := newTestReplayStore(t, 10_000_000)
	store.IngestAircraftFrame(replayFrameForTest(120, "abc123", 34.1, -118.1))
	store.IngestAircraftFrame(replayFrameForTest(301, "abc123", 34.2, -118.2))
	store.IngestAircraftFrame(replayFrameForTest(601, "def456", 35.1, -119.1))

	blocks := store.Manifest().Blocks
	if len(blocks) != 2 {
		t.Fatalf("seed blocks = %d, want 2", len(blocks))
	}
	if err := os.WriteFile(
		filepath.Join(store.dir, replayIndexName),
		[]byte(`{"version":`+fmt.Sprint(replayManifestVersion)+`,"blocks":[{"start":0,"end":300000,"url":"/api/replay/blocks/1970/01/01/0-300000.json.zst","bytes":`+fmt.Sprint(blocks[0].Bytes)+`}]}`),
		0o644,
	); err != nil {
		t.Fatal(err)
	}

	reloaded, err := NewReplayStore(ReplayOptions{
		Enabled:        true,
		Dir:            store.dir,
		MaxBytes:       10_000_000,
		CacheReindex:   true,
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

func TestReplayStoreLoadTrustsCacheWhenReindexDisabled(t *testing.T) {
	store := newTestReplayStore(t, 10_000_000)
	store.IngestAircraftFrame(replayFrameForTest(120, "abc123", 34.1, -118.1))
	store.IngestAircraftFrame(replayFrameForTest(301, "abc123", 34.2, -118.2))
	cached := store.Manifest().Blocks
	if len(cached) != 1 {
		t.Fatalf("seed blocks = %d, want 1", len(cached))
	}

	orphanStart := replayBlockDurationMS
	orphanEnd := orphanStart + replayBlockDurationMS
	orphanName := replayBlockName(orphanStart, orphanEnd)
	if err := writeReplayBlockForTest(filepath.Join(store.blocksDir, filepath.FromSlash(orphanName)), replayBlockFile{
		Version: replayManifestVersion,
		Start:   orphanStart,
		End:     orphanEnd,
		StepMS:  5000,
		Frames:  []ReplayFrame{{Ts: orphanStart}},
	}); err != nil {
		t.Fatal(err)
	}

	reloaded, err := NewReplayStore(ReplayOptions{
		Enabled:        true,
		Dir:            store.dir,
		MaxBytes:       10_000_000,
		CacheReindex:   false,
		SampleInterval: 5 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := reloaded.Load(); err != nil {
		t.Fatal(err)
	}

	got := reloaded.Manifest().Blocks
	if len(got) != 1 {
		t.Fatalf("loaded blocks = %d, want cached block only: %#v", len(got), got)
	}
	if got[0].Name != cached[0].Name {
		t.Fatalf("loaded block = %q, want cached %q", got[0].Name, cached[0].Name)
	}
}

func TestReplayStoreRejectsImplausibleFutureProducerTimestamp(t *testing.T) {
	store := newTestReplayStore(t, 10_000_000)
	future := float64(time.Now().Add(365 * 24 * time.Hour).Unix())

	store.IngestAircraftFrame(replayFrameForTest(future, "abc123", 34.1, -118.1))
	store.IngestAircraftFrame(replayFrameForTest(future+float64(replayBlockDurationSecs), "abc123", 34.2, -118.2))

	if got := store.Manifest().Blocks; len(got) != 0 {
		t.Fatalf("future timestamp created replay blocks: %#v", got)
	}
}

func TestReplayStoreLoadIncludesBlocksWithoutPreflightDecode(t *testing.T) {
	// We trust the filename + Stat. Decoding every block at startup
	// is what dominated boot time on large caches; the client decodes
	// on read and surfaces its own diagnostic on failure.
	dir := t.TempDir()
	blocksDir := filepath.Join(dir, replayBlocksDirName)
	if err := os.MkdirAll(blocksDir, 0o755); err != nil {
		t.Fatal(err)
	}
	start := (time.Now().Add(-time.Minute).UnixMilli() / replayBlockDurationMS) * replayBlockDurationMS
	end := start + replayBlockDurationMS
	name := replayBlockName(start, end)
	if err := writeReplayBlockForTest(filepath.Join(blocksDir, filepath.FromSlash(name)), struct {
		Version int           `json:"version"`
		Start   int64         `json:"start"`
		End     int64         `json:"end"`
		StepMS  int64         `json:"step_ms"`
		Frames  []ReplayFrame `json:"frames"`
		Extra   string        `json:"extra"`
	}{
		Version: replayManifestVersion,
		Start:   start,
		End:     end,
		StepMS:  5000,
		Frames:  []ReplayFrame{{Ts: start}},
		Extra:   "unexpected",
	}); err != nil {
		t.Fatal(err)
	}

	diagnostics := NewDiagnosticStore(DiagnosticStoreOptions{})
	store, err := NewReplayStore(ReplayOptions{
		Enabled:        true,
		Dir:            dir,
		MaxBytes:       1_000_000,
		CacheReindex:   true,
		SampleInterval: 5 * time.Second,
		Diagnostics:    diagnostics,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Load(); err != nil {
		t.Fatal(err)
	}
	if got := store.Manifest().Blocks; len(got) != 1 {
		t.Fatalf("manifest = %#v, want 1 entry (filename trusted, no preflight)", got)
	}
	for _, diag := range diagnostics.Snapshot() {
		if diag.Code == "replay.block.decode_failed" || diag.Code == "replay.cache.unreadable" {
			t.Fatalf("startup emitted preflight validation diagnostic: %#v", diag)
		}
	}
}

func TestParseReplayBlockNameRejectsFixedBlockInvariants(t *testing.T) {
	cases := []string{
		"1970/01/01/0-600000.json.zst",
		"1970/01/01/1000-301000.json.zst",
		"1970/01/02/0-300000.json.zst",
	}
	for _, name := range cases {
		if _, _, ok := parseReplayBlockName(name); ok {
			t.Fatalf("parseReplayBlockName(%q) succeeded, want reject", name)
		}
	}
}

func newTestReplayStore(t *testing.T, maxBytes int64) *ReplayStore {
	t.Helper()
	return newTestReplayStoreWithOptions(t, maxBytes, nil, true)
}

func newTestReplayStoreWithOptions(t *testing.T, maxBytes int64, diagnostics *DiagnosticStore, cacheReindex bool) *ReplayStore {
	t.Helper()
	store, err := NewReplayStore(ReplayOptions{
		Enabled:        true,
		Dir:            t.TempDir(),
		MaxBytes:       maxBytes,
		CacheReindex:   cacheReindex,
		SampleInterval: 5 * time.Second,
		Diagnostics:    diagnostics,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Load(); err != nil {
		t.Fatal(err)
	}
	return store
}

func readDayCacheForTest(t *testing.T, store *ReplayStore, day string) replayDayCacheFile {
	t.Helper()
	dayPath, ok := replayDayCachePath(day)
	if !ok {
		t.Fatalf("invalid day %q", day)
	}
	raw, err := os.ReadFile(filepath.Join(store.blocksDir, filepath.FromSlash(dayPath), replayCacheName))
	if err != nil {
		t.Fatal(err)
	}
	var cache replayDayCacheFile
	if err := json.Unmarshal(raw, &cache); err != nil {
		t.Fatal(err)
	}
	return cache
}

func assertReplayDiagnostic(t *testing.T, store *DiagnosticStore, code, scope string) {
	t.Helper()
	for _, d := range store.Snapshot() {
		if d.Code == code && d.Scope == scope {
			return
		}
	}
	t.Fatalf("missing diagnostic code=%q scope=%q in %#v", code, scope, store.Snapshot())
}

func assertNoReplayDiagnostic(t *testing.T, store *DiagnosticStore, code, scope string) {
	t.Helper()
	for _, d := range store.Snapshot() {
		if d.Code == code && d.Scope == scope {
			t.Fatalf("unexpected diagnostic code=%q scope=%q in %#v", code, scope, store.Snapshot())
		}
	}
}

func replayFrameForTest(now float64, hex string, lat, lon float64) identAircraftFrame {
	return identAircraftFrame{
		Schema:             "ident.aircraft.v1",
		ObservedAtEpochSec: now,
		Aircraft: []identAircraft{{
			Hex:            hex,
			IDKind:         aircraftIDKind(hex),
			Source:         aircraftSource(""),
			Flight:         "UAL123",
			Registration:   "N12345",
			TypeDesignator: "B738",
			Lat:            floatPtrForTest(lat),
			Lon:            floatPtrForTest(lon),
			AltBaroFt:      floatPtrForTest(12000),
			GsKt:           floatPtrForTest(420),
			TrackDeg:       floatPtrForTest(90),
		}},
	}
}

func totalReplayBytes(blocks []ReplayBlockIndex) int64 {
	var total int64
	for _, block := range blocks {
		total += block.Bytes
	}
	return total
}

func writeReplayBlockForTest(path string, block any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	zw, err := zstd.NewWriter(f)
	if err != nil {
		_ = f.Close()
		return err
	}
	encErr := json.NewEncoder(zw).Encode(block)
	closeZstdErr := zw.Close()
	closeFileErr := f.Close()
	if encErr != nil {
		return encErr
	}
	if closeZstdErr != nil {
		return closeZstdErr
	}
	return closeFileErr
}

func decodeReplayBlockRawForTest(raw []byte) (string, error) {
	zr, err := zstd.NewReader(bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	defer zr.Close()
	decoded, err := io.ReadAll(zr)
	if err != nil {
		return "", err
	}
	return string(decoded), nil
}
