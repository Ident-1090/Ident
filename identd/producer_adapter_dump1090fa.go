package main

import "strings"

type dump1090FAAdapter struct{}

func (dump1090FAAdapter) Kind() identProducerKind {
	return producerDump1090FA
}

func (dump1090FAAdapter) Detect(receiver producerReceiverJSON) (identProducer, bool) {
	version := strings.ToLower(strings.TrimSpace(receiver.Version))
	if receiver.Readsb || version == "" || strings.HasPrefix(version, "dump978") {
		return identProducer{}, false
	}
	if strings.Contains(version, "dump1090-fa") || strings.Contains(version, "flightaware") {
		return identProducer{Kind: producerDump1090FA, Version: receiver.Version}, true
	}
	return identProducer{}, false
}

func (dump1090FAAdapter) Capabilities(receiver producerReceiverJSON) identCapabilities {
	caps := commonProducerCapabilities(receiver)
	caps.MessageRate = capabilityProducerProvided
	caps.Gain = capabilityProducerProvided
	caps.Uptime = capabilityProducerProvided
	caps.MaxRange = capabilityIdentDerived
	return caps
}

func (dump1090FAAdapter) StatusFromStats(producer identProducer, stats producerStatsJSON) (identStatus, bool) {
	status := newIdentStatus(producer)
	if stats.Last1Min.Messages != nil {
		if rate, basisSec, ok := statsWindowRate(stats.Last1Min, *stats.Last1Min.Messages); ok {
			status.MessageRate = messageRateProvided("stats_last1min_messages", messageRateStatusValue{Hz: rate, BasisSec: basisSec})
		} else {
			status.MessageRate = messageRateUnavailable(reasonMalformedFile)
			status.Diagnostics = append(status.Diagnostics, warningDiagnostic("stats", "stats.dump1090fa.missing_window_duration", "stats window is missing start/end"))
		}
	}
	if stats.Last1Min.Local.GainDB != nil {
		status.Gain = gainProvided("last1min_local", gainStatusValue{DB: *stats.Last1Min.Local.GainDB})
	}
	if stats.Last1Min.End != nil && stats.Total.Start != nil {
		status.Uptime = uptimeProvided("window_end_minus_total_start", uptimeStatusValue{Sec: *stats.Last1Min.End - *stats.Total.Start, Subject: "receiver"})
	}
	return status, status.MessageRate != nil || status.Gain != nil || status.Uptime != nil
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
