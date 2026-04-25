package main

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const restartTrailCacheName = "trails.json.gz"

type TrailOptions struct {
	MemoryWindow    time.Duration
	SnapshotWindow  time.Duration
	SampleInterval  time.Duration
	RestartCacheDir string
}

type TrailStore struct {
	mu             sync.RWMutex
	memoryWindow   time.Duration
	snapshotWindow time.Duration
	sampleInterval time.Duration
	cacheDir       string

	aircraft      map[string][]trailPoint
	snapshot      []byte
	snapshotDirty bool

	cacheGeneration      uint64
	cacheSavedGeneration uint64
}

type trailPoint struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
	Alt any     `json:"alt"`
	Ts  int64   `json:"ts"`
}

type trailEnvelopeData struct {
	Aircraft map[string][]trailPoint `json:"aircraft"`
}

type trailBackfillEnvelope struct {
	Type      string            `json:"type"`
	RequestID string            `json:"request_id,omitempty"`
	Truncated bool              `json:"truncated,omitempty"`
	Data      trailEnvelopeData `json:"data"`
}

type TrailBackfillRequest struct {
	RequestID string
	SinceMs   int64
	UntilMs   int64
	Hex       []string
	MaxWindow time.Duration
	MaxPoints int
}

type trailCacheFile struct {
	Version  int                     `json:"version"`
	Aircraft map[string][]trailPoint `json:"aircraft"`
}

type aircraftTrailFrame struct {
	Now      float64              `json:"now"`
	Aircraft []aircraftTrailInput `json:"aircraft"`
}

type aircraftTrailInput struct {
	Hex      string          `json:"hex"`
	Lat      *float64        `json:"lat"`
	Lon      *float64        `json:"lon"`
	AltBaro  json.RawMessage `json:"alt_baro"`
	AltGeom  *float64        `json:"alt_geom"`
	Altitude *float64        `json:"altitude"`
	Ground   bool            `json:"ground"`
}

func NewTrailStore(options TrailOptions) *TrailStore {
	return &TrailStore{
		memoryWindow:   options.MemoryWindow,
		snapshotWindow: options.SnapshotWindow,
		sampleInterval: options.SampleInterval,
		cacheDir:       options.RestartCacheDir,
		aircraft:       map[string][]trailPoint{},
		snapshotDirty:  true,
	}
}

func (s *TrailStore) IngestAircraftJSON(b []byte) []byte {
	var frame aircraftTrailFrame
	if err := json.Unmarshal(b, &frame); err != nil {
		return nil
	}
	if len(frame.Aircraft) == 0 {
		return nil
	}
	nowMs := time.Now().UnixMilli()
	if numberIsFinite(frame.Now) && frame.Now > 0 {
		nowMs = int64(math.Round(frame.Now * 1000))
	}

	delta := map[string][]trailPoint{}
	cutoff := trailCutoff(nowMs, s.memoryWindow)
	minDeltaMs := int64(s.sampleInterval / time.Millisecond)

	s.mu.Lock()
	defer s.mu.Unlock()
	for _, ac := range frame.Aircraft {
		hex := normalizeTrailHex(ac.Hex)
		if hex == "" || ac.Lat == nil || ac.Lon == nil {
			continue
		}
		point := trailPoint{
			Lat: *ac.Lat,
			Lon: *ac.Lon,
			Alt: trailAltitude(ac),
			Ts:  nowMs,
		}
		series := pruneTrailSeries(s.aircraft[hex], cutoff)
		if len(series) > 0 && minDeltaMs > 0 && point.Ts-series[len(series)-1].Ts < minDeltaMs {
			s.aircraft[hex] = series
			continue
		}
		series = append(series, point)
		s.aircraft[hex] = series
		delta[hex] = append(delta[hex], point)
	}
	if len(delta) == 0 {
		return nil
	}
	s.pruneLocked(cutoff)
	s.snapshotDirty = true
	s.cacheGeneration++
	return marshalTrailEnvelope(delta)
}

