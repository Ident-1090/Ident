package main

import "encoding/json"

type producerAdapter interface {
	Kind() identProducerKind
	Detect(evidence producerEvidence) producerCandidate
	Capabilities(evidence producerEvidence) identCapabilities
	StatusFromStats(producer identProducer, stats producerStatsJSON) (identStatus, []diagnostic, bool)
	AircraftFrame(frame producerAircraftJSON) (identAircraftFrame, []diagnostic, bool)
	AircraftCounter(frame producerAircraftJSON) (aircraftCounterSample, bool)
	RangeOutline(outline producerOutlineJSON) (identRangeOutline, []diagnostic, bool)
}

type producerEvidence struct {
	Receiver *producerReceiverJSON
	Stats    *producerStatsJSON
	Aircraft *producerAircraftJSON
	Outline  *producerOutlineJSON
}

type producerCandidate struct {
	Producer     identProducer
	Score        int
	Capabilities identCapabilities
	Evidence     []string
}

func (c producerCandidate) Kind() identProducerKind {
	if c.Producer.Kind != "" {
		return c.Producer.Kind
	}
	return producerUnknown
}

type identProducer struct {
	Kind    identProducerKind `json:"kind"`
	Version string            `json:"version,omitempty"`
}

type identProducerKind string

const (
	producerReadsb      identProducerKind = "readsb"
	producerDump1090FA  identProducerKind = "dump1090-fa"
	producerSkyaware978 identProducerKind = "skyaware978"
	producerUnknown     identProducerKind = "unknown"
)

type identCapabilities struct {
	Aircraft         capabilitySource `json:"aircraft"`
	ReceiverPosition capabilitySource `json:"receiverPosition"`
	MessageRate      capabilitySource `json:"messageRate"`
	Gain             capabilitySource `json:"gain"`
	Uptime           capabilitySource `json:"uptime"`
	MaxRange         capabilitySource `json:"maxRange"`
	RangeOutline     capabilitySource `json:"rangeOutline"`
	Meteorology      capabilitySource `json:"meteorology"`
	Replay           capabilitySource `json:"replay"`
	Trails           capabilitySource `json:"trails"`
}

type capabilitySource string

const (
	capabilityProducerProvided capabilitySource = "producer_provided"
	capabilityIdentDerived     capabilitySource = "ident_derived"
	capabilityUnavailable      capabilitySource = "unavailable"
)

type capabilitiesPayload struct {
	Schema       string            `json:"schema"`
	Producer     identProducer     `json:"producer"`
	Capabilities identCapabilities `json:"capabilities"`
}

type identStatus struct {
	Schema           string                 `json:"schema"`
	ObservedAt       *observedAtValue       `json:"observedAt"`
	Freshness        freshness              `json:"freshness"`
	ReceiverPosition *receiverPositionValue `json:"receiverPosition,omitempty"`
	MessageRate      *messageRateValue      `json:"messageRate,omitempty"`
	Gain             *gainValue             `json:"gain,omitempty"`
	Uptime           *uptimeValue           `json:"uptime,omitempty"`
	MaxRange         *maxRangeValue         `json:"maxRange,omitempty"`
	Stats            *receiverStatsStatus   `json:"stats,omitempty"`
}

func newIdentStatus() identStatus {
	return identStatus{
		Schema: "ident.status.v1",
	}
}

type statusValue interface {
	statusValue()
}

type statusValueKind string

const (
	statusValueProducerProvided statusValueKind = "producer_provided"
	statusValueIdentDerived     statusValueKind = "ident_derived"
	statusValueUnavailable      statusValueKind = "unavailable"
)

type producerProvidedValue[T any] struct {
	Kind   statusValueKind `json:"kind"`
	Source string          `json:"source"`
	Value  T               `json:"value"`
}

func (producerProvidedValue[T]) statusValue() {}

type derivedValue[T any] struct {
	Kind   statusValueKind `json:"kind"`
	Source string          `json:"source"`
	Value  T               `json:"value"`
}

func (derivedValue[T]) statusValue() {}

func producerProvided[T any](source string, value T) producerProvidedValue[T] {
	return producerProvidedValue[T]{
		Kind:   statusValueProducerProvided,
		Source: source,
		Value:  value,
	}
}

func identDerived[T any](source string, value T) derivedValue[T] {
	return derivedValue[T]{
		Kind:   statusValueIdentDerived,
		Source: source,
		Value:  value,
	}
}

