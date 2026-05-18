package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"
)

const maxCounterElapsedSec = 120

type ProducerStatusNormalizer struct {
	mu                 sync.Mutex
	adapters           []producerAdapter
	adapter            producerAdapter
	producer           identProducer
	counter            *aircraftCounterSample
	counterResetReason unavailableReason
	now                func() time.Time
	receiver           *producerReceiverJSON

	upstreamTypeRaw      string
	upstreamType         identProducerKind
	upstreamTypeOverride bool
	externalDiagnostics  map[string][]diagnostic

	lastAircraftObservedAt *float64
	lastStatsObservedAt    *float64
	lastReceiverObservedAt *float64

	// Persistent status snapshot. Each ingest updates the fields it owns and
	// publishes the full snapshot so a late-connecting client receives every
	// known field, not just the most recent ingest path's contribution.
	lastReceiverPosition *receiverPositionValue
}

func NewProducerStatusNormalizer() *ProducerStatusNormalizer {
	return NewProducerStatusNormalizerWithAdapters(defaultProducerAdapters())
}

func NewProducerStatusNormalizerWithClock(now func() time.Time) *ProducerStatusNormalizer {
	return newProducerStatusNormalizer(defaultProducerAdapters(), now, "")
}

func NewProducerStatusNormalizerWithUpstreamType(upstreamType string) *ProducerStatusNormalizer {
	return newProducerStatusNormalizer(defaultProducerAdapters(), time.Now, upstreamType)
}

func NewProducerStatusNormalizerWithAdapters(adapters []producerAdapter) *ProducerStatusNormalizer {
	return newProducerStatusNormalizer(adapters, time.Now, "")
}

func newProducerStatusNormalizer(adapters []producerAdapter, now func() time.Time, upstreamType string) *ProducerStatusNormalizer {
	if now == nil {
		now = time.Now
	}
	kind, ok := parseUpstreamType(upstreamType)
	return &ProducerStatusNormalizer{
		adapters:             append([]producerAdapter(nil), adapters...),
		producer:             identProducer{Kind: producerUnknown},
		now:                  now,
		upstreamTypeRaw:      strings.TrimSpace(upstreamType),
		upstreamType:         kind,
		upstreamTypeOverride: ok,
	}
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
		status := n.statusWithDiagnostics(
			errorDiagnostic("receiver", "receiver.adapter.malformed_file", "receiver.json could not be parsed"),
		)
		n.stampStatus(&status, n.ingestClockObservedAt())
		return singleEnvelope("status", status)
	}
	nowEpoch := n.clockEpochSec()
	n.lastReceiverObservedAt = float64Ptr(nowEpoch)
	n.receiver = &receiver
	previousKind := n.producer.Kind
	var nextAdapter producerAdapter
	nextProducer := identProducer{Kind: producerUnknown}
	diagnostics := []diagnostic{}
	detectedAdapter, detectedProducer := n.detectAdapter(receiver)
	if n.upstreamTypeRaw != "" {
		if n.upstreamTypeOverride {
			if adapter := n.adapterForKind(n.upstreamType); adapter != nil {
				nextAdapter = adapter
				nextProducer = identProducer{Kind: n.upstreamType, Version: receiver.Version}
				if detectedAdapter != nil && detectedProducer.Kind != n.upstreamType {
					diagnostics = append(diagnostics, warningDiagnostic("config", "config.adapter.override_mismatch", "upstream type override "+n.upstreamTypeRaw+" differs from detected "+string(detectedProducer.Kind)))
				}
			} else {
				diagnostics = append(diagnostics, warningDiagnostic("config", "config.adapter.unsupported_upstream_type", "upstream type override "+n.upstreamTypeRaw+" is not supported by this build"))
			}
		} else {
			diagnostics = append(diagnostics, warningDiagnostic("config", "config.adapter.invalid_upstream_type", "upstream type override "+n.upstreamTypeRaw+" is not recognized"))
		}
	}
	if nextAdapter == nil && detectedAdapter != nil {
		nextAdapter = detectedAdapter
		nextProducer = detectedProducer
	}
	if nextAdapter == nil {
		diagnostics = append(diagnostics, warningDiagnostic("producer", "producer.ident.unknown", "producer could not be classified"))
	}
	n.adapter = nextAdapter
	n.producer = nextProducer
	// Counter is producer-scoped: keep the baseline when the producer kind is
	// unchanged so a touch of receiver.json doesn't restart the delta series.
	if nextProducer.Kind != previousKind {
		n.counter = nil
		if previousKind != producerUnknown && nextAdapter != nil {
			n.counterResetReason = reasonProducerChanged
		} else {
			n.counterResetReason = ""
		}
	}
	envs := appendEnvelope(nil, "capabilities", capabilitiesPayload{
		Schema:       "ident.capabilities.v1",
		Producer:     n.producer,
		Capabilities: n.capabilities(receiver),
	})
	if receiver.Lat != nil && receiver.Lon != nil && n.adapter != nil {
		n.lastReceiverPosition = receiverPositionProvided("receiver_json", receiverPositionStatusValue{Lat: *receiver.Lat, Lon: *receiver.Lon})
	} else if previousKind != producerUnknown && nextProducer.Kind != producerUnknown && previousKind != nextProducer.Kind {
		// Only clear the persisted position on an actual transition between
		// two known producers. Transient receiver.json that fails detection
		// (publisher hiccup, partial file) must NOT nuke a previously-good
		// position — the persistent-snapshot fix exists to weather these.
		n.lastReceiverPosition = nil
	}
	status := n.statusWithDiagnostics(diagnostics...)
	n.stampStatus(&status, ingestClockObservedAtFor(nowEpoch))
	if status.ReceiverPosition != nil || len(status.Diagnostics) > 0 {
		envs = appendEnvelope(envs, "status", status)
	}
	return envs
}

