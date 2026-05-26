package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/klauspost/compress/zstd"
)

const (
	replayIndexName         = "index.json"
	replayCacheName         = "manifest.cache.json"
	replayBlocksDirName     = "blocks"
	replayBlockURLPrefix    = "/api/replay/blocks/"
	replayManifestVersion   = 2
	replayBlockDuration     = 5 * time.Minute
	replayBlockDurationMS   = int64(replayBlockDuration / time.Millisecond)
	replayBlockDurationSecs = int64(replayBlockDuration / time.Second)
	replayMaxFutureSkew     = 10 * time.Minute
	replayReindexingTTL     = 15 * time.Second
	replayReindexingReemit  = 5 * time.Second
)

var (
	replayBlockNameRE         = regexp.MustCompile(`^\d{4}/\d{2}/\d{2}/\d+-\d+\.json\.zst$`)
	replayCacheArtifactNameRE = regexp.MustCompile(`^(?:\d{4}/\d{2}/\d{2}/)?manifest\.cache\.json$`)
)

type ReplayOptions struct {
	Enabled             bool
	Dir                 string
	MaxBytes            int64
	CleanupLowWatermark float64
	CacheReindex        bool
	SampleInterval      time.Duration
	OnAvailability      func(ReplayManifest)
	Diagnostics         *DiagnosticStore
}

type ReplayStore struct {
	mu sync.RWMutex

	enabled             bool
	dir                 string
	blocksDir           string
	maxBytes            int64
	cleanupLowWatermark float64
	cacheReindex        bool
	sampleInterval      time.Duration
	onAvailability      func(ReplayManifest)

	blocks      []ReplayBlockIndex
	byName      map[string]ReplayBlockIndex
	active      *replayActiveBlock
	lastSample  int64
	activeDirty bool
	diagnostics *DiagnosticStore
}

type ReplayManifest struct {
	Enabled  bool               `json:"enabled"`
	From     *int64             `json:"from"`
	To       *int64             `json:"to"`
	BlockSec int64              `json:"block_sec"`
	Blocks   []ReplayBlockIndex `json:"blocks"`
}

type ReplayBlockIndex struct {
	Start int64  `json:"start"`
	End   int64  `json:"end"`
	URL   string `json:"url"`
	Bytes int64  `json:"bytes"`
	Name  string `json:"-"`
}

type replayIndexFile struct {
	Version int                `json:"version"`
	Blocks  []ReplayBlockIndex `json:"blocks"`
}

type replayRootCacheFile struct {
	Version  int                `json:"version"`
	BlockSec int64              `json:"block_sec"`
	From     *int64             `json:"from,omitempty"`
	To       *int64             `json:"to,omitempty"`
	Days     []replayDaySummary `json:"days"`
}

type replayDaySummary struct {
	Date   string `json:"date"`
	From   int64  `json:"from"`
	To     int64  `json:"to"`
	Blocks int    `json:"blocks"`
	Bytes  int64  `json:"bytes"`
	Path   string `json:"path"`
}

type replayDayCacheFile struct {
	Version  int                `json:"version"`
	Date     string             `json:"date"`
	BlockSec int64              `json:"block_sec"`
	Blocks   []ReplayBlockIndex `json:"blocks"`
}

type replayBlockFile struct {
	Version int           `json:"version"`
	Start   int64         `json:"start"`
	End     int64         `json:"end"`
	StepMS  int64         `json:"step_ms"`
	Frames  []ReplayFrame `json:"frames"`
}

type ReplayFrame struct {
	Ts       int64            `json:"ts"`
	Aircraft []ReplayAircraft `json:"aircraft"`
}

type ReplayAircraft struct {
	Hex         string          `json:"hex"`
	Type        string          `json:"type,omitempty"`
	Flight      string          `json:"flight,omitempty"`
	R           string          `json:"r,omitempty"`
	T           string          `json:"t,omitempty"`
	Desc        string          `json:"desc,omitempty"`
	OwnOp       string          `json:"ownOp,omitempty"`
	Category    string          `json:"category,omitempty"`
	Lat         *float64        `json:"lat,omitempty"`
	Lon         *float64        `json:"lon,omitempty"`
	AltBaro     json.RawMessage `json:"alt_baro,omitempty"`
	AltGeom     *float64        `json:"alt_geom,omitempty"`
	GS          *float64        `json:"gs,omitempty"`
	Track       *float64        `json:"track,omitempty"`
	BaroRate    *float64        `json:"baro_rate,omitempty"`
	GeomRate    *float64        `json:"geom_rate,omitempty"`
	Squawk      string          `json:"squawk,omitempty"`
	Emergency   string          `json:"emergency,omitempty"`
	Messages    *int            `json:"messages,omitempty"`
	Seen        *float64        `json:"seen,omitempty"`
	SeenPos     *float64        `json:"seen_pos,omitempty"`
	RSSI        *float64        `json:"rssi,omitempty"`
	DBFlags     *int            `json:"dbFlags,omitempty"`
	Airground   json.RawMessage `json:"airground,omitempty"`
	NavQNH      *float64        `json:"nav_qnh,omitempty"`
	NavAltMCP   *float64        `json:"nav_altitude_mcp,omitempty"`
	NavAltFMS   *float64        `json:"nav_altitude_fms,omitempty"`
	NavHeading  *float64        `json:"nav_heading,omitempty"`
	NavModes    []string        `json:"nav_modes,omitempty"`
	TrueHeading *float64        `json:"true_heading,omitempty"`
	MagHeading  *float64        `json:"mag_heading,omitempty"`
}

