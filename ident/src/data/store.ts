import { create } from "zustand";
import { labelFieldsKey, startMapTimingTrace } from "../debug/mapTiming";
import type { BasemapId } from "../map/styles";
import { deriveFilterFromQuery } from "../omnibox/grammar";
import { presetUnitOverrides } from "../settings/format";
import type {
  Aircraft,
  AircraftFrame,
  Alert,
  AltitudeUnit,
  CategoryKey,
  ClockMode,
  DistanceUnit,
  HeyWhatsThatJson,
  HorizontalSpeedUnit,
  InspectorTab,
  LabelMode,
  LayerKey,
  OutlineJson,
  ReceiverJson,
  RouteInfo,
  StatsJson,
  TemperatureUnit,
  ThemeMode,
  TrailPoint,
  UnitMode,
  UnitOverrides,
  VerticalSpeedUnit,
} from "./types";

export type ConnStatus = "connecting" | "open" | "closed";

export interface ConnStatusInfo {
  isRetry?: boolean;
}

const TREND_BUFFER_LEN = 60;
const ALERT_MAX = 50;
const ALERT_WINDOW_MS = 30 * 60 * 1000;

// Per-hex trail buffer holds full in-range history, bounded only by point count
// (~1.5 h at 4 s historical cadence + 1 Hz live). settings.trailFadeSec controls
// how much of that buffer is drawn for UNSELECTED aircraft; selected renders all.
const TRAIL_POINT_CAP = 1500;
const DEFAULT_TRAIL_FADE_SEC = 180;
const TRAIL_FADE_MIN_SEC = 10;
const TRAIL_FADE_MAX_SEC = 600;

const MAP_STORAGE_KEY = "ident.map.state";
const SETTINGS_STORAGE_KEY = "ident.settings.state";
const MAP_CENTER_EPSILON_DEG = 1e-6;
const MAP_ZOOM_EPSILON = 1e-3;

export interface LabelFields {
  cs: boolean;
  type: boolean;
  alt: boolean;
  spd: boolean;
  sqk: boolean;
  rt: boolean;
}

const DEFAULT_LABEL_FIELDS: LabelFields = {
  cs: true,
  type: false,
  alt: true,
  spd: true,
  sqk: false,
  rt: false,
};

interface PersistedMapState {
  labelMode: LabelMode;
  layers: Record<LayerKey, boolean>;
  labelFields: LabelFields;
  basemapId: BasemapId;
  // null = MapEngine should place the map at the receiver once it arrives.
  // Populated values are restored verbatim on next session.
  center: { lng: number; lat: number } | null;
  zoom: number | null;
}

const VALID_BASEMAP_IDS: BasemapId[] = [
  "ident",
  "osm",
  "cartoPositron",
  "cartoDark",
  "esriSat",
  "esriTerrain",
];

interface PersistedSettingsState {
  trailFadeSec: number;
  unitMode: UnitMode;
  unitOverrides: UnitOverrides;
  clock: ClockMode;
  theme: ThemeMode;
}

function isThemeMode(v: unknown): v is ThemeMode {
  return v === "system" || v === "light" || v === "dark";
}

function isAltitudeUnit(v: unknown): v is AltitudeUnit {
  return v === "m" || v === "ft";
}

function isHorizontalSpeedUnit(v: unknown): v is HorizontalSpeedUnit {
  return v === "km/h" || v === "mph" || v === "kt";
}

function isDistanceUnit(v: unknown): v is DistanceUnit {
  return v === "km" || v === "mi" || v === "nm";
}

function isVerticalSpeedUnit(v: unknown): v is VerticalSpeedUnit {
  return v === "m/s" || v === "ft/min" || v === "fpm";
}

function isTemperatureUnit(v: unknown): v is TemperatureUnit {
  return v === "C" || v === "F";
}

function normalizeUnitOverrides(
  raw: Partial<UnitOverrides> | undefined,
  fallback: UnitOverrides,
): UnitOverrides {
  return {
    altitude: isAltitudeUnit(raw?.altitude) ? raw.altitude : fallback.altitude,
    horizontalSpeed: isHorizontalSpeedUnit(raw?.horizontalSpeed)
      ? raw.horizontalSpeed
      : fallback.horizontalSpeed,
    distance: isDistanceUnit(raw?.distance) ? raw.distance : fallback.distance,
    verticalSpeed: isVerticalSpeedUnit(raw?.verticalSpeed)
      ? raw.verticalSpeed
      : fallback.verticalSpeed,
    temperature: isTemperatureUnit(raw?.temperature)
      ? raw.temperature
      : fallback.temperature,
  };
}