func (n *ProducerStatusNormalizer) detectAdapter(receiver producerReceiverJSON) (producerAdapter, identProducer) {
	for _, adapter := range n.adapters {
		if producer, ok := adapter.Detect(receiver); ok {
			return adapter, producer
		}
	}
	return nil, identProducer{Kind: producerUnknown}
}

func (n *ProducerStatusNormalizer) IngestStatsJSON(b []byte) [][]byte {
	n.mu.Lock()
	defer n.mu.Unlock()

	if n.adapter == nil {
		status := n.statusWithDiagnostics(
			warningDiagnostic("stats", "stats.adapter.awaiting_classification", "stats ignored until producer classification is available"),
		)
		n.stampStatus(&status, n.ingestClockObservedAt())
		return singleEnvelope("status", status)
	}
	var stats producerStatsJSON
	if err := json.Unmarshal(b, &stats); err != nil {
		slog.Warn("producer stats: malformed JSON", "err", err, "channel", "stats", "code", "stats.adapter.malformed_file")
		status := n.statusWithDiagnostics(
			errorDiagnostic("stats", "stats.adapter.malformed_file", "stats.json could not be parsed"),
		)
		n.stampStatus(&status, n.ingestClockObservedAt())
		return singleEnvelope("status", status)
	}
	status, ok := n.adapter.StatusFromStats(n.producer, stats)
	if !ok {
		return nil
	}
	status.ReceiverPosition = n.lastReceiverPosition
	n.stampStatus(&status, n.observedAtFromStats(stats))
	return singleEnvelope("status", status)
}

func (n *ProducerStatusNormalizer) IngestAircraftJSONWithFrame(b []byte) ([][]byte, *identAircraftFrame) {
	n.mu.Lock()
	defer n.mu.Unlock()

	if n.adapter == nil {
		status := n.statusWithDiagnostics(
			warningDiagnostic("aircraft", "aircraft.adapter.awaiting_classification", "aircraft counters ignored until producer classification is available"),
		)
		n.stampStatus(&status, n.ingestClockObservedAt())
		return singleEnvelope("status", status), nil
	}
	var frame producerAircraftJSON
	if err := json.Unmarshal(b, &frame); err != nil {
		slog.Warn("producer aircraft: malformed JSON", "err", err, "channel", "aircraft", "code", "aircraft.adapter.malformed_file")
		status := n.statusWithDiagnostics(
			errorDiagnostic("aircraft", "aircraft.adapter.malformed_file", "aircraft.json could not be parsed"),
		)
		n.stampStatus(&status, n.ingestClockObservedAt())
		return singleEnvelope("status", status), nil
	}
	aircraftFrame, diagnostics, ok := n.adapter.AircraftFrame(frame)
	if !ok {
		diagnostics = append(diagnostics, errorDiagnostic("aircraft", "aircraft.adapter.malformed_file", "aircraft.json is missing required frame fields"))
		status := n.statusWithDiagnostics(diagnostics...)
		n.stampStatus(&status, n.ingestClockObservedAt())
		return singleEnvelope("status", status), nil
	}
	aircraftFrame.Producer = n.producer
	observedAt := n.observedAtFromAircraft(frame)
	envs := singleEnvelope("aircraft", aircraftFrame)
	sample, ok := n.adapter.AircraftCounter(frame)
	if !ok {
		if len(diagnostics) > 0 {
			status := n.statusWithDiagnostics(diagnostics...)
			n.stampStatus(&status, observedAt)
			envs = appendEnvelope(envs, "status", status)
		}
		return envs, &aircraftFrame
	}
	sample.producer = n.producer
	status := n.statusWithDiagnostics(diagnostics...)
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
		status.Diagnostics = append(status.Diagnostics, warningDiagnostic("aircraft", "aircraft.adapter.clock_not_advanced", "aircraft counter timestamp did not advance"))
		return n.appendUnavailableMessageRate(envs, status, observedAt, reasonClockNotAdvanced), &aircraftFrame
	}
	if delta < 0 {
		status.Diagnostics = append(status.Diagnostics, warningDiagnostic("aircraft", "aircraft.adapter.counter_reset", "aircraft message counter reset"))
		return n.appendUnavailableMessageRate(envs, status, observedAt, reasonCounterReset), &aircraftFrame
	}
	if elapsed > maxCounterElapsedSec {
		status.Diagnostics = append(status.Diagnostics, warningDiagnostic("aircraft", "aircraft.adapter.stale_counter_sample", "aircraft counter sample gap is too large"))
		return n.appendUnavailableMessageRate(envs, status, observedAt, reasonStaleSample), &aircraftFrame
	}
	status.MessageRate = messageRateDerived("aircraft_counter_delta", messageRateStatusValue{Hz: delta / elapsed, BasisSec: elapsed})
	n.stampStatus(&status, observedAt)
	return appendEnvelope(envs, "status", status), &aircraftFrame
}

