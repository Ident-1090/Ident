import { create } from "zustand";
import { labelFieldsKey, startMapTimingTrace } from "../debug/mapTiming";
import type { BasemapId } from "../map/styles";
import { deriveFilterFromQuery } from "../omnibox/grammar";
import type { FilterExpressionState } from "./predicates";
import {
  type LabelFields,
  normalizeUnitOverrides,
  type ReplayWindowPreferences,
  usePreferencesStore,
} from "./preferences";
import { aircraftRecency } from "./recency";
import type {
  Aircraft,
  AircraftFrame,
  AircraftIDKind,
  AircraftType,
  Alert,
  CategoryKey,
  ClockMode,
  HeyWhatsThatJson,
  IdentBuildInfo,
  IdentCapabilitiesEnvelope,
  IdentDiagnostic,
  IdentRangeOutline,
  IdentReplayAvailability,
  IdentStatus,
  InspectorTab,
  LabelMode,
  LayerKey,
  ReceiverJson,
  ReplayBlockFile,
  ReplayBlockIndex,
  ReplayFrame,
  ReplayManifest,
  RouteInfo,
  ThemeMode,
  TrailPoint,
  TrailPointInput,
  UnitMode,
  UnitOverrides,
} from "./types";

export type { LabelFields } from "./preferences";

export type ConnStatus = "connecting" | "open" | "closed";

export interface ConnStatusInfo {
  isRetry?: boolean;
  retryDelayMs?: number;
  nextRetryAt?: number;
}

const TREND_BUFFER_LEN = 60;
const ALERT_MAX = 50;
const ALERT_WINDOW_MS = 30 * 60 * 1000;
const TRAIL_SEGMENT_GROUND_DWELL_MS = 60_000;
const TRAIL_SEGMENT_AIRBORNE_NOISE_MS = 10_000;

// Per-hex trail buffer keeps the current leg. settings.trailFadeSec controls how
// much of that buffer is drawn for UNSELECTED aircraft; selected renders all.
const TRAIL_POINT_CAP = 1500;
const TRAIL_FADE_MIN_SEC = 10;
const TRAIL_FADE_MAX_SEC = 600;

const MAP_CENTER_EPSILON_DEG = 1e-6;
const MAP_ZOOM_EPSILON = 1e-3;

const MPS_BUFFER_LEN = 60;
const MPS_SAMPLE_INTERVAL_MS = 1000;
const REPLAY_INTERACTION_GRACE_MS = 10 * 60 * 1000;
const REPLAY_HEAD_KEEP_MS = 60 * 60 * 1000;
const REPLAY_PLAYHEAD_KEEP_MS = 60 * 60 * 1000;
const REPLAY_LOADED_FRAME_CAP = 50_000;

export function getNow(): number {
  return Date.now();
}

export interface InspectorSlice {
  tab: InspectorTab;
}

export interface FilterSlice {
  categories: Record<CategoryKey, boolean>;
  altRangeFt: [number, number];
  emergOnly: boolean;
  hideGround: boolean;
  groundOnly: boolean;
  hasPosOnly: boolean;
  // Free-text field filters set by the omnibox grammar (e.g. `op:delta`).
  // Empty string = no filter. Matching is case-insensitive substring for
  // operatorContains (over ac.op / ac.desc) and case-insensitive prefix
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
  // Aircraft source-kind (ac.source): empty string means no filter. Shorthand
  // values `adsb`, `tisb` match any member of that prefix family; other
  // values compare exactly against ac.source.
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
  expression: FilterExpressionState | null;
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
  showTrailTooltip: boolean;
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

// Relay-pushed runtime config (`config` channel). Populated on WS connect.
export interface ConfigSlice {
  station: string | null;
  ident: IdentBuildInfo | null;
}

export type ReplayMode = "live" | "replay";

export interface ReplayViewWindow {
  rangeId: string;
  rangeMs: number;
  fromExpr: string;
  toExpr: string;
  fixedEndMs: number | null;
  requestedEndMs?: number | null;
}

export interface ReplaySlice {
  enabled: boolean;
  availableFrom: number | null;
  availableTo: number | null;
  blockSec: number;
  blocks: ReplayBlockIndex[];
  unavailableBlockUrls: Record<string, true>;
  recent?: ReplayBlockFile | null;
  cache: Record<string, ReplayBlockFile>;
  mode: ReplayMode;
  playheadMs: number | null;
  trailStartMs: number | null;
  playing: boolean;
  speed: 1 | 4 | 16;
  viewWindow?: ReplayViewWindow;
  followLiveEdge: boolean;
  lastInteractionAt: number | null;
  loading: boolean;
  resumeAfterLoading: boolean;
  error: string | null;
  errorUrl: string | null;
}

export type ReplayFollowState = Pick<
  ReplaySlice,
  "mode" | "playheadMs" | "availableTo" | "viewWindow" | "followLiveEdge"
>;

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
  groundOnly: false,
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
  expression: null,
};

export interface IdentState {
  aircraft: Map<string, Aircraft>;
  receiver: ReceiverJson | null;
  rangeOutline: IdentRangeOutline | null;
  identStatus: IdentStatus | null;
  // Live diagnostics, snapshot-replaced on every `diagnostics` envelope. The
  // backend store dedupes by (channel, code, scope); the wire payload is
  // already the authoritative full set, so consumers replace, never merge.
  diagnostics: IdentDiagnostic[];
  capabilities: IdentCapabilitiesEnvelope | null;
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

  // Per-aircraft position trails for the current leg. The render path decides
  // how much of it to draw based on settings.trailFadeSec and selection.
  trailsByHex: Record<string, TrailPoint[]>;

  // Relay-supplied line-of-sight rings from the config snapshot.
  losData: HeyWhatsThatJson | null;

  // Live feedback (1 Hz msg-rate rolling window + last-snapshot timestamp).
  liveState: LiveStateSlice;

  // Relay-supplied runtime config (station name, …).
  config: ConfigSlice;

  // File-backed replay. Receiver status and diagnostics remain live; this
  // swaps the traffic/trails display surface only.
  replay: ReplaySlice;

  // Ingestion.
  ingestAircraft: (frame: AircraftFrame) => void;
  ingestRangeOutline: (outline: IdentRangeOutline) => void;
  ingestStatus: (s: IdentStatus) => void;
  ingestDiagnostics: (diagnostics: IdentDiagnostic[]) => void;
  ingestCapabilities: (c: IdentCapabilitiesEnvelope) => void;
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
  setFilterGsRangeKt: (range: [number, number] | null) => void;
  setFilterDistRangeNm: (range: [number, number] | null) => void;
  setFilterVsRangeFpm: (range: [number, number] | null) => void;
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
  recordTrailPoint: (hex: string, point: TrailPointInput) => void;

  // LOS rings.
  setLosData: (data: HeyWhatsThatJson | null) => void;

  // Live feedback.
  recordSnapshot: () => void;

  // Replay.
  setReplayManifest: (manifest: ReplayManifest) => void;
  ingestReplayAvailability: (envelope: IdentReplayAvailability) => void;
  setReplayBlock: (url: string, block: ReplayBlockFile) => void;
  markReplayBlockUnavailable: (url: string) => void;
  setReplayRecent: (block: ReplayBlockFile | null) => void;
  setReplayLoading: (loading: boolean) => void;
  setReplayError: (error: string | null, url?: string | null) => void;
  enterReplay: (playheadMs?: number) => void;
  goLive: () => void;
  setReplayPlayhead: (playheadMs: number) => void;
  setReplayPlaying: (playing: boolean) => void;
  setReplaySpeed: (speed: 1 | 4 | 16) => void;
  setReplayViewWindow: (window: ReplayViewWindow) => void;
}