function loadMapState(defaults: PersistedMapState): PersistedMapState {
  try {
    const raw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(MAP_STORAGE_KEY)
        : null;
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PersistedMapState> & {
      labelMode?: string;
      basemapId?: string;
    };
    // Older persisted values "cs"/"fl"/"full" were replaced by the labelFields
    // multi-toggle; coerce them to the new glyph-only enum.
    const glyph: LabelMode =
      parsed.labelMode === "dot"
        ? "dot"
        : parsed.labelMode === "arrow"
          ? "arrow"
          : defaults.labelMode;
    const basemapId = VALID_BASEMAP_IDS.includes(parsed.basemapId as BasemapId)
      ? (parsed.basemapId as BasemapId)
      : defaults.basemapId;
    const center =
      parsed.center &&
      typeof parsed.center.lng === "number" &&
      typeof parsed.center.lat === "number"
        ? { lng: parsed.center.lng, lat: parsed.center.lat }
        : defaults.center;
    const zoom = typeof parsed.zoom === "number" ? parsed.zoom : defaults.zoom;
    // Restore each known LayerKey from parsed; legacy keys absent from
    // defaults drop naturally so the activeCount badge doesn't carry them.
    const layers = {} as Record<LayerKey, boolean>;
    for (const key of Object.keys(defaults.layers) as LayerKey[]) {
      const v = parsed.layers?.[key];
      layers[key] = typeof v === "boolean" ? v : defaults.layers[key];
    }
    return {
      labelMode: glyph,
      layers,
      // Per-key merge so fields added after a user's last save get their
      // default value rather than undefined.
      labelFields: { ...defaults.labelFields, ...(parsed.labelFields ?? {}) },
      basemapId,
      center,
      zoom,
    };
  } catch {
    return defaults;
  }
}

