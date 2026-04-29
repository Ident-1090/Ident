package main

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"log"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	restartTrailCacheName = "trails.json.gz"
	trailCacheVersion     = 2
	trailSegmentDwell     = time.Minute
	trailAirborneNoise    = 10 * time.Second
)

type TrailOptions struct {
	MemoryWindow    time.Duration
	SampleInterval  time.Duration
	RestartCacheDir string
}

type TrailStore struct {
	mu             sync.RWMutex
	memoryWindow   time.Duration
	sampleInterval time.Duration
	cacheDir       string

	aircraft      map[string][]trailPoint
	trailStates   map[string]trailAircraftState
	invalidAlts   map[string]struct{}
	snapshot      []byte
	snapshotDirty bool

	cacheGeneration      uint64
	cacheSavedGeneration uint64
}

type trailPoint struct {
	Lat       float64  `json:"lat"`
	Lon       float64  `json:"lon"`
	Alt       any      `json:"alt"`
	Ts        int64    `json:"ts"`
	Ground    bool     `json:"ground,omitempty"`
	Stale     bool     `json:"stale,omitempty"`
	Segment   int      `json:"segment"`
	GS        *float64 `json:"gs,omitempty"`
	Track     *float64 `json:"track,omitempty"`
	Source    string   `json:"source,omitempty"`
	AltSource string   `json:"alt_source,omitempty"`
	AltGeom   *float64 `json:"alt_geom,omitempty"`
}

type trailEnvelopeData struct {
	Aircraft map[string][]trailPoint `json:"aircraft"`
}

type trailCacheFile struct {
	Version  int                           `json:"version"`
	Aircraft map[string][]trailPoint       `json:"aircraft"`
	States   map[string]trailAircraftState `json:"states,omitempty"`
}

type aircraftTrailFrame struct {
	Now      float64              `json:"now"`
	Aircraft []aircraftTrailInput `json:"aircraft"`
}

type aircraftTrailInput struct {
	Hex       string          `json:"hex"`
	Type      string          `json:"type"`
	Lat       *float64        `json:"lat"`
	Lon       *float64        `json:"lon"`
	AltBaro   json.RawMessage `json:"alt_baro"`
	AltGeom   *float64        `json:"alt_geom"`
	Altitude  *float64        `json:"altitude"`
	GS        *float64        `json:"gs"`
	Track     *float64        `json:"track"`
	SeenPos   *float64        `json:"seen_pos"`
	Ground    bool            `json:"ground"`
	Airground json.RawMessage `json:"airground"`
}

type trailAircraftState struct {
	Segment       int   `json:"segment"`
	LastTs        int64 `json:"last_ts"`
	LastGround    bool  `json:"last_ground"`
	GroundSince   int64 `json:"ground_since"`
	AirborneSince int64 `json:"airborne_since,omitempty"`
}

func NewTrailStore(options TrailOptions) *TrailStore {
	return &TrailStore{
		memoryWindow:   options.MemoryWindow,
		sampleInterval: options.SampleInterval,
		cacheDir:       options.RestartCacheDir,
		aircraft:       map[string][]trailPoint{},
		trailStates:    map[string]trailAircraftState{},
		invalidAlts:    map[string]struct{}{},
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
		ground := trailGround(ac)
		alt, altSource, invalidAlt := trailAltitude(ac, ground)
		if invalidAlt {
			s.logInvalidAltitudeLocked(hex)
		}
		point := trailPoint{
			Lat:       *ac.Lat,
			Lon:       *ac.Lon,
			Alt:       alt,
			Ts:        nowMs,
			Ground:    ground,
			Stale:     trailStale(ac),
			GS:        finitePointer(ac.GS),
			Track:     finitePointer(ac.Track),
			Source:    ac.Type,
			AltSource: altSource,
			AltGeom:   finitePointer(ac.AltGeom),
		}
		series := pruneTrailSeries(s.aircraft[hex], cutoff)
		if len(series) == 0 && len(s.aircraft[hex]) > 0 {
			delete(s.trailStates, hex)
			delete(s.invalidAlts, hex)
		}
		if len(series) > 0 && minDeltaMs > 0 && point.Ts-series[len(series)-1].Ts < minDeltaMs {
			s.aircraft[hex] = series
			continue
		}
		point = s.assignTrailSegmentLocked(hex, point)
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
		s.snapshot = marshalTrailEnvelope(copyTrailAircraft(s.aircraft))
		s.snapshotDirty = false
	}
	return [][]byte{append([]byte(nil), s.snapshot...)}
}

func (s *TrailStore) SnapshotJSON() []byte {
	data := s.SnapshotData()
	return marshalTrailData(data.Aircraft)
}

