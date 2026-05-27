package main

type readsbAdapter struct{}

func (readsbAdapter) Kind() identProducerKind {
	return producerReadsb
}

func (a readsbAdapter) Detect(evidence producerEvidence) producerCandidate {
	if evidence.Receiver == nil || !evidence.Receiver.Readsb {
		return producerCandidate{}
	}
	return producerCandidate{
		Producer:     identProducer{Kind: producerReadsb, Version: evidence.Receiver.Version},
		Score:        100,
		Capabilities: a.Capabilities(evidence),
		Evidence:     []string{"receiver.readsb"},
	}
}

func (readsbAdapter) Capabilities(evidence producerEvidence) identCapabilities {
	caps := commonProducerCapabilitiesFromEvidence(evidence)
	caps.MessageRate = capabilityProducerProvided
	caps.Gain = capabilityProducerProvided
	caps.Uptime = capabilityProducerProvided
	caps.MaxRange = capabilityProducerProvided
	caps.RangeOutline = capabilityProducerProvided
	return caps
}

func (readsbAdapter) StatusFromStats(_ identProducer, stats producerStatsJSON) (identStatus, []diagnostic, bool) {
	status := newIdentStatus()
	var diagnostics []diagnostic
	if stats.Last1Min.MessagesValid != nil {
		if rate, basisSec, ok := statsWindowRate(stats.Last1Min, *stats.Last1Min.MessagesValid); ok {
			status.MessageRate = messageRateProvided("stats_last1min_messages_valid", messageRateStatusValue{Hz: rate, BasisSec: basisSec})
		} else {
			status.MessageRate = messageRateUnavailable(reasonMalformedFile)
			diagnostics = append(diagnostics, warningDiagnostic("stats", "stats.readsb.missing_window_duration", "stats window is missing start/end"))
		}
	}
	if stats.GainDB != nil {
		status.Gain = gainProvided("top_level", gainStatusValue{DB: *stats.GainDB})
	}
	if stats.Now != nil && stats.Total.Start != nil {
		status.Uptime = uptimeProvided("stats_now_minus_total_start", uptimeStatusValue{Sec: *stats.Now - *stats.Total.Start, Subject: "receiver"})
	}
	if stats.MaxDistance != nil && numberIsFinite(*stats.MaxDistance) {
		status.MaxRange = maxRangeProvided("stats_max_distance_meters", maxRangeStatusValue{
			NM:          *stats.MaxDistance / metersPerNm,
			Scope:       "stats",
			Computation: "producer_reported_distance",
		})
	}
	if receiverStats, statsDiagnostics, ok := receiverStatsFromStats(stats); ok {
		status.Stats = &receiverStats
	} else {
		diagnostics = append(diagnostics, statsDiagnostics...)
	}
	return status, diagnostics, status.MessageRate != nil || status.Gain != nil || status.Uptime != nil || status.MaxRange != nil || status.Stats != nil
}

func (readsbAdapter) AircraftFrame(frame producerAircraftJSON) (identAircraftFrame, []diagnostic, bool) {
	return commonAircraftFrame(frame)
}

func (readsbAdapter) AircraftCounter(frame producerAircraftJSON) (aircraftCounterSample, bool) {
	return topLevelAircraftCounter(frame)
}

func (readsbAdapter) RangeOutline(outline producerOutlineJSON) (identRangeOutline, []diagnostic, bool) {
	return commonRangeOutline(outline)
}