function persistMapState(map: MapSlice): void {
  try {
    if (typeof localStorage === "undefined") return;
    const payload: PersistedMapState = {
      labelMode: map.labelMode,
      layers: map.layers,
      labelFields: map.labelFields,
      basemapId: map.basemapId,
      center: map.center,
      zoom: map.zoom,
    };
    localStorage.setItem(MAP_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Intentionally ignore: privacy-mode browsers throw on storage access.
  }
}

function loadSettingsState(
  defaults: PersistedSettingsState,
): PersistedSettingsState {
  try {
    const raw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(SETTINGS_STORAGE_KEY)
        : null;
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PersistedSettingsState> & {
      units?: UnitMode;
    };
    const legacyMode = parsed.units;
    const unitMode =
      parsed.unitMode === "metric" ||
      parsed.unitMode === "imperial" ||
      parsed.unitMode === "aviation" ||
      parsed.unitMode === "custom"
        ? parsed.unitMode
        : legacyMode === "metric" ||
            legacyMode === "imperial" ||
            legacyMode === "aviation"
          ? legacyMode
          : defaults.unitMode;
    const presetFallback =
      unitMode === "custom"
        ? defaults.unitOverrides
        : presetUnitOverrides(unitMode);
    return {
      trailFadeSec:
        typeof parsed.trailFadeSec === "number"
          ? parsed.trailFadeSec
          : defaults.trailFadeSec,
      unitMode,
      unitOverrides: normalizeUnitOverrides(
        parsed.unitOverrides,
        presetFallback,
      ),
      clock: parsed.clock ?? defaults.clock,
      theme: isThemeMode(parsed.theme) ? parsed.theme : defaults.theme,
    };
  } catch {
    return defaults;
  }
}

function persistSettingsState(settings: SettingsSlice): void {
  try {
    if (typeof localStorage === "undefined") return;
    const payload: PersistedSettingsState = {
      trailFadeSec: settings.trailFadeSec,
      unitMode: settings.unitMode,
      unitOverrides: settings.unitOverrides,
      clock: settings.clock,
      theme: settings.theme,
    };
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Intentionally ignore: privacy-mode browsers throw on storage access.
  }
}

const MPS_BUFFER_LEN = 60;
const MPS_SAMPLE_INTERVAL_MS = 1000;

export interface InspectorSlice {
  tab: InspectorTab;
}

export interface FilterSlice {
  categories: Record<CategoryKey, boolean>;
  altRangeFt: [number, number];
  emergOnly: boolean;
  hideGround: boolean;
  hasPosOnly: boolean;
  // Free-text field filters set by the omnibox grammar (e.g. `op:delta`).
  // Empty string = no filter. Matching is case-insensitive substring for
  // operatorContains (over ac.ownOp / ac.desc) and case-insensitive prefix
  // for callsignPrefix (over ac.flight).
  operatorContains: string;
  callsignPrefix: string;
  // Route filter matches aircraft whose known RouteInfo has an origin /
  // destination / raw route string containing the needle (case-insensitive).
  routeContains: string;
  // ICAO24 allocation country filter. Empty string = no filter; non-empty
  // values match country code or country name case-insensitively.
  countryContains: string;
  // Identifier fields. Empty string = no filter.
  hexContains: string;
  regPrefix: string;
  squawkEquals: string;
  typePrefix: string;
  // readsb source-kind (ac.type): empty string means no filter. Shorthand
  // values `adsb`, `tisb` match any member of that prefix family; other
  // values compare exactly against ac.type.
  sourceEquals: string;
  // Numeric range filters. null = no filter.
  gsRangeKt: [number, number] | null;
  distRangeNm: [number, number] | null;
  vsRangeFpm: [number, number] | null;
  // Heading window in degrees; both null means no filter.
  hdgCenter: number | null;
  hdgTolerance: number | null;
  // Keyword toggles not covered by the fields above.
  militaryOnly: boolean;
  inViewOnly: boolean;
  // Disjunctive branches for grouped / OR omnibox expressions. null means the
  // flat fields above describe the whole filter.
  expressionBranches: FilterSlice[] | null;
}

export interface MapSlice {
  labelMode: LabelMode;
  layers: Record<LayerKey, boolean>;
  labelFields: LabelFields;
  basemapId: BasemapId;
  recenterRequestId: number;
  // Persisted map view. null on a fresh session = MapEngine picks an initial
  // viewport (receiver-centered at zoom 8 once the receiver lands, otherwise
  // a continental default).
  center: { lng: number; lat: number } | null;
  zoom: number | null;
  // Hexes currently inside the map viewport. null = not yet published
  // (treat inview filter as no-op).
  viewportHexes: Set<string> | null;
}

export interface LabelsSlice {
  hoveredHex: string | null;
}

export interface SearchSlice {
  query: string;
}

export type CameraInteraction =
  | { kind: "pan"; at: number }
  | { kind: "zoom"; at: number };

export type CameraInteractionInput =
  | { kind: "pan"; at?: number }
  | { kind: "zoom"; at?: number };

export interface CameraSlice {
  trackSelected: boolean;
  autoFitTraffic: boolean;
  lastUserInteraction: CameraInteraction | null;
}

export interface SettingsSlice {
  trailFadeSec: number;
  unitMode: UnitMode;
  unitOverrides: UnitOverrides;
  clock: ClockMode;
  theme: ThemeMode;
}

export interface LiveStateSlice {
  lastMsgTs: number;
  mpsBuffer: number[];
  // True once we've received at least one route envelope over the WebSocket.
  // route.ts short-circuits its client-side adsb.im fetch when this is set,
  // so in sidecar mode the frontend never talks to the upstream directly.
  routesViaWs: boolean;
}

// Relay-pushed runtime config (`config` channel). Populated on WS connect;
// client-side display surfaces fall back to deriving values from the
// receiver envelope when a field is null.
export interface ConfigSlice {
  station: string | null;
}

export type UpdateStatusKind =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "unavailable"
  | "disabled"
  | "unknown";

export interface VersionInfo {
  version: string;
  commit: string;
  date: string;
}

export interface ReleaseInfo {
  version: string;
  name?: string;
  url?: string;
  publishedAt?: string;
}

export interface UpdateSlice {
  enabled: boolean;
  status: UpdateStatusKind;
  current: VersionInfo | null;
  latest: ReleaseInfo | null;
  checkedAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
}

const DEFAULT_FILTER: FilterSlice = {
  categories: {
    airline: false,
    ga: false,
    bizjet: false,
    mil: false,
    rotor: false,
    unknown: false,
  },
  altRangeFt: [0, 45000],
  emergOnly: false,
  hideGround: false,
  hasPosOnly: false,
  operatorContains: "",
  callsignPrefix: "",
  routeContains: "",
  countryContains: "",
  hexContains: "",
  regPrefix: "",
  squawkEquals: "",
  typePrefix: "",
  sourceEquals: "",
  gsRangeKt: null,
  distRangeNm: null,
  vsRangeFpm: null,
  hdgCenter: null,
  hdgTolerance: null,
  militaryOnly: false,
  inViewOnly: false,
  expressionBranches: null,
};

const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  rangeRings: true,
  rxRange: false,
  trails: false,
  losRings: false,
};

