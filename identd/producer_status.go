package main

import (
	"encoding/json"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const maxCounterElapsedSec = 120
const minProducerDetectionScore = 50

type producerSelectionState int

const (
	producerSelectionInsufficient producerSelectionState = iota
	producerSelectionSelected
	producerSelectionAmbiguous
)

type producerSelection struct {
	State      producerSelectionState
	Adapter    producerAdapter
	Candidate  producerCandidate
	Best       producerCandidate
	Candidates []producerCandidate
}

type producerSelectionEffect struct {
	CapabilitiesChanged bool
	CanNormalize        bool
}

type ProducerStatusNormalizer struct {
	mu                 sync.Mutex
	adapters           []producerAdapter
	adapter            producerAdapter
	producer           identProducer
	evidence           producerEvidence
	counter            *aircraftCounterSample
	counterResetReason unavailableReason
	now                func() time.Time
	runtimeStats       func() RuntimeStatsSample
	receiver           *producerReceiverJSON

	upstreamTypeRaw      string
	upstreamType         identProducerKind
	upstreamTypeOverride bool
	replayEnabled        bool
	diagnostics          *DiagnosticStore
	ambiguousLogKey      string

	lastAircraftObservedAt *float64
	lastStatsObservedAt    *float64
	lastReceiverObservedAt *float64

	// Persistent status snapshot. Each ingest updates the fields it owns and
	// publishes the full snapshot so a connecting client receives every
	// known field, not just the most recent ingest path's contribution.
	// MessageRate / Gain / Uptime / MaxRange are tracked alongside
	// ReceiverPosition for the same reason: a page refresh only sees the
	// hub-cached snapshot, and that snapshot must carry the current known
	// value of every slot so the UI doesn't blink fields whose providing
	// path happens to not be the most recent ingest.
	lastReceiverPosition *receiverPositionValue
	// MessageRate splits per source: stats path (window rate) and
	// aircraft path (counter delta) populate distinct slots so the wire
	// envelope can pick the freshest one and stale-source values can be
	// suppressed honestly. A single shared slot lets a fresh aircraft
	// poll keep a stale stats-derived rate alive indefinitely.
	lastStatsMessageRate    *messageRateValue
	lastAircraftMessageRate *messageRateValue
	lastGain                *gainValue
	lastUptime              *uptimeValue
	lastMaxRange            *maxRangeValue
	lastReceiverStats       *receiverStatsStatus
	observedCapabilities    identCapabilities

	// Closed on the first successful classification (any known producer
	// kind). It is a readiness signal for callers that care whether an
	// adapter has been selected; producer file watchers may still run before
	// it closes so their files can contribute classification evidence.
	classified     chan struct{}
	classifiedOnce sync.Once
}

type ProducerStatusNormalizerOptions struct {
	UpstreamType  string
	ReplayEnabled bool
	RuntimeStats  func() RuntimeStatsSample
}

func NewProducerStatusNormalizer() *ProducerStatusNormalizer {
	return NewProducerStatusNormalizerWithAdapters(defaultProducerAdapters())
}

func NewProducerStatusNormalizerWithClock(now func() time.Time) *ProducerStatusNormalizer {
	return newProducerStatusNormalizer(defaultProducerAdapters(), now, ProducerStatusNormalizerOptions{})
}

func NewProducerStatusNormalizerWithUpstreamType(upstreamType string) *ProducerStatusNormalizer {
	return NewProducerStatusNormalizerWithOptions(ProducerStatusNormalizerOptions{UpstreamType: upstreamType})
}

func NewProducerStatusNormalizerWithOptions(options ProducerStatusNormalizerOptions) *ProducerStatusNormalizer {
	return newProducerStatusNormalizer(defaultProducerAdapters(), time.Now, options)
}

func NewProducerStatusNormalizerWithAdapters(adapters []producerAdapter) *ProducerStatusNormalizer {
	return newProducerStatusNormalizer(adapters, time.Now, ProducerStatusNormalizerOptions{})
}

func newProducerStatusNormalizer(adapters []producerAdapter, now func() time.Time, options ProducerStatusNormalizerOptions) *ProducerStatusNormalizer {
	if now == nil {
		now = time.Now
	}
	runtimeStats := options.RuntimeStats
	if runtimeStats == nil {
		runtimeStats = func() RuntimeStatsSample { return RuntimeStatsSample{} }
	}
	kind, ok := parseUpstreamType(options.UpstreamType)
	return &ProducerStatusNormalizer{
		adapters:             append([]producerAdapter(nil), adapters...),
		producer:             identProducer{Kind: producerUnknown},
		now:                  now,
		runtimeStats:         runtimeStats,
		upstreamTypeRaw:      strings.TrimSpace(options.UpstreamType),
		upstreamType:         kind,
		upstreamTypeOverride: ok,
		replayEnabled:        options.ReplayEnabled,
		classified:           make(chan struct{}),
		// Initialize observedCapabilities so every field is explicitly
		// "unavailable" — never the zero value (""), which would marshal
		// as an out-of-enum string and surprise consumers if anything
		// reads it before the first IngestReceiverJSON.
		observedCapabilities: identServiceCapabilities(unavailableProducerCapabilities(), options.ReplayEnabled),
	}
}

// Classified returns a channel that is closed on the first successful
// producer classification.
func (n *ProducerStatusNormalizer) Classified() <-chan struct{} {
	return n.classified
}

// SetDiagnosticStore wires a store so subsequent ingest paths route their
// diagnostics through it. Callers that never set a store get a silent
// fallback; this keeps tests that don't care about diagnostics terse.
func (n *ProducerStatusNormalizer) SetDiagnosticStore(store *DiagnosticStore) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.diagnostics = store
}