func (s *TrailStore) SnapshotData() trailEnvelopeData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return trailEnvelopeData{Aircraft: copyTrailAircraft(s.aircraft)}
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
	if cached.Version != trailCacheVersion {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.aircraft = copyTrailAircraft(cached.Aircraft)
	s.trailStates = copyTrailStates(cached.States)
	if len(s.trailStates) == 0 {
		s.trailStates = rebuildTrailStates(s.aircraft)
	}
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
		Version:  trailCacheVersion,
		Aircraft: copyTrailAircraft(s.aircraft),
		States:   copyTrailStates(s.trailStates),
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

func trailGround(ac aircraftTrailInput) bool {
	if ac.Ground {
		return true
	}
	if len(ac.AltBaro) > 0 && string(ac.AltBaro) != "null" {
		var label string
		if err := json.Unmarshal(ac.AltBaro, &label); err == nil && label == "ground" {
			return true
		}
	}
	if len(ac.Airground) > 0 && string(ac.Airground) != "null" {
		var label string
		if err := json.Unmarshal(ac.Airground, &label); err == nil {
			return label == "ground"
		}
		var value float64
		if err := json.Unmarshal(ac.Airground, &value); err == nil {
			return value == 1
		}
	}
	return false
}

func trailAltitude(ac aircraftTrailInput, ground bool) (any, string, bool) {
	if len(ac.AltBaro) > 0 && string(ac.AltBaro) != "null" {
		var label string
		if err := json.Unmarshal(ac.AltBaro, &label); err == nil {
			if label == "ground" {
				return "ground", "", false
			}
			return nil, "", true
		}
		var alt float64
		if err := json.Unmarshal(ac.AltBaro, &alt); err == nil && numberIsFinite(alt) {
			return roundAltitude(alt), "baro", false
		}
		return nil, "", true
	}
	if ground {
		return "ground", "", false
	}
	if ac.AltGeom != nil && numberIsFinite(*ac.AltGeom) {
		return roundAltitude(*ac.AltGeom), "geom", false
	}
	if ac.Altitude != nil && numberIsFinite(*ac.Altitude) {
		return roundAltitude(*ac.Altitude), "baro", false
	}
	return nil, "", false
}

func trailStale(ac aircraftTrailInput) bool {
	return ac.SeenPos != nil && numberIsFinite(*ac.SeenPos) && *ac.SeenPos > 20
}

func finitePointer(v *float64) *float64 {
	if v == nil || !numberIsFinite(*v) {
		return nil
	}
	return v
}

func (s *TrailStore) logInvalidAltitudeLocked(hex string) {
	if _, ok := s.invalidAlts[hex]; ok {
		return
	}
	s.invalidAlts[hex] = struct{}{}
	log.Printf("trails: invalid alt_baro for %s", hex)
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
			delete(s.trailStates, hex)
			delete(s.invalidAlts, hex)
			continue
		}
		s.aircraft[hex] = points
		if _, ok := s.trailStates[hex]; !ok {
			s.trailStates[hex] = trailStateFromSeries(points)
		}
	}
}

func (s *TrailStore) assignTrailSegmentLocked(hex string, point trailPoint) trailPoint {
	state := s.trailStates[hex]
	if point.Ground {
		if state.GroundSince == 0 {
			state.GroundSince = point.Ts
		}
		state.AirborneSince = 0
	} else if state.GroundSince > 0 {
		if point.Ts-state.GroundSince >= int64(trailSegmentDwell/time.Millisecond) {
			state.Segment++
			state.GroundSince = 0
			state.AirborneSince = 0
		} else if state.AirborneSince == 0 {
			state.AirborneSince = point.Ts
		} else if point.Ts-state.AirborneSince >= int64(trailAirborneNoise/time.Millisecond) {
			state.GroundSince = 0
			state.AirborneSince = 0
		}
	} else {
		state.AirborneSince = 0
	}
	point.Segment = state.Segment
	state.LastTs = point.Ts
	state.LastGround = point.Ground
	s.trailStates[hex] = state
	return point
}

func trailStateFromSeries(points []trailPoint) trailAircraftState {
	var state trailAircraftState
	for _, point := range points {
		state.Segment = point.Segment
		state.LastTs = point.Ts
		state.LastGround = point.Ground
		if point.Ground {
			if state.GroundSince == 0 {
				state.GroundSince = point.Ts
			}
		} else {
			state.GroundSince = 0
		}
	}
	return state
}

func rebuildTrailStates(aircraft map[string][]trailPoint) map[string]trailAircraftState {
	out := make(map[string]trailAircraftState, len(aircraft))
	for hex, points := range aircraft {
		if len(points) == 0 {
			continue
		}
		out[hex] = trailStateFromSeries(points)
	}
	return out
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

func copyTrailStates(in map[string]trailAircraftState) map[string]trailAircraftState {
	out := make(map[string]trailAircraftState, len(in))
	for hex, state := range in {
		out[hex] = state
	}
	return out
}

func marshalTrailEnvelope(aircraft map[string][]trailPoint) []byte {
	data := marshalTrailData(aircraft)
	if len(data) == 0 {
		return nil
	}
	return wrapEnvelope("trails", data)
}

func marshalTrailData(aircraft map[string][]trailPoint) []byte {
	if len(aircraft) == 0 {
		return nil
	}
	data, err := json.Marshal(trailEnvelopeData{Aircraft: aircraft})
	if err != nil {
		return nil
	}
	return data
}