func (s *TrailStore) SnapshotEnvelopes() [][]byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.aircraft) == 0 {
		return nil
	}
	if s.snapshotDirty || len(s.snapshot) == 0 {
		aircraft, _ := s.filteredTrailAircraftLocked(TrailBackfillRequest{
			UntilMs:   latestTrailTimestamp(s.aircraft),
			MaxWindow: s.snapshotWindow,
		})
		s.snapshot = marshalTrailEnvelope(aircraft)
		s.snapshotDirty = false
	}
	if len(s.snapshot) == 0 {
		return nil
	}
	return [][]byte{append([]byte(nil), s.snapshot...)}
}

func (s *TrailStore) BackfillTrailEnvelope(req TrailBackfillRequest) []byte {
	s.mu.RLock()
	aircraft, truncated := s.filteredTrailAircraftLocked(req)
	s.mu.RUnlock()
	env := trailBackfillEnvelope{
		Type:      "trails",
		RequestID: req.RequestID,
		Truncated: truncated,
		Data: trailEnvelopeData{
			Aircraft: aircraft,
		},
	}
	out, err := json.Marshal(env)
	if err != nil {
		return nil
	}
	return out
}

func (s *TrailStore) LoadRestartCache() error {
	if s.cacheDir == "" {
		return nil
	}
	f, err := os.Open(filepath.Join(s.cacheDir, restartTrailCacheName))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()

	var cached trailCacheFile
	if err := json.NewDecoder(gz).Decode(&cached); err != nil {
		return err
	}
	if cached.Version != 1 {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.aircraft = copyTrailAircraft(cached.Aircraft)
	if latest := latestTrailTimestamp(s.aircraft); latest > 0 {
		s.pruneLocked(trailCutoff(latest, s.memoryWindow))
	}
	s.snapshotDirty = true
	s.cacheGeneration = 0
	s.cacheSavedGeneration = 0
	return nil
}

func (s *TrailStore) SaveRestartCache() error {
	if s.cacheDir == "" {
		return nil
	}
	s.mu.RLock()
	if len(s.aircraft) == 0 {
		s.mu.RUnlock()
		return nil
	}
	generation := s.cacheGeneration
	cached := trailCacheFile{
		Version:  1,
		Aircraft: copyTrailAircraft(s.aircraft),
	}
	s.mu.RUnlock()

	if err := os.MkdirAll(s.cacheDir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.cacheDir, ".trails-*.json.gz")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	gz := gzip.NewWriter(tmp)
	encErr := json.NewEncoder(gz).Encode(cached)
	closeErr := gz.Close()
	fileErr := tmp.Close()
	if encErr != nil {
		return encErr
	}
	if closeErr != nil {
		return closeErr
	}
	if fileErr != nil {
		return fileErr
	}
	if err := os.Rename(tmpName, filepath.Join(s.cacheDir, restartTrailCacheName)); err != nil {
		return err
	}

	s.mu.Lock()
	if s.cacheGeneration == generation {
		s.cacheSavedGeneration = generation
	}
	s.mu.Unlock()
	return nil
}

func (s *TrailStore) RunRestartCacheWriter(ctx context.Context, interval time.Duration) {
	if s.cacheDir == "" || interval <= 0 {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			_ = s.saveRestartCacheIfDirty()
			return
		case <-ticker.C:
			_ = s.saveRestartCacheIfDirty()
		}
	}
}

func (s *TrailStore) saveRestartCacheIfDirty() error {
	s.mu.RLock()
	dirty := s.cacheGeneration != s.cacheSavedGeneration
	s.mu.RUnlock()
	if !dirty {
		return nil
	}
	return s.SaveRestartCache()
}

func numberIsFinite(n float64) bool {
	return !math.IsNaN(n) && !math.IsInf(n, 0)
}

func normalizeTrailHex(hex string) string {
	hex = strings.ToLower(strings.TrimSpace(hex))
	if len(hex) == 0 {
		return ""
	}
	return hex
}

func trailAltitude(ac aircraftTrailInput) any {
	if len(ac.AltBaro) > 0 && string(ac.AltBaro) != "null" {
		var label string
		if err := json.Unmarshal(ac.AltBaro, &label); err == nil {
			if label == "ground" {
				return "ground"
			}
		}
		var alt float64
		if err := json.Unmarshal(ac.AltBaro, &alt); err == nil && numberIsFinite(alt) {
			return roundAltitude(alt)
		}
	}
	if ac.Ground {
		return "ground"
	}
	if ac.AltGeom != nil && numberIsFinite(*ac.AltGeom) {
		return roundAltitude(*ac.AltGeom)
	}
	if ac.Altitude != nil && numberIsFinite(*ac.Altitude) {
		return roundAltitude(*ac.Altitude)
	}
	return "ground"
}

