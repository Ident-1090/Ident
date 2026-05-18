package main

import (
	"encoding/json"
	"testing"
)

// Per-slot wrapper types prevent assigning a value carrying one slot's payload
// shape (e.g. a gain reading) into a different slot (e.g. message rate). The
// only way to construct each wrapper is through its dedicated constructor, and
// each constructor's parameter list pins the payload type at compile time.
//
// This test verifies that the wrapper types marshal to the same wire shape as
// the underlying producerProvidedValue / derivedValue / unavailableValue, so
// the published JSON contract is unchanged.
//
// The compile-time cross-slot guarantee is enforced by the type system itself:
// expressions like `status.MessageRate = gainProvided(...)` fail to compile
// because *gainValue is not assignable to *messageRateValue.
func TestStatusPerSlotWrappersPreserveWireShape(t *testing.T) {
	status := identStatus{
		Schema:   "ident.status.v1",
		Producer: identProducer{Kind: producerReadsb, Version: "readsb 1.0"},
		ObservedAt: observedAtProvided("stats_now", observedAtStatusValue{
			EpochSec: 1_700_000_100,
		}),
		ReceiverPosition: receiverPositionProvided("receiver_json", receiverPositionStatusValue{
			Lat: 37.4275,
			Lon: -122.1697,
		}),
		MessageRate: messageRateProvided("stats_last1min_messages_valid", messageRateStatusValue{
			Hz:       100,
			BasisSec: 60,
		}),
		Gain: gainProvided("top_level", gainStatusValue{DB: 18.6}),
		Uptime: uptimeProvided("stats_now_minus_total_start", uptimeStatusValue{
			Sec:     3600,
			Subject: "receiver",
		}),
		MaxRange: maxRangeProvided("stats_max_distance_meters", maxRangeStatusValue{
			NM:          120,
			Scope:       "stats",
			Computation: "producer_reported_distance",
		}),
		Diagnostics: []diagnostic{},
	}

	got := mustMarshalJSON(t, status)

	var decoded map[string]any
	if err := json.Unmarshal(got, &decoded); err != nil {
		t.Fatalf("unmarshal status JSON: %v\n%s", err, got)
	}

	assertProvidedShape(t, decoded["observedAt"], "stats_now", map[string]any{
		"epochSec": float64(1_700_000_100),
	})
	assertProvidedShape(t, decoded["receiverPosition"], "receiver_json", map[string]any{
		"lat": 37.4275,
		"lon": -122.1697,
	})
	assertProvidedShape(t, decoded["messageRate"], "stats_last1min_messages_valid", map[string]any{
		"hz":       float64(100),
		"basisSec": float64(60),
	})
	assertProvidedShape(t, decoded["gain"], "top_level", map[string]any{
		"db": 18.6,
	})
	assertProvidedShape(t, decoded["uptime"], "stats_now_minus_total_start", map[string]any{
		"sec":     float64(3600),
		"subject": "receiver",
	})
	assertProvidedShape(t, decoded["maxRange"], "stats_max_distance_meters", map[string]any{
		"nm":          float64(120),
		"scope":       "stats",
		"computation": "producer_reported_distance",
	})
}

// Constructors for ident-derived values must round-trip with the
// "ident_derived" kind tag preserved on the wire.
func TestStatusPerSlotWrappersDerivedKind(t *testing.T) {
	status := identStatus{
		Schema:   "ident.status.v1",
		Producer: identProducer{Kind: producerSkyaware978},
		ObservedAt: observedAtDerived("ingest_clock", observedAtStatusValue{
			EpochSec: 1_700_000_120,
		}),
		MessageRate: messageRateDerived("aircraft_counter_delta", messageRateStatusValue{
			Hz:       25,
			BasisSec: 10,
		}),
		Diagnostics: []diagnostic{},
	}

	decoded := mustDecodeJSON(t, mustMarshalJSON(t, status))
	assertDerivedShape(t, decoded["observedAt"], "ingest_clock", map[string]any{
		"epochSec": float64(1_700_000_120),
	})
	assertDerivedShape(t, decoded["messageRate"], "aircraft_counter_delta", map[string]any{
		"hz":       float64(25),
		"basisSec": float64(10),
	})
}

