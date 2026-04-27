package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/klauspost/compress/zstd"
)

const (
	replayIndexName       = "index.json"
	replayBlocksDirName   = "blocks"
	replayBlockURLPrefix  = "/api/replay/blocks/"
	replayManifestVersion = 1
)

var replayBlockNameRE = regexp.MustCompile(`^\d+-\d+\.json\.zst$`)

type ReplayOptions struct {
	Enabled        bool
	Dir            string
	Retention      time.Duration
	MaxBytes       int64
	BlockDuration  time.Duration
	SampleInterval time.Duration
	OnAvailability func(ReplayManifest)
}

type ReplayStore struct {
	mu sync.RWMutex

	enabled        bool
	dir            string
	blocksDir      string
	retention      time.Duration
	maxBytes       int64
	blockDuration  time.Duration
	sampleInterval time.Duration
	onAvailability func(ReplayManifest)

	blocks      []ReplayBlockIndex
	byName      map[string]ReplayBlockIndex
	active      *replayActiveBlock
	lastSample  int64
	activeDirty bool
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

type replayAircraftFrame struct {
	Now      float64          `json:"now"`
	Aircraft []ReplayAircraft `json:"aircraft"`
}

type replayActiveBlock struct {
	start  int64
	end    int64
	frames []ReplayFrame
}

func NewReplayStore(options ReplayOptions) (*ReplayStore, error) {
	blockDuration := options.BlockDuration
	if blockDuration <= 0 {
		blockDuration = 5 * time.Minute
	}
	sampleInterval := options.SampleInterval
	if sampleInterval <= 0 {
		sampleInterval = 5 * time.Second
	}
	store := &ReplayStore{
		enabled:        options.Enabled,
		dir:            options.Dir,
		blocksDir:      filepath.Join(options.Dir, replayBlocksDirName),
		retention:      options.Retention,
		maxBytes:       options.MaxBytes,
		blockDuration:  blockDuration,
		sampleInterval: sampleInterval,
		onAvailability: options.OnAvailability,
		byName:         map[string]ReplayBlockIndex{},
	}
	if !options.Enabled {
		return store, nil
	}
	if strings.TrimSpace(options.Dir) == "" {
		return nil, errors.New("IDENT_REPLAY_DIR is required when replay is enabled")
	}
	if options.Retention <= 0 {
		return nil, errors.New("IDENT_REPLAY_RETENTION_SEC must be positive when replay is enabled")
	}
	if options.MaxBytes <= 0 {
		return nil, errors.New("IDENT_REPLAY_MAX_BYTES must be positive when replay is enabled")
	}
	if blockDuration < time.Minute {
		return nil, errors.New("replay block duration must be at least 1 minute")
	}
	if sampleInterval <= 0 || sampleInterval > blockDuration {
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
	if err := s.removeTempFiles(); err != nil {
		return err
	}
	blocks := mergeReplayBlocks(s.loadIndexedBlocks(), s.scanBlocksDir())

	s.mu.Lock()
	s.blocks = sortedReplayBlocks(blocks)
	s.rebuildLookupLocked()
	s.pruneLocked(time.Now().UnixMilli())
	if err := s.writeIndexLocked(); err != nil {
		s.mu.Unlock()
		return err
	}
	manifest := s.manifestLocked()
	s.mu.Unlock()
	s.publishAvailability(manifest)
	return nil
}

func (s *ReplayStore) IngestAircraftJSON(b []byte) {
	if !s.enabled {
		return
	}
	var frame replayAircraftFrame
	if err := json.Unmarshal(b, &frame); err != nil {
		return
	}
	if len(frame.Aircraft) == 0 {
		return
	}
	nowMs := time.Now().UnixMilli()
	if numberIsFinite(frame.Now) && frame.Now > 0 {
		nowMs = int64(math.Round(frame.Now * 1000))
	}

	minDeltaMs := int64(s.sampleInterval / time.Millisecond)
	s.mu.Lock()
	if s.lastSample > 0 && minDeltaMs > 0 && nowMs-s.lastSample < minDeltaMs {
		s.mu.Unlock()
		return
	}
	s.lastSample = nowMs

	blockMs := int64(s.blockDuration / time.Millisecond)
	blockStart := (nowMs / blockMs) * blockMs
	if s.active == nil {
		s.active = &replayActiveBlock{start: blockStart, end: blockStart + blockMs}
	} else if blockStart > s.active.start {
		active := s.active
		s.active = &replayActiveBlock{start: blockStart, end: blockStart + blockMs}
		manifest, changed, err := s.finalizeLocked(active, nowMs)
		s.mu.Unlock()
		if err != nil {
			log.Printf("replay: finalize: %v", err)
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
	if !s.enabled || !replayBlockNameRE.MatchString(name) {
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
	path := filepath.Join(s.blocksDir, block.Name)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Encoding", "zstd")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, path)
}

func (s *ReplayStore) removeTempFiles() error {
	entries, err := os.ReadDir(s.blocksDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || (!strings.HasSuffix(name, ".tmp") && !strings.HasPrefix(name, ".")) {
			continue
		}
		if err := os.Remove(filepath.Join(s.blocksDir, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

func (s *ReplayStore) loadIndexedBlocks() []ReplayBlockIndex {
	f, err := os.Open(filepath.Join(s.dir, replayIndexName))
	if err != nil {
		return nil
	}
	defer f.Close()
	var idx replayIndexFile
	if err := json.NewDecoder(f).Decode(&idx); err != nil || idx.Version != replayManifestVersion {
		return nil
	}
	return s.validateBlocks(idx.Blocks)
}

func (s *ReplayStore) scanBlocksDir() []ReplayBlockIndex {
	entries, err := os.ReadDir(s.blocksDir)
	if err != nil {
		return nil
	}
	out := make([]ReplayBlockIndex, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !replayBlockNameRE.MatchString(entry.Name()) {
			continue
		}
		start, end, ok := parseReplayBlockName(entry.Name())
		if !ok {
			continue
		}
		out = append(out, ReplayBlockIndex{Start: start, End: end, Name: entry.Name()})
	}
	return s.validateBlocks(out)
}

func (s *ReplayStore) validateBlocks(blocks []ReplayBlockIndex) []ReplayBlockIndex {
	out := make([]ReplayBlockIndex, 0, len(blocks))
	for _, block := range blocks {
		name := block.Name
		if name == "" {
			name = replayBlockName(block.Start, block.End)
		}
		if !replayBlockNameRE.MatchString(name) {
			continue
		}
		start, end, ok := parseReplayBlockName(name)
		if !ok || end <= start {
			continue
		}
		info, err := os.Stat(filepath.Join(s.blocksDir, name))
		if err != nil || info.IsDir() {
			continue
		}
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
	tmp, err := os.CreateTemp(s.blocksDir, "."+name+".*.tmp")
	if err != nil {
		return s.manifestLocked(), false, err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	zw, err := zstd.NewWriter(tmp, zstd.WithEncoderLevel(zstd.EncoderLevelFromZstd(10)))
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
		log.Printf("replay: skip %s: block size %d exceeds budget %d", name, newSize, s.maxBytes)
		changed := s.pruneLocked(nowMs)
		if changed {
			_ = s.writeIndexLocked()
		}
		return s.manifestLocked(), changed, nil
	}
	s.pruneByBudgetLocked(newSize)
	if s.totalBytesLocked()+newSize > s.maxBytes {
		return s.manifestLocked(), false, fmt.Errorf("block %s would exceed replay byte budget", name)
	}
	finalPath := filepath.Join(s.blocksDir, name)
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
		return s.manifestLocked(), true, err
	}
	return s.manifestLocked(), true, nil
}

func (s *ReplayStore) pruneLocked(nowMs int64) bool {
	changed := false
	if s.retention > 0 && nowMs > 0 {
		cutoff := nowMs - int64(s.retention/time.Millisecond)
		kept := s.blocks[:0]
		for _, block := range s.blocks {
			if block.End < cutoff {
				removeReplayBlock(s.blocksDir, block.Name)
				changed = true
				continue
			}
			kept = append(kept, block)
		}
		s.blocks = kept
	}
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
	for len(s.blocks) > 0 && s.totalBytesLocked()+extraBytes > s.maxBytes {
		oldest := s.blocks[0]
		removeReplayBlock(s.blocksDir, oldest.Name)
		s.blocks = s.blocks[1:]
		changed = true
	}
	if changed {
		s.rebuildLookupLocked()
	}
	return changed
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
		BlockSec: int64(s.blockDuration / time.Second),
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
	return fmt.Sprintf("%d-%d.json.zst", start, end)
}

func parseReplayBlockName(name string) (int64, int64, bool) {
	if !replayBlockNameRE.MatchString(name) {
		return 0, 0, false
	}
	parts := strings.Split(strings.TrimSuffix(name, ".json.zst"), "-")
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
	return start, end, end > start
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

func removeReplayBlock(blocksDir, name string) {
	if name == "" {
		return
	}
	if err := os.Remove(filepath.Join(blocksDir, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Printf("replay: remove %s: %v", name, err)
	}
}

func compactReplayAircraft(in []ReplayAircraft) []ReplayAircraft {
	out := make([]ReplayAircraft, 0, len(in))
	for _, ac := range in {
		ac.Hex = normalizeTrailHex(ac.Hex)
		if ac.Hex == "" {
			continue
		}
		ac.Flight = strings.TrimSpace(ac.Flight)
		out = append(out, ac)
	}
	return out
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
	err = json.NewDecoder(zr).Decode(&out)
	return out, err
}