type replayActiveBlock struct {
	start  int64
	end    int64
	frames []ReplayFrame
}

func NewReplayStore(options ReplayOptions) (*ReplayStore, error) {
	sampleInterval := options.SampleInterval
	if sampleInterval <= 0 {
		sampleInterval = 5 * time.Second
	}
	cleanupLowWatermark := options.CleanupLowWatermark
	if cleanupLowWatermark <= 0 || cleanupLowWatermark >= 1 {
		cleanupLowWatermark = 0.90
	}
	store := &ReplayStore{
		enabled:             options.Enabled,
		dir:                 options.Dir,
		blocksDir:           filepath.Join(options.Dir, replayBlocksDirName),
		maxBytes:            options.MaxBytes,
		cleanupLowWatermark: cleanupLowWatermark,
		cacheReindex:        options.CacheReindex,
		sampleInterval:      sampleInterval,
		onAvailability:      options.OnAvailability,
		diagnostics:         options.Diagnostics,
		byName:              map[string]ReplayBlockIndex{},
	}
	if !options.Enabled {
		return store, nil
	}
	if strings.TrimSpace(options.Dir) == "" {
		return nil, errors.New("IDENT_REPLAY_DIR is required when replay is enabled")
	}
	if options.MaxBytes <= 0 {
		return nil, errors.New("IDENT_REPLAY_MAX_BYTES must be positive when replay is enabled")
	}
	if sampleInterval <= 0 || sampleInterval > replayBlockDuration {
		return nil, errors.New("replay sample interval must fit inside the block duration")
	}
	return store, nil
}

func (s *ReplayStore) Load() error {
	if !s.enabled {
		return nil
	}
	if err := os.MkdirAll(s.blocksDir, 0o755); err != nil {
		return err
	}
	hadRootCache := replayRootCacheExists(s.blocksDir)
	blocks, loadedFromCache := s.loadCachedBlocks()
	if !loadedFromCache {
		if !s.cacheReindex {
			s.noteWarning("replay.cache.reindex_disabled", "replay cache is unavailable and reindexing is disabled", WithScope("cache"))
		} else {
			noteReindexing := hadRootCache
			if noteReindexing {
				s.noteReindexing()
			}
			if err := s.removeTempFiles(); err != nil {
				s.noteWarning("replay.cache.reindex_failed", "replay cache reindexing failed", WithScope("cache"))
				return err
			}
			scanned, err := s.scanBlocksDir(noteReindexing)
			if err != nil {
				s.noteWarning("replay.cache.reindex_failed", "replay cache reindexing failed", WithScope("cache"))
				return err
			}
			blocks = mergeReplayBlocks(s.loadIndexedBlocks(), scanned)
		}
	}

	s.mu.Lock()
	s.blocks = sortedReplayBlocks(blocks)
	s.rebuildLookupLocked()
	changed := s.pruneLocked(time.Now().UnixMilli())
	if !loadedFromCache || changed {
		if err := s.writeIndexLocked(); err != nil {
			s.noteCacheWriteFailed(err)
			s.mu.Unlock()
			return err
		}
		if err := s.writeCacheLocked(); err != nil {
			s.noteCacheWriteFailed(err)
			s.mu.Unlock()
			return err
		}
	}
	manifest := s.manifestLocked()
	s.mu.Unlock()
	s.publishAvailability(manifest)
	return nil
}