func (n *ProducerStatusNormalizer) IngestOutlineJSON(b []byte) [][]byte {
	n.mu.Lock()
	defer n.mu.Unlock()

	if n.adapter == nil {
		status := n.statusWithDiagnostics(
			warningDiagnostic("outline", "outline.adapter.awaiting_classification", "outline ignored until producer classification is available"),
		)
		n.stampStatus(&status, n.ingestClockObservedAt())
		return singleEnvelope("status", status)
	}
	var producerOutline producerOutlineJSON
	if err := json.Unmarshal(b, &producerOutline); err != nil {
		slog.Warn("producer outline: malformed JSON", "err", err, "channel", "outline", "code", "outline.adapter.malformed_file")
		status := n.statusWithDiagnostics(
			errorDiagnostic("outline", "outline.adapter.malformed_file", "outline.json could not be parsed"),
		)
		n.stampStatus(&status, n.ingestClockObservedAt())
		return singleEnvelope("status", status)
	}
	outline, diagnostics, ok := n.adapter.RangeOutline(producerOutline)
	if !ok {
		if len(diagnostics) > 0 {
			status := n.statusWithDiagnostics(diagnostics...)
			n.stampStatus(&status, n.ingestClockObservedAt())
			return singleEnvelope("status", status)
		}
		return nil
	}
	observedAt := n.clockEpochSec()
	outline.Producer = n.producer
	outline.ObservedAtEpochSec = observedAt
	envs := singleEnvelope("rangeOutline", outline)
	if n.receiver == nil {
		return envs
	}
	nm, ok := outlineMaxRangeNm(*n.receiver, outline)
	if !ok {
		return envs
	}
	status := n.statusWithDiagnostics()
	status.MaxRange = maxRangeProvided("outline_"+string(outline.Scope)+"_vertices", maxRangeStatusValue{
		NM:          nm,
		Scope:       string(outline.Scope),
		Computation: "max_receiver_to_outline_vertex",
	})
	n.stampStatus(&status, ingestClockObservedAtFor(observedAt))
	return appendEnvelope(envs, "status", status)
}

func (n *ProducerStatusNormalizer) DiagnosticStatusEnvelope(diagnostics ...diagnostic) []byte {
	n.mu.Lock()
	defer n.mu.Unlock()
	status := n.statusWithDiagnostics(diagnostics...)
	n.stampStatus(&status, n.ingestClockObservedAt())
	env, err := marshalEnvelope("status", status)
	if err != nil {
		slog.Error("producer status: marshal diagnostic status", "err", err)
		return nil
	}
	return env
}

