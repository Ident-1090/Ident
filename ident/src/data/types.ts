// Types for producer JSON compatibility plus Ident-owned wire schemas.
// Upstream schema references are structural descriptions, not copied code.

export type AircraftType =
  | "adsb_icao"
  | "adsb_icao_nt"
  | "adsr_icao"
  | "tisb_icao"
  | "mlat"
  | "mode_s"
  | "adsb_other"
  | "adsr_other"
  | "tisb_trackfile"
  | "tisb_other"
  | "mode_ac"
  | "unknown";

export type AircraftIDKind = "icao" | "non_icao" | "unknown";

export interface Aircraft {
  hex: string;
  idKind: AircraftIDKind;
  source: AircraftType;
  flight?: string;
  reg?: string;
  typeDesignator?: string;
  desc?: string;
  op?: string;
  cat?: string;
  lat?: number;
  lon?: number;
  seenPosSec?: number;
  nic?: number;
  rcM?: number;
  altBaroFt?: number;
  altGeomFt?: number;
  onGround?: boolean;
  gsKt?: number;
  iasKt?: number;
  tasKt?: number;
  mach?: number;
  trackDeg?: number;
  calcTrackDeg?: number;
  trackRateDegSec?: number;
  rollDeg?: number;
  magHeadingDeg?: number;
  trueHeadingDeg?: number;
  baroRateFpm?: number;
  geomRateFpm?: number;
  windDirDeg?: number;
  windKt?: number;
  oatC?: number;
  tatC?: number;
  pressHPa?: number;
  humidity?: number;
  turb?: string;
  mrarSource?: string;
  squawk?: string;
  emergency?: string;
  alert?: boolean;
  spi?: boolean;
  qnhHPa?: number;
  mcpAltFt?: number;
  fmsAltFt?: number;
  navHdgDeg?: number;
  navModes?: string[];
  adsbVersion?: number;
  uatVersion?: number;
  nicBaro?: number;
  nacP?: number;
  nacV?: number;
  sil?: number;
  silType?: string;
  gva?: number;
  sda?: number;
  aircraftMessagesTotal?: number;
  seenSec?: number;
  rssiDbfs?: number;
  dbFlags?: number;
  mlatFields?: string[];
  tisbFields?: string[];
  segment?: number;
}

export interface AircraftFrame {
  schema?: string;
  observedAtEpochSec: number;
  frameMessagesTotal?: number;
  aircraft: Aircraft[];
}

export interface ReceiverJson {
  lat: number;
  lon: number;
  version: string;
  refresh?: number;
  history?: number;
  jaeroTimeout?: number;
  readsb?: boolean;
  binCraft?: boolean;
  zstd?: boolean;
  outlineJson?: boolean;
}

export interface StatsLocalJson {
  accepted?: number[];
  signal?: number;
  noise?: number;
  peak_signal?: number;
  strong_signals?: number;
  [k: string]: unknown;
}

export interface StatsCpuJson {
  demod?: number;
  reader?: number;
  background?: number;
  aircraft_json?: number;
  globe_json?: number;
  binCraft?: number;
  trace_json?: number;
  heatmap_and_state?: number;
  api_workers?: number;
  api_update?: number;
  remove_stale?: number;
  [k: string]: number | undefined;
}

export interface StatsWindowJson {
  start?: number;
  end?: number;
  messages_valid?: number;
  max_distance?: number;
  local?: StatsLocalJson;
  cpu?: StatsCpuJson;
  [k: string]: unknown;
}

export type StatsLast1MinJson = StatsWindowJson;

export interface StatsJson {
  now: number;
  gain_db?: number;
  estimated_ppm?: number;
  cpu_load?: number;
  aircraft_with_pos?: number;
  aircraft_without_pos?: number;
  messages?: number;
  max_distance?: number;
  last1min?: StatsWindowJson;
  total?: StatsWindowJson;
  [k: string]: unknown;
}

/**
 * readsb's observed coverage polygon. Each bucket under `actualRange` holds a
 * ring of [lat, lon, maxAltFt] samples — one per 1° of bearing from the site.
 * readsb publishes this authoritatively across all clients and windows; Ident
 * renders it directly rather than rebuilding it per-session.
 */
export interface OutlineRangeBucket {
  points?: Array<[number, number, number]>;
}

