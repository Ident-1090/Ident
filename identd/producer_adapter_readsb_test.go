package main

import "testing"

func TestProducerStatusNormalizerDetectsReadsbAndPublishesCapabilities(t *testing.T) {
	n := NewProducerStatusNormalizer()

	envs := n.IngestReceiverJSON([]byte(`{
		"version":"3.14",
		"readsb":true,
		"lat":37.5,
		"lon":-122.2
	}`))

	capabilities := findEnvelope(t, envs, "capabilities")
	if capabilities["schema"] != "ident.capabilities.v1" {
		t.Fatalf("schema = %v", capabilities["schema"])
	}
	producer := capabilities["producer"].(map[string]any)
	if producer["kind"] != "readsb" || producer["version"] != "3.14" {
		t.Fatalf("producer = %#v", producer)
	}
	caps := capabilities["capabilities"].(map[string]any)
	if caps["receiverPosition"] != "producer_provided" {
		t.Fatalf("receiverPosition capability = %v", caps["receiverPosition"])
	}
	status := findEnvelope(t, envs, "status")
	receiverPosition := status["receiverPosition"].(map[string]any)
	if receiverPosition["kind"] != "producer_provided" || receiverPosition["source"] != "receiver_json" {
		t.Fatalf("receiverPosition = %#v", receiverPosition)
	}
	value := receiverPosition["value"].(map[string]any)
	if value["lat"] != 37.5 || value["lon"] != -122.2 {
		t.Fatalf("receiverPosition value = %#v", value)
	}
}

func TestReadsbStatusIncludesSignalStats(t *testing.T) {
	n := NewProducerStatusNormalizer()
	n.IngestReceiverJSON([]byte(`{"version":"readsb 3.16","readsb":true}`))

	envs := n.IngestStatsJSON([]byte(`{
		"now":1700000060,
		"gain_db":18.6,
		"last1min":{
			"start":1700000000,
			"end":1700000060,
			"messages_valid":6000,
			"cpu":{"demod":2101,"reader":502},
			"local":{
				"signal":-17.8,
				"noise":-34.2,
				"strong_signals":60,
				"samples_dropped":2,
				"samples_lost":3
			}
		},
		"total":{"start":1699990000}
	}`))

	status := findEnvelope(t, envs, "status")
	stats := status["stats"].(map[string]any)
	assertReceiverMetric(t, stats["signalDbfs"], "stats_last1min_local", -17.8)
	assertReceiverMetric(t, stats["noiseDbfs"], "stats_last1min_local", -34.2)
	assertReceiverMetric(t, stats["strongPct"], "stats_last1min_local", 1)
	assertReceiverMetric(t, stats["sampleDrops"], "stats_last1min_local", 5)
	if _, ok := stats["cpuPct"]; ok {
		t.Fatalf("receiver stats = %#v", stats)
	}
}

func TestReadsbStatusReportsMalformedSignalStats(t *testing.T) {
	n := NewProducerStatusNormalizer()
	store := attachDiagnosticStoreForTest(n)
	n.IngestReceiverJSON([]byte(`{"version":"readsb 3.16","readsb":true}`))

	n.IngestStatsJSON([]byte(`{
		"now":1700000060,
		"last1min":{
			"start":1700000000,
			"end":1700000060,
			"local":{"strong_signals":60}
		}
	}`))

	diag, ok := findDiagnostic(store.Snapshot(), "stats.adapter.malformed_signal_stats")
	if !ok {
		t.Fatalf("diagnostic codes = %#v", diagnosticCodes(store.Snapshot()))
	}
	if diag.Channel != "stats" {
		t.Fatalf("diagnostic = %#v", diag)
	}
}