func (n *ProducerStatusNormalizer) SetExternalDiagnostics(key string, diagnostics []diagnostic) []byte {
	n.mu.Lock()
	defer n.mu.Unlock()
	key = strings.TrimSpace(key)
	if key == "" {
		return nil
	}
	if n.externalDiagnostics == nil {
		n.externalDiagnostics = map[string][]diagnostic{}
	}
	if len(diagnostics) == 0 {
		delete(n.externalDiagnostics, key)
	} else {
		unique := make([]diagnostic, 0, len(diagnostics))
		for _, d := range diagnostics {
			unique = appendUniqueDiagnostic(unique, d)
		}
		n.externalDiagnostics[key] = unique
	}
	status := n.statusWithDiagnostics()
	n.stampStatus(&status, n.ingestClockObservedAt())
	env, err := marshalEnvelope("status", status)
	if err != nil {
		slog.Error("producer status: marshal external diagnostic status", "err", err)
		return nil
	}
	return env
}

func (n *ProducerStatusNormalizer) statusWithDiagnostics(diagnostics ...diagnostic) identStatus {
	allDiagnostics := n.externalDiagnosticsSnapshotLocked()
	for _, d := range diagnostics {
		allDiagnostics = appendUniqueDiagnostic(allDiagnostics, d)
	}
	status := newIdentStatus(n.producer, allDiagnostics...)
	status.ReceiverPosition = n.lastReceiverPosition
	return status
}

func (n *ProducerStatusNormalizer) externalDiagnosticsSnapshotLocked() []diagnostic {
	if len(n.externalDiagnostics) == 0 {
		return nil
	}
	keys := make([]string, 0, len(n.externalDiagnostics))
	for key := range n.externalDiagnostics {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := []diagnostic{}
	for _, key := range keys {
		for _, d := range n.externalDiagnostics[key] {
			out = appendUniqueDiagnostic(out, d)
		}
	}
	return out
}

func (n *ProducerStatusNormalizer) appendUnavailableMessageRate(envs [][]byte, status identStatus, observedAt *observedAtValue, reason unavailableReason) [][]byte {
	status.MessageRate = messageRateUnavailable(reason)
	n.stampStatus(&status, observedAt)
	return appendEnvelope(envs, "status", status)
}

func (n *ProducerStatusNormalizer) capabilities(receiver producerReceiverJSON) identCapabilities {
	if n.adapter == nil {
		return identCapabilities{
			Aircraft:          capabilityUnavailable,
			ReceiverPosition:  capabilityUnavailable,
			MessageRate:       capabilityUnavailable,
			Gain:              capabilityUnavailable,
			Uptime:            capabilityUnavailable,
			MaxRange:          capabilityUnavailable,
			RangeOutline:      capabilityUnavailable,
			SignalDiagnostics: capabilityUnavailable,
			Meteorology:       capabilityUnavailable,
			Replay:            capabilityIdentDerived,
			Trails:            capabilityIdentDerived,
		}
	}
	return n.adapter.Capabilities(receiver)
}

func appendEnvelope(envs [][]byte, name string, payload any) [][]byte {
	env, err := marshalEnvelope(name, payload)
	if err != nil {
		slog.Error("producer status: marshal envelope", "name", name, "err", err)
		if status := marshalFailureStatusEnvelope(name); status != nil {
			return append(envs, status)
		}
		return envs
	}
	return append(envs, env)
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

func marshalFailureStatusEnvelope(name string) []byte {
	status := newIdentStatus(identProducer{Kind: producerUnknown},
		errorDiagnostic("adapter", "adapter.marshal_failed", "normalized "+name+" payload could not be serialized"),
	)
	status.ObservedAt = observedAtDerived("ingest_clock", observedAtStatusValue{EpochSec: float64(time.Now().UnixNano()) / float64(time.Second)})
	status.Freshness = freshness{}
	b, err := json.Marshal(status)
	if err != nil {
		slog.Error("producer status: marshal failure status", "name", name, "err", err)
		return nil
	}
	return wrapEnvelope("status", b)
}

func errorDiagnostic(channel, code, message string) diagnostic {
	return diagnostic{Severity: "error", Channel: channel, Code: code, Message: message}
}

func warningDiagnostic(channel, code, message string) diagnostic {
	return diagnostic{Severity: "warning", Channel: channel, Code: code, Message: message}
}

func infoDiagnostic(channel, code, message string) diagnostic {
	return diagnostic{Severity: "info", Channel: channel, Code: code, Message: message}
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
	for _, diagnostic := range status.Diagnostics {
		logStatusDiagnostic(diagnostic)
	}
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

func logStatusDiagnostic(d diagnostic) {
	level := slog.LevelInfo
	if d.Severity == "warning" {
		level = slog.LevelWarn
	} else if d.Severity == "error" {
		level = slog.LevelError
	}
	slog.LogAttrs(context.Background(), level, d.Message,
		slog.String("code", d.Code),
		slog.String("channel", d.Channel),
		slog.String("severity", d.Severity),
	)
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
