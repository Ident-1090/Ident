package main

import (
	"strings"
	"testing"
)

func TestProducerDetectionReadsbReceiverMarkerWinsOverReceiverShape(t *testing.T) {
	n := NewProducerStatusNormalizer()

	envs := n.IngestReceiverJSON([]byte(`{"version":"11.0","readsb":true,"refresh":1000,"history":16}`))

	producer := findEnvelope(t, envs, "capabilities")["producer"].(map[string]any)
	if producer["kind"] != "readsb" {
		t.Fatalf("producer = %#v, want readsb", producer)
	}
}

func TestProducerDetectionSkyaware978ReceiverMarkerWinsOverReceiverShape(t *testing.T) {
	n := NewProducerStatusNormalizer()

	envs := n.IngestReceiverJSON([]byte(`{"version":"dump978 11.0","refresh":1000,"history":16}`))

	producer := findEnvelope(t, envs, "capabilities")["producer"].(map[string]any)
	if producer["kind"] != "skyaware978" {
		t.Fatalf("producer = %#v, want skyaware978", producer)
	}
}

func TestProducerDetectionBareNumericReceiverStaysUnknown(t *testing.T) {
	n := NewProducerStatusNormalizer()

	envs := n.IngestReceiverJSON([]byte(`{"version":"11.0"}`))

	producer := findEnvelope(t, envs, "capabilities")["producer"].(map[string]any)
	if producer["kind"] != "unknown" {
		t.Fatalf("producer = %#v, want unknown", producer)
	}
	select {
	case <-n.Classified():
		t.Fatal("Classified() closed without enough producer evidence")
	default:
	}
}

func TestProducerDetectionUnknownKeepsIdentOwnedCapabilities(t *testing.T) {
	n := NewProducerStatusNormalizerWithOptions(ProducerStatusNormalizerOptions{ReplayEnabled: true})

	envs := n.IngestReceiverJSON([]byte(`{"version":"11.0"}`))

	capabilities := findEnvelope(t, envs, "capabilities")["capabilities"].(map[string]any)
	if capabilities["trails"] != "ident_derived" || capabilities["replay"] != "ident_derived" {
		t.Fatalf("ident-owned capabilities = %#v", capabilities)
	}
}

func TestProducerDetectionNumericFlightAwareReceiverNeedsStatsEvidence(t *testing.T) {
	n := NewProducerStatusNormalizer()
	store := attachDiagnosticStoreForTest(n)

	envs := n.IngestReceiverJSON([]byte(`{"version":"11.0","refresh":1000,"history":16,"lat":1.25,"lon":-2.5}`))

	producer := findEnvelope(t, envs, "capabilities")["producer"].(map[string]any)
	if producer["kind"] != "unknown" {
		t.Fatalf("producer = %#v, want unknown before stats", producer)
	}
	select {
	case <-n.Classified():
		t.Fatal("Classified() closed before stats evidence")
	default:
	}
	diag, ok := findDiagnostic(store.Snapshot(), "producer.ident.unknown")
	if !ok {
		t.Fatalf("missing producer.ident.unknown diagnostic: %#v", diagnosticCodes(store.Snapshot()))
	}
	if !strings.Contains(diag.Message, "receiver.version_refresh_history") {
		t.Fatalf("unknown diagnostic lost evidence context: %#v", diag)
	}
}

