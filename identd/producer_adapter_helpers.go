package main

import (
	"encoding/json"
	"log/slog"
	"math"
	"sort"
	"strings"
)

const (
	metersPerNm               = 1852
	nmPerRadian               = (180 * 60) / math.Pi
	identAircraftLostAfterSec = 30
)

func commonProducerCapabilitiesFromEvidence(evidence producerEvidence) identCapabilities {
	if evidence.Receiver == nil {
		return commonProducerCapabilities(producerReceiverJSON{})
	}
	return commonProducerCapabilities(*evidence.Receiver)
}

func commonProducerCapabilities(receiver producerReceiverJSON) identCapabilities {
	receiverPosition := capabilityUnavailable
	if receiver.Lat != nil && receiver.Lon != nil {
		receiverPosition = capabilityProducerProvided
	}
	return identCapabilities{
		Aircraft:         capabilityProducerProvided,
		ReceiverPosition: receiverPosition,
		MessageRate:      capabilityUnavailable,
		Gain:             capabilityUnavailable,
		Uptime:           capabilityUnavailable,
		MaxRange:         capabilityUnavailable,
		RangeOutline:     capabilityUnavailable,
		Meteorology:      capabilityUnavailable,
		Replay:           capabilityUnavailable,
		Trails:           capabilityIdentDerived,
	}
}

func producerVersionFromEvidence(evidence producerEvidence) string {
	if evidence.Receiver == nil {
		return ""
	}
	return evidence.Receiver.Version
}

func topLevelAircraftCounter(frame producerAircraftJSON) (aircraftCounterSample, bool) {
	if frame.Now == nil || frame.Messages == nil {
		return aircraftCounterSample{}, false
	}
	return aircraftCounterSample{now: *frame.Now, messages: *frame.Messages}, true
}

func commonAircraftFrame(frame producerAircraftJSON) (identAircraftFrame, []diagnostic, bool) {
	if frame.Now == nil || frame.Aircraft == nil {
		return identAircraftFrame{}, nil, false
	}
	aircraft := make([]identAircraft, 0, len(frame.Aircraft))
	diagnostics := []diagnostic{}
	for _, ac := range frame.Aircraft {
		if producerAircraftLost(ac) {
			continue
		}
		normalized, rowDiagnostics, ok := normalizeProducerAircraft(ac)
		if ok {
			aircraft = append(aircraft, normalized)
		}
		diagnostics = append(diagnostics, rowDiagnostics...)
	}
	return identAircraftFrame{
		Schema:             "ident.aircraft.v1",
		ObservedAtEpochSec: *frame.Now,
		FrameMessagesTotal: frame.Messages,
		Aircraft:           aircraft,
	}, diagnostics, true
}

func producerAircraftLost(ac producerAircraft) bool {
	if ac.Seen == nil || math.IsNaN(*ac.Seen) || math.IsInf(*ac.Seen, 0) {
		return false
	}
	return *ac.Seen > identAircraftLostAfterSec
}

