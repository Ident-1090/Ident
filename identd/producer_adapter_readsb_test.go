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