export interface OutlineJson {
  points?: Array<[number, number]>;
  actualRange?: {
    alltime?: OutlineRangeBucket;
    last24h?: OutlineRangeBucket;
    [k: string]: OutlineRangeBucket | undefined;
  };
  [k: string]: unknown;
}

export interface IdentRangeOutline {
  schema: "ident.rangeOutline.v1";
  observedAtEpochSec: number;
  source: "outline_json";
  scope: "last24h" | "alltime" | "points" | "other";
  coordinates: Array<[number, number]>;
}

// Semantic aircraft category key used by the rail's FiltersCard.
// The mapping from aircraft.cat (ADS-B A0..C7 letter codes) to these keys
// lives in predicates.ts.
export type CategoryKey =
  | "airline"
  | "ga"
  | "bizjet"
  | "mil"
  | "rotor"
  | "unknown";

export type InspectorTab = "telemetry" | "quality" | "signal" | "raw";

export type AlertKind = "emerg-squawk" | "weak-signal";

export type UnitMode = "metric" | "imperial" | "aviation" | "custom";

export type AltitudeUnit = "m" | "ft";

export type HorizontalSpeedUnit = "km/h" | "mph" | "kt";

export type DistanceUnit = "km" | "mi" | "nm";

export type VerticalSpeedUnit = "m/s" | "ft/min" | "fpm";

export type TemperatureUnit = "C" | "F";

export interface UnitOverrides {
  altitude: AltitudeUnit;
  horizontalSpeed: HorizontalSpeedUnit;
  distance: DistanceUnit;
  verticalSpeed: VerticalSpeedUnit;
  temperature: TemperatureUnit;
}

export type ClockMode = "utc" | "local";

export type ThemeMode = "system" | "light" | "dark";

export interface Alert {
  id: string;
  ts: number;
  kind: AlertKind;
  title: string;
  subtitle?: string;
  hex?: string;
}

// Toggles in LayersHUD. The basemap style handles water/coast/admin/terrain;
// the overlay keys below are drawn by MapEngine on top of whatever basemap is
// active.
export type LayerKey = "rangeRings" | "rxRange" | "trails" | "losRings";

/** Aircraft glyph shape on the map. Independent of label text content, which
 *  is controlled by MapSlice.labelFields (the topbar's CS/Alt/Sqk/Rt toggles). */
export type LabelMode = "arrow" | "icon";

export interface TrailPoint {
  lat: number;
  lon: number;
  // Altitude is feet or unknown; ground state is carried by ground.
  alt: number | null;
  ts: number;
  ground?: boolean;
  segment: number;
  gs?: number;
  track?: number;
  source?: AircraftType;
  alt_source?: "baro" | "geom";
  altGeomFt?: number;
}

export type TrailPointInput = Omit<TrailPoint, "segment"> & {
  segment?: number;
};

export interface ReplayBlockIndex {
  start: number;
  end: number;
  url: string;
  bytes: number;
}

export interface ReplayManifest {
  enabled: boolean;
  from: number | null;
  to: number | null;
  block_sec: number;
  blocks: ReplayBlockIndex[];
}

export interface ReplayFrame {
  ts: number;
  aircraft: Aircraft[];
}

export interface IdentProducer {
  kind: "readsb" | "dump1090-fa" | "skyaware978" | "unknown";
  version?: string;
}

export type IdentCapabilitySource =
  | "producer_provided"
  | "ident_derived"
  | "unavailable";

export interface IdentCapabilities {
  aircraft: IdentCapabilitySource;
  receiverPosition: IdentCapabilitySource;
  messageRate: IdentCapabilitySource;
  gain: IdentCapabilitySource;
  uptime: IdentCapabilitySource;
  maxRange: IdentCapabilitySource;
  rangeOutline: IdentCapabilitySource;
  signalDiagnostics: IdentCapabilitySource;
  meteorology: IdentCapabilitySource;
  replay: IdentCapabilitySource;
  trails: IdentCapabilitySource;
}

export interface IdentCapabilitiesEnvelope {
  schema: "ident.capabilities.v1";
  producer: IdentProducer;
  capabilities: IdentCapabilities;
}

export interface IdentConfig {
  schema: "ident.config.v1";
  station?: string;
  ident: IdentBuildInfo;
  lineOfSight?: HeyWhatsThatJson;
}

export interface IdentBuildInfo {
  version?: string;
  shortCommit?: string;
}

