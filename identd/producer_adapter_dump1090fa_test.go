package main

import "testing"

func TestProducerStatusNormalizerNormalizesDump1090FAStatsWindows(t *testing.T) {
	n := NewProducerStatusNormalizer()
	initial := n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2","lat":37.5,"lon":-122.2}`))
	initialCaps := findEnvelope(t, initial, "capabilities")["capabilities"].(map[string]any)
	if initialCaps["messageRate"] != "unavailable" || initialCaps["gain"] != "unavailable" || initialCaps["uptime"] != "unavailable" {
		t.Fatalf("initial capabilities = %#v", initialCaps)
	}

	envs := n.IngestStatsJSON([]byte(`{
		"last1min":{"start":1700000000,"end":1700000060,"messages":6000,"local":{"gain_db":43.9,"signal":-10.5,"noise":-28.6,"strong_signals":300,"samples_dropped":4}},
		"total":{"start":1699990000,"end":1700000060}
	}`))

	updatedCaps := findEnvelope(t, envs, "capabilities")["capabilities"].(map[string]any)
	if updatedCaps["messageRate"] != "producer_provided" || updatedCaps["gain"] != "producer_provided" || updatedCaps["uptime"] != "producer_provided" {
		t.Fatalf("updated capabilities = %#v", updatedCaps)
	}
	status := findEnvelope(t, envs, "status")
	if status["schema"] != "ident.status.v1" {
		t.Fatalf("schema = %v", status["schema"])
	}
	if _, ok := status["producer"]; ok {
		t.Fatalf("status envelope must not carry producer; only ident.capabilities.v1 does")
	}
	assertStatusValue(t, status["messageRate"], "producer_provided", "stats_last1min_messages", "hz", 100)
	assertStatusValue(t, status["gain"], "producer_provided", "last1min_local", "db", 43.9)
	stats := status["stats"].(map[string]any)
	assertReceiverMetric(t, stats["signalDbfs"], "stats_last1min_local", -10.5)
	assertReceiverMetric(t, stats["noiseDbfs"], "stats_last1min_local", -28.6)
	assertReceiverMetric(t, stats["strongPct"], "stats_last1min_local", 5)
	assertReceiverMetric(t, stats["sampleDrops"], "stats_last1min_local", 4)
	uptime := status["uptime"].(map[string]any)
	if uptime["kind"] != "producer_provided" || uptime["source"] != "window_end_minus_total_start" {
		t.Fatalf("uptime = %#v", uptime)
	}
	value := uptime["value"].(map[string]any)
	if value["subject"] != "receiver" || value["sec"] != float64(10060) {
		t.Fatalf("uptime value = %#v", value)
	}
}

func TestProducerStatusNormalizerDoesNotClassifyMutabilityAsDump1090FA(t *testing.T) {
	n := newProducerStatusNormalizerPastStartup()
	store := attachDiagnosticStoreForTest(n)

	envs := n.IngestReceiverJSON([]byte(`{"version":"dump1090-mutability v1.15","lat":37.5,"lon":-122.2}`))

	capabilities := findEnvelope(t, envs, "capabilities")
	producer := capabilities["producer"].(map[string]any)
	if producer["kind"] != "unknown" {
		t.Fatalf("producer = %#v, want unknown", producer)
	}
	if _, ok := findDiagnostic(store.Snapshot(), "producer.ident.unknown"); !ok {
		t.Fatalf("diagnostic codes = %#v", diagnosticCodes(store.Snapshot()))
	}
}

func TestProducerStatusNormalizerSurfacesDump1090FAMissingWindowDuration(t *testing.T) {
	// dump1090-fa shipped a stats window with messages but no usable
	// start/end pair. messageRate must surface as unavailable with a
	// diagnostic so the operator sees the malformed window instead of
	// the field silently disappearing — matching the readsb adapter's
	// behavior for the same condition.
	n := NewProducerStatusNormalizer()
	store := attachDiagnosticStoreForTest(n)
	n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`))

	envs := n.IngestStatsJSON([]byte(`{"last1min":{"end":1700000060,"messages":6000},"total":{"start":1700000060}}`))

	status := findEnvelope(t, envs, "status")
	assertUnavailableReason(t, status["messageRate"], "malformed_file")
	diag, ok := findDiagnostic(store.Snapshot(), "stats.dump1090fa.missing_window_duration")
	if !ok {
		t.Fatalf("diagnostic codes = %#v", diagnosticCodes(store.Snapshot()))
	}
	if diag.Channel != "stats" {
		t.Fatalf("diagnostic = %#v", diag)
	}
}

func TestProducerStatusNormalizerPromotesDump1090FAMessageRateFromAircraftCounter(t *testing.T) {
	n := NewProducerStatusNormalizer()
	initial := n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`))
	initialCaps := findEnvelope(t, initial, "capabilities")["capabilities"].(map[string]any)
	if initialCaps["messageRate"] != "unavailable" {
		t.Fatalf("initial capabilities = %#v", initialCaps)
	}

	first := ingestAircraftJSONForTest(t, n, `{"now":100,"messages":1000,"aircraft":[]}`)
	for _, env := range first {
		if decodeEnvelope(t, env).Type == "capabilities" {
			t.Fatalf("first sample should not promote capabilities: %s", env)
		}
	}

	second := ingestAircraftJSONForTest(t, n, `{"now":110,"messages":1250,"aircraft":[]}`)
	updatedCaps := findEnvelope(t, second, "capabilities")["capabilities"].(map[string]any)
	if updatedCaps["messageRate"] != "ident_derived" {
		t.Fatalf("updated capabilities = %#v", updatedCaps)
	}
	status := findEnvelope(t, second, "status")
	assertStatusValue(t, status["messageRate"], "ident_derived", "aircraft_counter_delta", "hz", 25)
}

func TestProducerStatusNormalizerDropsLostDump1090FAAircraft(t *testing.T) {
	n := NewProducerStatusNormalizer()
	n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`))

	envs := ingestAircraftJSONForTest(t, n, `{
		"now":100,
		"messages":1000,
		"aircraft":[
			{"hex":"abc123","seen":30,"messages":20},
			{"hex":"def456","seen":30.1,"messages":21}
		]
	}`)

	aircraft := findEnvelope(t, envs, "aircraft")
	rows := aircraft["aircraft"].([]any)
	if len(rows) != 1 {
		t.Fatalf("aircraft rows = %#v", rows)
	}
	row := rows[0].(map[string]any)
	if row["hex"] != "abc123" {
		t.Fatalf("row = %#v", row)
	}
}

func TestProducerStatusNormalizerReportsReplayCapabilityFromIdentConfigForDump1090FA(t *testing.T) {
	disabled := NewProducerStatusNormalizerWithOptions(ProducerStatusNormalizerOptions{})
	disabledCaps := findEnvelope(t, disabled.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`)), "capabilities")["capabilities"].(map[string]any)
	if disabledCaps["replay"] != "unavailable" {
		t.Fatalf("disabled replay capability = %#v", disabledCaps["replay"])
	}

	enabled := NewProducerStatusNormalizerWithOptions(ProducerStatusNormalizerOptions{ReplayEnabled: true})
	enabledCaps := findEnvelope(t, enabled.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`)), "capabilities")["capabilities"].(map[string]any)
	if enabledCaps["replay"] != "ident_derived" {
		t.Fatalf("enabled replay capability = %#v", enabledCaps["replay"])
	}
}