func roundAltitude(alt float64) any {
	rounded := math.Round(alt)
	if math.Abs(alt-rounded) < 0.001 {
		return int(rounded)
	}
	return alt
}

func trailCutoff(nowMs int64, window time.Duration) int64 {
	if window <= 0 {
		return 0
	}
	return nowMs - int64(window/time.Millisecond)
}

func pruneTrailSeries(points []trailPoint, cutoff int64) []trailPoint {
	if cutoff <= 0 || len(points) == 0 {
		return points
	}
	idx := sort.Search(len(points), func(i int) bool { return points[i].Ts >= cutoff })
	if idx == 0 {
		return points
	}
	out := append([]trailPoint(nil), points[idx:]...)
	return out
}

func (s *TrailStore) pruneLocked(cutoff int64) {
	if cutoff <= 0 {
		return
	}
	for hex, points := range s.aircraft {
		points = pruneTrailSeries(points, cutoff)
		if len(points) == 0 {
			delete(s.aircraft, hex)
			continue
		}
		s.aircraft[hex] = points
	}
}

func (s *TrailStore) filteredTrailAircraftLocked(req TrailBackfillRequest) (map[string][]trailPoint, bool) {
	if len(s.aircraft) == 0 {
		return map[string][]trailPoint{}, false
	}
	until := req.UntilMs
	if until <= 0 {
		until = latestTrailTimestamp(s.aircraft)
	}
	since := req.SinceMs
	if req.MaxWindow > 0 {
		windowStart := until - int64(req.MaxWindow/time.Millisecond)
		if since <= 0 || since < windowStart {
			since = windowStart
		}
	}
	if since <= 0 {
		since = 0
	}
	if until < since {
		return map[string][]trailPoint{}, false
	}
	hexFilter := map[string]struct{}{}
	for _, hex := range req.Hex {
		if normalized := normalizeTrailHex(hex); normalized != "" {
			hexFilter[normalized] = struct{}{}
		}
	}

	keys := make([]string, 0, len(s.aircraft))
	for hex := range s.aircraft {
		if len(hexFilter) > 0 {
			if _, ok := hexFilter[hex]; !ok {
				continue
			}
		}
		keys = append(keys, hex)
	}
	sort.Strings(keys)

	out := make(map[string][]trailPoint, len(keys))
	remaining := req.MaxPoints
	truncated := false
	for _, hex := range keys {
		if remaining == 0 && req.MaxPoints > 0 {
			truncated = true
			break
		}
		points := s.aircraft[hex]
		start := sort.Search(len(points), func(i int) bool { return points[i].Ts >= since })
		end := sort.Search(len(points), func(i int) bool { return points[i].Ts > until })
		if start >= end {
			continue
		}
		selected := points[start:end]
		if req.MaxPoints > 0 && len(selected) > remaining {
			selected = selected[:remaining]
			truncated = true
		}
		out[hex] = append([]trailPoint(nil), selected...)
		if req.MaxPoints > 0 {
			remaining -= len(selected)
		}
	}
	return out, truncated
}

func latestTrailTimestamp(aircraft map[string][]trailPoint) int64 {
	var latest int64
	for _, points := range aircraft {
		if len(points) == 0 {
			continue
		}
		if ts := points[len(points)-1].Ts; ts > latest {
			latest = ts
		}
	}
	return latest
}

func copyTrailAircraft(in map[string][]trailPoint) map[string][]trailPoint {
	out := make(map[string][]trailPoint, len(in))
	for hex, points := range in {
		if len(points) == 0 {
			continue
		}
		out[hex] = append([]trailPoint(nil), points...)
	}
	return out
}

func marshalTrailEnvelope(aircraft map[string][]trailPoint) []byte {
	if len(aircraft) == 0 {
		return nil
	}
	data, err := json.Marshal(trailEnvelopeData{Aircraft: aircraft})
	if err != nil {
		return nil
	}
	return wrapEnvelope("trails", data)
}
