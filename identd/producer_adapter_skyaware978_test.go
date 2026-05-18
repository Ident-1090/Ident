package main

import "testing"

func TestProducerStatusNormalizerDerivesSkyaware978AircraftCounterRateAfterBootstrap(t *testing.T) {
	n := NewProducerStatusNormalizer()
	n.IngestReceiverJSON([]byte(`{"version":"dump978-fa 8.2"}`))

	first := ingestAircraftJSONForTest(t, n, `{"now":100,"messages":1000,"aircraft":[]}`)
	firstStatus := findEnvelope(t, first, "status")
	firstRate := firstStatus["messageRate"].(map[string]any)
	if firstRate["kind"] != "unavailable" || firstRate["reason"] != "awaiting_second_sample" {
		t.Fatalf("first messageRate = %#v", firstRate)
	}

	second := ingestAircraftJSONForTest(t, n, `{"now":110,"messages":1250,"aircraft":[]}`)
	secondStatus := findEnvelope(t, second, "status")
	assertStatusValue(t, secondStatus["messageRate"], "ident_derived", "aircraft_counter_delta", "hz", 25)
}
