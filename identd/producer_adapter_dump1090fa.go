package main

import "strings"

type dump1090FAAdapter struct{}

func (dump1090FAAdapter) Kind() identProducerKind {
	return producerDump1090FA
}

func (a dump1090FAAdapter) Detect(evidence producerEvidence) producerCandidate {
	if evidence.Receiver != nil {
		version := strings.ToLower(strings.TrimSpace(evidence.Receiver.Version))
		if evidence.Receiver.Readsb || strings.HasPrefix(version, "dump978") || strings.Contains(version, "mutability") {
			return producerCandidate{}
		}
		if strings.Contains(version, "dump1090-fa") || strings.Contains(version, "flightaware") {
			return producerCandidate{
				Producer:     identProducer{Kind: producerDump1090FA, Version: evidence.Receiver.Version},
				Score:        100,
				Capabilities: a.Capabilities(evidence),
				Evidence:     []string{"receiver.version.dump1090fa"},
			}
		}
	}
	score, signals := dump1090FAEvidenceScore(evidence)
	if score == 0 {
		return producerCandidate{}
	}
	return producerCandidate{
		Producer:     identProducer{Kind: producerDump1090FA, Version: producerVersionFromEvidence(evidence)},
		Score:        score,
		Capabilities: a.Capabilities(evidence),
		Evidence:     signals,
	}
}

func (dump1090FAAdapter) Capabilities(evidence producerEvidence) identCapabilities {
	caps := commonProducerCapabilitiesFromEvidence(evidence)
	if evidence.Stats == nil {
		return caps
	}
	if evidence.Stats.Last1Min.Messages != nil {
		if _, _, ok := statsWindowRate(evidence.Stats.Last1Min, *evidence.Stats.Last1Min.Messages); ok {
			caps.MessageRate = capabilityProducerProvided
		}
	}
	if evidence.Stats.Last1Min.Local.GainDB != nil {
		caps.Gain = capabilityProducerProvided
	}
	if evidence.Stats.Last1Min.End != nil && evidence.Stats.Total.Start != nil {
		caps.Uptime = capabilityProducerProvided
	}
	return caps
}

func dump1090FAEvidenceScore(evidence producerEvidence) (int, []string) {
	score := 0
	var signals []string
	if evidence.Receiver != nil {
		version := strings.ToLower(strings.TrimSpace(evidence.Receiver.Version))
		if evidence.Receiver.Readsb || strings.HasPrefix(version, "dump978") || strings.Contains(version, "mutability") {
			return 0, nil
		}
		if evidence.Receiver.Version != "" && evidence.Receiver.Refresh != nil && evidence.Receiver.History != nil {
			score += 10
			signals = append(signals, "receiver.version_refresh_history")
		}
	}
	stats := evidence.Stats
	if stats == nil {
		return score, signals
	}
	windowCount := 0
	for _, window := range []producerStatsWindow{stats.Latest, stats.Last1Min, stats.Last5Min, stats.Last15Min, stats.Total} {
		if window.Start != nil || window.End != nil || window.Messages != nil || window.Local.GainDB != nil {
			windowCount++
		}
	}
	if windowCount >= 4 && stats.Now == nil && stats.Last1Min.MessagesValid == nil {
		score += 50
		signals = append(signals, "stats.windows")
	}
	if stats.Last1Min.Messages != nil {
		score += 10
		signals = append(signals, "stats.last1min.messages")
	}
	if stats.Last1Min.Local.GainDB != nil {
		score += 5
		signals = append(signals, "stats.last1min.local.gain_db")
	}
	if stats.Last1Min.End != nil && stats.Total.Start != nil {
		score += 5
		signals = append(signals, "stats.uptime_window")
	}
	return score, signals
}

func (dump1090FAAdapter) StatusFromStats(_ identProducer, stats producerStatsJSON) (identStatus, []diagnostic, bool) {
	status := newIdentStatus()
	var diagnostics []diagnostic
	if stats.Last1Min.Messages != nil {
		if rate, basisSec, ok := statsWindowRate(stats.Last1Min, *stats.Last1Min.Messages); ok {
			status.MessageRate = messageRateProvided("stats_last1min_messages", messageRateStatusValue{Hz: rate, BasisSec: basisSec})
		} else {
			status.MessageRate = messageRateUnavailable(reasonMalformedFile)
			diagnostics = append(diagnostics, warningDiagnostic("stats", "stats.dump1090fa.missing_window_duration", "stats window is missing start/end"))
		}
	}
	if stats.Last1Min.Local.GainDB != nil {
		status.Gain = gainProvided("last1min_local", gainStatusValue{DB: *stats.Last1Min.Local.GainDB})
	}
	if stats.Last1Min.End != nil && stats.Total.Start != nil {
		status.Uptime = uptimeProvided("window_end_minus_total_start", uptimeStatusValue{Sec: *stats.Last1Min.End - *stats.Total.Start, Subject: "receiver"})
	}
	if receiverStats, statsDiagnostics, ok := receiverStatsFromStats(stats); ok {
		status.Stats = &receiverStats
	} else {
		diagnostics = append(diagnostics, statsDiagnostics...)
	}
	return status, diagnostics, status.MessageRate != nil || status.Gain != nil || status.Uptime != nil || status.Stats != nil
}

func (dump1090FAAdapter) AircraftFrame(frame producerAircraftJSON) (identAircraftFrame, []diagnostic, bool) {
	return commonAircraftFrame(frame)
}

func (dump1090FAAdapter) AircraftCounter(frame producerAircraftJSON) (aircraftCounterSample, bool) {
	return topLevelAircraftCounter(frame)
}

func (dump1090FAAdapter) RangeOutline(producerOutlineJSON) (identRangeOutline, []diagnostic, bool) {
	return identRangeOutline{}, nil, false
}