// Per-slot wrapper types make each identStatus field carry a payload type
// that is incompatible with the others. Constructors are the only way to
// build a wrapper, and each constructor's parameter list pins the inner
// payload shape, so the compiler rejects cross-slot assignments such as
// `status.MessageRate = gainProvided(...)`. The wrappers forward MarshalJSON
// to the wrapped statusValue so the wire shape is identical to the previous
// interface-typed encoding.

type observedAtValue struct{ inner statusValue }

func (v *observedAtValue) MarshalJSON() ([]byte, error) { return json.Marshal(v.inner) }

func observedAtProvided(source string, value observedAtStatusValue) *observedAtValue {
	return &observedAtValue{inner: producerProvided(source, value)}
}

func observedAtDerived(source string, value observedAtStatusValue) *observedAtValue {
	return &observedAtValue{inner: identDerived(source, value)}
}

type receiverPositionValue struct{ inner statusValue }

func (v *receiverPositionValue) MarshalJSON() ([]byte, error) { return json.Marshal(v.inner) }

func receiverPositionProvided(source string, value receiverPositionStatusValue) *receiverPositionValue {
	return &receiverPositionValue{inner: producerProvided(source, value)}
}

type messageRateValue struct{ inner statusValue }

func (v *messageRateValue) MarshalJSON() ([]byte, error) { return json.Marshal(v.inner) }

func messageRateProvided(source string, value messageRateStatusValue) *messageRateValue {
	return &messageRateValue{inner: producerProvided(source, value)}
}

func messageRateDerived(source string, value messageRateStatusValue) *messageRateValue {
	return &messageRateValue{inner: identDerived(source, value)}
}

func messageRateUnavailable(reason unavailableReason) *messageRateValue {
	return &messageRateValue{inner: unavailableValue{Kind: statusValueUnavailable, Reason: reason}}
}

type gainValue struct{ inner statusValue }

func (v *gainValue) MarshalJSON() ([]byte, error) { return json.Marshal(v.inner) }

func gainProvided(source string, value gainStatusValue) *gainValue {
	return &gainValue{inner: producerProvided(source, value)}
}

type uptimeValue struct{ inner statusValue }

func (v *uptimeValue) MarshalJSON() ([]byte, error) { return json.Marshal(v.inner) }

func uptimeProvided(source string, value uptimeStatusValue) *uptimeValue {
	return &uptimeValue{inner: producerProvided(source, value)}
}

type maxRangeValue struct{ inner statusValue }

func (v *maxRangeValue) MarshalJSON() ([]byte, error) { return json.Marshal(v.inner) }

func maxRangeProvided(source string, value maxRangeStatusValue) *maxRangeValue {
	return &maxRangeValue{inner: producerProvided(source, value)}
}

type receiverMetricValue struct{ inner statusValue }

func (v *receiverMetricValue) MarshalJSON() ([]byte, error) { return json.Marshal(v.inner) }

func receiverMetricProvided(source string, value float64) *receiverMetricValue {
	return &receiverMetricValue{inner: producerProvided(source, value)}
}

func receiverMetricDerived(source string, value float64) *receiverMetricValue {
	return &receiverMetricValue{inner: identDerived(source, value)}
}

type observedAtStatusValue struct {
	EpochSec float64 `json:"epochSec"`
}

type receiverPositionStatusValue struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

type messageRateStatusValue struct {
	Hz       float64 `json:"hz"`
	BasisSec float64 `json:"basisSec"`
}

type gainStatusValue struct {
	DB float64 `json:"db"`
}

type uptimeStatusValue struct {
	Sec     float64 `json:"sec"`
	Subject string  `json:"subject"`
}

type maxRangeStatusValue struct {
	NM          float64 `json:"nm"`
	Scope       string  `json:"scope"`
	Computation string  `json:"computation"`
}

type receiverStatsStatus struct {
	SignalDBFS  *receiverMetricValue `json:"signalDbfs,omitempty"`
	NoiseDBFS   *receiverMetricValue `json:"noiseDbfs,omitempty"`
	StrongPct   *receiverMetricValue `json:"strongPct,omitempty"`
	SampleDrops *receiverMetricValue `json:"sampleDrops,omitempty"`
	CPUPct      *receiverMetricValue `json:"cpuPct,omitempty"`
	RAMPct      *receiverMetricValue `json:"ramPct,omitempty"`
}