func normalizeProducerAircraft(ac producerAircraft) (identAircraft, []diagnostic, bool) {
	hex := strings.ToLower(strings.TrimSpace(ac.Hex))
	if hex == "" {
		return identAircraft{}, nil, false
	}
	altBaroFt, groundFromAltBaro, altBaroDiagnostic := normalizeBaroAltitude(hex, ac.AltBaro)
	onGround := normalizeGround(ac.Ground, groundFromAltBaro, ac.Airground)
	alert, alertDiagnostic := normalizeBoolField(hex, ac.Alert, "alert")
	spi, spiDiagnostic := normalizeBoolField(hex, ac.SPI, "spi")
	diagnostics := []diagnostic{}
	if altBaroDiagnostic != nil {
		diagnostics = append(diagnostics, *altBaroDiagnostic)
	}
	if alertDiagnostic != nil {
		diagnostics = append(diagnostics, *alertDiagnostic)
	}
	if spiDiagnostic != nil {
		diagnostics = append(diagnostics, *spiDiagnostic)
	}
	return identAircraft{
		Hex:                   hex,
		IDKind:                aircraftIDKind(hex),
		Source:                aircraftSource(ac.Type),
		Flight:                strings.TrimSpace(ac.Flight),
		Registration:          strings.TrimSpace(ac.Registration),
		TypeDesignator:        strings.TrimSpace(ac.TypeDesignator),
		Description:           strings.TrimSpace(ac.Desc),
		Operator:              strings.TrimSpace(ac.Operator),
		Category:              strings.TrimSpace(ac.Category),
		Lat:                   finitePointer(ac.Lat),
		Lon:                   finitePointer(ac.Lon),
		SeenPosSec:            finitePointer(ac.SeenPos),
		Nic:                   ac.NIC,
		RcM:                   finitePointer(ac.RC),
		AltBaroFt:             altBaroFt,
		AltGeomFt:             finitePointer(ac.AltGeom),
		OnGround:              onGround,
		GsKt:                  finitePointer(ac.GS),
		IasKt:                 finitePointer(ac.IAS),
		TasKt:                 finitePointer(ac.TAS),
		Mach:                  finitePointer(ac.Mach),
		TrackDeg:              finitePointer(ac.Track),
		CalcTrackDeg:          finitePointer(ac.CalcTrack),
		TrackRateDegSec:       finitePointer(ac.TrackRate),
		RollDeg:               finitePointer(ac.Roll),
		MagHeadingDeg:         finitePointer(ac.MagHeading),
		TrueHeadingDeg:        finitePointer(ac.TrueHeading),
		BaroRateFpm:           finitePointer(ac.BaroRate),
		GeomRateFpm:           finitePointer(ac.GeomRate),
		WindDirDeg:            finitePointer(firstFloat(ac.WindDir, ac.WD)),
		WindKt:                finitePointer(firstFloat(ac.WindSpeed, ac.WS)),
		OatC:                  finitePointer(firstFloat(ac.Temperature, ac.OAT)),
		TatC:                  finitePointer(ac.TAT),
		PressHPa:              finitePointer(ac.Pressure),
		Humidity:              finitePointer(ac.Humidity),
		Turb:                  strings.TrimSpace(ac.Turbulence),
		MrarSource:            strings.TrimSpace(ac.MRARSource),
		Squawk:                strings.TrimSpace(ac.Squawk),
		Emergency:             strings.TrimSpace(ac.Emergency),
		Alert:                 alert,
		Spi:                   spi,
		QnhHPa:                finitePointer(ac.NavQNH),
		McpAltFt:              finitePointer(ac.NavAltMCP),
		FmsAltFt:              finitePointer(ac.NavAltFMS),
		NavHdgDeg:             finitePointer(ac.NavHeading),
		NavModes:              compactStrings(ac.NavModes),
		AdsbVersion:           ac.Version,
		UatVersion:            ac.UATVersion,
		NicBaro:               ac.NICBaro,
		NacP:                  ac.NACP,
		NacV:                  ac.NACV,
		Sil:                   ac.SIL,
		SilType:               strings.TrimSpace(ac.SILType),
		Gva:                   ac.GVA,
		Sda:                   ac.SDA,
		AircraftMessagesTotal: finitePointer(ac.Messages),
		SeenSec:               finitePointer(ac.Seen),
		RssiDbfs:              finitePointer(ac.RSSI),
		DbFlags:               ac.DBFlags,
		MlatFields:            compactStrings(ac.MLAT),
		TisbFields:            compactStrings(ac.TISB),
	}, diagnostics, true
}

func aircraftIDKind(hex string) identAircraftIDKind {
	if strings.HasPrefix(hex, "~") {
		return identAircraftIDNonICAO
	}
	if len(hex) != 6 {
		return identAircraftIDUnknown
	}
	for _, r := range hex {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return identAircraftIDUnknown
		}
	}
	return identAircraftIDICAO
}

func aircraftSource(raw string) identAircraftSource {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "adsb_icao":
		return aircraftSourceADSBICAO
	case "adsb_icao_nt":
		return aircraftSourceADSBICAONT
	case "adsr_icao":
		return aircraftSourceADSRICAO
	case "tisb_icao":
		return aircraftSourceTISBICAO
	case "adsb_other":
		return aircraftSourceADSBOther
	case "adsr_other":
		return aircraftSourceADSROther
	case "tisb_other":
		return aircraftSourceTISBOther
	case "tisb_trackfile":
		return aircraftSourceTISBTrackfile
	case "mode_s":
		return aircraftSourceModeS
	case "mode_ac":
		return aircraftSourceModeAC
	case "mlat":
		return aircraftSourceMLAT
	default:
		return aircraftSourceUnknown
	}
}

