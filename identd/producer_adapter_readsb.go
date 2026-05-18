package main

type readsbAdapter struct{}

func (readsbAdapter) Kind() identProducerKind {
	return producerReadsb
}

func (readsbAdapter) Detect(receiver producerReceiverJSON) (identProducer, bool) {
	if !receiver.Readsb {
		return identProducer{}, false
	}
	return identProducer{Kind: producerReadsb, Version: receiver.Version}, true
}

func (readsbAdapter) Capabilities(receiver producerReceiverJSON) identCapabilities {
	caps := commonProducerCapabilities(receiver)
	caps.MessageRate = capabilityProducerProvided
	caps.Gain = capabilityProducerProvided
	caps.Uptime = capabilityProducerProvided
	caps.MaxRange = capabilityProducerProvided
	caps.RangeOutline = capabilityProducerProvided
	caps.SignalDiagnostics = capabilityProducerProvided
	return caps
}

func (readsbAdapter) StatusFromStats(producer identProducer, stats producerStatsJSON) (identStatus, bool) {
	status := newIdentStatus(producer)
	if stats.Last1Min.MessagesValid != nil {
		if rate, basisSec, ok := statsWindowRate(stats.Last1Min, *stats.Last1Min.MessagesValid); ok {
			status.MessageRate = messageRateProvided("stats_last1min_messages_valid", messageRateStatusValue{Hz: rate, BasisSec: basisSec})
		} else {
			status.MessageRate = messageRateUnavailable(reasonMalformedFile)
			status.Diagnostics = append(status.Diagnostics, warningDiagnostic("stats", "stats.readsb.missing_window_duration", "stats window is missing start/end"))
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
	return status, status.MessageRate != nil || status.Gain != nil || status.Uptime != nil || status.MaxRange != nil
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