export type IdentRouteEntry =
  | {
      callsign: string;
      origin?: string;
      destination?: string;
      route?: string;
      dropped?: false;
    }
  | { callsign: string; dropped: true };

export interface IdentRoutes {
  schema: "ident.routes.v1";
  observedAtEpochSec?: number;
  routes: IdentRouteEntry[];
}

export interface IdentReplayAvailability {
  schema: "ident.replay.availability.v1";
  enabled: boolean;
  fromEpochMs?: number;
  toEpochMs?: number;
  blockSec: number;
  blockCount: number;
}

export type IdentUnavailableReason =
  | "not_provided_by_producer"
  | "awaiting_classification"
  | "awaiting_second_sample"
  | "producer_changed"
  | "counter_reset"
  | "clock_not_advanced"
  | "stale_sample"
  | "malformed_file";

export interface IdentUnavailableValue {
  kind: "unavailable";
  reason: IdentUnavailableReason;
}

export interface IdentProvidedValue<TValue, TSource extends string> {
  kind: "producer_provided";
  source: TSource;
  value: TValue;
}

export interface IdentDerivedValue<TValue, TSource extends string> {
  kind: "ident_derived";
  source: TSource;
  value: TValue;
}

export type IdentStatusValue<TValue, TSource extends string> =
  | IdentProvidedValue<TValue, TSource>
  | IdentDerivedValue<TValue, TSource>
  | IdentUnavailableValue;

export interface IdentDiagnostic {
  severity: "info" | "warning" | "error";
  channel: string;
  code: string;
  // Per-instance scope so per-thing diagnostics (e.g. one replay block)
  // can coexist with other entries sharing channel+code. Default "".
  scope?: string;
  message: string;
  // action carries the label+URL pair atomically. The two fields only make
  // sense together; nesting them rules out the half-populated state where
  // a URL renders without a label or vice versa.
  action?: { label: string; url: string };
}

export interface IdentDiagnosticsEnvelope {
  schema: "ident.diagnostics.v1";
  diagnostics: IdentDiagnostic[];
}

export type IdentObservedAtStatus = IdentStatusValue<
  { epochSec: number },
  "stats_now" | "stats_window_end" | "aircraft_now" | "ingest_clock"
>;

export interface IdentFreshness {
  aircraftAgeSec: number | null;
  statsAgeSec: number | null;
  receiverObservedAgeSec: number | null;
}

export interface IdentStatus {
  schema: "ident.status.v1";
  observedAt: IdentObservedAtStatus;
  freshness: IdentFreshness;
  receiverPosition?: IdentStatusValue<
    { lat: number; lon: number },
    "receiver_json"
  >;
  messageRate?: IdentStatusValue<
    { hz: number; basisSec?: number },
    | "stats_last1min_messages_valid"
    | "stats_last1min_messages"
    | "aircraft_counter_delta"
  >;
  gain?: IdentStatusValue<
    { db: number },
    | "top_level"
    | "latest_local"
    | "last1min_local"
    | "last5min_local"
    | "last15min_local"
    | "total_local"
  >;
  uptime?: IdentStatusValue<
    { sec: number; subject: "receiver" | "ident" },
    | "stats_now_minus_total_start"
    | "window_end_minus_total_start"
    | "ident_process_start"
  >;
  maxRange?: IdentStatusValue<
    {
      nm: number;
      scope: "last24h" | "alltime" | "points" | "other" | "stats";
      computation:
        | "max_receiver_to_outline_vertex"
        | "producer_reported_distance";
    },
    | "outline_last24h_vertices"
    | "outline_alltime_vertices"
    | "outline_points_vertices"
    | "outline_other_vertices"
    | "stats_max_distance_meters"
  >;
}

export interface ReplayBlockFile {
  version: 2;
  start: number;
  end: number;
  step_ms: number;
  frames: ReplayFrame[];
}

export interface RouteInfo {
  origin: string;
  destination: string;
  route?: string;
}

/**
 * HeyWhatsThat "upintheair" line-of-sight rings payload.
 *   data.rings[i].alt    — altitude in meters
 *   data.rings[i].points — polygon vertices as [lat, lon]
 * Other top-level fields (id, refraction, etc.) exist but aren't consumed here.
 */
export interface HeyWhatsThatRing {
  alt: number | string;
  points: Array<[number, number]>;
}

export interface HeyWhatsThatJson {
  rings: HeyWhatsThatRing[];
  [k: string]: unknown;
}