export interface IdentState {
  aircraft: Map<string, Aircraft>;
  receiver: ReceiverJson | null;
  stats: StatsJson | null;
  outline: OutlineJson | null;
  now: number;
  connectionStatus: Record<string, ConnStatus>;
  connectionStatusInfo: Record<string, ConnStatusInfo>;
  selectedHex: string | null;

  // Inspector slice.
  inspector: InspectorSlice;
  altTrendsByHex: Record<string, number[]>;
  gsTrendsByHex: Record<string, number[]>;
  rssiBufByHex: Record<string, number[]>;
  routeByCallsign: Record<string, RouteInfo | null>;

  // Filter slice (consumed by rail's FiltersCard via matchesFilter).
  filter: FilterSlice;

  // Alerts buffer (rolling 30-minute window, cap 50). Prepend-on-push.
  alerts: Alert[];

  // Map HUD slice.
  map: MapSlice;

  // Label overlay state (hover, collision-resolver output, auto-mode fallback).
  labels: LabelsSlice;

  // Topbar search query (raw input value; normalization happens at consumer).
  search: SearchSlice;

  // Camera automation state. `lastUserInteraction` is an ADT so consumers can
  // distinguish pan semantics from zoom semantics instead of inferring from a
  // bare timestamp.
  camera: CameraSlice;

  // Settings slice.
  settings: SettingsSlice;

  // Per-aircraft position trails (ring buffer bounded by TRAIL_POINT_CAP).
  // Holds the aircraft's full in-range history; render path decides how much
  // of it to draw based on settings.trailFadeSec and selection.
  trailsByHex: Record<string, TrailPoint[]>;

  // Relay-supplied line-of-sight rings from the config snapshot.
  losData: HeyWhatsThatJson | null;

  // Live feedback (1 Hz msg-rate rolling window + last-snapshot timestamp).
  liveState: LiveStateSlice;

  // Relay-supplied runtime config (station name, …).
  config: ConfigSlice;

  // GitHub release notification status. identd owns the GitHub request/cache
  // and never installs updates; the browser only reads this local endpoint.
  update: UpdateSlice;

  // Ingestion.
  ingestAircraft: (frame: AircraftFrame) => void;
  ingestReceiver: (r: ReceiverJson) => void;
  ingestStats: (s: StatsJson) => void;
  ingestOutline: (o: OutlineJson) => void;
  ingestConfig: (c: Partial<ConfigSlice>) => void;
  setConnectionStatus: (
    channel: string,
    status: ConnStatus,
    info?: ConnStatusInfo,
  ) => void;
  select: (hex: string | null) => void;

  // Inspector.
  setInspectorTab: (tab: InspectorTab) => void;
  recordAircraftSample: (hex: string, sample: Aircraft) => void;
  setRouteInfo: (callsign: string, route: RouteInfo | null) => void;

  // Filter.
  toggleFilterCategory: (cat: CategoryKey) => void;
  setFilterAltRange: (range: [number, number]) => void;
  setFilterEmergOnly: (v: boolean) => void;
  setFilterHideGround: (v: boolean) => void;
  setFilterHasPosOnly: (v: boolean) => void;
  setFilterOperatorContains: (v: string) => void;
  setFilterCallsignPrefix: (v: string) => void;
  setFilterRouteContains: (v: string) => void;
  setFilterCountryContains: (v: string) => void;
  setFilterHexContains: (v: string) => void;
  setFilterRegPrefix: (v: string) => void;
  setFilterSquawkEquals: (v: string) => void;
  setFilterTypePrefix: (v: string) => void;
  setFilterSourceEquals: (v: string) => void;
  setFilterGsRangeKt: (r: [number, number] | null) => void;
  setFilterDistRangeNm: (r: [number, number] | null) => void;
  setFilterVsRangeFpm: (r: [number, number] | null) => void;
  setFilterHdgWindow: (center: number | null, tolerance: number | null) => void;
  setFilterMilitaryOnly: (v: boolean) => void;
  setFilterInViewOnly: (v: boolean) => void;
  resetFilter: () => void;

  // Alerts.
  pushAlert: (alert: Alert) => void;