// Adapter order is the producer detection priority. More specific producer
// signatures must appear before broader fallback adapters.
func defaultProducerAdapters() []producerAdapter {
	return []producerAdapter{
		readsbAdapter{},
		skyaware978Adapter{},
		dump1090FAAdapter{},
	}
}

func parseUpstreamType(raw string) (identProducerKind, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "":
		return "", false
	case "readsb":
		return producerReadsb, true
	case "dump1090-fa", "piaware":
		return producerDump1090FA, true
	case "skyaware978", "dump978-fa", "dump978":
		return producerSkyaware978, true
	default:
		return "", false
	}
}

func (n *ProducerStatusNormalizer) adapterForKind(kind identProducerKind) producerAdapter {
	for _, adapter := range n.adapters {
		if adapter.Kind() == kind {
			return adapter
		}
	}
	return nil
}

func (n *ProducerStatusNormalizer) IngestReceiverJSON(b []byte) [][]byte {
	n.mu.Lock()
	defer n.mu.Unlock()

	var receiver producerReceiverJSON
	if err := json.Unmarshal(b, &receiver); err != nil {
		slog.Warn("producer receiver: malformed JSON", "err", err, "channel", "receiver", "code", "receiver.adapter.malformed_file")
		n.noteError("receiver", "receiver.adapter.malformed_file", "receiver.json could not be parsed", WithTTL(defaultDiagnosticEventTTL))
		return nil
	}
	nowEpoch := n.clockEpochSec()
	n.lastReceiverObservedAt = float64Ptr(nowEpoch)
	n.receiver = &receiver
	n.evidence.Receiver = &receiver
	previousKind := n.producer.Kind
	selection := n.applyProducerSelectionLocked()
	if receiver.Lat != nil && receiver.Lon != nil && selection.CanNormalize && n.adapter != nil {
		n.lastReceiverPosition = receiverPositionProvided("receiver_json", receiverPositionStatusValue{Lat: *receiver.Lat, Lon: *receiver.Lon})
		n.promoteObservedCapability("receiverPosition", capabilityProducerProvided)
	} else if selection.CapabilitiesChanged && previousKind != producerUnknown && n.producer.Kind != producerUnknown && previousKind != n.producer.Kind {
		// Only clear the persisted position on an actual transition between
		// two known producers. Transient receiver.json that fails detection
		// (publisher hiccup, partial file) must NOT nuke a previously-good
		// position — the persistent-snapshot fix exists to weather these.
		n.lastReceiverPosition = nil
	}
	envs := n.capabilitiesEnvelope(nil)
	// Always publish a status envelope so the hub-cached snapshot
	// carries the current persistent state for connecting clients.
	// Fields the receiver path doesn't populate ride from currentStatus()
	// (lastMessageRate / lastGain / lastUptime / lastMaxRange).
	status := n.currentStatus()
	n.stampStatus(&status, ingestClockObservedAtFor(nowEpoch))
	envs = appendEnvelope(envs, "status", status)
	return envs
}

func (n *ProducerStatusNormalizer) applyProducerSelectionLocked() producerSelectionEffect {
	previousKind := n.producer.Kind
	previousVersion := n.producer.Version
	selection := n.selectProducerLocked()
	switch selection.State {
	case producerSelectionAmbiguous:
		n.noteAmbiguousProducerSelectionCandidates(selection.Candidates)
		if n.adapter != nil && candidatesIncludeKind(selection.Candidates, n.adapter.Kind()) {
			return producerSelectionEffect{CanNormalize: true}
		}
		return producerSelectionEffect{}
	case producerSelectionInsufficient:
		n.noteUnknownProducerSelection(selection.Best)
		if n.adapter == nil {
			n.producer = identProducer{Kind: producerUnknown}
			return producerSelectionEffect{}
		}
		return producerSelectionEffect{CanNormalize: true}
	}

	nextAdapter := selection.Adapter
	nextCandidate := selection.Candidate
	nextProducer := nextCandidate.Producer
	if nextProducer.Kind == "" {
		nextProducer.Kind = nextAdapter.Kind()
	}
	n.adapter = nextAdapter
	n.producer = nextProducer
	n.classifiedOnce.Do(func() { close(n.classified) })

	if nextProducer.Kind != previousKind {
		// Counter samples are scoped to one producer kind. A kind transition
		// invalidates the baseline; the next aircraft sample must bootstrap.
		n.counter = nil
		if previousKind != producerUnknown {
			n.counterResetReason = reasonProducerChanged
		} else {
			n.counterResetReason = ""
		}
		n.observedCapabilities = n.applyIdentServiceCapabilities(nextCandidate.Capabilities)
		n.lastStatsMessageRate = nil
		n.lastAircraftMessageRate = nil
		n.lastGain = nil
		n.lastUptime = nil
		n.lastMaxRange = nil
		n.lastReceiverStats = nil
		n.lastStatsObservedAt = nil
		n.lastAircraftObservedAt = nil
		return producerSelectionEffect{CapabilitiesChanged: true, CanNormalize: true}
	}

	nextCapabilities := mergeStrongerCapabilities(n.observedCapabilities, n.applyIdentServiceCapabilities(nextCandidate.Capabilities))
	capabilitiesChanged := nextCapabilities != n.observedCapabilities
	n.observedCapabilities = nextCapabilities
	return producerSelectionEffect{CapabilitiesChanged: previousVersion != nextProducer.Version || capabilitiesChanged, CanNormalize: true}
}

