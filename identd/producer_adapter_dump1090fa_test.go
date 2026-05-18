package main

import "testing"

func TestProducerStatusNormalizerNormalizesDump1090FAStatsWindows(t *testing.T) {
	n := NewProducerStatusNormalizer()
	n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2","lat":37.5,"lon":-122.2}`))

	envs := n.IngestStatsJSON([]byte(`{
		"last1min":{"start":1700000000,"end":1700000060,"messages":6000,"local":{"gain_db":43.9}},
		"total":{"start":1699990000,"end":1700000060}
	}`))

	status := findEnvelope(t, envs, "status")
	if status["schema"] != "ident.status.v1" {
		t.Fatalf("schema = %v", status["schema"])
	}
	producer := status["producer"].(map[string]any)
	if producer["kind"] != "dump1090-fa" {
		t.Fatalf("producer = %#v", producer)
	}
	assertStatusValue(t, status["messageRate"], "producer_provided", "stats_last1min_messages", "hz", 100)
	assertStatusValue(t, status["gain"], "producer_provided", "last1min_local", "db", 43.9)
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
	n := NewProducerStatusNormalizer()

	envs := n.IngestReceiverJSON([]byte(`{"version":"dump1090-mutability v1.15","lat":37.5,"lon":-122.2}`))

	capabilities := findEnvelope(t, envs, "capabilities")
	producer := capabilities["producer"].(map[string]any)
	if producer["kind"] != "unknown" {
		t.Fatalf("producer = %#v, want unknown", producer)
	}
	status := findEnvelope(t, envs, "status")
	diagnostics := status["diagnostics"].([]any)
	if len(diagnostics) != 1 {
		t.Fatalf("diagnostics = %#v", diagnostics)
	}
	diag := diagnostics[0].(map[string]any)
	if diag["code"] != "producer.ident.unknown" {
		t.Fatalf("diagnostic = %#v", diag)
	}
}

func TestProducerStatusNormalizerRejectsMissingDump1090FAStatsWindowDuration(t *testing.T) {
	n := NewProducerStatusNormalizer()
	n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`))

	envs := n.IngestStatsJSON([]byte(`{"last1min":{"messages":6000}}`))

	status := findEnvelope(t, envs, "status")
	rate := status["messageRate"].(map[string]any)
	if rate["kind"] != "unavailable" || rate["reason"] != "malformed_file" {
		t.Fatalf("messageRate = %#v", rate)
	}
}