// Unavailable wrappers must serialize with the "unavailable" kind and a reason.
func TestStatusPerSlotWrappersUnavailableKind(t *testing.T) {
	status := identStatus{
		Schema:      "ident.status.v1",
		Producer:    identProducer{Kind: producerDump1090FA},
		ObservedAt:  observedAtDerived("ingest_clock", observedAtStatusValue{EpochSec: 1}),
		MessageRate: messageRateUnavailable(reasonAwaitingSecondSample),
		Diagnostics: []diagnostic{},
	}

	decoded := mustDecodeJSON(t, mustMarshalJSON(t, status))
	rate, ok := decoded["messageRate"].(map[string]any)
	if !ok {
		t.Fatalf("messageRate = %#v", decoded["messageRate"])
	}
	if rate["kind"] != "unavailable" || rate["reason"] != "awaiting_second_sample" {
		t.Fatalf("messageRate = %#v", rate)
	}
}

// Nil wrappers in a status must be omitted from the wire payload entirely,
// matching the previous interface-typed behavior under `omitempty`.
func TestStatusPerSlotWrappersOmitWhenNil(t *testing.T) {
	status := identStatus{
		Schema:      "ident.status.v1",
		Producer:    identProducer{Kind: producerUnknown},
		ObservedAt:  observedAtDerived("ingest_clock", observedAtStatusValue{EpochSec: 1}),
		Diagnostics: []diagnostic{},
	}

	decoded := mustDecodeJSON(t, mustMarshalJSON(t, status))
	for _, key := range []string{"receiverPosition", "messageRate", "gain", "uptime", "maxRange"} {
		if _, present := decoded[key]; present {
			t.Fatalf("expected %q to be omitted when wrapper is nil, decoded = %#v", key, decoded)
		}
	}
}

func assertProvidedShape(t *testing.T, raw any, source string, value map[string]any) {
	t.Helper()
	obj, ok := raw.(map[string]any)
	if !ok {
		t.Fatalf("expected object, got %#v", raw)
	}
	if obj["kind"] != "producer_provided" {
		t.Fatalf("kind = %#v, want producer_provided", obj["kind"])
	}
	if obj["source"] != source {
		t.Fatalf("source = %#v, want %q", obj["source"], source)
	}
	gotValue, ok := obj["value"].(map[string]any)
	if !ok {
		t.Fatalf("value = %#v", obj["value"])
	}
	for k, want := range value {
		if gotValue[k] != want {
			t.Fatalf("value[%q] = %#v, want %#v (full value=%#v)", k, gotValue[k], want, gotValue)
		}
	}
}

func assertDerivedShape(t *testing.T, raw any, source string, value map[string]any) {
	t.Helper()
	obj, ok := raw.(map[string]any)
	if !ok {
		t.Fatalf("expected object, got %#v", raw)
	}
	if obj["kind"] != "ident_derived" {
		t.Fatalf("kind = %#v, want ident_derived", obj["kind"])
	}
	if obj["source"] != source {
		t.Fatalf("source = %#v, want %q", obj["source"], source)
	}
	gotValue, ok := obj["value"].(map[string]any)
	if !ok {
		t.Fatalf("value = %#v", obj["value"])
	}
	for k, want := range value {
		if gotValue[k] != want {
			t.Fatalf("value[%q] = %#v, want %#v (full value=%#v)", k, gotValue[k], want, gotValue)
		}
	}
}

func mustMarshalJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func mustDecodeJSON(t *testing.T, b []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal: %v\n%s", err, b)
	}
	return m
}
