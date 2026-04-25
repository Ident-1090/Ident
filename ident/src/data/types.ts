// Types mirror readsb's aircraft.json / receiver.json / stats.json schemas.
// readsb is BSD-3-Clause; these are structural descriptions, not copied code.

export type AircraftType =
  | "adsb_icao"
  | "adsb_icao_nt"
  | "adsr_icao"
  | "tisb_icao"
  | "adsc"
  | "mlat"
  | "other"
  | "mode_s"
  | "adsb_other"
  | "adsr_other"
  | "tisb_trackfile"
  | "tisb_other"
  | "mode_ac"
  | "unknown";

export interface Aircraft {
  hex: string;
  type?: AircraftType;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  ownOp?: string;
  category?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  alt_geom?: number;
  gs?: number;
  ias?: number;
  tas?: number;
  mach?: number;
  wd?: number;
  ws?: number;
  oat?: number;
  tat?: number;
  track?: number;
  track_rate?: number;
  roll?: number;
  mag_heading?: number;
  true_heading?: number;
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  emergency?: string;
  nav_qnh?: number;
  nav_altitude_mcp?: number;
  nav_altitude_fms?: number;
  nav_heading?: number;
  nav_modes?: string[];
  nic?: number;
  rc?: number;
  version?: number;
  nic_baro?: number;
  nac_p?: number;
  nac_v?: number;
  sil?: number;
  sil_type?: string;
  gva?: number;
  sda?: number;
  messages?: number;
  seen?: number;
  seen_pos?: number;
  rssi?: number;
  dbFlags?: number;
  // readsb sets alt_baro to "ground" and sometimes includes airground as a
  // convenience; keep optional since not all frames set it.
  airground?: number | "ground" | "airborne";
}

export interface AircraftFrame {
  now: number;
  messages?: number;
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

// Semantic aircraft category key used by the rail's FiltersCard.
// The mapping from aircraft.category (ADS-B A0..C7 letter codes) to these keys
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
  alt: number | "ground";
  ts: number;
}

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

export interface ReplayBlockFile {
  version: 1;
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