func (n *ProducerStatusNormalizer) selectProducerLocked() producerSelection {
	if n.upstreamTypeRaw != "" {
		return n.selectOverrideProducerLocked()
	}
	return n.selectDetectedProducerLocked()
}

func (n *ProducerStatusNormalizer) selectOverrideProducerLocked() producerSelection {
	detected := n.selectDetectedProducerLocked()
	if n.upstreamTypeOverride {
		adapter := n.adapterForKind(n.upstreamType)
		if adapter == nil {
			n.noteWarning("config", "config.adapter.unsupported_upstream_type", "upstream type override "+n.upstreamTypeRaw+" is not supported by this build", WithTTL(receiverConditionTTL))
			return detected
		}
		if detected.State == producerSelectionSelected && detected.Candidate.Producer.Kind != n.upstreamType {
			n.noteWarning("config", "config.adapter.override_mismatch", "upstream type override "+n.upstreamTypeRaw+" differs from detected "+string(detected.Candidate.Producer.Kind), WithTTL(receiverConditionTTL))
		}
		return producerSelection{
			State:   producerSelectionSelected,
			Adapter: adapter,
			Candidate: producerCandidate{
				Producer:     identProducer{Kind: n.upstreamType, Version: producerVersionFromEvidence(n.evidence)},
				Score:        100,
				Capabilities: adapter.Capabilities(n.evidence),
				Evidence:     []string{"config.IDENT_UPSTREAM_TYPE"},
			},
		}
	}
	n.noteWarning("config", "config.adapter.invalid_upstream_type", "upstream type override "+n.upstreamTypeRaw+" is not recognized", WithTTL(receiverConditionTTL))
	return detected
}

func (n *ProducerStatusNormalizer) selectDetectedProducerLocked() producerSelection {
	var strongest producerCandidate
	var bestAdapter producerAdapter
	var best producerCandidate
	var candidates []producerCandidate
	for _, adapter := range n.adapters {
		candidate := adapter.Detect(n.evidence)
		if candidate.Score > strongest.Score {
			strongest = candidate
		}
		if candidate.Score < minProducerDetectionScore {
			continue
		}
		if bestAdapter == nil || candidate.Score > best.Score {
			bestAdapter = adapter
			best = candidate
			candidates = []producerCandidate{candidate}
			continue
		}
		if candidate.Score == best.Score {
			candidates = append(candidates, candidate)
		}
	}
	if len(candidates) > 1 {
		return producerSelection{State: producerSelectionAmbiguous, Best: best, Candidates: candidates}
	}
	if bestAdapter == nil {
		return producerSelection{State: producerSelectionInsufficient, Best: strongest}
	}
	return producerSelection{State: producerSelectionSelected, Adapter: bestAdapter, Candidate: best}
}

func candidatesIncludeKind(candidates []producerCandidate, kind identProducerKind) bool {
	for _, candidate := range candidates {
		if candidate.Kind() == kind {
			return true
		}
	}
	return false
}

func (n *ProducerStatusNormalizer) noteUnknownProducerSelection(best producerCandidate) {
	message := "producer could not be classified from observed files"
	if best.Score > 0 {
		message = message + "; strongest evidence score " + strconv.Itoa(best.Score)
	}
	if len(best.Evidence) > 0 {
		message = message + " from " + strings.Join(best.Evidence, ", ")
	}
	n.noteWarning("producer", "producer.ident.unknown", message, WithTTL(receiverConditionTTL))
}

func (n *ProducerStatusNormalizer) noteAmbiguousProducerSelectionCandidates(candidates []producerCandidate) {
	summary := producerCandidateSummaries(candidates)
	message := "producer evidence matched multiple adapters; set IDENT_UPSTREAM_TYPE to choose one"
	if len(summary) > 0 {
		message = message + ": " + strings.Join(summary, "; ")
	}
	key := strings.Join(summary, "|")
	if n.ambiguousLogKey != key {
		n.ambiguousLogKey = key
		slog.Warn("ambiguous producer identification", "candidates", strings.Join(summary, "; "))
	}
	n.noteWarning("producer", "producer.ident.ambiguous", message, WithTTL(receiverConditionTTL))
}

func producerCandidateSummaries(candidates []producerCandidate) []string {
	summaries := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		kind := candidate.Kind()
		if kind == producerUnknown {
			continue
		}
		summary := string(kind) + " score=" + strconv.Itoa(candidate.Score)
		if len(candidate.Evidence) > 0 {
			summary = summary + " evidence=" + strings.Join(candidate.Evidence, ",")
		}
		summaries = append(summaries, summary)
	}
	sort.Strings(summaries)
	return summaries
}

func (n *ProducerStatusNormalizer) IngestStatsJSON(b []byte) [][]byte {
	n.mu.Lock()
	defer n.mu.Unlock()

	var stats producerStatsJSON
	if err := json.Unmarshal(b, &stats); err != nil {
		slog.Warn("producer stats: malformed JSON", "err", err, "channel", "stats", "code", "stats.adapter.malformed_file")
		n.noteError("stats", "stats.adapter.malformed_file", "stats.json could not be parsed", WithTTL(defaultDiagnosticEventTTL))
		return nil
	}
	n.evidence.Stats = &stats
	var envs [][]byte
	selection := n.applyProducerSelectionLocked()
	if !selection.CanNormalize || n.adapter == nil {
		if selection.CapabilitiesChanged {
			envs = n.capabilitiesEnvelope(envs)
		}
		return envs
	}
	status, diagnostics, ok := n.adapter.StatusFromStats(n.producer, stats)
	n.noteFrameDiagnostics(diagnostics)
	if !ok {
		if selection.CapabilitiesChanged {
			envs = n.capabilitiesEnvelope(envs)
		}
		return envs
	}
	observedAt := n.observedAtFromStats(stats)
	n.persistLiveValues(status, messageRateSourceStats)
	status = n.buildWireStatus(status)
	n.stampStatus(&status, observedAt)
	if n.promoteObservedCapabilitiesFromStatus(status) || selection.CapabilitiesChanged {
		envs = n.capabilitiesEnvelope(envs)
	}
	return appendEnvelope(envs, "status", status)
}

