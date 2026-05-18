package main

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestProducerStatusNormalizerAddsStatsObservedAtAndFreshness(t *testing.T) {
	n := NewProducerStatusNormalizerWithClock(func() time.Time {
		return time.Unix(1_700_000_120, 0)
	})
	n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`))
	ingestAircraftJSONForTest(t, n, `{"now":1700000100,"messages":1000,"aircraft":[]}`)

	envs := n.IngestStatsJSON([]byte(`{
		"last1min":{"start":1700000040,"end":1700000100,"messages":6000},
		"total":{"start":1699990000}
	}`))

	status := findEnvelope(t, envs, "status")
	assertStatusValue(t, status["observedAt"], "producer_provided", "stats_window_end", "epochSec", 1700000100)
	freshness := status["freshness"].(map[string]any)
	if freshness["aircraftAgeSec"] != float64(20) || freshness["statsAgeSec"] != float64(20) {
		t.Fatalf("freshness = %#v", freshness)
	}
}

func TestProducerStatusNormalizerUsesIngestClockForStatsFreshnessWhenStatsTimeMissing(t *testing.T) {
	n := NewProducerStatusNormalizerWithClock(func() time.Time {
		return time.Unix(1_700_000_120, 0)
	})
	n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`))

	envs := n.IngestStatsJSON([]byte(`{
		"last1min":{"messages":6000},
		"total":{"start":1699990000}
	}`))

	status := findEnvelope(t, envs, "status")
	assertStatusValue(t, status["observedAt"], "ident_derived", "ingest_clock", "epochSec", 1700000120)
	freshness := status["freshness"].(map[string]any)
	if freshness["statsAgeSec"] != float64(0) {
		t.Fatalf("freshness = %#v", freshness)
	}
}

func TestProducerStatusNormalizerAddsAircraftObservedAtAndFreshness(t *testing.T) {
	n := NewProducerStatusNormalizerWithClock(func() time.Time {
		return time.Unix(1_700_000_120, 0)
	})
	n.IngestReceiverJSON([]byte(`{"version":"dump978-fa 8.2"}`))

	envs := ingestAircraftJSONForTest(t, n, `{"now":1700000100,"messages":1000,"aircraft":[]}`)

	status := findEnvelope(t, envs, "status")
	assertStatusValue(t, status["observedAt"], "producer_provided", "aircraft_now", "epochSec", 1700000100)
	freshness := status["freshness"].(map[string]any)
	if freshness["aircraftAgeSec"] != float64(20) || freshness["statsAgeSec"] != nil {
		t.Fatalf("freshness = %#v", freshness)
	}
}

func TestProducerStatusNormalizerReportsMalformedStatsJSON(t *testing.T) {
	n := NewProducerStatusNormalizer()
	n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`))

	envs := n.IngestStatsJSON([]byte(`{"last1min":`))

	status := findEnvelope(t, envs, "status")
	diagnostics, ok := status["diagnostics"].([]any)
	if !ok {
		t.Fatalf("diagnostics = %#v", status["diagnostics"])
	}
	if len(diagnostics) != 1 {
		t.Fatalf("diagnostics = %#v", diagnostics)
	}
	diag := diagnostics[0].(map[string]any)
	if diag["code"] != "stats.adapter.malformed_file" || diag["severity"] != "error" {
		t.Fatalf("diagnostic = %#v", diag)
	}
}

func TestProducerStatusNormalizerLogsDiagnosticsWithStableCode(t *testing.T) {
	var buf bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	n := NewProducerStatusNormalizer()
	n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`))
	n.IngestStatsJSON([]byte(`{"last1min":`))

	logged := buf.String()
	if !strings.Contains(logged, "code=stats.adapter.malformed_file") ||
		!strings.Contains(logged, "channel=stats") {
		t.Fatalf("diagnostic log = %q", logged)
	}
}