function appendTrimmed(buf: number[] | undefined, value: number): number[] {
  const next = buf ? buf.slice() : [];
  next.push(value);
  if (next.length > TREND_BUFFER_LEN)
    next.splice(0, next.length - TREND_BUFFER_LEN);
  return next;
}

function aircraftFrameTimestampMs(frame: AircraftFrame): number {
  return typeof frame.observedAtEpochSec === "number" &&
    Number.isFinite(frame.observedAtEpochSec)
    ? Math.round(frame.observedAtEpochSec * 1000)
    : Date.now();
}

function aircraftFrameAdvanced(
  frame: AircraftFrame,
  previousNow: number,
): boolean {
  return (
    typeof frame.observedAtEpochSec === "number" &&
    Number.isFinite(frame.observedAtEpochSec) &&
    frame.observedAtEpochSec > previousNow
  );
}

function replayBlockAvailability(blocks: ReplayBlockIndex[]): {
  from: number | null;
  to: number | null;
} {
  if (blocks.length === 0) return { from: null, to: null };
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const block of blocks) {
    from = Math.min(from, block.start);
    to = Math.max(to, block.end);
  }
  return Number.isFinite(from) && Number.isFinite(to)
    ? { from, to }
    : { from: null, to: null };
}

function replayAvailability(
  remoteFrom: number | null,
  remoteTo: number | null,
  recent: ReplayBlockFile | null,
): { from: number | null; to: number | null } {
  let from = remoteFrom;
  let to = remoteTo;
  if (recent && recent.frames.length > 0) {
    from = from == null ? recent.start : Math.min(from, recent.start);
    to = to == null ? recent.end : Math.max(to, recent.end);
  }
  return { from, to };
}

interface ReplayAvailabilityUpdate {
  enabled: boolean;
  remoteFrom: number | null;
  remoteTo: number | null;
  blockSec: number;
  // When omitted, the existing block index is preserved. Manifest fetches
  // supply it; envelope updates do not, because the envelope carries only
  // bounds and a count.
  blocks?: ReplayBlockIndex[];
}

function applyReplayAvailability(
  replay: ReplaySlice,
  update: ReplayAvailabilityUpdate,
): ReplaySlice {
  const enabled = update.enabled;
  const blocks = update.blocks ?? replay.blocks;
  const unavailableBlockUrls = enabled
    ? replayUnavailableBlockUrls(replay.unavailableBlockUrls, blocks)
    : {};
  const available = replayAvailability(
    update.remoteFrom,
    update.remoteTo,
    replay.recent ?? null,
  );
  const availableFrom = available.from;
  const availableTo = available.to;
  const requestedReplay =
    enabled && replay.mode === "replay" && availableFrom != null;
  const followsLiveEdge = requestedReplay && replayFollowsLiveEdge(replay);
  const mode = requestedReplay && !followsLiveEdge ? "replay" : "live";
  const playheadMs =
    mode === "replay"
      ? clampReplayPlayhead(
          replay.playheadMs ?? availableTo ?? availableFrom ?? 0,
          availableFrom,
          availableTo,
        )
      : null;
  return {
    ...replay,
    enabled,
    availableFrom,
    availableTo,
    blockSec: update.blockSec > 0 ? update.blockSec : replay.blockSec,
    blocks,
    unavailableBlockUrls,
    recent: enabled ? replay.recent : null,
    mode,
    playheadMs,
    trailStartMs:
      mode === "replay" ? (replay.trailStartMs ?? playheadMs) : null,
    playing: mode === "replay" ? replay.playing : true,
    viewWindow:
      mode === "live" ? liveReplayWindow(replay.viewWindow) : replay.viewWindow,
    followLiveEdge: false,
    loading: followsLiveEdge ? false : replay.loading,
    resumeAfterLoading: followsLiveEdge ? false : replay.resumeAfterLoading,
    error: enabled ? replay.error : null,
    errorUrl: enabled ? replay.errorUrl : null,
  };
}

function replayUnavailableBlockUrls(
  urls: Record<string, true> | undefined,
  blocks: ReplayBlockIndex[],
): Record<string, true> {
  const next: Record<string, true> = {};
  const manifestUrls = new Set(blocks.map((block) => block.url));
  for (const url of Object.keys(urls ?? {})) {
    if (manifestUrls.has(url)) next[url] = true;
  }
  return next;
}

function normalizeReplayBlock(block: ReplayBlockFile): ReplayBlockFile {
  const frames = Array.isArray(block.frames)
    ? block.frames
        .map(normalizeReplayFrame)
        .filter((frame): frame is ReplayFrame => frame != null)
        .slice()
        .sort((a, b) => a.ts - b.ts)
    : [];
  const start = Number.isFinite(block.start)
    ? block.start
    : (frames[0]?.ts ?? 0);
  const end = Number.isFinite(block.end)
    ? block.end
    : (frames[frames.length - 1]?.ts ?? start);
  return {
    version: 2,
    start,
    end,
    step_ms:
      Number.isFinite(block.step_ms) && block.step_ms > 0
        ? block.step_ms
        : 1000,
    frames,
  };
}

function normalizeReplayFrame(frame: unknown): ReplayFrame | null {
  const obj = replayObject(frame);
  if (!obj) return null;
  const ts = replayNumber(obj, "ts");
  if (ts == null) return null;
  const aircraft = Array.isArray(obj.aircraft)
    ? obj.aircraft
        .map(normalizeReplayAircraft)
        .filter((ac): ac is Aircraft => ac != null)
    : [];
  return { ts, aircraft };
}

function normalizeReplayAircraft(raw: unknown): Aircraft | null {
  const obj = replayObject(raw);
  if (!obj) return null;
  const hex = replayString(obj, "hex")?.trim().toLowerCase();
  if (!hex) return null;
  if (isCurrentAircraftShape(obj)) {
    const out: Aircraft = {
      ...(obj as Partial<Aircraft>),
      hex,
      idKind: replayAircraftIDKind(replayString(obj, "idKind"), hex),
      source: replayAircraftType(replayString(obj, "source")),
    };
    const flight = replayString(obj, "flight")?.trim();
    if (flight) out.flight = flight;
    return out;
  }
  const out: Aircraft = {
    hex,
    idKind: replayAircraftIDKind(undefined, hex),
    source: replayAircraftType(replayString(obj, "type")),
  };
  assignReplayString(out, "flight", obj, "flight", true);
  assignReplayString(out, "reg", obj, "r");
  assignReplayString(out, "typeDesignator", obj, "t");
  assignReplayString(out, "desc", obj, "desc");
  assignReplayString(out, "op", obj, "ownOp");
  assignReplayString(out, "cat", obj, "category");
  assignReplayNumber(out, "lat", obj, "lat");
  assignReplayNumber(out, "lon", obj, "lon");
  assignReplayNumber(out, "seenPosSec", obj, "seen_pos");
  assignReplayNumber(out, "altGeomFt", obj, "alt_geom");
  assignReplayNumber(out, "gsKt", obj, "gs");
  assignReplayNumber(out, "trackDeg", obj, "track");
  assignReplayNumber(out, "baroRateFpm", obj, "baro_rate");
  assignReplayNumber(out, "geomRateFpm", obj, "geom_rate");
  assignReplayString(out, "squawk", obj, "squawk");
  assignReplayString(out, "emergency", obj, "emergency");
  assignReplayNumber(out, "qnhHPa", obj, "nav_qnh");
  assignReplayNumber(out, "mcpAltFt", obj, "nav_altitude_mcp");
  assignReplayNumber(out, "fmsAltFt", obj, "nav_altitude_fms");
  assignReplayNumber(out, "navHdgDeg", obj, "nav_heading");
  assignReplayNumber(out, "trueHeadingDeg", obj, "true_heading");
  assignReplayNumber(out, "magHeadingDeg", obj, "mag_heading");
  assignReplayNumber(out, "aircraftMessagesTotal", obj, "messages");
  assignReplayNumber(out, "seenSec", obj, "seen");
  assignReplayNumber(out, "rssiDbfs", obj, "rssi");
  assignReplayNumber(out, "dbFlags", obj, "dbFlags");
  const navModes = replayStringArray(obj, "nav_modes");
  if (navModes) out.navModes = navModes;
  const altBaro = obj.alt_baro;
  if (typeof altBaro === "number" && Number.isFinite(altBaro)) {
    out.altBaroFt = altBaro;
  } else if (altBaro === "ground") {
    out.onGround = true;
  }
  const airground = replayString(obj, "airground");
  if (airground === "ground") out.onGround = true;
  if (airground === "airborne") out.onGround = false;
  return out;
}