func (n *ProducerStatusNormalizer) IngestAircraftJSONWithFrame(b []byte) ([][]byte, *identAircraftFrame) {
	n.mu.Lock()
	defer n.mu.Unlock()

	var frame producerAircraftJSON
	if err := json.Unmarshal(b, &frame); err != nil {
		slog.Warn("producer aircraft: malformed JSON", "err", err, "channel", "aircraft", "code", "aircraft.adapter.malformed_file")
		n.noteError("aircraft", "aircraft.adapter.malformed_file", "aircraft.json could not be parsed", WithTTL(defaultDiagnosticEventTTL))
		return nil, nil
	}
	n.evidence.Aircraft = &frame
	var envs [][]byte
	selection := n.applyProducerSelectionLocked()
	if selection.CapabilitiesChanged {
		envs = n.capabilitiesEnvelope(envs)
	}
	if !selection.CanNormalize || n.adapter == nil {
		return envs, nil
	}
	aircraftFrame, diagnostics, ok := n.adapter.AircraftFrame(frame)
	if !ok {
		n.noteError("aircraft", "aircraft.adapter.malformed_file", "aircraft.json is missing required frame fields", WithTTL(defaultDiagnosticEventTTL))
		n.noteFrameDiagnostics(diagnostics)
		return nil, nil
	}
	n.noteFrameDiagnostics(diagnostics)
	observedAt := n.observedAtFromAircraft(frame)
	envs = appendEnvelope(envs, "aircraft", aircraftFrame)
	sample, ok := n.adapter.AircraftCounter(frame)
	if !ok {
		return envs, &aircraftFrame
	}
	sample.producer = n.producer
	status := n.currentStatus()
	if n.counter == nil || n.counter.producer != sample.producer {
		// The first sample establishes the baseline and cannot produce a rate.
		// If the receiver-ingest stage flagged a producer change, surface it
		// distinctly so operators can tell a flip apart from a cold start.
		bootstrapReason := reasonAwaitingSecondSample
		if n.counterResetReason != "" {
			bootstrapReason = n.counterResetReason
			n.counterResetReason = ""
		}
		n.counter = &sample
		return n.appendUnavailableMessageRate(envs, status, observedAt, bootstrapReason), &aircraftFrame
	}
	elapsed := sample.now - n.counter.now
	delta := sample.messages - n.counter.messages
	n.counter = &sample
	if elapsed <= 0 {
		n.noteWarning("aircraft", "aircraft.adapter.clock_not_advanced", "aircraft counter timestamp did not advance", WithTTL(defaultDiagnosticEventTTL))
		return n.appendUnavailableMessageRate(envs, status, observedAt, reasonClockNotAdvanced), &aircraftFrame
	}
	if delta < 0 {
		n.noteWarning("aircraft", "aircraft.adapter.counter_reset", "aircraft message counter reset", WithTTL(defaultDiagnosticEventTTL))
		return n.appendUnavailableMessageRate(envs, status, observedAt, reasonCounterReset), &aircraftFrame
	}
	if elapsed > maxCounterElapsedSec {
		n.noteWarning("aircraft", "aircraft.adapter.stale_counter_sample", "aircraft counter sample gap is too large", WithTTL(defaultDiagnosticEventTTL))
		return n.appendUnavailableMessageRate(envs, status, observedAt, reasonStaleSample), &aircraftFrame
	}
	status.MessageRate = messageRateDerived("aircraft_counter_delta", messageRateStatusValue{Hz: delta / elapsed, BasisSec: elapsed})
	n.persistLiveValues(status, messageRateSourceAircraft)
	n.stampStatus(&status, observedAt)
	envs = n.promoteCapabilitiesFromStatus(envs, status)
	return appendEnvelope(envs, "status", status), &aircraftFrame
}

// noteFrameDiagnostics fans out per-row aircraft diagnostics (invalid bool
// fields, invalid altitudes, etc.) into the diagnostic store with their
// natural identity. Adapter-emitted diagnostic objects carry the
// (channel, code) tuple already; severity and message are taken verbatim.
func (n *ProducerStatusNormalizer) noteFrameDiagnostics(diagnostics []diagnostic) {
	if n.diagnostics == nil {
		return
	}
	for _, d := range diagnostics {
		n.diagnostics.Note(d.Channel, d.Code, d.Severity, d.Message, WithTTL(defaultDiagnosticEventTTL))
	}
}

