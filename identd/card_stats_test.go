package main

import "testing"

func TestCardStatsExtractsRateAndRange(t *testing.T) {
	n := &ProducerStatusNormalizer{
		lastStatsMessageRate: messageRateProvided("stats", messageRateStatusValue{Hz: 418.5}),
		lastMaxRange:         maxRangeProvided("outline", maxRangeStatusValue{NM: 250}),
	}
	rate, hasRate, nm, hasRange := n.CardStats()
	if !hasRate || rate != 418.5 {
		t.Fatalf("rate=%v hasRate=%v, want 418.5/true", rate, hasRate)
	}
	if !hasRange || nm != 250 {
		t.Fatalf("range=%v hasRange=%v, want 250/true", nm, hasRange)
	}
}

func TestCardStatsFallsBackToAircraftRate(t *testing.T) {
	n := &ProducerStatusNormalizer{
		lastAircraftMessageRate: messageRateDerived("aircraft_counter_delta", messageRateStatusValue{Hz: 12}),
	}
	rate, hasRate, _, hasRange := n.CardStats()
	if !hasRate || rate != 12 {
		t.Fatalf("rate=%v hasRate=%v, want 12/true", rate, hasRate)
	}
	if hasRange {
		t.Fatal("expected no range")
	}
}

func TestCardStatsEmptyWhenUnset(t *testing.T) {
	n := &ProducerStatusNormalizer{}
	_, hasRate, _, hasRange := n.CardStats()
	if hasRate || hasRange {
		t.Fatalf("expected no stats, got hasRate=%v hasRange=%v", hasRate, hasRange)
	}
}