func normalizeBaroAltitude(hex string, raw json.RawMessage) (*float64, *bool, *diagnostic) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil, nil
	}
	var label string
	if err := json.Unmarshal(raw, &label); err == nil {
		if label == "ground" {
			ground := true
			return nil, &ground, nil
		}
		slog.Warn("aircraft adapter: invalid alt_baro string", "hex", hex, "field", "alt_baro", "value", label, "channel", "aircraft", "code", "aircraft.adapter.invalid_altitude")
		d := warningDiagnostic("aircraft", "aircraft.adapter.invalid_altitude", "aircraft alt_baro must be a number or \"ground\"")
		return nil, nil, &d
	}
	var alt float64
	if err := json.Unmarshal(raw, &alt); err != nil || !numberIsFinite(alt) {
		slog.Warn("aircraft adapter: invalid alt_baro value", "hex", hex, "field", "alt_baro", "raw", string(raw), "channel", "aircraft", "code", "aircraft.adapter.invalid_altitude")
		d := warningDiagnostic("aircraft", "aircraft.adapter.invalid_altitude", "aircraft alt_baro must be a number or \"ground\"")
		return nil, nil, &d
	}
	return &alt, nil, nil
}

func normalizeGround(primary *bool, fromAltBaro *bool, airground json.RawMessage) *bool {
	if primary != nil {
		return primary
	}
	if fromAltBaro != nil {
		return fromAltBaro
	}
	if len(airground) == 0 || string(airground) == "null" {
		return nil
	}
	var label string
	if err := json.Unmarshal(airground, &label); err == nil {
		switch strings.ToLower(strings.TrimSpace(label)) {
		case "ground":
			ground := true
			return &ground
		case "airborne":
			ground := false
			return &ground
		}
	}
	var value float64
	if err := json.Unmarshal(airground, &value); err == nil {
		ground := value == 1
		return &ground
	}
	return nil
}

func normalizeBoolField(hex string, raw json.RawMessage, field string) (*bool, *diagnostic) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var b bool
	if err := json.Unmarshal(raw, &b); err == nil {
		return &b, nil
	}
	var n float64
	if err := json.Unmarshal(raw, &n); err == nil {
		if n == 0 {
			b = false
			return &b, nil
		}
		if n == 1 {
			b = true
			return &b, nil
		}
	}
	slog.Warn("aircraft adapter: invalid bool field", "hex", hex, "field", field, "raw", string(raw), "channel", "aircraft", "code", "aircraft.adapter.invalid_bool")
	d := warningDiagnostic("aircraft", "aircraft.adapter.invalid_bool", "aircraft "+field+" value must be boolean or 0/1")
	return nil, &d
}

func firstFloat(primary, fallback *float64) *float64 {
	if primary != nil {
		return primary
	}
	return fallback
}

func compactStrings(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	out := make([]string, 0, len(in))
	for _, v := range in {
		v = strings.TrimSpace(v)
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}

func commonRangeOutline(outline producerOutlineJSON) (identRangeOutline, []diagnostic, bool) {
	scope, points, ok := producerOutlinePoints(outline)
	if !ok {
		slog.Warn("outline adapter: malformed polygon", "channel", "outline", "code", "outline.adapter.malformed_outline")
		return identRangeOutline{}, []diagnostic{
			warningDiagnostic("outline", "outline.adapter.malformed_outline", "outline.json did not contain a valid polygon"),
		}, false
	}
	coordinates := make([][]float64, 0, len(points))
	for _, point := range points {
		if len(point) < 2 || !numberIsFinite(point[0]) || !numberIsFinite(point[1]) {
			continue
		}
		coordinates = append(coordinates, []float64{point[1], point[0]})
	}
	if len(coordinates) < 3 {
		slog.Warn("outline adapter: too few valid vertices", "scope", scope, "received", len(points), "valid", len(coordinates), "channel", "outline", "code", "outline.adapter.malformed_outline")
		return identRangeOutline{}, []diagnostic{
			warningDiagnostic("outline", "outline.adapter.malformed_outline", "outline.json did not contain enough valid vertices"),
		}, false
	}
	return identRangeOutline{
		Schema:      "ident.rangeOutline.v1",
		Source:      rangeOutlineSourceOutlineJSON,
		Scope:       scope,
		Coordinates: coordinates,
	}, nil, true
}

func producerOutlinePoints(outline producerOutlineJSON) (rangeOutlineScope, [][]float64, bool) {
	if outline.ActualRange != nil {
		for _, scope := range []rangeOutlineScope{rangeOutlineScopeLast24h, rangeOutlineScopeAlltime} {
			if bucket, ok := outline.ActualRange[string(scope)]; ok && len(bucket.Points) >= 3 {
				return scope, bucket.Points, true
			}
		}
		keys := make([]string, 0, len(outline.ActualRange))
		for key := range outline.ActualRange {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			bucket := outline.ActualRange[key]
			if len(bucket.Points) >= 3 {
				return rangeOutlineScopeOther, bucket.Points, true
			}
		}
	}
	if len(outline.Points) >= 3 {
		return rangeOutlineScopePoints, outline.Points, true
	}
	return "", nil, false
}

func outlineMaxRangeNm(receiver producerReceiverJSON, outline identRangeOutline) (float64, bool) {
	if receiver.Lat == nil || receiver.Lon == nil {
		return 0, false
	}
	var maxNm float64
	for _, coordinate := range outline.Coordinates {
		if len(coordinate) < 2 || !numberIsFinite(coordinate[0]) || !numberIsFinite(coordinate[1]) {
			continue
		}
		nm := haversineNm(*receiver.Lat, *receiver.Lon, coordinate[1], coordinate[0])
		if nm > maxNm {
			maxNm = nm
		}
	}
	return maxNm, maxNm > 0
}

func haversineNm(lat1, lon1, lat2, lon2 float64) float64 {
	phi1 := lat1 * math.Pi / 180
	phi2 := lat2 * math.Pi / 180
	dPhi := (lat2 - lat1) * math.Pi / 180
	dLambda := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dPhi/2)*math.Sin(dPhi/2) + math.Cos(phi1)*math.Cos(phi2)*math.Sin(dLambda/2)*math.Sin(dLambda/2)
	return 2 * math.Asin(math.Min(1, math.Sqrt(a))) * nmPerRadian
}