func (n *ProducerStatusNormalizer) IngestOutlineJSON(b []byte) [][]byte {
	n.mu.Lock()
	defer n.mu.Unlock()

	var producerOutline producerOutlineJSON
	if err := json.Unmarshal(b, &producerOutline); err != nil {
		slog.Warn("producer outline: malformed JSON", "err", err, "channel", "outline", "code", "outline.adapter.malformed_file")
		n.noteError("outline", "outline.adapter.malformed_file", "outline.json could not be parsed", WithTTL(defaultDiagnosticEventTTL))
		return nil
	}
	n.evidence.Outline = &producerOutline
	var envs [][]byte
	selection := n.applyProducerSelectionLocked()
	if selection.CapabilitiesChanged {
		envs = n.capabilitiesEnvelope(envs)
	}
	if !selection.CanNormalize || n.adapter == nil {
		return envs
	}
	outline, diagnostics, ok := n.adapter.RangeOutline(producerOutline)
	if !ok {
		n.noteFrameDiagnostics(diagnostics)
		return envs
	}
	observedAt := n.clockEpochSec()
	outline.ObservedAtEpochSec = observedAt
	envs = appendEnvelope(envs, "rangeOutline", outline)
	if n.receiver == nil {
		return envs
	}
	nm, ok := outlineMaxRangeNm(*n.receiver, outline)
	if !ok {
		return envs
	}
	status := n.currentStatus()
	status.MaxRange = maxRangeProvided("outline_"+string(outline.Scope)+"_vertices", maxRangeStatusValue{
		NM:          nm,
		Scope:       string(outline.Scope),
		Computation: "max_receiver_to_outline_vertex",
	})
	n.persistLiveValues(status, messageRateSourceNone)
	n.stampStatus(&status, ingestClockObservedAtFor(observedAt))
	envs = n.promoteCapabilitiesFromStatus(envs, status)
	return appendEnvelope(envs, "status", status)
}

// statsStaleThresholdSec / aircraftStaleThresholdSec gate persisted live
// values against the freshness of their source. They protect the snappy
// page-refresh win of carrying lastGain / lastUptime / lastMessageRate on
// every envelope from showing values that no longer reflect reality when
// the producer stops updating its source files.
//
// Surveyed upstream write cadences:
//   - aircraft.json: 1s on readsb / dump1090-fa / dump978-fa
//   - stats.json:    10s on readsb, 60s on dump1090-fa, not emitted by dump978-fa
//
// Thresholds picked at meaningful multiples of the slowest cadence so a
// single missed tick (load spike, GC pause, fsnotify coalescing) doesn't
// blank the value, but a genuinely stalled source surfaces honest gaps.
const (
	statsStaleThresholdSec    = 180.0 // 3x dump1090-fa's 60s cadence
	aircraftStaleThresholdSec = 10.0  // 10x the 1Hz nominal cadence
)

func (n *ProducerStatusNormalizer) currentStatus() identStatus {
	status := newIdentStatus()
	status.ReceiverPosition = n.lastReceiverPosition
	status.MaxRange = n.lastMaxRange // outline is naturally infrequent; no gate

	nowEpoch := n.clockEpochSec()
	statsStale := isSourceStale(n.lastStatsObservedAt, nowEpoch, statsStaleThresholdSec)
	aircraftStale := isSourceStale(n.lastAircraftObservedAt, nowEpoch, aircraftStaleThresholdSec)

	if !statsStale {
		status.Gain = n.lastGain
		status.Uptime = n.lastUptime
		status.Stats = n.lastReceiverStats
	}
	status.Stats = mergeReceiverStats(status.Stats, receiverStatsFromRuntime(n.runtimeStats()))
	// MessageRate is dual-source. Prefer the stats-derived value when its
	// source is fresh (it's typically averaged over a longer window than
	// the aircraft counter delta and more numerically stable). Fall back
	// to the aircraft-derived value when stats has gone stale but
	// aircraft is still ticking. Both stale -> emit nothing rather than
	// invent freshness from one path's clock.
	switch {
	case !statsStale && n.lastStatsMessageRate != nil:
		status.MessageRate = n.lastStatsMessageRate
	case !aircraftStale && n.lastAircraftMessageRate != nil:
		status.MessageRate = n.lastAircraftMessageRate
	}
	// Surface a single diagnostic when gating actually suppresses
	// stats-only fields the user would otherwise see. messageRate is
	// dual-source so its suppression isn't necessarily a stats problem.
	// Producers that legitimately never emit stats (e.g. dump978-fa)
	// have nil lastGain/lastUptime and don't trip this trigger.
	//
	// Uses the default condition TTL: aircraft ingest calls currentStatus
	// at ~1Hz, so the entry refreshes every poll while the source stays
	// stale and fades within seconds of stats recovering (the first
	// post-recovery aircraft tick sees statsStale=false and stops
	// re-emitting). A longer TTL would leave the warning visible long
	// after the underlying condition resolved.
	if statsStale && (n.lastGain != nil || n.lastUptime != nil || n.lastReceiverStats != nil) {
		n.noteWarning("stats", "stats.source.stale",
			"stats.json source has not updated; cached values suppressed in status snapshot")
	}

	return status
}

func isSourceStale(lastAt *float64, nowEpoch float64, thresholdSec float64) bool {
	if lastAt == nil {
		return true
	}
	return nowEpoch-*lastAt > thresholdSec
}

// buildWireStatus merges the freshly-produced local status (whatever this
// ingest path filled in) with the staleness-gated persistent snapshot.
// Local fields win because they're fresh by construction; persistent fields
// fill the slots the local path didn't touch. Stale persistent fields are
// suppressed by currentStatus() and naturally don't appear in the merge.
func (n *ProducerStatusNormalizer) buildWireStatus(local identStatus) identStatus {
	full := n.currentStatus()
	if local.ReceiverPosition != nil {
		full.ReceiverPosition = local.ReceiverPosition
	}
	if local.MessageRate != nil {
		full.MessageRate = local.MessageRate
	}
	if local.Gain != nil {
		full.Gain = local.Gain
	}
	if local.Uptime != nil {
		full.Uptime = local.Uptime
	}
	if local.MaxRange != nil {
		full.MaxRange = local.MaxRange
	}
	if local.Stats != nil {
		full.Stats = mergeReceiverStats(full.Stats, local.Stats)
	}
	return full
}

