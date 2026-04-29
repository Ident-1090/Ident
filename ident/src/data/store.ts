import { create } from "zustand";
import { labelFieldsKey, startMapTimingTrace } from "../debug/mapTiming";
import type { BasemapId } from "../map/styles";
import { deriveFilterFromQuery } from "../omnibox/grammar";
import {
  type LabelFields,
  normalizeUnitOverrides,
  type ReplayWindowPreferences,
  usePreferencesStore,
} from "./preferences";
import type {
  Aircraft,
  AircraftFrame,
  Alert,
  CategoryKey,
  ClockMode,
  HeyWhatsThatJson,
  InspectorTab,
  LabelMode,
  LayerKey,
  OutlineJson,
  ReceiverJson,
  ReplayBlockFile,
  ReplayBlockIndex,
  ReplayFrame,
  ReplayManifest,
  RouteInfo,
  StatsJson,
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

// Per-hex trail buffer holds full in-range history, bounded only by point count
// (~1.5 h at 4 s historical cadence + 1 Hz live). settings.trailFadeSec controls
// how much of that buffer is drawn for UNSELECTED aircraft; selected renders all.
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
  recent?: ReplayBlockFile | null;
  cache: Record<string, ReplayBlockFile>;
  mode: ReplayMode;
  playheadMs: number | null;
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

  // File-backed replay. Receiver status and diagnostics remain live; this
  // swaps the traffic/trails display surface only.
  replay: ReplaySlice;

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
  recordTrailPoint: (hex: string, point: TrailPointInput) => void;

  // LOS rings.
  setLosData: (data: HeyWhatsThatJson | null) => void;

  // Live feedback.
  recordSnapshot: () => void;

  // Update notification.
  setUpdateStatus: (next: Partial<UpdateSlice>) => void;

  // Replay.
  setReplayManifest: (manifest: ReplayManifest) => void;
  setReplayBlock: (url: string, block: ReplayBlockFile) => void;
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
  return typeof frame.now === "number" && Number.isFinite(frame.now)
    ? Math.round(frame.now * 1000)
    : Date.now();
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

function normalizeReplayBlock(block: ReplayBlockFile): ReplayBlockFile {
  const frames = Array.isArray(block.frames)
    ? block.frames
        .filter((frame) => typeof frame.ts === "number")
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
    version: 1,
    start,
    end,
    step_ms:
      Number.isFinite(block.step_ms) && block.step_ms > 0
        ? block.step_ms
        : 1000,
    frames,
  };
}