func statsWindowRate(window producerStatsWindow, messages float64) (float64, float64, bool) {
	seconds, ok := statsWindowSeconds(window)
	if !ok || seconds <= 0 {
		return 0, 0, false
	}
	return messages / seconds, seconds, true
}

func statsWindowSeconds(window producerStatsWindow) (float64, bool) {
	if window.Start == nil || window.End == nil {
		return 0, false
	}
	seconds := *window.End - *window.Start
	if seconds <= 0 || !numberIsFinite(seconds) {
		return 0, false
	}
	return seconds, true
}

func receiverStatsFromStats(stats producerStatsJSON) (receiverStatsStatus, []diagnostic, bool) {
	local := stats.Last1Min.Local
	value := receiverStatsStatus{}
	if signal := finitePointer(local.Signal); signal != nil {
		value.SignalDBFS = receiverMetricProvided("stats_last1min_local", *signal)
	}
	if noise := finitePointer(local.Noise); noise != nil {
		value.NoiseDBFS = receiverMetricProvided("stats_last1min_local", *noise)
	}
	if local.StrongSignals != nil {
		denominator := firstFinite(stats.Last1Min.MessagesValid, stats.Last1Min.Messages)
		if denominator != nil && *denominator > 0 {
			strongPct := (*local.StrongSignals / *denominator) * 100
			if strong := finitePointer(&strongPct); strong != nil {
				value.StrongPct = receiverMetricProvided("stats_last1min_local", *strong)
			}
		}
	}
	if sampleDrops := sumFinite(local.SamplesDropped, local.SamplesLost); sampleDrops != nil {
		value.SampleDrops = receiverMetricProvided("stats_last1min_local", *sampleDrops)
	}
	ok := value.SignalDBFS != nil ||
		value.NoiseDBFS != nil ||
		value.StrongPct != nil ||
		value.SampleDrops != nil
	if !ok && receiverStatsInputPresent(local) {
		slog.Warn("producer stats: malformed signal stats", "channel", "stats", "code", "stats.adapter.malformed_signal_stats")
		return value, []diagnostic{warningDiagnostic("stats", "stats.adapter.malformed_signal_stats", "stats local signal fields could not be normalized")}, false
	}
	return value, nil, ok
}

func receiverStatsInputPresent(local producerStatsLocalJSON) bool {
	return local.Signal != nil ||
		local.Noise != nil ||
		local.StrongSignals != nil ||
		local.SamplesDropped != nil ||
		local.SamplesLost != nil
}

func firstFinite(values ...*float64) *float64 {
	for _, value := range values {
		if finite := finitePointer(value); finite != nil {
			return finite
		}
	}
	return nil
}

func sumFinite(values ...*float64) *float64 {
	var sum float64
	ok := false
	for _, value := range values {
		finite := finitePointer(value)
		if finite == nil {
			continue
		}
		sum += *finite
		ok = true
	}
	if !ok {
		return nil
	}
	return &sum
}