// messageRateSource identifies which ingest path produced a messageRate so
// the staleness gate can suppress a stale stats-derived rate even when the
// aircraft path keeps the wall clock fresh (and vice versa). A single slot
// would let a healthy aircraft poll perpetually mask a stalled stats source.
type messageRateSource int

const (
	// messageRateSourceNone is for ingest paths that never set MessageRate
	// (e.g. outline) but still call persistLiveValues for other fields.
	// Without this, those paths would have to pick an arbitrary source
	// label whose slot they could accidentally overwrite if a future
	// helper started populating MessageRate from currentStatus().
	messageRateSourceNone messageRateSource = iota
	messageRateSourceStats
	messageRateSourceAircraft
)

// persistLiveValues copies non-nil live-value fields into the normalizer's
// persistent slots so every status envelope can publish a full snapshot of
// the known receiver state. mrSource selects which per-source messageRate
// slot receives the value when one is present.
func (n *ProducerStatusNormalizer) persistLiveValues(status identStatus, mrSource messageRateSource) {
	if status.MessageRate != nil {
		switch mrSource {
		case messageRateSourceStats:
			n.lastStatsMessageRate = status.MessageRate
		case messageRateSourceAircraft:
			n.lastAircraftMessageRate = status.MessageRate
		case messageRateSourceNone:
			// Path does not own MessageRate; do not touch either slot.
		}
	}
	if status.Gain != nil {
		n.lastGain = status.Gain
	}
	if status.Uptime != nil {
		n.lastUptime = status.Uptime
	}
	if status.MaxRange != nil {
		n.lastMaxRange = status.MaxRange
	}
	if status.Stats != nil {
		n.lastReceiverStats = status.Stats
	}
}

// ReemitReceiverConditions re-Notes the currently-active receiver-derived
// diagnostics so they survive a single TTL window even when receiver.json
// hasn't changed. The diagnostic principle is "alive while being re-emitted";
// receiver.json is event-driven, so a stable misconfiguration would
// otherwise expire from the store between file changes. The heartbeat
// goroutine in main.go drives this on reemitReceiverInterval.
func (n *ProducerStatusNormalizer) ReemitReceiverConditions() {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.upstreamTypeRaw != "" {
		if n.upstreamTypeOverride {
			if adapter := n.adapterForKind(n.upstreamType); adapter == nil {
				n.noteWarning("config", "config.adapter.unsupported_upstream_type",
					"upstream type override "+n.upstreamTypeRaw+" is not supported by this build",
					WithTTL(receiverConditionTTL))
			} else {
				if detected := n.selectDetectedProducerLocked(); detected.State == producerSelectionSelected && detected.Candidate.Producer.Kind != n.upstreamType {
					n.noteWarning("config", "config.adapter.override_mismatch",
						"upstream type override "+n.upstreamTypeRaw+" differs from detected "+string(detected.Candidate.Producer.Kind),
						WithTTL(receiverConditionTTL))
				}
			}
		} else {
			n.noteWarning("config", "config.adapter.invalid_upstream_type",
				"upstream type override "+n.upstreamTypeRaw+" is not recognized",
				WithTTL(receiverConditionTTL))
		}
	}
	if n.adapter == nil {
		switch detected := n.selectDetectedProducerLocked(); detected.State {
		case producerSelectionAmbiguous:
			n.noteAmbiguousProducerSelectionCandidates(detected.Candidates)
		case producerSelectionInsufficient:
			n.noteUnknownProducerSelection(detected.Best)
		}
	}
}

func (n *ProducerStatusNormalizer) noteWarning(channel, code, message string, opts ...DiagnosticOpt) {
	if n.diagnostics == nil {
		return
	}
	n.diagnostics.Note(channel, code, severityWarning, message, opts...)
}

func (n *ProducerStatusNormalizer) noteError(channel, code, message string, opts ...DiagnosticOpt) {
	if n.diagnostics == nil {
		return
	}
	n.diagnostics.Note(channel, code, severityError, message, opts...)
}

// warningDiagnostic constructs an in-process diagnostic value used by adapter
// helpers that fan out row-level findings (invalid bool, invalid altitude,
// malformed outline) up to the normalizer, which then stores them.
func warningDiagnostic(channel, code, message string) diagnostic {
	return diagnostic{Severity: severityWarning, Channel: channel, Code: code, Message: message}
}

func (n *ProducerStatusNormalizer) appendUnavailableMessageRate(envs [][]byte, status identStatus, observedAt *observedAtValue, reason unavailableReason) [][]byte {
	status.MessageRate = messageRateUnavailable(reason)
	// Persists the unavailable wrapper into lastAircraftMessageRate. The
	// slot's contract is "last value this path produced", not "last
	// known good value" — surfacing the unavailable state on subsequent
	// envelopes (e.g. a receiver re-ingest after a counter reset) is
	// more honest than continuing to publish an old good rate that no
	// longer reflects measurement state. Next aircraft frame that
	// produces a valid counter overwrites with a derived rate.
	n.persistLiveValues(status, messageRateSourceAircraft)
	n.stampStatus(&status, observedAt)
	return appendEnvelope(envs, "status", status)
}

func (n *ProducerStatusNormalizer) applyIdentServiceCapabilities(caps identCapabilities) identCapabilities {
	return identServiceCapabilities(caps, n.replayEnabled)
}

func identServiceCapabilities(caps identCapabilities, replayEnabled bool) identCapabilities {
	if replayEnabled {
		caps.Replay = capabilityIdentDerived
	} else {
		caps.Replay = capabilityUnavailable
	}
	caps.Trails = capabilityIdentDerived
	return caps
}