type unavailableValue struct {
	Kind   statusValueKind   `json:"kind"`
	Reason unavailableReason `json:"reason"`
}

func (unavailableValue) statusValue() {}

type unavailableReason string

const (
	reasonNotProvidedByProducer  unavailableReason = "not_provided_by_producer"
	reasonAwaitingClassification unavailableReason = "awaiting_classification"
	reasonAwaitingSecondSample   unavailableReason = "awaiting_second_sample"
	reasonProducerChanged        unavailableReason = "producer_changed"
	reasonCounterReset           unavailableReason = "counter_reset"
	reasonClockNotAdvanced       unavailableReason = "clock_not_advanced"
	reasonStaleSample            unavailableReason = "stale_sample"
	reasonMalformedFile          unavailableReason = "malformed_file"
)

type freshness struct {
	AircraftAgeSec         *float64 `json:"aircraftAgeSec"`
	StatsAgeSec            *float64 `json:"statsAgeSec"`
	ReceiverObservedAgeSec *float64 `json:"receiverObservedAgeSec"`
}

type producerReceiverJSON struct {
	Version string   `json:"version"`
	Readsb  bool     `json:"readsb"`
	Refresh *float64 `json:"refresh"`
	History *int     `json:"history"`
	Lat     *float64 `json:"lat"`
	Lon     *float64 `json:"lon"`
}

type producerStatsJSON struct {
	Now         *float64            `json:"now"`
	GainDB      *float64            `json:"gain_db"`
	MaxDistance *float64            `json:"max_distance"`
	Latest      producerStatsWindow `json:"latest"`
	Last1Min    producerStatsWindow `json:"last1min"`
	Last5Min    producerStatsWindow `json:"last5min"`
	Last15Min   producerStatsWindow `json:"last15min"`
	Total       producerStatsWindow `json:"total"`
}

type producerStatsWindow struct {
	Start         *float64               `json:"start"`
	End           *float64               `json:"end"`
	Messages      *float64               `json:"messages"`
	MessagesValid *float64               `json:"messages_valid"`
	MaxDistance   *float64               `json:"max_distance"`
	Local         producerStatsLocalJSON `json:"local"`
}

type producerStatsLocalJSON struct {
	GainDB         *float64 `json:"gain_db"`
	Signal         *float64 `json:"signal"`
	Noise          *float64 `json:"noise"`
	StrongSignals  *float64 `json:"strong_signals"`
	SamplesDropped *float64 `json:"samples_dropped"`
	SamplesLost    *float64 `json:"samples_lost"`
}

type producerOutlineJSON struct {
	Points      [][]float64                      `json:"points"`
	ActualRange map[string]producerOutlineBucket `json:"actualRange"`
}

type producerOutlineBucket struct {
	Points [][]float64 `json:"points"`
}

type rangeOutlineSource string
type rangeOutlineScope string

const (
	rangeOutlineSourceOutlineJSON rangeOutlineSource = "outline_json"

	rangeOutlineScopeLast24h rangeOutlineScope = "last24h"
	rangeOutlineScopeAlltime rangeOutlineScope = "alltime"
	rangeOutlineScopePoints  rangeOutlineScope = "points"
	rangeOutlineScopeOther   rangeOutlineScope = "other"
)

type identRangeOutline struct {
	Schema             string             `json:"schema"`
	ObservedAtEpochSec float64            `json:"observedAtEpochSec"`
	Source             rangeOutlineSource `json:"source"`
	Scope              rangeOutlineScope  `json:"scope"`
	Coordinates        [][]float64        `json:"coordinates"`
}

type producerAircraftJSON struct {
	Now      *float64           `json:"now"`
	Messages *float64           `json:"messages"`
	Aircraft []producerAircraft `json:"aircraft"`
}

type identAircraftFrame struct {
	Schema             string          `json:"schema"`
	ObservedAtEpochSec float64         `json:"observedAtEpochSec"`
	FrameMessagesTotal *float64        `json:"frameMessagesTotal,omitempty"`
	Aircraft           []identAircraft `json:"aircraft"`
}

