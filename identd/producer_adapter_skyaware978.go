package main

import "strings"

type skyaware978Adapter struct{}

func (skyaware978Adapter) Kind() identProducerKind {
	return producerSkyaware978
}

func (skyaware978Adapter) Detect(receiver producerReceiverJSON) (identProducer, bool) {
	version := strings.ToLower(strings.TrimSpace(receiver.Version))
	if !strings.HasPrefix(version, "dump978") {
		return identProducer{}, false
	}
	return identProducer{Kind: producerSkyaware978, Version: receiver.Version}, true
}

func (skyaware978Adapter) Capabilities(receiver producerReceiverJSON) identCapabilities {
	caps := commonProducerCapabilities(receiver)
	caps.MessageRate = capabilityIdentDerived
	caps.Gain = capabilityUnavailable
	caps.Uptime = capabilityUnavailable
	caps.MaxRange = capabilityIdentDerived
	return caps
}

func (skyaware978Adapter) StatusFromStats(identProducer, producerStatsJSON) (identStatus, bool) {
	return identStatus{}, false
}

func (skyaware978Adapter) AircraftFrame(frame producerAircraftJSON) (identAircraftFrame, []diagnostic, bool) {
	return commonAircraftFrame(frame)
}

func (skyaware978Adapter) AircraftCounter(frame producerAircraftJSON) (aircraftCounterSample, bool) {
	return topLevelAircraftCounter(frame)
}

func (skyaware978Adapter) RangeOutline(producerOutlineJSON) (identRangeOutline, []diagnostic, bool) {
	return identRangeOutline{}, nil, false
}