func TestAppendEnvelopeReportsMarshalFailures(t *testing.T) {
	envs := appendEnvelope(nil, "aircraft", func() {})

	status := findEnvelope(t, envs, "status")
	diagnostics, ok := status["diagnostics"].([]any)
	if !ok {
		t.Fatalf("diagnostics = %#v", status["diagnostics"])
	}
	if len(diagnostics) != 1 {
		t.Fatalf("diagnostics = %#v", diagnostics)
	}
	diag := diagnostics[0].(map[string]any)
	if diag["channel"] != "adapter" || diag["code"] != "adapter.marshal_failed" || diag["severity"] != "error" {
		t.Fatalf("diagnostic = %#v", diag)
	}
	if !strings.Contains(diag["message"].(string), "aircraft") {
		t.Fatalf("diagnostic should name failed envelope: %#v", diag)
	}
}

func TestMessageRateStatusValueSerializesBasisSec(t *testing.T) {
	body, err := json.Marshal(identDerived("aircraft_counter_delta", messageRateStatusValue{Hz: 10}))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(body, []byte(`"basisSec":0`)) {
		t.Fatalf("message rate value omitted basisSec: %s", body)
	}
}

func TestProducerStatusNormalizerDistinguishesCounterFailures(t *testing.T) {
	n := NewProducerStatusNormalizer()
	n.IngestReceiverJSON([]byte(`{"version":"dump978-fa 8.2"}`))
	ingestAircraftJSONForTest(t, n, `{"now":100,"messages":1000,"aircraft":[]}`)

	stalled := findEnvelope(t, ingestAircraftJSONForTest(t, n, `{"now":100,"messages":1010,"aircraft":[]}`), "status")
	assertUnavailableReason(t, stalled["messageRate"], "clock_not_advanced")

	reset := findEnvelope(t, ingestAircraftJSONForTest(t, n, `{"now":110,"messages":900,"aircraft":[]}`), "status")
	assertUnavailableReason(t, reset["messageRate"], "counter_reset")

	ingestAircraftJSONForTest(t, n, `{"now":120,"messages":1200,"aircraft":[]}`)
	stale := findEnvelope(t, ingestAircraftJSONForTest(t, n, `{"now":420,"messages":1500,"aircraft":[]}`), "status")
	assertUnavailableReason(t, stale["messageRate"], "stale_sample")
}

func TestProducerStatusNormalizerBootstrapsCounterAfterProducerChange(t *testing.T) {
	n := NewProducerStatusNormalizer()
	n.IngestReceiverJSON([]byte(`{"version":"dump978-fa 8.2"}`))
	ingestAircraftJSONForTest(t, n, `{"now":100,"messages":1000,"aircraft":[]}`)
	assertStatusValue(t, findEnvelope(t, ingestAircraftJSONForTest(t, n, `{"now":110,"messages":1250,"aircraft":[]}`), "status")["messageRate"], "ident_derived", "aircraft_counter_delta", "hz", 25)

	n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`))
	status := findEnvelope(t, ingestAircraftJSONForTest(t, n, `{"now":120,"messages":1400,"aircraft":[]}`), "status")
	assertUnavailableReason(t, status["messageRate"], "producer_changed")
}

func TestProducerStatusNormalizerReportsInvalidAircraftBoolean(t *testing.T) {
	n := NewProducerStatusNormalizer()
	n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`))

	status := findEnvelope(t, ingestAircraftJSONForTest(t, n, `{
		"now":100,
		"messages":1000,
		"aircraft":[{"hex":"abc123","alert":2,"spi":"yes"}]
	}`), "status")

	diagnostics, ok := status["diagnostics"].([]any)
	if !ok {
		t.Fatalf("diagnostics = %#v", status["diagnostics"])
	}
	if len(diagnostics) != 2 {
		t.Fatalf("diagnostics = %#v", diagnostics)
	}
	for _, raw := range diagnostics {
		diag := raw.(map[string]any)
		if diag["channel"] != "aircraft" || diag["code"] != "aircraft.adapter.invalid_bool" {
			t.Fatalf("diagnostic = %#v", diag)
		}
	}
}