// IDKind describes the aircraft address shape. Source describes how the
// upstream acquired the track; the two axes are related but independent.
type identAircraft struct {
	Hex            string              `json:"hex"`
	IDKind         identAircraftIDKind `json:"idKind"`
	Source         identAircraftSource `json:"source"`
	Flight         string              `json:"flight,omitempty"`
	Registration   string              `json:"reg,omitempty"`
	TypeDesignator string              `json:"typeDesignator,omitempty"`
	Description    string              `json:"desc,omitempty"`
	Operator       string              `json:"op,omitempty"`
	Category       string              `json:"cat,omitempty"`

	Lat        *float64 `json:"lat,omitempty"`
	Lon        *float64 `json:"lon,omitempty"`
	SeenPosSec *float64 `json:"seenPosSec,omitempty"`
	Nic        *int     `json:"nic,omitempty"`
	RcM        *float64 `json:"rcM,omitempty"`

	// OnGround is the aircraft state used for trail segmentation. AltBaroFt is
	// only the barometric altitude measurement when one is available.
	AltBaroFt *float64 `json:"altBaroFt,omitempty"`
	AltGeomFt *float64 `json:"altGeomFt,omitempty"`
	OnGround  *bool    `json:"onGround,omitempty"`

	GsKt            *float64 `json:"gsKt,omitempty"`
	IasKt           *float64 `json:"iasKt,omitempty"`
	TasKt           *float64 `json:"tasKt,omitempty"`
	Mach            *float64 `json:"mach,omitempty"`
	TrackDeg        *float64 `json:"trackDeg,omitempty"`
	CalcTrackDeg    *float64 `json:"calcTrackDeg,omitempty"`
	TrackRateDegSec *float64 `json:"trackRateDegSec,omitempty"`
	RollDeg         *float64 `json:"rollDeg,omitempty"`
	MagHeadingDeg   *float64 `json:"magHeadingDeg,omitempty"`
	TrueHeadingDeg  *float64 `json:"trueHeadingDeg,omitempty"`
	BaroRateFpm     *float64 `json:"baroRateFpm,omitempty"`
	GeomRateFpm     *float64 `json:"geomRateFpm,omitempty"`

	// OAT is outside air temperature; TAT is total air temperature.
	WindDirDeg *float64 `json:"windDirDeg,omitempty"`
	WindKt     *float64 `json:"windKt,omitempty"`
	OatC       *float64 `json:"oatC,omitempty"`
	TatC       *float64 `json:"tatC,omitempty"`
	PressHPa   *float64 `json:"pressHPa,omitempty"`
	Humidity   *float64 `json:"humidity,omitempty"`
	Turb       string   `json:"turb,omitempty"`
	MrarSource string   `json:"mrarSource,omitempty"`

	Squawk    string `json:"squawk,omitempty"`
	Emergency string `json:"emergency,omitempty"`
	Alert     *bool  `json:"alert,omitempty"`
	Spi       *bool  `json:"spi,omitempty"`

	QnhHPa    *float64 `json:"qnhHPa,omitempty"`
	McpAltFt  *float64 `json:"mcpAltFt,omitempty"`
	FmsAltFt  *float64 `json:"fmsAltFt,omitempty"`
	NavHdgDeg *float64 `json:"navHdgDeg,omitempty"`
	NavModes  []string `json:"navModes,omitempty"`

	AdsbVersion *int   `json:"adsbVersion,omitempty"`
	UatVersion  *int   `json:"uatVersion,omitempty"`
	NicBaro     *int   `json:"nicBaro,omitempty"`
	NacP        *int   `json:"nacP,omitempty"`
	NacV        *int   `json:"nacV,omitempty"`
	Sil         *int   `json:"sil,omitempty"`
	SilType     string `json:"silType,omitempty"`
	Gva         *int   `json:"gva,omitempty"`
	Sda         *int   `json:"sda,omitempty"`

	// Message totals are cumulative for the upstream process and reset when
	// that process restarts or changes.
	AircraftMessagesTotal *float64 `json:"aircraftMessagesTotal,omitempty"`
	SeenSec               *float64 `json:"seenSec,omitempty"`
	RssiDbfs              *float64 `json:"rssiDbfs,omitempty"`
	DbFlags               *uint16  `json:"dbFlags,omitempty"`
	MlatFields            []string `json:"mlatFields,omitempty"`
	TisbFields            []string `json:"tisbFields,omitempty"`
}

type identAircraftIDKind string