func (s *ReplayStore) IngestAircraftFrame(frame identAircraftFrame) {
	if !s.enabled {
		return
	}
	nowMs := time.Now().UnixMilli()
	if numberIsFinite(frame.ObservedAtEpochSec) && frame.ObservedAtEpochSec > 0 {
		observedMs := int64(math.Round(frame.ObservedAtEpochSec * 1000))
		if observedMs > nowMs+int64(replayMaxFutureSkew/time.Millisecond) {
			return
		}
		nowMs = observedMs
	}

	minDeltaMs := int64(s.sampleInterval / time.Millisecond)
	s.mu.Lock()
	if s.lastSample > 0 && minDeltaMs > 0 && nowMs-s.lastSample < minDeltaMs {
		s.mu.Unlock()
		return
	}
	s.lastSample = nowMs

	blockStart := (nowMs / replayBlockDurationMS) * replayBlockDurationMS
	if s.active == nil {
		s.active = &replayActiveBlock{start: blockStart, end: blockStart + replayBlockDurationMS}
	} else if blockStart > s.active.start {
		active := s.active
		s.active = &replayActiveBlock{start: blockStart, end: blockStart + replayBlockDurationMS}
		manifest, changed, err := s.finalizeLocked(active, nowMs)
		s.mu.Unlock()
		if err != nil {
			slog.Warn("replay: finalize", "err", err)
		}
		if changed {
			s.publishAvailability(manifest)
		}
		s.mu.Lock()
	}
	if nowMs >= s.active.start && nowMs < s.active.end {
		s.active.frames = append(s.active.frames, ReplayFrame{
			Ts:       nowMs,
			Aircraft: compactReplayAircraft(frame.Aircraft),
		})
		s.activeDirty = true
	}
	s.mu.Unlock()
}

func (s *ReplayStore) Manifest() ReplayManifest {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.manifestLocked()
}

func (s *ReplayStore) RecentReplay() (replayBlockFile, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.activeBlockFileLocked()
}

func (s *ReplayStore) ServeBlock(w http.ResponseWriter, r *http.Request, name string) {
	if !s.enabled {
		http.NotFound(w, r)
		return
	}
	name = filepath.ToSlash(name)
	if replayCacheArtifactNameRE.MatchString(name) {
		path := filepath.Join(s.blocksDir, filepath.FromSlash(name))
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, path)
		return
	}
	if !replayBlockNameRE.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	s.mu.RLock()
	block, ok := s.byName[name]
	s.mu.RUnlock()
	if !ok {
		http.NotFound(w, r)
		return
	}
	path := filepath.Join(s.blocksDir, filepath.FromSlash(block.Name))
	if info, err := os.Stat(path); err != nil || info.IsDir() {
		s.repairReplayBlock(block.Name, "replay.block.missing", "replay block is missing from disk")
		http.NotFound(w, r)
		return
	}
	// Negotiate Content-Encoding from the request. The file on disk is
	// always raw zstd. When the client accepts zstd we passthrough with the
	// encoding header set so the browser decompresses natively. When it
	// doesn't (notably plain-HTTP Chrome, which restricts zstd to HTTPS)
	// we still passthrough the raw bytes but omit the encoding header —
	// the client detects the zstd magic and decompresses in JS. We never
	// decompress on the server: that would be a CPU amplification vector.
	if clientAcceptsZstd(r.Header.Get("Accept-Encoding")) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Encoding", "zstd")
	} else {
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, path)
}

// clientAcceptsZstd reports whether the Accept-Encoding header contains a
// usable zstd token. Honors the explicit-disable form "zstd;q=0" but
// otherwise ignores q-values — they're vanishingly rare in practice and
// every modern client either lists zstd or doesn't.
//
// Wildcard "*" and "identity" are intentionally treated as not-zstd: "*"
// only promises that unlisted encodings are acceptable, not that the client
// can decode them, and "identity" explicitly asks for no encoding. Sending
// raw zstd to either group would re-create the ERR_CONTENT_DECODING_FAILED
// failure mode this whole path exists to prevent.
func clientAcceptsZstd(header string) bool {
	for _, raw := range strings.Split(header, ",") {
		parts := strings.SplitN(strings.TrimSpace(raw), ";", 2)
		token := strings.TrimSpace(parts[0])
		if !strings.EqualFold(token, "zstd") {
			continue
		}
		if len(parts) == 2 && strings.EqualFold(strings.TrimSpace(parts[1]), "q=0") {
			return false
		}
		return true
	}
	return false
}

func (s *ReplayStore) removeTempFiles() error {
	return filepath.WalkDir(s.blocksDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".tmp") && !strings.HasPrefix(name, ".") {
			return nil
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	})
}

func (s *ReplayStore) loadIndexedBlocks() []ReplayBlockIndex {
	f, err := os.Open(filepath.Join(s.dir, replayIndexName))
	if err != nil {
		return nil
	}
	defer f.Close()
	var idx replayIndexFile
	if err := decodeIdentJSON(f, &idx); err != nil {
		slog.Warn("replay: ignoring unreadable index", "err", err, "path", filepath.Join(s.dir, replayIndexName))
		s.noteWarning("replay.cache.unreadable", "replay index could not be read", WithScope("cache"))
		return nil
	}
	if idx.Version != replayManifestVersion {
		slog.Warn("replay: ignoring index version", "version", idx.Version, "want", replayManifestVersion, "path", filepath.Join(s.dir, replayIndexName))
		s.noteWarning("replay.cache.unsupported_version", "replay index version is not supported", WithScope("cache"))
		return nil
	}
	return s.validateBlocks(idx.Blocks)
}