func TestProducerStatusNormalizerStatusEnvelopeCarriesPersistentSnapshot(t *testing.T) {
	n := NewProducerStatusNormalizer()
	n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2","lat":37.5,"lon":-122.2}`))

	// Subsequent ingest paths must republish the full status snapshot — a
	// late-connecting client should still see receiverPosition after a stats
	// or aircraft update arrives.
	status := findEnvelope(t, n.IngestStatsJSON([]byte(`{"last1min":{"messages":600,"start":1000,"end":1060,"local":{"gain_db":18.6}}}`)), "status")
	if _, ok := status["receiverPosition"]; !ok {
		t.Fatalf("status payload after stats ingest missing receiverPosition: %#v", status)
	}
	pos, ok := status["receiverPosition"].(map[string]any)
	if !ok || pos["kind"] != "producer_provided" {
		t.Fatalf("receiverPosition = %#v", status["receiverPosition"])
	}
}

func TestProducerStatusNormalizerReportsInvalidAircraftAltitude(t *testing.T) {
	n := NewProducerStatusNormalizer()
	n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`))

	status := findEnvelope(t, ingestAircraftJSONForTest(t, n, `{
		"now":100,
		"messages":1000,
		"aircraft":[{"hex":"abc123","alt_baro":"FL340"}]
	}`), "status")

	diagnostics, ok := status["diagnostics"].([]any)
	if !ok {
		t.Fatalf("diagnostics = %#v", status["diagnostics"])
	}
	if len(diagnostics) != 1 {
		t.Fatalf("diagnostics = %#v", diagnostics)
	}
	diag := diagnostics[0].(map[string]any)
	if diag["channel"] != "aircraft" || diag["code"] != "aircraft.adapter.invalid_altitude" {
		t.Fatalf("diagnostic = %#v", diag)
	}
}

func TestProducerStatusNormalizerKeepsCounterAcrossSameProducerReceiverReingest(t *testing.T) {
	n := NewProducerStatusNormalizer()
	n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`))
	ingestAircraftJSONForTest(t, n, `{"now":100,"messages":1000,"aircraft":[]}`)

	// Re-ingest the same producer; counter baseline must survive so the next
	// aircraft sample produces a rate rather than emitting awaiting_second_sample.
	n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`))

	status := findEnvelope(t, ingestAircraftJSONForTest(t, n, `{"now":160,"messages":4000,"aircraft":[]}`), "status")
	rate, ok := status["messageRate"].(map[string]any)
	if !ok {
		t.Fatalf("messageRate = %#v", status["messageRate"])
	}
	if rate["kind"] != "ident_derived" {
		t.Fatalf("messageRate kind = %#v (expected ident_derived, counter should have survived re-ingest)", rate["kind"])
	}
}

func TestProducerStatusNormalizerEmitsProducerChangedOnKindFlip(t *testing.T) {
	n := NewProducerStatusNormalizer()
	n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`))
	ingestAircraftJSONForTest(t, n, `{"now":100,"messages":1000,"aircraft":[]}`)

	// Flip producer to readsb; the next aircraft frame should report the
	// producer change as a distinct reason, not generic awaiting_second_sample.
	n.IngestReceiverJSON([]byte(`{"version":"readsb v3.14.1676","readsb":true}`))

	status := findEnvelope(t, ingestAircraftJSONForTest(t, n, `{"now":200,"messages":5000,"aircraft":[]}`), "status")
	rate, ok := status["messageRate"].(map[string]any)
	if !ok {
		t.Fatalf("messageRate = %#v", status["messageRate"])
	}
	if rate["kind"] != "unavailable" || rate["reason"] != "producer_changed" {
		t.Fatalf("messageRate = %#v (expected unavailable+producer_changed)", rate)
	}
}