func TestProducerDetectionFlightAwareStatsClassifiesAndPublishesStatus(t *testing.T) {
	n := NewProducerStatusNormalizer()
	n.IngestReceiverJSON([]byte(`{"version":"11.0","refresh":1000,"history":16,"lat":1.25,"lon":-2.5}`))

	envs := n.IngestStatsJSON([]byte(`{
		"latest":{"start":1700000050,"end":1700000060,"messages":1000},
		"last1min":{"start":1700000000,"end":1700000060,"messages":6000,"local":{"gain_db":43.9}},
		"last5min":{"start":1699999760,"end":1700000060,"messages":30000},
		"last15min":{"start":1699999160,"end":1700000060,"messages":90000},
		"total":{"start":1699990000,"end":1700000060}
	}`))

	capabilities := findEnvelope(t, envs, "capabilities")
	producer := capabilities["producer"].(map[string]any)
	if producer["kind"] != "dump1090-fa" || producer["version"] != "11.0" {
		t.Fatalf("producer = %#v", producer)
	}
	status := findEnvelope(t, envs, "status")
	assertStatusValue(t, status["messageRate"], "producer_provided", "stats_last1min_messages", "hz", 100)
	assertStatusValue(t, status["gain"], "producer_provided", "last1min_local", "db", 43.9)
	select {
	case <-n.Classified():
	default:
		t.Fatal("Classified() not closed after stats evidence")
	}
}

func TestProducerDetectionStatsCanClassifyBeforeReceiver(t *testing.T) {
	n := NewProducerStatusNormalizer()

	envs := n.IngestStatsJSON([]byte(`{
		"latest":{"start":1700000050,"end":1700000060,"messages":1000},
		"last1min":{"start":1700000000,"end":1700000060,"messages":6000,"local":{"gain_db":43.9}},
		"last5min":{"start":1699999760,"end":1700000060,"messages":30000},
		"last15min":{"start":1699999160,"end":1700000060,"messages":90000},
		"total":{"start":1699990000,"end":1700000060}
	}`))

	producer := findEnvelope(t, envs, "capabilities")["producer"].(map[string]any)
	if producer["kind"] != "dump1090-fa" {
		t.Fatalf("producer = %#v, want dump1090-fa", producer)
	}
	status := findEnvelope(t, envs, "status")
	assertStatusValue(t, status["messageRate"], "producer_provided", "stats_last1min_messages", "hz", 100)
}

func TestProducerDetectionMutabilityNameStaysUnknownDespiteReceiverShape(t *testing.T) {
	n := NewProducerStatusNormalizer()

	envs := n.IngestReceiverJSON([]byte(`{"version":"dump1090-mutability v1.15","refresh":1000,"history":16}`))

	producer := findEnvelope(t, envs, "capabilities")["producer"].(map[string]any)
	if producer["kind"] != "unknown" {
		t.Fatalf("producer = %#v, want unknown", producer)
	}
}

func TestProducerDetectionPreClassificationStatsDoesNotEmitAwaitingDiagnostics(t *testing.T) {
	n := NewProducerStatusNormalizer()
	store := attachDiagnosticStoreForTest(n)

	for range 3 {
		envs := n.IngestStatsJSON([]byte(`{"last1min":{"messages":10}}`))
		if len(envs) != 0 {
			t.Fatalf("unclassified stats emitted envelopes: %#v", envs)
		}
	}

	if _, ok := findDiagnostic(store.Snapshot(), "stats.adapter.awaiting_classification"); ok {
		t.Fatalf("unexpected diagnostics = %#v", diagnosticCodes(store.Snapshot()))
	}
	if _, ok := findDiagnostic(store.Snapshot(), "producer.ident.unknown"); !ok {
		t.Fatalf("missing producer.ident.unknown diagnostic: %#v", diagnosticCodes(store.Snapshot()))
	}
}

func TestProducerDetectionSubthresholdEvidenceStaysUnknownWithContext(t *testing.T) {
	n := NewProducerStatusNormalizer()
	store := attachDiagnosticStoreForTest(n)

	envs := n.IngestStatsJSON([]byte(`{"last1min":{"start":1700000000,"end":1700000060,"messages":6000}}`))

	if len(envs) != 0 {
		t.Fatalf("subthreshold evidence emitted envelopes: %#v", envs)
	}
	diag, ok := findDiagnostic(store.Snapshot(), "producer.ident.unknown")
	if !ok {
		t.Fatalf("missing producer.ident.unknown diagnostic: %#v", diagnosticCodes(store.Snapshot()))
	}
	if !strings.Contains(diag.Message, "stats.last1min.messages") {
		t.Fatalf("unknown diagnostic lost subthreshold evidence: %#v", diag)
	}
}

