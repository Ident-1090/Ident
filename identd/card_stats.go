package main

// CardStats is the receiver snapshot rendered onto the public share card.
type CardStats struct {
	Station     string
	MessageRate float64
	HasRate     bool
	Aircraft    int
	MaxRangeNM  float64
	HasRange    bool
}

func messageRateHz(v *messageRateValue) (float64, bool) {
	if v == nil {
		return 0, false
	}
	switch s := v.inner.(type) {
	case producerProvidedValue[messageRateStatusValue]:
		return s.Value.Hz, true
	case derivedValue[messageRateStatusValue]:
		return s.Value.Hz, true
	}
	return 0, false
}

func maxRangeNm(v *maxRangeValue) (float64, bool) {
	if v == nil {
		return 0, false
	}
	switch s := v.inner.(type) {
	case producerProvidedValue[maxRangeStatusValue]:
		return s.Value.NM, true
	case derivedValue[maxRangeStatusValue]:
		return s.Value.NM, true
	}
	return 0, false
}

// CardStats returns the latest known message rate and max range for the share
// card. Best-effort: it reads the last published values directly (preferring
// the stats-derived rate, falling back to the aircraft-counter rate) without
// the staleness gating or diagnostics side effects of the wire snapshot — a
// slightly stale number on a cached share image is fine.
func (n *ProducerStatusNormalizer) CardStats() (rate float64, hasRate bool, maxRangeNM float64, hasRange bool) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if hz, ok := messageRateHz(n.lastStatsMessageRate); ok {
		rate, hasRate = hz, true
	} else if hz, ok := messageRateHz(n.lastAircraftMessageRate); ok {
		rate, hasRate = hz, true
	}
	if nm, ok := maxRangeNm(n.lastMaxRange); ok {
		maxRangeNM, hasRange = nm, true
	}
	return rate, hasRate, maxRangeNM, hasRange
}