func (s *ReplayStore) loadCachedBlocks() ([]ReplayBlockIndex, bool) {
	rootPath := filepath.Join(s.blocksDir, replayCacheName)
	f, err := os.Open(rootPath)
	if err != nil {
		return nil, false
	}
	defer f.Close()

	var root replayRootCacheFile
	if err := decodeIdentJSON(f, &root); err != nil {
		slog.Warn("replay: ignoring unreadable cache", "err", err, "path", rootPath)
		s.noteWarning("replay.cache.unreadable", "replay cache could not be read", WithScope("cache"))
		return nil, false
	}
	if root.Version != replayManifestVersion || root.BlockSec != replayBlockDurationSecs {
		slog.Warn("replay: ignoring cache version", "version", root.Version, "block_sec", root.BlockSec, "path", rootPath)
		s.noteWarning("replay.cache.unsupported_version", "replay cache version is not supported", WithScope("cache"))
		return nil, false
	}

	blocks := []ReplayBlockIndex{}
	for _, day := range root.Days {
		dayPath, ok := replayDayCachePath(day.Date)
		if !ok {
			s.noteWarning("replay.cache.unreadable", "replay cache contains an invalid day", WithScope("cache"))
			return nil, false
		}
		dayCachePath := filepath.Join(s.blocksDir, filepath.FromSlash(dayPath), replayCacheName)
		dayFile, err := os.Open(dayCachePath)
		if err != nil {
			slog.Warn("replay: ignoring unavailable day cache", "err", err, "path", dayCachePath)
			s.noteWarning("replay.cache.unreadable", "replay day cache could not be read", WithScope(day.Date))
			return nil, false
		}
		var cache replayDayCacheFile
		decodeErr := decodeIdentJSON(dayFile, &cache)
		closeErr := dayFile.Close()
		if decodeErr != nil {
			slog.Warn("replay: ignoring unreadable day cache", "err", decodeErr, "path", dayCachePath)
			s.noteWarning("replay.cache.unreadable", "replay day cache could not be read", WithScope(day.Date))
			return nil, false
		}
		if closeErr != nil {
			slog.Warn("replay: closing day cache", "err", closeErr, "path", dayCachePath)
			s.noteWarning("replay.cache.unreadable", "replay day cache could not be read", WithScope(day.Date))
			return nil, false
		}
		if cache.Version != replayManifestVersion || cache.Date != day.Date || cache.BlockSec != replayBlockDurationSecs {
			slog.Warn("replay: ignoring day cache version", "version", cache.Version, "date", cache.Date, "block_sec", cache.BlockSec, "path", dayCachePath)
			s.noteWarning("replay.cache.unsupported_version", "replay day cache version is not supported", WithScope(day.Date))
			return nil, false
		}
		for _, block := range cache.Blocks {
			name := replayBlockNameFromURL(block.URL)
			if name == "" {
				name = replayBlockName(block.Start, block.End)
			}
			start, end, ok := parseReplayBlockName(name)
			if !ok {
				s.noteWarning("replay.cache.unreadable", "replay day cache contains an invalid block", WithScope(day.Date))
				return nil, false
			}
			blocks = append(blocks, ReplayBlockIndex{
				Start: start,
				End:   end,
				URL:   replayBlockURLPrefix + name,
				Bytes: block.Bytes,
				Name:  name,
			})
		}
	}
	return sortedReplayBlocks(blocks), true
}