func TestProducerDetectionReemitKeepsUnknownEvidenceContext(t *testing.T) {
	n := NewProducerStatusNormalizer()
	store := attachDiagnosticStoreForTest(n)

	n.IngestReceiverJSON([]byte(`{"version":"11.0","refresh":1000,"history":16}`))
	n.ReemitReceiverConditions()

	diag, ok := findDiagnostic(store.Snapshot(), "producer.ident.unknown")
	if !ok {
		t.Fatalf("missing producer.ident.unknown diagnostic: %#v", diagnosticCodes(store.Snapshot()))
	}
	if !strings.Contains(diag.Message, "receiver.version_refresh_history") {
		t.Fatalf("unknown diagnostic lost evidence context after re-emit: %#v", diag)
	}
}

func TestProducerDetectionEvidenceSelectionDoesNotEmitLowConfidenceDiagnostic(t *testing.T) {
	n := NewProducerStatusNormalizer()
	store := attachDiagnosticStoreForTest(n)

	envs := n.IngestStatsJSON([]byte(`{
		"latest":{"start":1700000050,"end":1700000060,"messages":1000},
		"last1min":{"start":1700000000,"end":1700000060,"messages":6000,"local":{"gain_db":43.9}},
		"last5min":{"start":1699999760,"end":1700000060,"messages":30000},
		"last15min":{"start":1699999160,"end":1700000060,"messages":90000},
		"total":{"start":1699990000,"end":1700000060}
	}`))

	producer := findEnvelope(t, envs, "capabilities")["producer"].(map[string]any)
	if producer["kind"] != "dump1090-fa" {
		t.Fatalf("producer = %#v, want dump1090-fa", producer)
	}
	if _, ok := findDiagnostic(store.Snapshot(), "producer.ident.low_confidence"); ok {
		t.Fatalf("unexpected low-confidence diagnostic: %#v", diagnosticCodes(store.Snapshot()))
	}
}

func TestProducerDetectionAmbiguousEvidenceKeepsSelectedProducerAndUsesCurrentAdapter(t *testing.T) {
	n := NewProducerStatusNormalizer()
	store := attachDiagnosticStoreForTest(n)

	n.IngestStatsJSON([]byte(`{
		"latest":{"start":1700000050,"end":1700000060,"messages":1000},
		"last1min":{"start":1700000000,"end":1700000060,"messages":6000,"local":{"gain_db":43.9}},
		"last5min":{"start":1699999760,"end":1700000060,"messages":30000},
		"last15min":{"start":1699999160,"end":1700000060,"messages":90000},
		"total":{"start":1699990000,"end":1700000060}
	}`))

	envs, frame := n.IngestAircraftJSONWithFrame([]byte(`{
		"now":1700000061,
		"messages":1001,
		"aircraft":[{"hex":"abc123","uat_version":2}]
	}`))
	if frame == nil {
		t.Fatal("ambiguous evidence that still includes the selected producer should publish normalized aircraft")
	}
	if frame.Schema != "ident.aircraft.v1" || len(frame.Aircraft) != 1 {
		t.Fatalf("frame = %#v", frame)
	}
	for _, env := range envs {
		if decodeEnvelope(t, env).Type == "capabilities" {
			t.Fatalf("ambiguous evidence should not demote selected capabilities: %#v", string(env))
		}
	}
	if n.producer.Kind != producerDump1090FA {
		t.Fatalf("producer = %q, want dump1090-fa", n.producer.Kind)
	}
	if _, ok := findDiagnostic(store.Snapshot(), "producer.ident.ambiguous"); !ok {
		t.Fatalf("missing ambiguous diagnostic: %#v", diagnosticCodes(store.Snapshot()))
	}
}