function appendRecentReplayFrame(
  replay: ReplaySlice,
  frame: ReplayFrame,
): ReplaySlice {
  if (!replay.enabled || frame.aircraft.length === 0) return replay;
  const followsLiveEdge = replayFollowsLiveEdge(replay);
  const prev = replay.recent ?? {
    version: 1 as const,
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
      version: 1,
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

const INITIAL_REPLAY_STATE: ReplaySlice = {
  enabled: false,
  availableFrom: null,
  availableTo: null,
  blockSec: 300,
  blocks: [],
  recent: null,
  cache: {},
  mode: "live",
  playheadMs: null,
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
  stats: null,
  outline: null,
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

  config: { station: null },

  update: INITIAL_UPDATE_STATE,

  replay: INITIAL_REPLAY_STATE,

  ingestAircraft: (frame) =>
    set((st) => {
      const next = new Map<string, Aircraft>();
      for (const ac of frame.aircraft) next.set(ac.hex, ac);
      retainSelectedAircraft(next, st, frame);
      const nowMs = aircraftFrameTimestampMs(frame);

      // Push sampled numeric values (alt_baro, gs, rssi) into per-hex rolling
      // buffers. Keeping this inside ingestAircraft gives us a single call site
      // for live and replayed aircraft frames.
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
        replay: appendRecentReplayFrame(st.replay, {
          ts: nowMs,
          aircraft: frame.aircraft,
        }),
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

  setInspectorTab: (tab) => {
    usePreferencesStore.getState().setInspectorTab(tab);
    set((st) => ({ inspector: { ...st.inspector, tab } }));
  },

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
    set((st) => {
      const prev = st.trailsByHex[hex];
      const next = prev ? prev.slice() : [];
      next.push(assignTrailPointSegment(point, prev));
      if (next.length > TRAIL_POINT_CAP)
        next.splice(0, next.length - TRAIL_POINT_CAP);
      return { trailsByHex: { ...st.trailsByHex, [hex]: next } };
    }),

  setLosData: (data) => set({ losData: data }),

  recordSnapshot: () =>
    set((st) => ({ liveState: { ...st.liveState, lastMsgTs: Date.now() } })),

  setUpdateStatus: (next) =>
    set((st) => ({ update: { ...st.update, ...next } })),

  setReplayManifest: (manifest) =>
    set((st) => {
      const enabled = manifest.enabled;
      const available = replayAvailability(
        manifest.from ?? null,
        manifest.to ?? null,
        st.replay.recent ?? null,
      );
      const availableFrom = available.from;
      const availableTo = available.to;
      const requestedReplay =
        enabled && st.replay.mode === "replay" && availableFrom != null;
      const followsLiveEdge =
        requestedReplay && replayFollowsLiveEdge(st.replay);
      const mode = requestedReplay && !followsLiveEdge ? "replay" : "live";
      const playheadMs =
        mode === "replay"
          ? clampReplayPlayhead(
              st.replay.playheadMs ?? availableTo ?? availableFrom ?? 0,
              availableFrom,
              availableTo,
            )
          : null;
      return {
        replay: {
          ...st.replay,
          enabled,
          availableFrom,
          availableTo,
          blockSec:
            manifest.block_sec > 0 ? manifest.block_sec : st.replay.blockSec,
          blocks: Array.isArray(manifest.blocks) ? manifest.blocks : [],
          recent: enabled ? st.replay.recent : null,
          mode,
          playheadMs,
          playing: mode === "replay" ? st.replay.playing : true,
          viewWindow:
            mode === "live"
              ? liveReplayWindow(st.replay.viewWindow)
              : st.replay.viewWindow,
          followLiveEdge: false,
          loading: followsLiveEdge ? false : st.replay.loading,
          resumeAfterLoading: followsLiveEdge
            ? false
            : st.replay.resumeAfterLoading,
          error: enabled ? st.replay.error : null,
          errorUrl: enabled ? st.replay.errorUrl : null,
        },
      };
    }),

  setReplayBlock: (url, block) =>
    set((st) => {
      const normalized = normalizeReplayBlock(block);
      const clearError = shouldClearReplayBlockError(
        st.replay,
        url,
        block,
        normalized,
      );
      return {
        replay: {
          ...st.replay,
          cache: { ...st.replay.cache, [url]: normalized },
          error: clearError ? null : st.replay.error,
          errorUrl: clearError ? null : st.replay.errorUrl,
        },
      };
    }),

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
  playheadMs: number;
  trails: Record<string, TrailPoint[]>;
} | null = null;
let displayTrailsCache: {
  source: Record<string, TrailPoint[]>;
  trails: Record<string, TrailPoint[]>;
} | null = null;

export function __resetTrailDisplayCachesForTests(): void {
  replayTrailsCache = null;
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

export function selectDisplayTrailsByHex(
  st: IdentState,
): Record<string, TrailPoint[]> {
  if (st.replay.mode !== "replay" || st.replay.playheadMs == null) {
    return displayLatestTrailSegments(st.trailsByHex);
  }
  const blocks = replayLoadedBlocks(st);
  if (blocks.length === 0) return EMPTY_REPLAY_TRAILS;
  if (
    replayTrailsCache &&
    replayTrailsCache.blocks === st.replay.cache &&
    replayTrailsCache.recent === st.replay.recent &&
    replayTrailsCache.playheadMs === st.replay.playheadMs
  ) {
    return replayTrailsCache.trails;
  }
  const since = st.replay.playheadMs - TRAIL_FADE_MAX_SEC * 1000;
  const out: Record<string, TrailPoint[]> = {};
  const segmentStates = new Map<string, TrailSegmentState>();
  for (const block of blocks) {
    let i = firstFrameAtOrAfter(block.frames, since);
    for (; i < block.frames.length; i += 1) {
      const frame = block.frames[i];
      if (frame.ts > st.replay.playheadMs) break;
      for (const ac of frame.aircraft) {
        if (typeof ac.lat !== "number" || typeof ac.lon !== "number") continue;
        const series = out[ac.hex] ?? [];
        const segmentState = segmentStates.get(ac.hex) ?? { segment: 0 };
        const point = assignTrailPointSegment(
          trailPointFromAircraft(
            { ...ac, lat: ac.lat, lon: ac.lon },
            frame.ts,
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
    series.sort((a, b) => a.ts - b.ts);
    if (series.length > TRAIL_POINT_CAP) {
      out[hex] = series.slice(series.length - TRAIL_POINT_CAP);
    }
  }
  const trails = displayLatestTrailSegments(out);
  replayTrailsCache = {
    blocks: st.replay.cache,
    recent: st.replay.recent,
    playheadMs: st.replay.playheadMs,
    trails,
  };
  return trails;
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
  if (typeof ac.seen_pos === "number" && ac.seen_pos > 20) point.stale = true;
  if (typeof ac.gs === "number") point.gs = ac.gs;
  if (typeof ac.track === "number") point.track = ac.track;
  if (ac.type) point.source = ac.type;
  if (alt_source) point.alt_source = alt_source;
  if (typeof ac.alt_geom === "number") point.alt_geom = ac.alt_geom;
  if (segmentState) {
    point.segment = nextTrailSegment(segmentState, point);
  }
  return point;
}

function aircraftOnGround(ac: Aircraft): boolean {
  return (
    ac.alt_baro === "ground" || ac.airground === 1 || ac.airground === "ground"
  );
}

function aircraftTrailAltitude(
  ac: Aircraft,
  ground: boolean,
): { alt: TrailPoint["alt"]; alt_source?: TrailPoint["alt_source"] } {
  if (ac.alt_baro === "ground") return { alt: "ground" };
  if (typeof ac.alt_baro === "number") {
    return { alt: ac.alt_baro, alt_source: "baro" };
  }
  if (ground) return { alt: "ground" };
  if (typeof ac.alt_geom === "number") {
    return { alt: ac.alt_geom, alt_source: "geom" };
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

function latestTrailSegment(points: TrailPoint[]): TrailPoint[] {
  if (points.length === 0) return points;
  const segment = points[points.length - 1].segment;
  if (segment == null) return points;
  let start = points.length - 1;
  while (start > 0 && points[start - 1].segment === segment) start--;
  return start === 0 ? points : points.slice(start);
}

function currentReplayFrame(st: IdentState): ReplayFrame | null {
  if (st.replay.mode !== "replay" || st.replay.playheadMs == null) return null;
  let best: ReplayFrame | null = null;
  for (const block of replayLoadedBlocks(st)) {
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
  return blocks;
}

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
