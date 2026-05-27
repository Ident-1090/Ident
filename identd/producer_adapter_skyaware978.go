package main

import "strings"

type skyaware978Adapter struct{}

func (skyaware978Adapter) Kind() identProducerKind {
	return producerSkyaware978
}

func (a skyaware978Adapter) Detect(evidence producerEvidence) producerCandidate {
	if evidence.Receiver != nil {
		version := strings.ToLower(strings.TrimSpace(evidence.Receiver.Version))
		if strings.HasPrefix(version, "dump978") {
			return producerCandidate{
				Producer:     identProducer{Kind: producerSkyaware978, Version: evidence.Receiver.Version},
				Score:        100,
				Capabilities: a.Capabilities(evidence),
				Evidence:     []string{"receiver.version.dump978"},
			}
		}
	}
	if aircraftHasUATVersion(evidence.Aircraft) {
		return producerCandidate{
			Producer:     identProducer{Kind: producerSkyaware978, Version: producerVersionFromEvidence(evidence)},
			Score:        70,
			Capabilities: a.Capabilities(evidence),
			Evidence:     []string{"aircraft.uatVersion"},
		}
	}
	return producerCandidate{}
}

func (skyaware978Adapter) Capabilities(evidence producerEvidence) identCapabilities {
	caps := commonProducerCapabilitiesFromEvidence(evidence)
	caps.Gain = capabilityUnavailable
	caps.Uptime = capabilityUnavailable
	return caps
}

func aircraftHasUATVersion(frame *producerAircraftJSON) bool {
	if frame == nil {
		return false
	}
	for _, ac := range frame.Aircraft {
		if ac.UATVersion != nil {
			return true
		}
	}
	return false
}

func (skyaware978Adapter) StatusFromStats(identProducer, producerStatsJSON) (identStatus, []diagnostic, bool) {
	return identStatus{}, nil, false
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