func TestProducerDetectionColdStartAmbiguousEvidenceNamesTiedCandidates(t *testing.T) {
	n := NewProducerStatusNormalizerWithAdapters([]producerAdapter{
		detectingTestAdapter{kind: producerDump1090FA, score: 60, evidence: []string{"stats.windows"}},
		detectingTestAdapter{kind: producerSkyaware978, score: 60, evidence: []string{"aircraft.uatVersion"}},
	})
	store := attachDiagnosticStoreForTest(n)

	envs := n.IngestStatsJSON([]byte(`{"last1min":{"start":1700000000,"end":1700000060,"messages":6000}}`))
	if len(envs) != 0 {
		t.Fatalf("ambiguous cold-start stats emitted envs=%d", len(envs))
	}

	diag, ok := findDiagnostic(store.Snapshot(), "producer.ident.ambiguous")
	if !ok {
		t.Fatalf("missing ambiguous diagnostic: %#v", diagnosticCodes(store.Snapshot()))
	}
	for _, want := range []string{"dump1090-fa", "skyaware978", "aircraft.uatVersion", "stats.windows"} {
		if !strings.Contains(diag.Message, want) {
			t.Fatalf("ambiguous diagnostic missing %q: %#v", want, diag)
		}
	}
}

func TestProducerDetectionRepeatedUnclassifiedAircraftDoesNotPublishCapabilities(t *testing.T) {
	n := NewProducerStatusNormalizer()
	store := attachDiagnosticStoreForTest(n)

	for i := 0; i < 3; i++ {
		envs, frame := n.IngestAircraftJSONWithFrame([]byte(`{
			"now":1700000061,
			"messages":1001,
			"aircraft":[{"hex":"abc123","type":"adsb_icao"}]
		}`))
		if len(envs) != 0 || frame != nil {
			t.Fatalf("unclassified aircraft tick %d emitted envs=%d frame=%#v", i, len(envs), frame)
		}
	}
	if _, ok := findDiagnostic(store.Snapshot(), "producer.ident.unknown"); !ok {
		t.Fatalf("missing unknown diagnostic: %#v", diagnosticCodes(store.Snapshot()))
	}
}

type detectingTestAdapter struct {
	kind     identProducerKind
	score    int
	evidence []string
}

func (a detectingTestAdapter) Kind() identProducerKind {
	return a.kind
}

func (a detectingTestAdapter) Detect(producerEvidence) producerCandidate {
	return producerCandidate{
		Producer:     identProducer{Kind: a.kind},
		Score:        a.score,
		Capabilities: a.Capabilities(producerEvidence{}),
		Evidence:     append([]string(nil), a.evidence...),
	}
}

func (detectingTestAdapter) Capabilities(producerEvidence) identCapabilities {
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

func (detectingTestAdapter) StatusFromStats(identProducer, producerStatsJSON) (identStatus, []diagnostic, bool) {
	return identStatus{}, nil, false
}

func (detectingTestAdapter) AircraftFrame(producerAircraftJSON) (identAircraftFrame, []diagnostic, bool) {
	return identAircraftFrame{}, nil, false
}

func (detectingTestAdapter) AircraftCounter(producerAircraftJSON) (aircraftCounterSample, bool) {
	return aircraftCounterSample{}, false
}

func (detectingTestAdapter) RangeOutline(producerOutlineJSON) (identRangeOutline, []diagnostic, bool) {
	return identRangeOutline{}, nil, false
}

func TestProducerDetectionAircraftWithoutUATVersionStaysUnknown(t *testing.T) {
	n := NewProducerStatusNormalizer()
	store := attachDiagnosticStoreForTest(n)

	envs, frame := n.IngestAircraftJSONWithFrame([]byte(`{
		"now":1700000061,
		"messages":1001,
		"aircraft":[{"hex":"abc123","type":"adsb_icao"}]
	}`))
	if len(envs) != 0 || frame != nil {
		t.Fatalf("unclassified aircraft emitted envs=%d frame=%#v", len(envs), frame)
	}
	if _, ok := findDiagnostic(store.Snapshot(), "producer.ident.unknown"); !ok {
		t.Fatalf("missing unknown diagnostic: %#v", diagnosticCodes(store.Snapshot()))
	}
}