func unavailableProducerCapabilities() identCapabilities {
	return identCapabilities{
		Aircraft:         capabilityUnavailable,
		ReceiverPosition: capabilityUnavailable,
		MessageRate:      capabilityUnavailable,
		Gain:             capabilityUnavailable,
		Uptime:           capabilityUnavailable,
		MaxRange:         capabilityUnavailable,
		RangeOutline:     capabilityUnavailable,
		Meteorology:      capabilityUnavailable,
		Replay:           capabilityUnavailable,
		Trails:           capabilityUnavailable,
	}
}

func (n *ProducerStatusNormalizer) capabilitiesEnvelope(envs [][]byte) [][]byte {
	return appendEnvelope(envs, "capabilities", capabilitiesPayload{
		Schema:       "ident.capabilities.v1",
		Producer:     n.producer,
		Capabilities: n.observedCapabilities,
	})
}

func (n *ProducerStatusNormalizer) promoteCapabilitiesFromStatus(envs [][]byte, status identStatus) [][]byte {
	if !n.promoteObservedCapabilitiesFromStatus(status) {
		return envs
	}
	return n.capabilitiesEnvelope(envs)
}

func (n *ProducerStatusNormalizer) promoteObservedCapabilitiesFromStatus(status identStatus) bool {
	changed := false
	if status.ReceiverPosition != nil {
		changed = n.promoteObservedCapability("receiverPosition", capabilityProducerProvided) || changed
	}
	if status.MessageRate != nil {
		changed = n.promoteObservedCapability("messageRate", messageRateCapabilitySource(status.MessageRate)) || changed
	}
	if status.Gain != nil {
		changed = n.promoteObservedCapability("gain", capabilityProducerProvided) || changed
	}
	if status.Uptime != nil {
		changed = n.promoteObservedCapability("uptime", capabilityProducerProvided) || changed
	}
	if status.MaxRange != nil {
		changed = n.promoteObservedCapability("maxRange", maxRangeCapabilitySource(status.MaxRange)) || changed
	}
	return changed
}

func receiverStatsFromRuntime(sample RuntimeStatsSample) *receiverStatsStatus {
	status := receiverStatsStatus{}
	if cpu := finitePointer(sample.CPUPct); cpu != nil {
		status.CPUPct = receiverMetricDerived("ident_runtime", *cpu)
	}
	if ram := finitePointer(sample.RAMPct); ram != nil {
		status.RAMPct = receiverMetricDerived("ident_runtime", *ram)
	}
	if status.CPUPct == nil && status.RAMPct == nil {
		return nil
	}
	return &status
}

func mergeReceiverStats(base, overlay *receiverStatsStatus) *receiverStatsStatus {
	if base == nil {
		return overlay
	}
	if overlay == nil {
		return base
	}
	merged := *base
	if overlay.SignalDBFS != nil {
		merged.SignalDBFS = overlay.SignalDBFS
	}
	if overlay.NoiseDBFS != nil {
		merged.NoiseDBFS = overlay.NoiseDBFS
	}
	if overlay.StrongPct != nil {
		merged.StrongPct = overlay.StrongPct
	}
	if overlay.SampleDrops != nil {
		merged.SampleDrops = overlay.SampleDrops
	}
	if overlay.CPUPct != nil {
		merged.CPUPct = overlay.CPUPct
	}
	if overlay.RAMPct != nil {
		merged.RAMPct = overlay.RAMPct
	}
	return &merged
}

func messageRateCapabilitySource(value *messageRateValue) capabilitySource {
	switch value.inner.(type) {
	case producerProvidedValue[messageRateStatusValue]:
		return capabilityProducerProvided
	case derivedValue[messageRateStatusValue]:
		return capabilityIdentDerived
	default:
		return capabilityUnavailable
	}
}

func maxRangeCapabilitySource(value *maxRangeValue) capabilitySource {
	switch value.inner.(type) {
	case producerProvidedValue[maxRangeStatusValue]:
		return capabilityProducerProvided
	case derivedValue[maxRangeStatusValue]:
		return capabilityIdentDerived
	default:
		return capabilityUnavailable
	}
}

// mergeStrongerCapabilities keeps the stronger source per field across two
// capability snapshots. Strength ordering: producer_provided > ident_derived
// > unavailable. Used on same-producer receiver re-ingest so a touch of
// receiver.json doesn't demote a capability previously promoted by live data.
func mergeStrongerCapabilities(prior, next identCapabilities) identCapabilities {
	return identCapabilities{
		Aircraft:         strongerCapabilitySource(prior.Aircraft, next.Aircraft),
		ReceiverPosition: strongerCapabilitySource(prior.ReceiverPosition, next.ReceiverPosition),
		MessageRate:      strongerCapabilitySource(prior.MessageRate, next.MessageRate),
		Gain:             strongerCapabilitySource(prior.Gain, next.Gain),
		Uptime:           strongerCapabilitySource(prior.Uptime, next.Uptime),
		MaxRange:         strongerCapabilitySource(prior.MaxRange, next.MaxRange),
		RangeOutline:     strongerCapabilitySource(prior.RangeOutline, next.RangeOutline),
		Meteorology:      strongerCapabilitySource(prior.Meteorology, next.Meteorology),
		Replay:           strongerCapabilitySource(prior.Replay, next.Replay),
		Trails:           strongerCapabilitySource(prior.Trails, next.Trails),
	}
}

func strongerCapabilitySource(a, b capabilitySource) capabilitySource {
	if capabilitySourceRank(a) >= capabilitySourceRank(b) {
		return a
	}
	return b
}

func capabilitySourceRank(s capabilitySource) int {
	switch s {
	case capabilityProducerProvided:
		return 2
	case capabilityIdentDerived:
		return 1
	default:
		return 0
	}
}