function isCurrentAircraftShape(obj: Record<string, unknown>): boolean {
  return (
    "idKind" in obj ||
    "source" in obj ||
    "typeDesignator" in obj ||
    "altBaroFt" in obj ||
    "trackDeg" in obj
  );
}

function replayObject(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function replayString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

function replayNumber(
  obj: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = obj[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function replayStringArray(
  obj: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = obj[key];
  if (!Array.isArray(value)) return undefined;
  const out = value.filter(
    (entry): entry is string => typeof entry === "string",
  );
  return out.length > 0 ? out : undefined;
}

function assignReplayString<K extends keyof Aircraft>(
  out: Aircraft,
  target: K,
  obj: Record<string, unknown>,
  source: string,
  trim = false,
): void {
  const value = replayString(obj, source);
  if (value == null) return;
  const next = trim ? value.trim() : value;
  if (next) (out[target] as string | undefined) = next;
}

function assignReplayNumber<K extends keyof Aircraft>(
  out: Aircraft,
  target: K,
  obj: Record<string, unknown>,
  source: string,
): void {
  const value = replayNumber(obj, source);
  if (value != null) (out[target] as number | undefined) = value;
}

const REPLAY_AIRCRAFT_TYPES = new Set<AircraftType>([
  "adsb_icao",
  "adsb_icao_nt",
  "adsr_icao",
  "tisb_icao",
  "mlat",
  "mode_s",
  "adsb_other",
  "adsr_other",
  "tisb_trackfile",
  "tisb_other",
  "mode_ac",
  "unknown",
]);

function replayAircraftType(value: string | undefined): AircraftType {
  return value && REPLAY_AIRCRAFT_TYPES.has(value as AircraftType)
    ? (value as AircraftType)
    : "unknown";
}

function replayAircraftIDKind(
  value: string | undefined,
  hex: string,
): AircraftIDKind {
  if (value === "icao" || value === "non_icao" || value === "unknown") {
    return value;
  }
  if (hex.startsWith("~")) return "non_icao";
  return /^[0-9a-f]{6}$/.test(hex) ? "icao" : "unknown";
}

function appendRecentReplayFrame(
  replay: ReplaySlice,
  frame: ReplayFrame,
): ReplaySlice {
  if (!replay.enabled || frame.aircraft.length === 0) return replay;
  const followsLiveEdge = replayFollowsLiveEdge(replay);
  const prev = replay.recent ?? {
    version: 2 as const,
    start: frame.ts,
    end: frame.ts,
    step_ms: 1000,
    frames: [],
  };
  if (
    prev.frames.length > 0 &&
    frame.ts <= prev.frames[prev.frames.length - 1].ts
  ) {
    return replay;
  }
  const frames = [...prev.frames, frame];
  const nextRecent = pruneRecentReplayFrames(
    {
      version: 2,
      start: Math.min(prev.start, frame.ts),
      end: Math.max(prev.end, frame.ts),
      step_ms: prev.step_ms,
      frames,
    },
    replay,
    frame.ts,
  );
  const remote = replayBlockAvailability(replay.blocks);
  const available = replayAvailability(remote.from, remote.to, nextRecent);
  return {
    ...replay,
    recent: nextRecent,
    availableFrom: available.from,
    availableTo: available.to,
    mode: followsLiveEdge ? "live" : replay.mode,
    playheadMs: followsLiveEdge ? null : replay.playheadMs,
    playing: followsLiveEdge ? true : replay.playing,
    followLiveEdge: false,
    loading: followsLiveEdge ? false : replay.loading,
    resumeAfterLoading: followsLiveEdge ? false : replay.resumeAfterLoading,
  };
}

function pruneRecentReplayFrames(
  block: ReplayBlockFile,
  replay: ReplaySlice,
  headMs: number,
): ReplayBlockFile {
  if (block.frames.length <= REPLAY_LOADED_FRAME_CAP) return block;
  if (
    replay.lastInteractionAt != null &&
    getNow() - replay.lastInteractionAt < REPLAY_INTERACTION_GRACE_MS
  ) {
    return block;
  }
  const playhead = replay.playheadMs;
  const headKeepFrom = headMs - REPLAY_HEAD_KEEP_MS;
  let frames = block.frames;
  while (frames.length > REPLAY_LOADED_FRAME_CAP) {
    const idx = frames.findIndex((frame) =>
      canDropRecentReplayFrame(frame, replay, headKeepFrom, playhead),
    );
    if (idx < 0) break;
    frames = [...frames.slice(0, idx), ...frames.slice(idx + 1)];
  }
  if (frames.length === 0) return { ...block, frames: [] };
  return {
    ...block,
    start: frames[0].ts,
    end: frames[frames.length - 1].ts,
    frames,
  };
}

function canDropRecentReplayFrame(
  frame: ReplayFrame,
  replay: ReplaySlice,
  headKeepFrom: number,
  playhead: number | null,
): boolean {
  if (!replayTimeCoveredByRemote(frame.ts, replay.blocks)) return false;
  if (frame.ts >= headKeepFrom) return false;
  if (
    playhead != null &&
    Math.abs(frame.ts - playhead) <= REPLAY_PLAYHEAD_KEEP_MS
  ) {
    return false;
  }
  return true;
}

function replayTimeCoveredByRemote(
  ts: number,
  blocks: ReplayBlockIndex[],
): boolean {
  return blocks.some((block) => ts >= block.start && ts <= block.end);
}

function retainAgedAircraft(
  next: Map<string, Aircraft>,
  previous: IdentState,
  frame: AircraftFrame,
): void {
  const elapsedSec = frame.observedAtEpochSec - previous.now;
  for (const [hex, aircraft] of previous.aircraft) {
    if (next.has(hex)) continue;
    const aged = ageAircraft(aircraft, elapsedSec);
    const isSelected = hex === previous.selectedHex;
    if (!isSelected && aircraftRecency(aged, false) === "lost") continue;
    next.set(hex, aged);
  }
}

function ageAircraft(aircraft: Aircraft, deltaSec: number): Aircraft {
  const delta = Number.isFinite(deltaSec) && deltaSec > 0 ? deltaSec : 0;
  if (delta === 0) return aircraft;
  return {
    ...aircraft,
    seenSec: ageSeconds(aircraft.seenSec, delta),
    seenPosSec: ageSeconds(aircraft.seenPosSec, delta),
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

const INITIAL_CAMERA_STATE: CameraSlice = {
  trackSelected: false,
  autoFitTraffic: false,
  lastUserInteraction: null,
};

const INITIAL_REPLAY_STATE: ReplaySlice = {
  enabled: false,
  availableFrom: null,
  availableTo: null,
  blockSec: 300,
  blocks: [],
  unavailableBlockUrls: {},
  recent: null,
  cache: {},
  mode: "live",
  playheadMs: null,
  trailStartMs: null,
  playing: true,
  speed: 1,
  viewWindow: usePreferencesStore.getState().replayWindow,
  followLiveEdge: false,
  lastInteractionAt: null,
  loading: false,
  resumeAfterLoading: false,
  error: null,
  errorUrl: null,
};

export const useIdentStore = create<IdentState>((set) => ({
  aircraft: new Map(),
  receiver: null,
  rangeOutline: null,
  identStatus: null,
  diagnostics: [],
  capabilities: null,
  now: 0,
  connectionStatus: { ws: "connecting" },
  connectionStatusInfo: { ws: { isRetry: false } },
  selectedHex: null,

  inspector: { tab: usePreferencesStore.getState().inspectorTab },
  altTrendsByHex: {},
  gsTrendsByHex: {},
  rssiBufByHex: {},
  routeByCallsign: {},

  filter: DEFAULT_FILTER,

  alerts: [],

  map: {
    ...usePreferencesStore.getState().map,
    viewportHexes: null,
    recenterRequestId: 0,
  },

  labels: {
    hoveredHex: null,
  },

  search: { query: "" },

  camera: INITIAL_CAMERA_STATE,

  settings: usePreferencesStore.getState().settings,

  trailsByHex: {},

  losData: null,

  liveState: { lastMsgTs: 0, mpsBuffer: [], routesViaWs: false },

  config: { station: null, ident: null },

  replay: INITIAL_REPLAY_STATE,

  ingestAircraft: (frame) =>
    set((st) => {
      const advanced = aircraftFrameAdvanced(frame, st.now);
      const next = new Map<string, Aircraft>();
      for (const ac of frame.aircraft) {
        next.set(ac.hex, ac);
      }
      retainAgedAircraft(next, st, frame);
      const retainedHexes = new Set(next.keys());
      const nowMs = aircraftFrameTimestampMs(frame);

      // Push sampled numeric values (altBaroFt, gs, rssi) into per-hex rolling
      // buffers. Keeping this inside ingestAircraft gives us a single call site
      // for live and replayed aircraft frames.
      const altTrendsByHex: Record<string, number[]> = { ...st.altTrendsByHex };
      const gsTrendsByHex: Record<string, number[]> = { ...st.gsTrendsByHex };
      const rssiBufByHex: Record<string, number[]> = { ...st.rssiBufByHex };
      for (const ac of frame.aircraft) {
        if (typeof ac.altBaroFt === "number") {
          altTrendsByHex[ac.hex] = appendTrimmed(
            altTrendsByHex[ac.hex],
            ac.altBaroFt,
          );
        }
        if (typeof ac.gsKt === "number") {
          gsTrendsByHex[ac.hex] = appendTrimmed(gsTrendsByHex[ac.hex], ac.gsKt);
        }
        if (typeof ac.rssiDbfs === "number") {
          rssiBufByHex[ac.hex] = appendTrimmed(
            rssiBufByHex[ac.hex],
            ac.rssiDbfs,
          );
        }
      }
      let trailsByHex = retainTrailsForAircraft(st.trailsByHex, retainedHexes);
      if (advanced) {
        let nextTrailsByHex: Record<string, TrailPoint[]> | null = null;
        for (const ac of frame.aircraft) {
          if (typeof ac.lat !== "number" || typeof ac.lon !== "number")
            continue;
          nextTrailsByHex ??= { ...trailsByHex };
          appendTrailPointToRecord(
            nextTrailsByHex,
            ac.hex,
            trailPointFromAircraft(ac as PositionedAircraft, nowMs),
          );
        }
        if (nextTrailsByHex) trailsByHex = nextTrailsByHex;
      }

      return {
        aircraft: next,
        now: frame.observedAtEpochSec,
        selectedHex: st.selectedHex,
        camera: st.camera,
        altTrendsByHex,
        gsTrendsByHex,
        rssiBufByHex,
        trailsByHex,
        liveState: advanced
          ? { ...st.liveState, lastMsgTs: Date.now() }
          : st.liveState,
        replay: appendRecentReplayFrame(st.replay, {
          ts: nowMs,
          aircraft: frame.aircraft,
        }),
      };
    }),

  ingestRangeOutline: (rangeOutline) => set({ rangeOutline }),
  ingestStatus: (status) =>
    set((st) => {
      const previous = st.identStatus;
      const merged: IdentStatus = {
        schema: status.schema,
        observedAt: status.observedAt,
        freshness: status.freshness,
        receiverPosition: status.receiverPosition ?? previous?.receiverPosition,
        messageRate: status.messageRate ?? previous?.messageRate,
        gain: status.gain ?? previous?.gain,
        uptime: status.uptime ?? previous?.uptime,
        maxRange: status.maxRange ?? previous?.maxRange,
      };
      const pos =
        merged.receiverPosition?.kind !== "unavailable"
          ? merged.receiverPosition?.value
          : undefined;
      // Producer identity lives in the capabilities envelope; pull from
      // there for the receiver-display label instead of duplicating it on
      // every status envelope.
      const producer = st.capabilities?.producer;
      return {
        identStatus: merged,
        receiver: pos
          ? {
              lat: pos.lat,
              lon: pos.lon,
              version: producer?.version ?? producer?.kind ?? "unknown",
            }
          : st.receiver,
      };
    }),
  // Snapshot replacement: the diagnostics envelope is the full set, identity
  // dedup happens on the backend, so the frontend just replaces.
  ingestDiagnostics: (diagnostics) => set({ diagnostics }),
  ingestCapabilities: (capabilities) =>
    set((st) => {
      // Capabilities can arrive AFTER a status envelope on snapshot
      // replay or reconnect ordering. ingestStatus reads producer
      // info from capabilities at merge time and falls back to
      // "unknown" if absent — so we recompute the receiver label
      // here to resolve the race instead of leaving "unknown" stuck.
      const next: Partial<IdentState> = { capabilities };
      if (st.receiver) {
        next.receiver = {
          ...st.receiver,
          version: capabilities.producer.version ?? capabilities.producer.kind,
        };
      }
      return next;
    }),
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

  setInspectorTab: (tab) => {
    usePreferencesStore.getState().setInspectorTab(tab);
    set((st) => ({ inspector: { ...st.inspector, tab } }));
  },

  recordAircraftSample: (hex, sample) =>
    set((st) => {
      const altTrendsByHex =
        typeof sample.altBaroFt === "number"
          ? {
              ...st.altTrendsByHex,
              [hex]: appendTrimmed(st.altTrendsByHex[hex], sample.altBaroFt),
            }
          : st.altTrendsByHex;
      const gsTrendsByHex =
        typeof sample.gsKt === "number"
          ? {
              ...st.gsTrendsByHex,
              [hex]: appendTrimmed(st.gsTrendsByHex[hex], sample.gsKt),
            }
          : st.gsTrendsByHex;
      const rssiBufByHex =
        typeof sample.rssiDbfs === "number"
          ? {
              ...st.rssiBufByHex,
              [hex]: appendTrimmed(st.rssiBufByHex[hex], sample.rssiDbfs),
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
  setFilterGsRangeKt: (range) =>
    set((st) => ({ filter: { ...st.filter, gsRangeKt: range } })),
  setFilterDistRangeNm: (range) =>
    set((st) => ({ filter: { ...st.filter, distRangeNm: range } })),
  setFilterVsRangeFpm: (range) =>
    set((st) => ({ filter: { ...st.filter, vsRangeFpm: range } })),
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
      usePreferencesStore.getState().setMapPreferences(map);
      return { map };
    }),

  toggleLayer: (key) =>
    set((st) => {
      const map = {
        ...st.map,
        layers: { ...st.map.layers, [key]: !st.map.layers[key] },
      };
      usePreferencesStore.getState().setMapPreferences(map);
      return { map };
    }),

  setBasemap: (id) =>
    set((st) => {
      const map = { ...st.map, basemapId: id };
      usePreferencesStore.getState().setMapPreferences(map);
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
      usePreferencesStore.getState().setMapPreferences(map);
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
      usePreferencesStore.getState().setMapPreferences(map);
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
      const at = interaction.at ?? getNow();
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
        showTrailTooltip: next.showTrailTooltip ?? st.settings.showTrailTooltip,
        unitMode: next.unitMode ?? st.settings.unitMode,
        unitOverrides: normalizeUnitOverrides(
          next.unitOverrides,
          st.settings.unitOverrides,
        ),
        clock: next.clock ?? st.settings.clock,
        theme: next.theme ?? st.settings.theme,
      };
      usePreferencesStore.getState().setSettingsPreferences(settings);
      return { settings };
    }),

  setTrailFadeSec: (sec) =>
    set((st) => {
      const clamped = Math.max(
        TRAIL_FADE_MIN_SEC,
        Math.min(TRAIL_FADE_MAX_SEC, Math.round(sec)),
      );
      const settings = { ...st.settings, trailFadeSec: clamped };
      usePreferencesStore.getState().setSettingsPreferences(settings);
      return { settings };
    }),

  recordTrailPoint: (hex, point) =>
    set((st) => ({
      trailsByHex: appendTrailPoint(st.trailsByHex, hex, point),
    })),

  setLosData: (data) => set({ losData: data }),

  recordSnapshot: () =>
    set((st) => ({ liveState: { ...st.liveState, lastMsgTs: Date.now() } })),

  setReplayManifest: (manifest) =>
    set((st) => ({
      replay: applyReplayAvailability(st.replay, {
        enabled: manifest.enabled,
        remoteFrom: manifest.from ?? null,
        remoteTo: manifest.to ?? null,
        blockSec: manifest.block_sec,
        blocks: Array.isArray(manifest.blocks) ? manifest.blocks : undefined,
      }),
    })),

  ingestReplayAvailability: (envelope) =>
    set((st) => ({
      replay: applyReplayAvailability(st.replay, {
        enabled: envelope.enabled,
        remoteFrom: envelope.fromEpochMs ?? null,
        remoteTo: envelope.toEpochMs ?? null,
        blockSec: envelope.blockSec,
      }),
    })),

  setReplayBlock: (url, block) =>
    set((st) => {
      const normalized = normalizeReplayBlock(block);
      const clearError = shouldClearReplayBlockError(
        st.replay,
        url,
        block,
        normalized,
      );
      const unavailableBlockUrls = {
        ...(st.replay.unavailableBlockUrls ?? {}),
      };
      delete unavailableBlockUrls[url];
      return {
        replay: {
          ...st.replay,
          cache: { ...st.replay.cache, [url]: normalized },
          unavailableBlockUrls,
          error: clearError ? null : st.replay.error,
          errorUrl: clearError ? null : st.replay.errorUrl,
        },
      };
    }),

  markReplayBlockUnavailable: (url) =>
    set((st) =>
      st.replay.unavailableBlockUrls?.[url]
        ? st
        : {
            replay: {
              ...st.replay,
              unavailableBlockUrls: {
                ...(st.replay.unavailableBlockUrls ?? {}),
                [url]: true,
              },
            },
          },
    ),

  setReplayRecent: (block) =>
    set((st) => {
      const recent = block ? normalizeReplayBlock(block) : null;
      const remote = replayBlockAvailability(st.replay.blocks);
      const available = replayAvailability(remote.from, remote.to, recent);
      const clearError = st.replay.errorUrl == null;
      return {
        replay: {
          ...st.replay,
          recent,
          availableFrom: available.from,
          availableTo: available.to,
          error: clearError ? null : st.replay.error,
          errorUrl: clearError ? null : st.replay.errorUrl,
        },
      };
    }),

  setReplayLoading: (loading) =>
    set((st) => {
      if (replayFollowsLiveEdge(st.replay)) {
        return {
          replay: {
            ...st.replay,
            mode: "live",
            playheadMs: null,
            trailStartMs: null,
            loading: false,
            playing: true,
            viewWindow: liveReplayWindow(st.replay.viewWindow),
            resumeAfterLoading: false,
            followLiveEdge: false,
          },
        };
      }
      if (loading) {
        const shouldResume = st.replay.mode === "replay" && st.replay.playing;
        if (
          st.replay.loading &&
          !shouldResume &&
          !st.replay.resumeAfterLoading
        ) {
          return st;
        }
        return {
          replay: {
            ...st.replay,
            loading: true,
            playing: shouldResume ? false : st.replay.playing,
            resumeAfterLoading: st.replay.resumeAfterLoading || shouldResume,
          },
        };
      }
      const shouldResume =
        st.replay.mode === "replay" && st.replay.resumeAfterLoading;
      if (!st.replay.loading && !shouldResume) return st;
      return {
        replay: {
          ...st.replay,
          loading: false,
          playing: shouldResume ? true : st.replay.playing,
          resumeAfterLoading: false,
        },
      };
    }),

  setReplayError: (error, url = null) =>
    set((st) => ({
      replay: {
        ...st.replay,
        error,
        errorUrl: error ? url : null,
        loading: false,
        resumeAfterLoading: false,
      },
    })),

  enterReplay: (playheadMs) =>
    set((st) => {
      if (
        !st.replay.enabled ||
        st.replay.availableFrom == null ||
        st.replay.availableTo == null
      ) {
        return st;
      }
      const nextPlayhead = clampReplayPlayhead(
        playheadMs ?? st.replay.availableTo,
        st.replay.availableFrom,
        st.replay.availableTo,
      );
      const snappedPlayhead = snapReplayPlayheadToLoadedFrame(
        st.replay,
        nextPlayhead,
      );
      const followLiveEdge = snappedPlayhead >= st.replay.availableTo - 1;
      if (followLiveEdge) {
        return {
          replay: {
            ...st.replay,
            mode: "live",
            playheadMs: null,
            trailStartMs: null,
            playing: true,
            viewWindow: liveReplayWindow(st.replay.viewWindow),
            followLiveEdge: false,
            loading: false,
            resumeAfterLoading: false,
            lastInteractionAt: getNow(),
            error: null,
            errorUrl: null,
          },
        };
      }
      return {
        replay: {
          ...st.replay,
          mode: "replay",
          playheadMs: snappedPlayhead,
          trailStartMs: snappedPlayhead,
          playing: false,
          followLiveEdge: false,
          loading: st.replay.loading,
          resumeAfterLoading: st.replay.resumeAfterLoading,
          lastInteractionAt: getNow(),
          error: null,
          errorUrl: null,
        },
      };
    }),

  goLive: () =>
    set((st) => ({
      replay: {
        ...st.replay,
        mode: "live",
        playheadMs: null,
        trailStartMs: null,
        playing: true,
        viewWindow: liveReplayWindow(st.replay.viewWindow),
        followLiveEdge: false,
        loading: false,
        resumeAfterLoading: false,
        lastInteractionAt: getNow(),
      },
    })),

  setReplayPlayhead: (playheadMs) =>
    set((st) => {
      if (st.replay.availableFrom == null || st.replay.availableTo == null) {
        return st;
      }
      const fixedEndMs = st.replay.viewWindow?.fixedEndMs;
      const effectiveTo =
        fixedEndMs == null
          ? st.replay.availableTo
          : Math.min(st.replay.availableTo, fixedEndMs);
      const nextPlayhead = snapReplayPlayheadToLoadedFrame(
        st.replay,
        clampReplayPlayhead(playheadMs, st.replay.availableFrom, effectiveTo),
      );
      if (fixedEndMs == null && nextPlayhead >= st.replay.availableTo) {
        return {
          replay: {
            ...st.replay,
            mode: "live",
            playing: true,
            playheadMs: null,
            trailStartMs: null,
            viewWindow: liveReplayWindow(st.replay.viewWindow),
            followLiveEdge: false,
            loading: false,
            resumeAfterLoading: false,
            lastInteractionAt: getNow(),
          },
        };
      }
      return {
        replay: {
          ...st.replay,
          playheadMs: nextPlayhead,
          followLiveEdge: false,
          loading: false,
          resumeAfterLoading: false,
          lastInteractionAt: getNow(),
        },
      };
    }),

  setReplayPlaying: (playing) =>
    set((st) => ({
      replay: {
        ...st.replay,
        playing: replayFollowsLiveEdge(st.replay)
          ? true
          : st.replay.mode === "replay"
            ? playing
            : true,
        resumeAfterLoading: false,
        lastInteractionAt:
          st.replay.mode === "replay" ? getNow() : st.replay.lastInteractionAt,
      },
    })),

  setReplaySpeed: (speed) =>
    set((st) => ({
      replay: { ...st.replay, speed, lastInteractionAt: getNow() },
    })),

  setReplayViewWindow: (window) => {
    const nextWindow = normalizeReplayViewWindow(window);
    if (isPersistableReplayWindow(nextWindow)) {
      usePreferencesStore.getState().setReplayWindow({
        rangeId: nextWindow.rangeId,
        rangeMs: nextWindow.rangeMs,
        fromExpr: nextWindow.fromExpr,
        toExpr: "now",
        fixedEndMs: null,
      });
    }
    set((st) => ({
      replay: {
        ...st.replay,
        viewWindow: nextWindow,
        followLiveEdge:
          st.replay.followLiveEdge && nextWindow.fixedEndMs == null,
      },
    }));
  },
}));

function clampReplayPlayhead(
  value: number,
  from: number | null,
  to: number | null,
): number {
  if (!Number.isFinite(value)) return from ?? to ?? 0;
  let out = value;
  if (from != null) out = Math.max(from, out);
  if (to != null) out = Math.min(to, out);
  return out;
}

function shouldClearReplayBlockError(
  replay: ReplaySlice,
  url: string,
  original: ReplayBlockFile,
  normalized: ReplayBlockFile,
): boolean {
  if (replay.errorUrl !== url) return false;
  return !(
    Array.isArray(original.frames) &&
    original.frames.length > 0 &&
    normalized.frames.length === 0
  );
}

export function replayFollowsLiveEdge(replay: ReplayFollowState): boolean {
  return (
    replay.mode === "replay" &&
    replay.playheadMs != null &&
    replay.availableTo != null &&
    replay.viewWindow?.fixedEndMs == null &&
    (replay.followLiveEdge || replay.playheadMs >= replay.availableTo - 1)
  );
}

function snapReplayPlayheadToLoadedFrame(
  replay: ReplaySlice,
  playheadMs: number,
): number {
  const blocks = replayLoadedBlocksFromReplay(replay);
  let hasContainingBlock = false;
  let nextFrame: ReplayFrame | null = null;
  for (const block of blocks) {
    if (playheadMs < block.start || playheadMs > block.end) continue;
    hasContainingBlock = true;
    if (frameAtOrBefore(block.frames, playheadMs)) return playheadMs;
    const frame = frameAtOrAfter(block.frames, playheadMs);
    if (frame && (!nextFrame || frame.ts < nextFrame.ts)) nextFrame = frame;
  }
  if (!hasContainingBlock) return playheadMs;
  if (!nextFrame) {
    for (const block of blocks) {
      if (playheadMs > block.end) continue;
      const frame = frameAtOrAfter(block.frames, playheadMs);
      if (frame && (!nextFrame || frame.ts < nextFrame.ts)) nextFrame = frame;
    }
  }
  return nextFrame && nextFrame.ts > playheadMs ? nextFrame.ts : playheadMs;
}

function liveReplayWindow(window: ReplayViewWindow | undefined) {
  if (!window) return window;
  return {
    ...window,
    toExpr: "now",
    fixedEndMs: null,
    requestedEndMs: null,
  };
}

function normalizeReplayViewWindow(window: ReplayViewWindow): ReplayViewWindow {
  const fixedEndMsValid =
    window.fixedEndMs != null &&
    Number.isFinite(window.fixedEndMs) &&
    window.fixedEndMs > 0;
  const requestedEndMsValid =
    window.requestedEndMs != null &&
    Number.isFinite(window.requestedEndMs) &&
    window.requestedEndMs > 0 &&
    Number.isFinite(window.rangeMs) &&
    window.rangeMs > 0 &&
    window.requestedEndMs - window.rangeMs >= 0;
  if (
    (window.fixedEndMs != null && !fixedEndMsValid) ||
    (window.requestedEndMs != null && !requestedEndMsValid)
  ) {
    console.warn("[ident replay] invalid replay view window", {
      fixedEndMs: window.fixedEndMs,
      rangeMs: window.rangeMs,
      requestedEndMs: window.requestedEndMs,
    });
  }
  const fixedEndMs =
    window.fixedEndMs != null && fixedEndMsValid ? window.fixedEndMs : null;
  const requestedEndMs =
    window.requestedEndMs != null && requestedEndMsValid
      ? window.requestedEndMs
      : null;
  return {
    ...window,
    fixedEndMs,
    requestedEndMs,
  };
}

function isPersistableReplayWindow(
  window: ReplayViewWindow,
): window is ReplayWindowPreferences {
  return window.fixedEndMs === null && window.toExpr.trim() === "now";
}

const EMPTY_REPLAY_AIRCRAFT = new Map<string, Aircraft>();
const EMPTY_REPLAY_TRAILS: Record<string, TrailPoint[]> = {};
const replayAircraftMapByFrame = new WeakMap<
  ReplayFrame,
  Map<string, Aircraft>
>();
let replayTrailsCache: {
  blocks: Record<string, ReplayBlockFile>;
  recent: ReplayBlockFile | null | undefined;
  trailStore: Record<string, TrailPoint[]>;
  frameTs: number;
  trailStartMs: number | null;
  selectedHex: string | null;
  trails: Record<string, TrailPoint[]>;
} | null = null;
let replayTrailStoreCache: {
  trailStore: Record<string, TrailPoint[]>;
  frameTs: number;
  trailStartMs: number | null;
  selectedHex: string | null;
  trails: Record<string, TrailPoint[]>;
} | null = null;
let displayTrailsCache: {
  source: Record<string, TrailPoint[]>;
  trails: Record<string, TrailPoint[]>;
} | null = null;

export function __resetTrailDisplayCachesForTests(): void {
  replayTrailsCache = null;
  replayTrailStoreCache = null;
  displayTrailsCache = null;
}

export function selectDisplayAircraftMap(
  st: IdentState,
): Map<string, Aircraft> {
  const frame = currentReplayFrame(st);
  if (st.replay.mode === "replay") {
    if (!frame) return EMPTY_REPLAY_AIRCRAFT;
    const cached = replayAircraftMapByFrame.get(frame);
    if (cached) return cached;
    const next = new Map(frame.aircraft.map((ac) => [ac.hex, ac]));
    replayAircraftMapByFrame.set(frame, next);
    return next;
  }
  return st.aircraft;
}

export function selectDisplayNow(st: IdentState): number {
  return selectDisplayNowMs(st) / 1000;
}

export function selectDisplayNowMs(st: IdentState): number {
  return st.replay.mode === "replay" && st.replay.playheadMs != null
    ? st.replay.playheadMs
    : st.now * 1000;
}

export function selectDisplayTrailNowMs(st: IdentState): number {
  if (st.replay.mode !== "replay" || st.replay.playheadMs == null) {
    return st.now * 1000;
  }
  return currentReplayFrame(st)?.ts ?? st.replay.playheadMs;
}

export function selectDisplayTrailsByHex(
  st: IdentState,
): Record<string, TrailPoint[]> {
  if (st.replay.mode !== "replay" || st.replay.playheadMs == null) {
    return st.trailsByHex;
  }
  const blocks = replayLoadedBlocks(st);
  const trailStoreTrails = cachedReplayTrailStoreDisplayTrails(
    st,
    st.replay.playheadMs,
  );
  if (blocks.length === 0) return trailStoreTrails;
  const frame = currentReplayFrameFromBlocks(st, blocks);
  if (!frame) return trailStoreTrails;
  if (
    replayTrailsCache &&
    replayTrailsCache.blocks === st.replay.cache &&
    replayTrailsCache.recent === st.replay.recent &&
    replayTrailsCache.trailStore === st.trailsByHex &&
    replayTrailsCache.frameTs === frame.ts &&
    replayTrailsCache.trailStartMs === st.replay.trailStartMs &&
    replayTrailsCache.selectedHex === st.selectedHex
  ) {
    return replayTrailsCache.trails;
  }
  const selectedHex = st.selectedHex;
  const unselectedSince = frame.ts - TRAIL_FADE_MAX_SEC * 1000;
  const selectedSince =
    selectedHex == null
      ? unselectedSince
      : selectedReplayTrailStart(
          blocks,
          selectedHex,
          frame.ts,
          st.replay.trailStartMs ?? unselectedSince,
        );
  const out: Record<string, TrailPoint[]> = {};
  const segmentStates = new Map<string, TrailSegmentState>();
  for (const block of blocks) {
    let i = firstFrameAtOrAfter(block.frames, selectedSince);
    for (; i < block.frames.length; i += 1) {
      const replayFrame = block.frames[i];
      if (replayFrame.ts > frame.ts) break;
      for (const ac of replayFrame.aircraft) {
        if (ac.hex !== selectedHex && replayFrame.ts < unselectedSince)
          continue;
        if (typeof ac.lat !== "number" || typeof ac.lon !== "number") continue;
        const series = out[ac.hex] ?? [];
        const segmentState = segmentStates.get(ac.hex) ?? { segment: 0 };
        const point = assignTrailPointSegment(
          trailPointFromAircraft(
            ac as PositionedAircraft,
            replayFrame.ts,
            segmentState,
          ),
          series,
        );
        segmentStates.set(
          ac.hex,
          advanceTrailSegmentState(segmentState, point),
        );
        series.push(point);
        out[ac.hex] = series;
      }
    }
  }
  for (const [hex, series] of Object.entries(out)) {
    if (hex !== selectedHex && series.length > TRAIL_POINT_CAP) {
      out[hex] = series.slice(series.length - TRAIL_POINT_CAP);
    }
  }
  const trails = replayTrailsWithTrailStore(
    displayLatestTrailSegments(out),
    cachedReplayTrailStoreDisplayTrails(st, frame.ts),
  );
  replayTrailsCache = {
    blocks: st.replay.cache,
    recent: st.replay.recent,
    trailStore: st.trailsByHex,
    frameTs: frame.ts,
    trailStartMs: st.replay.trailStartMs,
    selectedHex,
    trails,
  };
  return trails;
}

function cachedReplayTrailStoreDisplayTrails(
  st: IdentState,
  frameTs: number,
): Record<string, TrailPoint[]> {
  if (
    replayTrailStoreCache &&
    replayTrailStoreCache.trailStore === st.trailsByHex &&
    replayTrailStoreCache.frameTs === frameTs &&
    replayTrailStoreCache.trailStartMs === st.replay.trailStartMs &&
    replayTrailStoreCache.selectedHex === st.selectedHex
  ) {
    return replayTrailStoreCache.trails;
  }
  const trails = replayTrailStoreDisplayTrails(st, frameTs);
  replayTrailStoreCache = {
    trailStore: st.trailsByHex,
    frameTs,
    trailStartMs: st.replay.trailStartMs,
    selectedHex: st.selectedHex,
    trails,
  };
  return trails;
}

function replayTrailStoreDisplayTrails(
  st: IdentState,
  frameTs: number,
): Record<string, TrailPoint[]> {
  const selectedHex = st.selectedHex;
  const unselectedSince = frameTs - TRAIL_FADE_MAX_SEC * 1000;
  const out: Record<string, TrailPoint[]> = {};
  for (const [hex, points] of Object.entries(st.trailsByHex)) {
    const since =
      hex === selectedHex
        ? (st.replay.trailStartMs ?? unselectedSince)
        : unselectedSince;
    const kept = points.filter(
      (point) => point.ts >= since && point.ts <= frameTs,
    );
    if (kept.length === 0) continue;
    out[hex] =
      hex === selectedHex || kept.length <= TRAIL_POINT_CAP
        ? latestTrailSegment(kept)
        : latestTrailSegment(kept.slice(kept.length - TRAIL_POINT_CAP));
  }
  return Object.keys(out).length > 0 ? out : EMPTY_REPLAY_TRAILS;
}

function replayTrailsWithTrailStore(
  replayTrails: Record<string, TrailPoint[]>,
  trailStoreTrails: Record<string, TrailPoint[]>,
): Record<string, TrailPoint[]> {
  if (trailStoreTrails === EMPTY_REPLAY_TRAILS) return replayTrails;
  if (replayTrails === EMPTY_REPLAY_TRAILS) return trailStoreTrails;
  return { ...replayTrails, ...trailStoreTrails };
}

interface TrailSegmentState {
  segment: number;
  lastGround?: boolean;
  groundSince?: number;
  airborneSince?: number;
}

type PositionedAircraft = Aircraft & { lat: number; lon: number };

export function trailPointFromAircraft(
  ac: PositionedAircraft,
  ts: number,
  segmentState?: TrailSegmentState,
): TrailPointInput {
  const ground = aircraftOnGround(ac);
  const { alt, alt_source } = aircraftTrailAltitude(ac, ground);
  const point: TrailPointInput = {
    lat: ac.lat,
    lon: ac.lon,
    alt,
    ts,
    ground,
  };
  if (typeof ac.gsKt === "number") point.gs = ac.gsKt;
  if (typeof ac.trackDeg === "number") point.track = ac.trackDeg;
  if (ac.source) point.source = ac.source;
  if (alt_source) point.alt_source = alt_source;
  if (typeof ac.altGeomFt === "number") point.altGeomFt = ac.altGeomFt;
  if (segmentState) {
    point.segment = nextTrailSegment(segmentState, point);
  }
  return point;
}

function aircraftOnGround(ac: Aircraft): boolean {
  return ac.onGround === true;
}

function aircraftTrailAltitude(
  ac: Aircraft,
  ground: boolean,
): { alt: TrailPoint["alt"]; alt_source?: TrailPoint["alt_source"] } {
  if (typeof ac.altBaroFt === "number") {
    return { alt: ac.altBaroFt, alt_source: "baro" };
  }
  if (ground) return { alt: null };
  if (typeof ac.altGeomFt === "number") {
    return { alt: ac.altGeomFt, alt_source: "geom" };
  }
  return { alt: null };
}

function assignTrailPointSegment(
  point: TrailPointInput,
  previous: TrailPoint[] | undefined,
): TrailPoint {
  if (point.segment != null) return { ...point, segment: point.segment };
  const state = trailSegmentStateFromSeries(previous);
  return { ...point, segment: nextTrailSegment(state, point) };
}

function trailSegmentStateFromSeries(
  series: TrailPoint[] | undefined,
): TrailSegmentState {
  let state: TrailSegmentState = { segment: 0 };
  for (const point of series ?? []) {
    state.segment = point.segment ?? state.segment;
    state = advanceTrailSegmentState(state, point);
  }
  return state;
}

function nextTrailSegment(
  state: TrailSegmentState,
  point: TrailPointInput,
): number {
  if (point.ground) return state.segment;
  if (
    state.groundSince != null &&
    point.ts - state.groundSince >= TRAIL_SEGMENT_GROUND_DWELL_MS
  ) {
    return state.segment + 1;
  }
  return state.segment;
}

function advanceTrailSegmentState(
  state: TrailSegmentState,
  point: TrailPoint,
): TrailSegmentState {
  const segment = point.segment ?? state.segment;
  if (point.ground) {
    return {
      segment,
      lastGround: true,
      groundSince: state.lastGround ? state.groundSince : point.ts,
    };
  }
  if (state.groundSince == null) return { segment, lastGround: false };
  if (segment > state.segment) return { segment, lastGround: false };
  if (state.airborneSince == null) {
    return {
      segment,
      lastGround: false,
      groundSince: state.groundSince,
      airborneSince: point.ts,
    };
  }
  if (point.ts - state.airborneSince >= TRAIL_SEGMENT_AIRBORNE_NOISE_MS) {
    return { segment, lastGround: false };
  }
  return {
    segment,
    lastGround: false,
    groundSince: state.groundSince,
    airborneSince: state.airborneSince,
  };
}

function displayLatestTrailSegments(
  source: Record<string, TrailPoint[]>,
): Record<string, TrailPoint[]> {
  if (displayTrailsCache?.source === source) return displayTrailsCache.trails;
  let changed = false;
  const trails: Record<string, TrailPoint[]> = {};
  for (const [hex, points] of Object.entries(source)) {
    const latest = latestTrailSegment(points);
    trails[hex] = latest;
    if (latest !== points) changed = true;
  }
  const out = changed ? trails : source;
  displayTrailsCache = { source, trails: out };
  return out;
}

function retainTrailsForAircraft(
  source: Record<string, TrailPoint[]>,
  activeHexes: Set<string>,
): Record<string, TrailPoint[]> {
  let changed = false;
  const trails: Record<string, TrailPoint[]> = {};
  for (const [hex, points] of Object.entries(source)) {
    if (activeHexes.has(hex)) {
      trails[hex] = points;
    } else {
      changed = true;
    }
  }
  return changed ? trails : source;
}

function trailWithAppendedPoint(
  previous: TrailPoint[] | undefined,
  next: TrailPoint[],
  point: TrailPoint,
): TrailPoint[] {
  const previousSegment = previous?.at(-1)?.segment;
  return previousSegment != null && previousSegment !== point.segment
    ? [point]
    : next;
}

function appendTrailPoint(
  source: Record<string, TrailPoint[]>,
  hex: string,
  point: TrailPointInput,
): Record<string, TrailPoint[]> {
  const next = { ...source };
  appendTrailPointToRecord(next, hex, point);
  return next;
}

function appendTrailPointToRecord(
  source: Record<string, TrailPoint[]>,
  hex: string,
  point: TrailPointInput,
): void {
  const prev = source[hex];
  const next = prev ? prev.slice() : [];
  const assigned = assignTrailPointSegment(point, prev);
  next.push(assigned);
  source[hex] = trailWithAppendedPoint(prev, next, assigned);
}

function latestTrailSegment(points: TrailPoint[]): TrailPoint[] {
  if (points.length === 0) return points;
  const segment = points[points.length - 1].segment;
  if (segment == null) return points;
  let start = points.length - 1;
  while (start > 0 && points[start - 1].segment === segment) start--;
  return start === 0 ? points : points.slice(start);
}

export function pruneRetainedTrail(points: TrailPoint[]): TrailPoint[] {
  return latestTrailSegment(points);
}

function selectedReplayTrailStart(
  blocks: ReplayBlockFile[],
  selectedHex: string,
  playheadMs: number,
  fallbackStartMs: number,
): number {
  let startMs = fallbackStartMs;
  for (const block of blocks) {
    if (block.start >= startMs || block.start > playheadMs) continue;
    if (blockContainsAircraftAtOrBefore(block, selectedHex, playheadMs)) {
      startMs = block.start;
    }
  }
  return startMs;
}

function blockContainsAircraftAtOrBefore(
  block: ReplayBlockFile,
  hex: string,
  playheadMs: number,
): boolean {
  for (const frame of block.frames) {
    if (frame.ts > playheadMs) break;
    if (frame.aircraft.some((ac) => ac.hex === hex)) return true;
  }
  return false;
}

function currentReplayFrame(st: IdentState): ReplayFrame | null {
  if (st.replay.mode !== "replay" || st.replay.playheadMs == null) return null;
  return currentReplayFrameFromBlocks(st, replayLoadedBlocks(st));
}

function currentReplayFrameFromBlocks(
  st: IdentState,
  blocks: ReplayBlockFile[],
): ReplayFrame | null {
  if (st.replay.mode !== "replay" || st.replay.playheadMs == null) return null;
  let best: ReplayFrame | null = null;
  for (const block of blocks) {
    if (st.replay.playheadMs > block.end) continue;
    if (st.replay.playheadMs < block.start) continue;
    const frame = frameAtOrBefore(block.frames, st.replay.playheadMs);
    if (frame && (!best || frame.ts > best.ts)) best = frame;
  }
  return best;
}

function frameAtOrBefore(
  frames: ReplayFrame[],
  timestampMs: number,
): ReplayFrame | null {
  const index = firstFrameAfter(frames, timestampMs) - 1;
  return index >= 0 ? frames[index] : null;
}

function frameAtOrAfter(
  frames: ReplayFrame[],
  timestampMs: number,
): ReplayFrame | null {
  const index = firstFrameAtOrAfter(frames, timestampMs);
  return index < frames.length ? frames[index] : null;
}

function firstFrameAtOrAfter(
  frames: ReplayFrame[],
  timestampMs: number,
): number {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (frames[mid].ts < timestampMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function firstFrameAfter(frames: ReplayFrame[], timestampMs: number): number {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (frames[mid].ts <= timestampMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function replayLoadedBlocks(st: IdentState): ReplayBlockFile[] {
  return replayLoadedBlocksFromReplay(st.replay);
}

function replayLoadedBlocksFromReplay(replay: ReplaySlice): ReplayBlockFile[] {
  const blocks = Object.values(replay.cache);
  if (replay.recent && replay.recent.frames.length > 0) {
    blocks.push(replay.recent);
  }
  blocks.sort((a, b) => a.start - b.start);
  return blocks;
}

/**
 * Append the normalized message rate to the rolling buffer. Exported for direct
 * invocation from tests — the 1 Hz timer below is the production call site.
 */
export function sampleMpsOnce(): void {
  const st = useIdentStore.getState();
  const messageRate = st.identStatus?.messageRate;
  const normalizedRate =
    messageRate && messageRate.kind !== "unavailable"
      ? messageRate.value.hz
      : undefined;
  let rate = 0;
  if (typeof normalizedRate === "number" && Number.isFinite(normalizedRate)) {
    rate = normalizedRate;
  }
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