func (s *ReplayStore) scanBlocksDir(noteProgress bool) ([]ReplayBlockIndex, error) {
	out := []ReplayBlockIndex{}
	lastNote := time.Now()
	err := filepath.WalkDir(s.blocksDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if noteProgress && time.Since(lastNote) >= replayReindexingReemit {
			s.noteReindexing()
			lastNote = time.Now()
		}
		if entry.IsDir() {
			return nil
		}
		name, err := filepath.Rel(s.blocksDir, path)
		if err != nil {
			return err
		}
		name = filepath.ToSlash(name)
		start, end, ok := parseReplayBlockName(name)
		if !ok {
			return nil
		}
		out = append(out, ReplayBlockIndex{Start: start, End: end, Name: name})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.validateBlocks(out), nil
}

func replayRootCacheExists(blocksDir string) bool {
	info, err := os.Stat(filepath.Join(blocksDir, replayCacheName))
	return err == nil && !info.IsDir()
}

func (s *ReplayStore) validateBlocks(blocks []ReplayBlockIndex) []ReplayBlockIndex {
	out := make([]ReplayBlockIndex, 0, len(blocks))
	for _, block := range blocks {
		name := block.Name
		if name == "" {
			name = replayBlockName(block.Start, block.End)
		}
		start, end, ok := parseReplayBlockName(name)
		if !ok || end <= start {
			continue
		}
		info, err := os.Stat(filepath.Join(s.blocksDir, filepath.FromSlash(name)))
		if err != nil || info.IsDir() {
			continue
		}
		// Trust the parsed filename + Stat info. Decoding the block at
		// startup decompresses the full zstd payload per file and is the
		// dominant cost of a slow boot; the client decompresses on read
		// anyway, and surfaces its own diagnostic if the block is
		// undecodeable. Validation here only duplicated that work.
		out = append(out, ReplayBlockIndex{
			Start: start,
			End:   end,
			URL:   replayBlockURLPrefix + name,
			Bytes: info.Size(),
			Name:  name,
		})
	}
	return out
}

// noteWarning emits a persistent replay-side diagnostic. The entry stays
// visible (TTL 0) until process restart or a later emission displaces the
// same channel/code/scope key.
func (s *ReplayStore) noteWarning(code, message string, opts ...DiagnosticOpt) {
	if s.diagnostics == nil {
		return
	}
	noteOpts := append([]DiagnosticOpt{WithTTL(0)}, opts...)
	s.diagnostics.Note("replay", code, severityWarning, message, noteOpts...)
}

func (s *ReplayStore) noteReindexing() {
	if s.diagnostics == nil {
		return
	}
	s.diagnostics.Note(
		"replay",
		"replay.cache.reindexing",
		severityWarning,
		"replay cache reindexing is in progress",
		WithScope("cache"),
		WithTTL(replayReindexingTTL),
	)
}

func (s *ReplayStore) noteCacheWriteFailed(err error, scope ...string) {
	slog.Warn("replay: write cache", "err", err)
	diagScope := "cache"
	if len(scope) > 0 && strings.TrimSpace(scope[0]) != "" {
		diagScope = scope[0]
	}
	s.noteWarning("replay.cache.write_failed", "replay cache metadata could not be written", WithScope(diagScope))
}

func (s *ReplayStore) finalizeLocked(active *replayActiveBlock, nowMs int64) (ReplayManifest, bool, error) {
	if active == nil || len(active.frames) == 0 {
		s.pruneLocked(nowMs)
		return s.manifestLocked(), false, nil
	}
	block := replayBlockFile{
		Version: replayManifestVersion,
		Start:   active.start,
		End:     active.end,
		StepMS:  int64(s.sampleInterval / time.Millisecond),
		Frames:  active.frames,
	}
	name := replayBlockName(active.start, active.end)
	blockDir := filepath.Join(s.blocksDir, filepath.Dir(name))
	if err := os.MkdirAll(blockDir, 0o755); err != nil {
		return s.manifestLocked(), false, err
	}
	tmp, err := os.CreateTemp(blockDir, "."+filepath.Base(name)+".*.tmp")
	if err != nil {
		return s.manifestLocked(), false, err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	zw, err := zstd.NewWriter(tmp, zstd.WithEncoderLevel(zstd.EncoderLevelFromZstd(10)), zstd.WithEncoderCRC(true))
	if err != nil {
		_ = tmp.Close()
		return s.manifestLocked(), false, err
	}
	encErr := json.NewEncoder(zw).Encode(block)
	closeErr := zw.Close()
	fileErr := tmp.Close()
	if encErr != nil {
		return s.manifestLocked(), false, encErr
	}
	if closeErr != nil {
		return s.manifestLocked(), false, closeErr
	}
	if fileErr != nil {
		return s.manifestLocked(), false, fileErr
	}
	info, err := os.Stat(tmpName)
	if err != nil {
		return s.manifestLocked(), false, err
	}
	newSize := info.Size()
	if newSize > s.maxBytes {
		slog.Warn("replay: skip block size exceeds budget", "name", name, "size", newSize, "want", s.maxBytes)
		changed := s.pruneLocked(nowMs)
		if changed {
			if err := s.writeIndexLocked(); err != nil {
				s.noteCacheWriteFailed(err)
			}
			if err := s.writeCacheLocked(); err != nil {
				s.noteCacheWriteFailed(err)
			}
		}
		return s.manifestLocked(), changed, nil
	}
	s.pruneByBudgetLocked(newSize)
	if s.totalBytesLocked()+newSize > s.maxBytes {
		return s.manifestLocked(), false, fmt.Errorf("block %s would exceed replay byte budget", name)
	}
	finalPath := filepath.Join(s.blocksDir, filepath.FromSlash(name))
	if err := os.Rename(tmpName, finalPath); err != nil {
		return s.manifestLocked(), false, err
	}
	s.blocks = append(s.blocks, ReplayBlockIndex{
		Start: active.start,
		End:   active.end,
		URL:   replayBlockURLPrefix + name,
		Bytes: newSize,
		Name:  name,
	})
	s.blocks = sortedReplayBlocks(s.blocks)
	s.rebuildLookupLocked()
	s.pruneLocked(nowMs)
	if err := s.writeIndexLocked(); err != nil {
		s.noteCacheWriteFailed(err)
		return s.manifestLocked(), true, err
	}
	if err := s.writeCacheLocked(); err != nil {
		s.noteCacheWriteFailed(err)
		return s.manifestLocked(), true, err
	}
	return s.manifestLocked(), true, nil
}

func (s *ReplayStore) pruneLocked(nowMs int64) bool {
	changed := false
	if s.pruneByBudgetLocked(0) {
		changed = true
	}
	if changed {
		s.rebuildLookupLocked()
	}
	return changed
}

func (s *ReplayStore) pruneByBudgetLocked(extraBytes int64) bool {
	changed := false
	total := s.totalBytesLocked() + extraBytes
	if total <= s.maxBytes {
		return false
	}
	targetBytes := int64(float64(s.maxBytes) * s.cleanupLowWatermark)
	if targetBytes <= 0 || targetBytes > s.maxBytes {
		targetBytes = s.maxBytes
	}
	for len(s.blocks) > 0 && total > targetBytes {
		oldest := s.blocks[0]
		if err := removeReplayBlock(s.blocksDir, oldest.Name); err != nil {
			slog.Warn("replay: remove", "name", oldest.Name, "path", filepath.Join(s.blocksDir, filepath.FromSlash(oldest.Name)), "err", err)
			s.noteWarning("replay.cache.cleaning_failed", "replay cache cleanup could not remove an old block", WithScope(replayBlockDay(oldest.Start)))
			break
		}
		s.blocks = s.blocks[1:]
		total -= oldest.Bytes
		changed = true
	}
	if changed {
		s.rebuildLookupLocked()
	}
	return changed
}

func (s *ReplayStore) repairReplayBlock(name, code, message string) bool {
	start, _, ok := parseReplayBlockName(name)
	if !ok {
		return false
	}
	day := replayBlockDay(start)
	s.mu.Lock()
	found := -1
	for i, block := range s.blocks {
		if block.Name == name {
			found = i
			break
		}
	}
	if found < 0 {
		s.mu.Unlock()
		slog.Debug("replay: ignoring failure report for unknown block", "name", name, "code", code)
		return false
	}
	s.blocks = append(s.blocks[:found], s.blocks[found+1:]...)
	s.rebuildLookupLocked()
	dayBlocks := make([]ReplayBlockIndex, 0)
	for _, block := range s.blocks {
		if replayBlockDay(block.Start) == day {
			dayBlocks = append(dayBlocks, block)
		}
	}
	indexErr := s.writeIndexLocked()
	cacheErr := s.writeCacheLocked()
	dayErr := s.writeDayCacheLocked(day, dayBlocks)
	manifest := s.manifestLocked()
	s.mu.Unlock()

	if indexErr != nil {
		s.noteCacheWriteFailed(indexErr, "cache")
	}
	if cacheErr != nil {
		s.noteCacheWriteFailed(cacheErr, day)
	}
	if dayErr != nil {
		s.noteCacheWriteFailed(dayErr, day)
	}
	s.noteWarning(code, message, WithScope(day))
	s.noteWarning("replay.cache.stale", "replay cache metadata was repaired after a bad block", WithScope(day))
	s.publishAvailability(manifest)
	return true
}

func (s *ReplayStore) totalBytesLocked() int64 {
	var total int64
	for _, block := range s.blocks {
		total += block.Bytes
	}
	return total
}

func (s *ReplayStore) writeIndexLocked() error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.dir, "."+replayIndexName+".*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	encErr := json.NewEncoder(tmp).Encode(replayIndexFile{
		Version: replayManifestVersion,
		Blocks:  s.blocks,
	})
	closeErr := tmp.Close()
	if encErr != nil {
		return encErr
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmpName, filepath.Join(s.dir, replayIndexName))
}