const (
	identAircraftIDICAO    identAircraftIDKind = "icao"
	identAircraftIDNonICAO identAircraftIDKind = "non_icao"
	identAircraftIDUnknown identAircraftIDKind = "unknown"
)

type identAircraftSource string

const (
	aircraftSourceADSBICAO      identAircraftSource = "adsb_icao"
	aircraftSourceADSBICAONT    identAircraftSource = "adsb_icao_nt"
	aircraftSourceADSRICAO      identAircraftSource = "adsr_icao"
	aircraftSourceTISBICAO      identAircraftSource = "tisb_icao"
	aircraftSourceADSBOther     identAircraftSource = "adsb_other"
	aircraftSourceADSROther     identAircraftSource = "adsr_other"
	aircraftSourceTISBOther     identAircraftSource = "tisb_other"
	aircraftSourceTISBTrackfile identAircraftSource = "tisb_trackfile"
	aircraftSourceModeS         identAircraftSource = "mode_s"
	aircraftSourceModeAC        identAircraftSource = "mode_ac"
	aircraftSourceMLAT          identAircraftSource = "mlat"
	aircraftSourceUnknown       identAircraftSource = "unknown"
)

type producerAircraft struct {
	Hex            string          `json:"hex"`
	Type           string          `json:"type"`
	Flight         string          `json:"flight"`
	Registration   string          `json:"r"`
	TypeDesignator string          `json:"t"`
	Desc           string          `json:"desc"`
	Operator       string          `json:"ownOp"`
	Category       string          `json:"category"`
	Lat            *float64        `json:"lat"`
	Lon            *float64        `json:"lon"`
	SeenPos        *float64        `json:"seen_pos"`
	NIC            *int            `json:"nic"`
	RC             *float64        `json:"rc"`
	AltBaro        json.RawMessage `json:"alt_baro"`
	AltGeom        *float64        `json:"alt_geom"`
	Ground         *bool           `json:"ground"`
	Airground      json.RawMessage `json:"airground"`
	GS             *float64        `json:"gs"`
	IAS            *float64        `json:"ias"`
	TAS            *float64        `json:"tas"`
	Mach           *float64        `json:"mach"`
	Track          *float64        `json:"track"`
	CalcTrack      *float64        `json:"calc_track"`
	TrackRate      *float64        `json:"track_rate"`
	Roll           *float64        `json:"roll"`
	MagHeading     *float64        `json:"mag_heading"`
	TrueHeading    *float64        `json:"true_heading"`
	BaroRate       *float64        `json:"baro_rate"`
	GeomRate       *float64        `json:"geom_rate"`
	WD             *float64        `json:"wd"`
	WS             *float64        `json:"ws"`
	OAT            *float64        `json:"oat"`
	TAT            *float64        `json:"tat"`
	WindSpeed      *float64        `json:"wind_speed"`
	WindDir        *float64        `json:"wind_dir"`
	Temperature    *float64        `json:"temperature"`
	Pressure       *float64        `json:"pressure"`
	Humidity       *float64        `json:"humidity"`
	Turbulence     string          `json:"turbulence"`
	MRARSource     string          `json:"mrar_source"`
	Squawk         string          `json:"squawk"`
	Emergency      string          `json:"emergency"`
	Alert          json.RawMessage `json:"alert"`
	SPI            json.RawMessage `json:"spi"`
	NavQNH         *float64        `json:"nav_qnh"`
	NavAltMCP      *float64        `json:"nav_altitude_mcp"`
	NavAltFMS      *float64        `json:"nav_altitude_fms"`
	NavHeading     *float64        `json:"nav_heading"`
	NavModes       []string        `json:"nav_modes"`
	Version        *int            `json:"version"`
	UATVersion     *int            `json:"uat_version"`
	NICBaro        *int            `json:"nic_baro"`
	NACP           *int            `json:"nac_p"`
	NACV           *int            `json:"nac_v"`
	SIL            *int            `json:"sil"`
	SILType        string          `json:"sil_type"`
	GVA            *int            `json:"gva"`
	SDA            *int            `json:"sda"`
	Messages       *float64        `json:"messages"`
	Seen           *float64        `json:"seen"`
	RSSI           *float64        `json:"rssi"`
	DBFlags        *uint16         `json:"dbFlags"`
	MLAT           []string        `json:"mlat"`
	TISB           []string        `json:"tisb"`
}

type aircraftCounterSample struct {
	now      float64
	messages float64
	producer identProducer
}