  // Map.
  setLabelMode: (mode: LabelMode) => void;
  toggleLayer: (key: LayerKey) => void;
  toggleLabelField: (key: keyof LabelFields) => void;
  setBasemap: (id: BasemapId) => void;
  requestRecenter: () => void;
  setMapView: (view: {
    center: { lng: number; lat: number };
    zoom: number;
  }) => void;
  setMapViewportHexes: (hexes: Set<string> | null) => void;
  setTrackSelected: (enabled: boolean) => void;
  setAutoFitTraffic: (enabled: boolean) => void;
  recordMapInteraction: (interaction: CameraInteractionInput) => void;

  // Labels.
  setHoveredHex: (hex: string | null) => void;

  // Search.
  setSearchQuery: (q: string) => void;

  // Settings.
  setSettings: (next: Partial<SettingsSlice>) => void;
  setTrailFadeSec: (sec: number) => void;

  // Trails.
  recordTrailPoint: (hex: string, point: TrailPoint) => void;

  // LOS rings.
  setLosData: (data: HeyWhatsThatJson | null) => void;

  // Live feedback.
  recordSnapshot: () => void;

  // Update notification.
  setUpdateStatus: (next: Partial<UpdateSlice>) => void;
}

function appendTrimmed(buf: number[] | undefined, value: number): number[] {
  const next = buf ? buf.slice() : [];
  next.push(value);
  if (next.length > TREND_BUFFER_LEN)
    next.splice(0, next.length - TREND_BUFFER_LEN);
  return next;
}

function retainSelectedAircraft(
  next: Map<string, Aircraft>,
  previous: IdentState,
  frame: AircraftFrame,
): void {
  const selectedHex = previous.selectedHex;
  if (!selectedHex || next.has(selectedHex)) return;
  const selectedAircraft = previous.aircraft.get(selectedHex);
  if (!selectedAircraft) return;
  next.set(
    selectedHex,
    ageAircraft(selectedAircraft, frame.now - previous.now),
  );
}

function ageAircraft(aircraft: Aircraft, deltaSec: number): Aircraft {
  const delta = Number.isFinite(deltaSec) && deltaSec > 0 ? deltaSec : 0;
  if (delta === 0) return aircraft;
  return {
    ...aircraft,
    seen: ageSeconds(aircraft.seen, delta),
    seen_pos: ageSeconds(aircraft.seen_pos, delta),
  };
}

function ageSeconds(
  value: number | undefined,
  delta: number,
): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value + delta
    : value;
}

function sameViewportHexes(
  a: Set<string> | null,
  b: Set<string> | null,
): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (a.size !== b.size) return false;
  for (const hex of a) {
    if (!b.has(hex)) return false;
  }
  return true;
}

function sameMapView(
  a: { center: { lng: number; lat: number } | null; zoom: number | null },
  b: { center: { lng: number; lat: number } | null; zoom: number | null },
): boolean {
  const sameCenter =
    a.center === b.center ||
    (a.center != null &&
      b.center != null &&
      Math.abs(a.center.lng - b.center.lng) <= MAP_CENTER_EPSILON_DEG &&
      Math.abs(a.center.lat - b.center.lat) <= MAP_CENTER_EPSILON_DEG);
  if (!sameCenter) return false;
  if (a.zoom == null || b.zoom == null) return a.zoom === b.zoom;
  return Math.abs(a.zoom - b.zoom) <= MAP_ZOOM_EPSILON;
}

const INITIAL_MAP_STATE: PersistedMapState = loadMapState({
  labelMode: "arrow",
  layers: DEFAULT_LAYERS,
  labelFields: DEFAULT_LABEL_FIELDS,
  basemapId: "ident",
  center: null,
  zoom: null,
});

const INITIAL_SETTINGS_STATE: PersistedSettingsState = loadSettingsState({
  trailFadeSec: DEFAULT_TRAIL_FADE_SEC,
  unitMode: "aviation",
  unitOverrides: presetUnitOverrides("aviation"),
  clock: "utc",
  theme: "system",
});

const INITIAL_CAMERA_STATE: CameraSlice = {
  trackSelected: false,
  autoFitTraffic: false,
  lastUserInteraction: null,
};

const INITIAL_UPDATE_STATE: UpdateSlice = {
  enabled: true,
  status: "idle",
  current: null,
  latest: null,
  checkedAt: null,
  lastSuccessAt: null,
  error: null,
};