func (s *ReplayStore) writeCacheLocked() error {
	if err := os.MkdirAll(s.blocksDir, 0o755); err != nil {
		return err
	}
	days := replayDaySummaries(s.blocks)
	root := replayRootCacheFile{
		Version:  replayManifestVersion,
		BlockSec: replayBlockDurationSecs,
		Days:     days,
	}
	if len(s.blocks) > 0 {
		from := s.blocks[0].Start
		to := s.blocks[len(s.blocks)-1].End
		root.From = &from
		root.To = &to
	}
	if err := writeJSONAtomic(filepath.Join(s.blocksDir, replayCacheName), root); err != nil {
		return err
	}
	byDay := map[string][]ReplayBlockIndex{}
	for _, block := range s.blocks {
		day := replayBlockDay(block.Start)
		byDay[day] = append(byDay[day], block)
	}
	for day, blocks := range byDay {
		if err := s.writeDayCacheLocked(day, blocks); err != nil {
			return err
		}
	}
	return nil
}

func (s *ReplayStore) writeDayCacheLocked(day string, blocks []ReplayBlockIndex) error {
	dayPath, ok := replayDayCachePath(day)
	if !ok {
		return fmt.Errorf("invalid replay day %q", day)
	}
	path := filepath.Join(s.blocksDir, filepath.FromSlash(dayPath), replayCacheName)
	cache := replayDayCacheFile{
		Version:  replayManifestVersion,
		Date:     day,
		BlockSec: replayBlockDurationSecs,
		Blocks:   blocks,
	}
	return writeJSONAtomic(path, cache)
}