func (n *ProducerStatusNormalizer) promoteObservedCapability(name string, source capabilitySource) bool {
	if source == capabilityUnavailable {
		return false
	}
	switch name {
	case "receiverPosition":
		if n.observedCapabilities.ReceiverPosition == source {
			return false
		}
		n.observedCapabilities.ReceiverPosition = source
	case "messageRate":
		if n.observedCapabilities.MessageRate == source {
			return false
		}
		n.observedCapabilities.MessageRate = source
	case "gain":
		if n.observedCapabilities.Gain == source {
			return false
		}
		n.observedCapabilities.Gain = source
	case "uptime":
		if n.observedCapabilities.Uptime == source {
			return false
		}
		n.observedCapabilities.Uptime = source
	case "maxRange":
		if n.observedCapabilities.MaxRange == source {
			return false
		}
		n.observedCapabilities.MaxRange = source
	default:
		return false
	}
	return true
}

func appendEnvelope(envs [][]byte, name string, payload any) [][]byte {
	env, err := marshalEnvelope(name, payload)
	if err != nil {
		slog.Error("producer status: marshal envelope", "name", name, "err", err)
		if diag := marshalFailureDiagnosticsEnvelope(name); diag != nil {
			return append(envs, diag)
		}
		return envs
	}
	return append(envs, env)
}

func marshalFailureDiagnosticsEnvelope(name string) []byte {
	env, err := marshalDiagnosticsEnvelope([]diagnostic{
		{
			Severity: severityError,
			Channel:  "adapter",
			Code:     "adapter.marshal_failed",
			Message:  "normalized " + name + " payload could not be serialized",
		},
	})
	if err != nil {
		slog.Error("producer status: marshal failure diagnostics envelope", "name", name, "err", err)
		return nil
	}
	return env
}

func singleEnvelope(name string, payload any) [][]byte {
	return appendEnvelope(nil, name, payload)
}

func marshalEnvelope(name string, payload any) ([]byte, error) {
	b, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return wrapEnvelope(name, b), nil
}

func (n *ProducerStatusNormalizer) observedAtFromStats(stats producerStatsJSON) *observedAtValue {
	if stats.Now != nil {
		n.lastStatsObservedAt = float64Ptr(*stats.Now)
		return observedAtProvided("stats_now", observedAtStatusValue{EpochSec: *stats.Now})
	}
	if stats.Last1Min.End != nil {
		n.lastStatsObservedAt = float64Ptr(*stats.Last1Min.End)
		return observedAtProvided("stats_window_end", observedAtStatusValue{EpochSec: *stats.Last1Min.End})
	}
	epoch := n.clockEpochSec()
	n.lastStatsObservedAt = float64Ptr(epoch)
	return observedAtDerived("ingest_clock", observedAtStatusValue{EpochSec: epoch})
}

func (n *ProducerStatusNormalizer) observedAtFromAircraft(frame producerAircraftJSON) *observedAtValue {
	if frame.Now != nil {
		n.lastAircraftObservedAt = float64Ptr(*frame.Now)
		return observedAtProvided("aircraft_now", observedAtStatusValue{EpochSec: *frame.Now})
	}
	return n.ingestClockObservedAt()
}

func (n *ProducerStatusNormalizer) ingestClockObservedAt() *observedAtValue {
	return ingestClockObservedAtFor(n.clockEpochSec())
}

func ingestClockObservedAtFor(epoch float64) *observedAtValue {
	return observedAtDerived("ingest_clock", observedAtStatusValue{EpochSec: epoch})
}

func (n *ProducerStatusNormalizer) stampStatus(status *identStatus, observedAt *observedAtValue) {
	status.ObservedAt = observedAt
	status.Freshness = n.currentFreshness()
}

func (n *ProducerStatusNormalizer) currentFreshness() freshness {
	nowEpoch := n.clockEpochSec()
	return freshness{
		AircraftAgeSec:         ageSeconds(nowEpoch, n.lastAircraftObservedAt),
		StatsAgeSec:            ageSeconds(nowEpoch, n.lastStatsObservedAt),
		ReceiverObservedAgeSec: ageSeconds(nowEpoch, n.lastReceiverObservedAt),
	}
}

func (n *ProducerStatusNormalizer) clockEpochSec() float64 {
	return float64(n.now().UnixNano()) / float64(time.Second)
}

func ageSeconds(now float64, observed *float64) *float64 {
	if observed == nil {
		return nil
	}
	age := now - *observed
	if age < 0 {
		age = 0
	}
	return &age
}

func float64Ptr(v float64) *float64 {
	return &v
}

func publishProducerUpdate(hub *Hub, normalizer *ProducerStatusNormalizer, name string, b []byte) *identAircraftFrame {
	var envs [][]byte
	var aircraftFrame *identAircraftFrame
	switch name {
	case "receiver":
		envs = normalizer.IngestReceiverJSON(b)
	case "stats":
		envs = normalizer.IngestStatsJSON(b)
	case "aircraft":
		envs, aircraftFrame = normalizer.IngestAircraftJSONWithFrame(b)
	case "outline":
		envs = normalizer.IngestOutlineJSON(b)
	default:
		return nil
	}
	for _, env := range envs {
		if typ, ok := wrappedEnvelopeType(env); ok {
			hub.PublishSnapshotEnvelope(typ, env)
		}
	}
	return aircraftFrame
}

func wrappedEnvelopeType(env []byte) (string, bool) {
	var outer struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(env, &outer); err != nil || outer.Type == "" {
		return "", false
	}
	return outer.Type, true
}