export const useIdentStore = create<IdentState>((set) => ({
  aircraft: new Map(),
  receiver: null,
  stats: null,
  outline: null,
  now: 0,
  connectionStatus: { ws: "connecting" },
  connectionStatusInfo: { ws: { isRetry: false } },
  selectedHex: null,

  inspector: { tab: "telemetry" },
  altTrendsByHex: {},
  gsTrendsByHex: {},
  rssiBufByHex: {},
  routeByCallsign: {},

  filter: DEFAULT_FILTER,

  alerts: [],

  map: { ...INITIAL_MAP_STATE, viewportHexes: null, recenterRequestId: 0 },

  labels: {
    hoveredHex: null,
  },

  search: { query: "" },

  camera: INITIAL_CAMERA_STATE,

  settings: INITIAL_SETTINGS_STATE,

  trailsByHex: {},

  losData: null,

  liveState: { lastMsgTs: 0, mpsBuffer: [], routesViaWs: false },

  config: { station: null },

  update: INITIAL_UPDATE_STATE,

  ingestAircraft: (frame) =>
    set((st) => {
      const next = new Map<string, Aircraft>();
      for (const ac of frame.aircraft) next.set(ac.hex, ac);
      retainSelectedAircraft(next, st, frame);

      // Push sampled numeric values (alt_baro, gs, rssi) into per-hex rolling
      // buffers. Keeping this inside ingestAircraft gives us a single call
      // site regardless of whether frames arrive via WS or HTTP fallback.
      const altTrendsByHex: Record<string, number[]> = { ...st.altTrendsByHex };
      const gsTrendsByHex: Record<string, number[]> = { ...st.gsTrendsByHex };
      const rssiBufByHex: Record<string, number[]> = { ...st.rssiBufByHex };
      for (const ac of frame.aircraft) {
        if (typeof ac.alt_baro === "number") {
          altTrendsByHex[ac.hex] = appendTrimmed(
            altTrendsByHex[ac.hex],
            ac.alt_baro,
          );
        }
        if (typeof ac.gs === "number") {
          gsTrendsByHex[ac.hex] = appendTrimmed(gsTrendsByHex[ac.hex], ac.gs);
        }
        if (typeof ac.rssi === "number") {
          rssiBufByHex[ac.hex] = appendTrimmed(rssiBufByHex[ac.hex], ac.rssi);
        }
      }

      return {
        aircraft: next,
        now: frame.now,
        selectedHex: st.selectedHex,
        camera: st.camera,
        altTrendsByHex,
        gsTrendsByHex,
        rssiBufByHex,
      };
    }),

  ingestReceiver: (r) => set({ receiver: r }),
  ingestStats: (s) => set({ stats: s }),
  ingestOutline: (o) => set({ outline: o }),
  ingestConfig: (c) => set((st) => ({ config: { ...st.config, ...c } })),

  setConnectionStatus: (channel, status, info) =>
    set((st) => ({
      connectionStatus: { ...st.connectionStatus, [channel]: status },
      connectionStatusInfo: {
        ...st.connectionStatusInfo,
        [channel]: info ?? {},
      },
    })),

  select: (hex) => {
    startMapTimingTrace("store select", { hex: hex ?? "none" });
    set((st) => ({
      selectedHex: hex,
      camera: { ...st.camera, trackSelected: hex != null },
    }));
  },

  setInspectorTab: (tab) =>
    set((st) => ({ inspector: { ...st.inspector, tab } })),

  recordAircraftSample: (hex, sample) =>
    set((st) => {
      const altTrendsByHex =
        typeof sample.alt_baro === "number"
          ? {
              ...st.altTrendsByHex,
              [hex]: appendTrimmed(st.altTrendsByHex[hex], sample.alt_baro),
            }
          : st.altTrendsByHex;
      const gsTrendsByHex =
        typeof sample.gs === "number"
          ? {
              ...st.gsTrendsByHex,
              [hex]: appendTrimmed(st.gsTrendsByHex[hex], sample.gs),
            }
          : st.gsTrendsByHex;
      const rssiBufByHex =
        typeof sample.rssi === "number"
          ? {
              ...st.rssiBufByHex,
              [hex]: appendTrimmed(st.rssiBufByHex[hex], sample.rssi),
            }
          : st.rssiBufByHex;
      return { altTrendsByHex, gsTrendsByHex, rssiBufByHex };
    }),

  setRouteInfo: (callsign, route) =>
    set((st) => ({
      routeByCallsign: {
        ...st.routeByCallsign,
        [callsign.trim().toUpperCase()]: route,
      },
    })),

  toggleFilterCategory: (cat) =>
    set((st) => ({
      filter: {
        ...st.filter,
        categories: {
          ...st.filter.categories,
          [cat]: !st.filter.categories[cat],
        },
      },
    })),

  setFilterAltRange: (range) =>
    set((st) => ({ filter: { ...st.filter, altRangeFt: range } })),
  setFilterEmergOnly: (v) =>
    set((st) => ({ filter: { ...st.filter, emergOnly: v } })),
  setFilterHideGround: (v) =>
    set((st) => ({ filter: { ...st.filter, hideGround: v } })),
  setFilterHasPosOnly: (v) =>
    set((st) => ({ filter: { ...st.filter, hasPosOnly: v } })),
  setFilterOperatorContains: (v) =>
    set((st) => ({ filter: { ...st.filter, operatorContains: v } })),
  setFilterCallsignPrefix: (v) =>
    set((st) => ({ filter: { ...st.filter, callsignPrefix: v } })),
  setFilterRouteContains: (v) =>
    set((st) => ({ filter: { ...st.filter, routeContains: v } })),
  setFilterCountryContains: (v) =>
    set((st) => ({ filter: { ...st.filter, countryContains: v } })),
  setFilterHexContains: (v) =>
    set((st) => ({ filter: { ...st.filter, hexContains: v } })),
  setFilterRegPrefix: (v) =>
    set((st) => ({ filter: { ...st.filter, regPrefix: v } })),
  setFilterSquawkEquals: (v) =>
    set((st) => ({ filter: { ...st.filter, squawkEquals: v } })),
  setFilterTypePrefix: (v) =>
    set((st) => ({ filter: { ...st.filter, typePrefix: v } })),
  setFilterSourceEquals: (v) =>
    set((st) => ({ filter: { ...st.filter, sourceEquals: v } })),
  setFilterGsRangeKt: (r) =>
    set((st) => ({ filter: { ...st.filter, gsRangeKt: r } })),
  setFilterDistRangeNm: (r) =>
    set((st) => ({ filter: { ...st.filter, distRangeNm: r } })),
  setFilterVsRangeFpm: (r) =>
    set((st) => ({ filter: { ...st.filter, vsRangeFpm: r } })),
  setFilterHdgWindow: (center, tolerance) =>
    set((st) => ({
      filter: { ...st.filter, hdgCenter: center, hdgTolerance: tolerance },
    })),
  setFilterMilitaryOnly: (v) =>
    set((st) => ({ filter: { ...st.filter, militaryOnly: v } })),
  setFilterInViewOnly: (v) =>
    set((st) => ({ filter: { ...st.filter, inViewOnly: v } })),
  resetFilter: () => set({ filter: DEFAULT_FILTER, search: { query: "" } }),

  pushAlert: (alert) =>
    set((st) => {
      const cutoff = alert.ts - ALERT_WINDOW_MS;
      const kept = st.alerts.filter((a) => a.ts >= cutoff);
      const next = [alert, ...kept];
      if (next.length > ALERT_MAX) next.length = ALERT_MAX;
      return { alerts: next };
    }),

  setLabelMode: (mode) =>
    set((st) => {
      startMapTimingTrace("store labelMode", {
        from: st.map.labelMode,
        to: mode,
      });
      const map = { ...st.map, labelMode: mode };
      persistMapState(map);
      return { map };
    }),

  toggleLayer: (key) =>
    set((st) => {
      const map = {
        ...st.map,
        layers: { ...st.map.layers, [key]: !st.map.layers[key] },
      };
      persistMapState(map);
      return { map };
    }),

  setBasemap: (id) =>
    set((st) => {
      const map = { ...st.map, basemapId: id };
      persistMapState(map);
      return { map };
    }),

  requestRecenter: () =>
    set((st) => ({
      map: { ...st.map, recenterRequestId: st.map.recenterRequestId + 1 },
    })),

  setMapView: ({ center, zoom }) =>
    set((st) => {
      const map = { ...st.map, center, zoom };
      if (sameMapView(st.map, map)) return st;
      persistMapState(map);
      return { map };
    }),

  toggleLabelField: (key) =>
    set((st) => {
      const map = {
        ...st.map,
        labelFields: { ...st.map.labelFields, [key]: !st.map.labelFields[key] },
      };
      startMapTimingTrace("store labelField", {
        field: key,
        value: map.labelFields[key],
        fields: labelFieldsKey(map.labelFields),
      });
      persistMapState(map);
      return { map };
    }),

  setMapViewportHexes: (hexes) =>
    set((st) => {
      if (sameViewportHexes(st.map.viewportHexes, hexes)) return st;
      return { map: { ...st.map, viewportHexes: hexes } };
    }),

  setTrackSelected: (enabled) =>
    set((st) => ({
      camera: {
        ...st.camera,
        trackSelected: enabled && st.selectedHex != null,
      },
    })),

  setAutoFitTraffic: (enabled) =>
    set((st) => ({ camera: { ...st.camera, autoFitTraffic: enabled } })),

  recordMapInteraction: (interaction) =>
    set((st) => {
      const at = interaction.at ?? Date.now();
      return {
        camera: {
          ...st.camera,
          trackSelected:
            interaction.kind === "pan" ? false : st.camera.trackSelected,
          lastUserInteraction: { kind: interaction.kind, at },
        },
      };
    }),

  setHoveredHex: (hex) =>
    set((st) => {
      if (st.labels.hoveredHex === hex) return st;
      return { labels: { ...st.labels, hoveredHex: hex } };
    }),

  setSearchQuery: (q) => {
    const derived = deriveFilterFromQuery(q, DEFAULT_FILTER);
    set({ search: { query: q }, filter: derived.filter });
  },

  setSettings: (next) =>
    set((st) => {
      const trailFadeSecRaw = next.trailFadeSec ?? st.settings.trailFadeSec;
      const trailFadeSec = Math.max(
        TRAIL_FADE_MIN_SEC,
        Math.min(TRAIL_FADE_MAX_SEC, Math.round(trailFadeSecRaw)),
      );
      const settings: SettingsSlice = {
        trailFadeSec,
        unitMode: next.unitMode ?? st.settings.unitMode,
        unitOverrides: normalizeUnitOverrides(
          next.unitOverrides,
          st.settings.unitOverrides,
        ),
        clock: next.clock ?? st.settings.clock,
        theme: next.theme ?? st.settings.theme,
      };
      persistSettingsState(settings);
      return { settings };
    }),

  setTrailFadeSec: (sec) =>
    set((st) => {
      const clamped = Math.max(
        TRAIL_FADE_MIN_SEC,
        Math.min(TRAIL_FADE_MAX_SEC, Math.round(sec)),
      );
      const settings = { ...st.settings, trailFadeSec: clamped };
      persistSettingsState(settings);
      return { settings };
    }),

  recordTrailPoint: (hex, point) =>
    set((st) => {
      const prev = st.trailsByHex[hex];
      const next = prev ? prev.slice() : [];
      next.push(point);
      if (next.length > TRAIL_POINT_CAP)
        next.splice(0, next.length - TRAIL_POINT_CAP);
      return { trailsByHex: { ...st.trailsByHex, [hex]: next } };
    }),

  setLosData: (data) => set({ losData: data }),

  recordSnapshot: () =>
    set((st) => ({ liveState: { ...st.liveState, lastMsgTs: Date.now() } })),

  setUpdateStatus: (next) =>
    set((st) => ({ update: { ...st.update, ...next } })),
}));

/**
 * Convert stats.last1min.messages_valid (a count over the past 60 s window)
 * into a per-second rate and append to the rolling buffer. Exported for direct
 * invocation from tests — the 1 Hz timer below is the production call site.
 */
export function sampleMpsOnce(): void {
  const st = useIdentStore.getState();
  const valid = st.stats?.last1min?.messages_valid;
  const rate =
    typeof valid === "number" && Number.isFinite(valid) ? valid / 60 : 0;
  const nextBuf = st.liveState.mpsBuffer.slice();
  nextBuf.push(rate);
  if (nextBuf.length > MPS_BUFFER_LEN)
    nextBuf.splice(0, nextBuf.length - MPS_BUFFER_LEN);
  useIdentStore.setState({
    liveState: { ...st.liveState, mpsBuffer: nextBuf },
  });
}

// Single 1 Hz sampler. Idempotent — module-level guard prevents duplicate
// timers under HMR / repeat imports.
let mpsSamplerTimer: ReturnType<typeof setInterval> | null = null;
if (mpsSamplerTimer == null && typeof setInterval !== "undefined") {
  mpsSamplerTimer = setInterval(sampleMpsOnce, MPS_SAMPLE_INTERVAL_MS);
}