func writeJSONAtomic(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	encErr := json.NewEncoder(tmp).Encode(v)
	closeErr := tmp.Close()
	if encErr != nil {
		return encErr
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmpName, path)
}

func replayDaySummaries(blocks []ReplayBlockIndex) []replayDaySummary {
	byDay := map[string]*replayDaySummary{}
	for _, block := range blocks {
		day := replayBlockDay(block.Start)
		summary := byDay[day]
		if summary == nil {
			summary = &replayDaySummary{
				Date: day,
				From: block.Start,
				To:   block.End,
				Path: replayBlockURLPrefix + strings.ReplaceAll(day, "-", "/") + "/" + replayCacheName,
			}
			byDay[day] = summary
		}
		if block.Start < summary.From {
			summary.From = block.Start
		}
		if block.End > summary.To {
			summary.To = block.End
		}
		summary.Blocks++
		summary.Bytes += block.Bytes
	}
	out := make([]replayDaySummary, 0, len(byDay))
	for _, summary := range byDay {
		out = append(out, *summary)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Date < out[j].Date
	})
	return out
}

func (s *ReplayStore) manifestLocked() ReplayManifest {
	blocks := append([]ReplayBlockIndex(nil), s.blocks...)
	var from *int64
	var to *int64
	if len(blocks) > 0 {
		f := blocks[0].Start
		t := blocks[len(blocks)-1].End
		from = &f
		to = &t
	}
	return ReplayManifest{
		Enabled:  s.enabled,
		From:     from,
		To:       to,
		BlockSec: replayBlockDurationSecs,
		Blocks:   blocks,
	}
}

func (s *ReplayStore) activeBlockFileLocked() (replayBlockFile, bool) {
	if s.active == nil || len(s.active.frames) == 0 {
		return replayBlockFile{}, false
	}
	frames := append([]ReplayFrame(nil), s.active.frames...)
	return replayBlockFile{
		Version: replayManifestVersion,
		Start:   s.active.start,
		End:     frames[len(frames)-1].Ts,
		StepMS:  int64(s.sampleInterval / time.Millisecond),
		Frames:  frames,
	}, true
}

func (s *ReplayStore) rebuildLookupLocked() {
	s.byName = map[string]ReplayBlockIndex{}
	for _, block := range s.blocks {
		s.byName[block.Name] = block
	}
}

func (s *ReplayStore) publishAvailability(manifest ReplayManifest) {
	if s.onAvailability != nil {
		s.onAvailability(manifest)
	}
}

func replayBlockName(start, end int64) string {
	dayPath := replayBlockDayPath(start)
	return fmt.Sprintf("%s/%d-%d.json.zst", dayPath, start, end)
}

func parseReplayBlockName(name string) (int64, int64, bool) {
	name = filepath.ToSlash(name)
	if !replayBlockNameRE.MatchString(name) {
		return 0, 0, false
	}
	parts := strings.Split(strings.TrimSuffix(path.Base(name), ".json.zst"), "-")
	if len(parts) != 2 {
		return 0, 0, false
	}
	var start, end int64
	if _, err := fmt.Sscan(parts[0], &start); err != nil {
		return 0, 0, false
	}
	if _, err := fmt.Sscan(parts[1], &end); err != nil {
		return 0, 0, false
	}
	if end != start+replayBlockDurationMS || start%replayBlockDurationMS != 0 {
		return 0, 0, false
	}
	if replayBlockDayPath(start) != path.Dir(name) {
		return 0, 0, false
	}
	return start, end, true
}