func TestProducerStatusNormalizerKeepsAircraftAfterMalformedStats(t *testing.T) {
	n := NewProducerStatusNormalizer()
	n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`))

	malformed := n.IngestStatsJSON([]byte(`{"last1min":`))
	assertDiagnostic(t, findEnvelope(t, malformed, "status"), "stats.adapter.malformed_file")

	envs, frame := n.IngestAircraftJSONWithFrame([]byte(`{
		"now":100,
		"messages":1000,
		"aircraft":[{"hex":"abc123","lat":1,"lon":2}]
	}`))
	if frame == nil || len(frame.Aircraft) != 1 {
		t.Fatalf("aircraft frame = %#v", frame)
	}
	aircraft := findEnvelope(t, envs, "aircraft")
	rows := aircraft["aircraft"].([]any)
	if rows[0].(map[string]any)["hex"] != "abc123" {
		t.Fatalf("aircraft = %#v", aircraft)
	}
}

func TestPublishProducerUpdateCachesNormalizedSnapshots(t *testing.T) {
	hub := NewHub([]string{"capabilities", "status", "aircraft"})
	n := NewProducerStatusNormalizer()

	publishProducerUpdate(hub, n, "receiver", []byte(`{"version":"dump1090-fa 10.2","lat":37.5,"lon":-122.2}`))
	publishProducerUpdate(hub, n, "stats", []byte(`{
		"last1min":{"start":1700000000,"end":1700000060,"messages":6000},
		"total":{"start":1699990000}
	}`))

	snaps := hub.Snapshots()
	if len(snaps) != 2 {
		t.Fatalf("snapshots = %d, want capabilities + status", len(snaps))
	}
	first := decodeEnvelope(t, snaps[0])
	second := decodeEnvelope(t, snaps[1])
	if first.Type != "capabilities" || second.Type != "status" {
		t.Fatalf("snapshot order/types = %q, %q", first.Type, second.Type)
	}
	if strings.Contains(string(snaps[0]), `"type":"receiver"`) ||
		strings.Contains(string(snaps[1]), `"type":"stats"`) ||
		strings.Contains(string(snaps[1]), `"last1min":`) {
		t.Fatalf("raw producer data leaked into snapshots: %s\n%s", snaps[0], snaps[1])
	}
}

func TestPublishProducerUpdateDoesNotPublishAircraftBeforeProducerDetection(t *testing.T) {
	hub := NewHub([]string{"capabilities", "status", "aircraft"})
	n := NewProducerStatusNormalizer()

	publishProducerUpdate(hub, n, "aircraft", []byte(`{"now":100,"messages":1000,"aircraft":[]}`))

	for _, snap := range hub.Snapshots() {
		if decodeEnvelope(t, snap).Type == "aircraft" {
			t.Fatalf("published aircraft before producer detection: %s", snap)
		}
	}
}

func TestPublishProducerUpdatePublishesAircraftThroughDetectedAdapter(t *testing.T) {
	hub := NewHub([]string{"capabilities", "status", "aircraft"})
	n := NewProducerStatusNormalizer()

	publishProducerUpdate(hub, n, "receiver", []byte(`{"version":"dump1090-fa 10.2"}`))
	publishProducerUpdate(hub, n, "aircraft", []byte(`{
		"now":100,
		"messages":1000,
		"aircraft":[{
			"hex":"~abc123",
			"type":"mlat",
			"flight":"TEST1",
			"r":"N12345",
			"t":"B738",
			"desc":"Test aircraft",
			"ownOp":"Example Air",
			"lat":34.1,
			"lon":-118.2,
			"alt_baro":"ground",
			"ground":true,
			"alt_geom":3175,
			"gs":141.5,
			"track":275.2,
			"seen_pos":3,
			"rssi":-18.5,
			"alert":1,
			"spi":0,
			"dbFlags":1,
			"version":2,
			"uat_version":3,
			"messages":42,
			"mlat":["lat","lon"],
			"tisb":["callsign"],
			"producer_private":"ignored"
		}],
		"producer_private":"ignored"
	}`))

	var aircraft map[string]any
	for _, snap := range hub.Snapshots() {
		env := decodeEnvelope(t, snap)
		if env.Type != "aircraft" {
			continue
		}
		if err := json.Unmarshal(env.Data, &aircraft); err != nil {
			t.Fatalf("unmarshal aircraft: %v\n%s", err, env.Data)
		}
	}
	if aircraft == nil {
		t.Fatal("missing aircraft snapshot")
	}
	if aircraft["schema"] != "ident.aircraft.v1" {
		t.Fatalf("schema = %v, want ident.aircraft.v1", aircraft["schema"])
	}
	producer := aircraft["producer"].(map[string]any)
	if producer["kind"] != "dump1090-fa" {
		t.Fatalf("producer = %#v", producer)
	}
	if aircraft["producer_private"] != nil {
		t.Fatalf("producer private top-level field leaked into aircraft frame: %#v", aircraft)
	}
	if aircraft["observedAtEpochSec"] != float64(100) || aircraft["frameMessagesTotal"] != float64(1000) {
		t.Fatalf("aircraft frame counters = %#v", aircraft)
	}
	rows := aircraft["aircraft"].([]any)
	first := rows[0].(map[string]any)
	if first["hex"] != "~abc123" || first["idKind"] != "non_icao" || first["source"] != "mlat" || first["flight"] != "TEST1" {
		t.Fatalf("aircraft row = %#v", first)
	}
	if first["reg"] != "N12345" || first["typeDesignator"] != "B738" || first["op"] != "Example Air" {
		t.Fatalf("aircraft identity fields = %#v", first)
	}
	if first["onGround"] != true || first["altBaroFt"] != nil || first["altGeomFt"] != float64(3175) {
		t.Fatalf("aircraft altitude fields = %#v", first)
	}
	if first["gsKt"] != float64(141.5) || first["trackDeg"] != float64(275.2) || first["seenPosSec"] != float64(3) {
		t.Fatalf("aircraft motion fields = %#v", first)
	}
	if first["alert"] != true || first["spi"] != false || first["dbFlags"] != float64(1) {
		t.Fatalf("aircraft flag fields = %#v", first)
	}
	if first["adsbVersion"] != float64(2) || first["uatVersion"] != float64(3) || first["aircraftMessagesTotal"] != float64(42) {
		t.Fatalf("aircraft version/counter fields = %#v", first)
	}
	if first["mlatFields"].([]any)[0] != "lat" || first["tisbFields"].([]any)[0] != "callsign" {
		t.Fatalf("aircraft source arrays = %#v", first)
	}
	if first["producer_private"] != nil {
		t.Fatalf("producer private aircraft field leaked into aircraft frame: %#v", first)
	}
	for _, rawKey := range []string{"r", "t", "ownOp", "alt_baro", "ground", "alt_geom", "gs", "track", "seen_pos", "rssi", "messages", "mlat", "tisb"} {
		if _, ok := first[rawKey]; ok {
			t.Fatalf("raw producer key %q leaked into aircraft row: %#v", rawKey, first)
		}
	}
}

func TestProducerStatusNormalizerUpstreamOverrideWinsOverDetection(t *testing.T) {
	n := NewProducerStatusNormalizerWithUpstreamType("dump1090-fa")

	envs := n.IngestReceiverJSON([]byte(`{"version":"readsb 3.16","readsb":true}`))

	capabilities := findEnvelope(t, envs, "capabilities")
	producer := capabilities["producer"].(map[string]any)
	if producer["kind"] != "dump1090-fa" {
		t.Fatalf("producer = %#v", producer)
	}
	status := findEnvelope(t, envs, "status")
	diag := status["diagnostics"].([]any)[0].(map[string]any)
	if diag["code"] != "config.adapter.override_mismatch" {
		t.Fatalf("diagnostic = %#v", diag)
	}
}

func TestProducerStatusNormalizerInvalidUpstreamOverrideFallsBackToDetection(t *testing.T) {
	n := NewProducerStatusNormalizerWithUpstreamType("not-supported")

	envs := n.IngestReceiverJSON([]byte(`{"version":"readsb 3.16","readsb":true}`))

	capabilities := findEnvelope(t, envs, "capabilities")
	producer := capabilities["producer"].(map[string]any)
	if producer["kind"] != "readsb" {
		t.Fatalf("producer = %#v", producer)
	}
	status := findEnvelope(t, envs, "status")
	diagnostics := status["diagnostics"].([]any)
	if len(diagnostics) != 1 {
		t.Fatalf("diagnostics = %#v", diagnostics)
	}
	diag := diagnostics[0].(map[string]any)
	if diag["channel"] != "config" || diag["code"] != "config.adapter.invalid_upstream_type" {
		t.Fatalf("diagnostic = %#v", diag)
	}
	if !strings.Contains(diag["message"].(string), "not-supported") {
		t.Fatalf("diagnostic should include raw value: %#v", diag)
	}
}

func TestProducerStatusNormalizerUnsupportedUpstreamOverrideFallsBackToDetection(t *testing.T) {
	n := newProducerStatusNormalizer([]producerAdapter{readsbAdapter{}}, time.Now, "dump1090-fa")

	envs := n.IngestReceiverJSON([]byte(`{"version":"readsb 3.16","readsb":true}`))

	capabilities := findEnvelope(t, envs, "capabilities")
	producer := capabilities["producer"].(map[string]any)
	if producer["kind"] != "readsb" {
		t.Fatalf("producer = %#v", producer)
	}
	status := findEnvelope(t, envs, "status")
	diagnostics := status["diagnostics"].([]any)
	if len(diagnostics) != 1 {
		t.Fatalf("diagnostics = %#v", diagnostics)
	}
	diag := diagnostics[0].(map[string]any)
	if diag["channel"] != "config" || diag["code"] != "config.adapter.unsupported_upstream_type" {
		t.Fatalf("diagnostic = %#v", diag)
	}
	if !strings.Contains(diag["message"].(string), "dump1090-fa") {
		t.Fatalf("diagnostic should include raw value: %#v", diag)
	}
}

func TestPublishProducerUpdatePublishesRangeOutlineThroughDetectedAdapter(t *testing.T) {
	hub := NewHub([]string{"capabilities", "status", "aircraft", "rangeOutline"})
	n := NewProducerStatusNormalizerWithClock(func() time.Time {
		return time.Unix(1_700_000_120, 0)
	})

	publishProducerUpdate(hub, n, "receiver", []byte(`{"version":"readsb 3.16","readsb":true,"lat":0,"lon":0}`))
	publishProducerUpdate(hub, n, "outline", []byte(`{
		"actualRange":{
			"last24h":{"points":[[0,1,12000],[0,2,13000],[1,0,14000]]}
		},
		"producer_private":"ignored"
	}`))

	var outline map[string]any
	var status map[string]any
	for _, snap := range hub.Snapshots() {
		env := decodeEnvelope(t, snap)
		switch env.Type {
		case "rangeOutline":
			if err := json.Unmarshal(env.Data, &outline); err != nil {
				t.Fatalf("unmarshal rangeOutline: %v\n%s", err, env.Data)
			}
		case "status":
			if err := json.Unmarshal(env.Data, &status); err != nil {
				t.Fatalf("unmarshal status: %v\n%s", err, env.Data)
			}
		}
	}
	if outline == nil {
		t.Fatal("missing rangeOutline snapshot")
	}
	if outline["schema"] != "ident.rangeOutline.v1" || outline["scope"] != "last24h" {
		t.Fatalf("range outline = %#v", outline)
	}
	producer := outline["producer"].(map[string]any)
	if producer["kind"] != "readsb" {
		t.Fatalf("range outline producer = %#v", producer)
	}
	coords := outline["coordinates"].([]any)
	first := coords[0].([]any)
	if first[0] != float64(1) || first[1] != float64(0) {
		t.Fatalf("coordinates = %#v", coords)
	}
	if outline["producer_private"] != nil || outline["actualRange"] != nil {
		t.Fatalf("raw producer outline leaked: %#v", outline)
	}
	if status == nil {
		t.Fatal("missing status snapshot")
	}
	maxRange := status["maxRange"].(map[string]any)
	if maxRange["kind"] != "producer_provided" || maxRange["source"] != "outline_last24h_vertices" {
		t.Fatalf("maxRange = %#v", maxRange)
	}
	value := maxRange["value"].(map[string]any)
	nm := value["nm"].(float64)
	if nm < 119 || nm > 121 || value["scope"] != "last24h" || value["computation"] != "max_receiver_to_outline_vertex" {
		t.Fatalf("maxRange value = %#v", value)
	}
}

func TestPublishProducerUpdateReportsMalformedRangeOutline(t *testing.T) {
	hub := NewHub([]string{"capabilities", "status", "rangeOutline"})
	n := NewProducerStatusNormalizer()

	publishProducerUpdate(hub, n, "receiver", []byte(`{"version":"readsb 3.16","readsb":true,"lat":0,"lon":0}`))
	publishProducerUpdate(hub, n, "outline", []byte(`{"actualRange":{"last24h":{"points":[[0,1],[1,0]]}}}`))

	status := findSnapshotEnvelope(t, hub.Snapshots(), "status")
	diagnostics := status["diagnostics"].([]any)
	if len(diagnostics) != 1 {
		t.Fatalf("diagnostics = %#v", diagnostics)
	}
	diag := diagnostics[0].(map[string]any)
	if diag["channel"] != "outline" || diag["code"] != "outline.adapter.malformed_outline" {
		t.Fatalf("diagnostic = %#v", diag)
	}
	for _, snap := range hub.Snapshots() {
		if decodeEnvelope(t, snap).Type == "rangeOutline" {
			t.Fatalf("published malformed range outline: %s", snap)
		}
	}
}

func TestPublishProducerUpdatePublishesRangeOutlineWithoutReceiverPosition(t *testing.T) {
	hub := NewHub([]string{"capabilities", "status", "rangeOutline"})
	n := NewProducerStatusNormalizer()

	publishProducerUpdate(hub, n, "receiver", []byte(`{"version":"readsb 3.16","readsb":true}`))
	publishProducerUpdate(hub, n, "outline", []byte(`{
		"actualRange":{"last24h":{"points":[[0,1],[1,0],[1,1]]}}
	}`))

	outline := findSnapshotEnvelope(t, hub.Snapshots(), "rangeOutline")
	if outline["schema"] != "ident.rangeOutline.v1" {
		t.Fatalf("outline = %#v", outline)
	}
	for _, snap := range hub.Snapshots() {
		env := decodeEnvelope(t, snap)
		if env.Type != "status" {
			continue
		}
		var status map[string]any
		if err := json.Unmarshal(env.Data, &status); err != nil {
			t.Fatalf("unmarshal status: %v\n%s", err, env.Data)
		}
		if _, ok := status["maxRange"]; ok {
			t.Fatalf("maxRange should not publish without receiver position: %#v", status)
		}
	}
}

func TestProducerOutlinePointsChoosesOtherBucketDeterministically(t *testing.T) {
	scope, points, ok := producerOutlinePoints(producerOutlineJSON{
		ActualRange: map[string]producerOutlineBucket{
			"zulu":  {Points: [][]float64{{9, 0}, {9, 1}, {9, 2}}},
			"alpha": {Points: [][]float64{{1, 0}, {1, 1}, {1, 2}}},
		},
	})
	if !ok || scope != rangeOutlineScopeOther {
		t.Fatalf("scope = %q ok=%v", scope, ok)
	}
	if points[0][0] != 1 {
		t.Fatalf("points = %#v, want alpha bucket first", points)
	}
}

func TestProducerStatusNormalizerConvertsStatsMaxDistanceToNauticalMiles(t *testing.T) {
	n := NewProducerStatusNormalizerWithClock(func() time.Time {
		return time.Unix(1_700_000_120, 0)
	})
	n.IngestReceiverJSON([]byte(`{"version":"readsb 3.16","readsb":true}`))

	envs := n.IngestStatsJSON([]byte(`{
		"now": 1700000120,
		"gain_db": 18.6,
		"max_distance": 185200,
		"last1min": {"start": 1700000060, "end": 1700000120, "messages_valid": 600},
		"total": {"start": 1699990000}
	}`))

	status := findEnvelope(t, envs, "status")
	maxRange := status["maxRange"].(map[string]any)
	if maxRange["kind"] != "producer_provided" || maxRange["source"] != "stats_max_distance_meters" {
		t.Fatalf("maxRange = %#v", maxRange)
	}
	value := maxRange["value"].(map[string]any)
	nm := value["nm"].(float64)
	if nm < 99.9 || nm > 100.1 || value["scope"] != "stats" || value["computation"] != "producer_reported_distance" {
		t.Fatalf("maxRange value = %#v", value)
	}
}

func findEnvelope(t *testing.T, envs [][]byte, wantType string) map[string]any {
	t.Helper()
	for _, env := range envs {
		outer := decodeEnvelope(t, env)
		if outer.Type != wantType {
			continue
		}
		var data map[string]any
		if err := json.Unmarshal(outer.Data, &data); err != nil {
			t.Fatalf("unmarshal %s data: %v\n%s", wantType, err, outer.Data)
		}
		return data
	}
	t.Fatalf("missing %q envelope in %d envelopes", wantType, len(envs))
	return nil
}

func findSnapshotEnvelope(t *testing.T, snapshots [][]byte, wantType string) map[string]any {
	t.Helper()
	return findEnvelope(t, snapshots, wantType)
}

func ingestAircraftJSONForTest(t *testing.T, n *ProducerStatusNormalizer, body string) [][]byte {
	t.Helper()
	envs, _ := n.IngestAircraftJSONWithFrame([]byte(body))
	return envs
}

type decodedEnvelope struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

func decodeEnvelope(t *testing.T, env []byte) decodedEnvelope {
	t.Helper()
	var outer decodedEnvelope
	if err := json.Unmarshal(env, &outer); err != nil {
		t.Fatalf("unmarshal envelope: %v\n%s", err, env)
	}
	return outer
}

func assertStatusValue(t *testing.T, raw any, kind, source, valueKey string, want float64) {
	t.Helper()
	status := raw.(map[string]any)
	if status["kind"] != kind || status["source"] != source {
		t.Fatalf("status = %#v", status)
	}
	value := status["value"].(map[string]any)
	if value[valueKey] != want {
		t.Fatalf("%s = %#v, want %v in %#v", valueKey, value[valueKey], want, value)
	}
}

func assertUnavailableReason(t *testing.T, raw any, reason string) {
	t.Helper()
	status := raw.(map[string]any)
	if status["kind"] != "unavailable" || status["reason"] != reason {
		t.Fatalf("status = %#v, want unavailable %q", status, reason)
	}
}

func assertDiagnostic(t *testing.T, status map[string]any, code string) {
	t.Helper()
	diagnostics, ok := status["diagnostics"].([]any)
	if !ok {
		t.Fatalf("diagnostics = %#v", status["diagnostics"])
	}
	for _, raw := range diagnostics {
		diag := raw.(map[string]any)
		if diag["code"] == code {
			return
		}
	}
	t.Fatalf("diagnostic %q missing from %#v", code, diagnostics)
}