func replayBlockDay(start int64) string {
	return time.UnixMilli(start).UTC().Format("2006-01-02")
}

func replayDayCachePath(day string) (string, bool) {
	t, err := time.Parse("2006-01-02", day)
	if err != nil || t.Format("2006-01-02") != day {
		return "", false
	}
	return t.Format("2006/01/02"), true
}

func replayBlockDayPath(start int64) string {
	return time.UnixMilli(start).UTC().Format("2006/01/02")
}

func replayBlockNameFromURL(raw string) string {
	if !strings.HasPrefix(raw, replayBlockURLPrefix) {
		return ""
	}
	return strings.TrimPrefix(raw, replayBlockURLPrefix)
}

func sortedReplayBlocks(blocks []ReplayBlockIndex) []ReplayBlockIndex {
	out := append([]ReplayBlockIndex(nil), blocks...)
	sort.Slice(out, func(i, j int) bool {
		if out[i].Start == out[j].Start {
			return out[i].End < out[j].End
		}
		return out[i].Start < out[j].Start
	})
	return out
}

func mergeReplayBlocks(indexed, scanned []ReplayBlockIndex) []ReplayBlockIndex {
	byName := map[string]ReplayBlockIndex{}
	for _, block := range indexed {
		byName[block.Name] = block
	}
	for _, block := range scanned {
		byName[block.Name] = block
	}
	out := make([]ReplayBlockIndex, 0, len(byName))
	for _, block := range byName {
		out = append(out, block)
	}
	return sortedReplayBlocks(out)
}

func removeReplayBlock(blocksDir, name string) error {
	if name == "" {
		return nil
	}
	err := os.Remove(filepath.Join(blocksDir, filepath.FromSlash(name)))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func compactReplayAircraft(in []identAircraft) []ReplayAircraft {
	out := make([]ReplayAircraft, 0, len(in))
	for _, ac := range in {
		hex := normalizeTrailHex(ac.Hex)
		if hex == "" {
			continue
		}
		out = append(out, ReplayAircraft{
			Hex:         hex,
			Type:        string(ac.Source),
			Flight:      strings.TrimSpace(ac.Flight),
			R:           ac.Registration,
			T:           ac.TypeDesignator,
			Desc:        ac.Description,
			OwnOp:       ac.Operator,
			Category:    ac.Category,
			Lat:         ac.Lat,
			Lon:         ac.Lon,
			AltBaro:     replayAltBaro(ac),
			AltGeom:     ac.AltGeomFt,
			GS:          ac.GsKt,
			Track:       ac.TrackDeg,
			BaroRate:    ac.BaroRateFpm,
			GeomRate:    ac.GeomRateFpm,
			Squawk:      ac.Squawk,
			Emergency:   ac.Emergency,
			Messages:    replayInt(ac.AircraftMessagesTotal),
			Seen:        ac.SeenSec,
			SeenPos:     ac.SeenPosSec,
			RSSI:        ac.RssiDbfs,
			DBFlags:     replayDBFlags(ac.DbFlags),
			Airground:   replayAirground(ac),
			NavQNH:      ac.QnhHPa,
			NavAltMCP:   ac.McpAltFt,
			NavAltFMS:   ac.FmsAltFt,
			NavHeading:  ac.NavHdgDeg,
			NavModes:    ac.NavModes,
			TrueHeading: ac.TrueHeadingDeg,
			MagHeading:  ac.MagHeadingDeg,
		})
	}
	return out
}

func replayAltBaro(ac identAircraft) json.RawMessage {
	if ac.AltBaroFt != nil {
		return replayRawJSON(*ac.AltBaroFt)
	}
	if ac.OnGround != nil && *ac.OnGround {
		return replayRawJSON("ground")
	}
	return nil
}

func replayAirground(ac identAircraft) json.RawMessage {
	if ac.OnGround == nil {
		return nil
	}
	if *ac.OnGround {
		return replayRawJSON("ground")
	}
	return replayRawJSON("airborne")
}

func replayRawJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return b
}

func replayInt(v *float64) *int {
	if v == nil || !numberIsFinite(*v) {
		return nil
	}
	out := int(math.Round(*v))
	return &out
}

func replayDBFlags(v *uint16) *int {
	if v == nil {
		return nil
	}
	out := int(*v)
	return &out
}

func readZstdReplayBlock(path string) (replayBlockFile, error) {
	var out replayBlockFile
	f, err := os.Open(path)
	if err != nil {
		return out, err
	}
	defer f.Close()
	zr, err := zstd.NewReader(f)
	if err != nil {
		return out, err
	}
	defer zr.Close()
	return out, decodeIdentJSON(zr, &out)
}
