import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { BasemapId } from "../map/styles";
import { presetUnitOverrides } from "../settings/format";
import type {
  AltitudeUnit,
  ClockMode,
  DistanceUnit,
  HorizontalSpeedUnit,
  InspectorTab,
  LabelMode,
  LayerKey,
  TemperatureUnit,
  ThemeMode,
  UnitMode,
  UnitOverrides,
  VerticalSpeedUnit,
} from "./types";

const PREFERENCES_STORAGE_KEY = "ident.preferences";
const RELEASE_UPDATE_DISMISSAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface LabelFields {
  cs: boolean;
  type: boolean;
  alt: boolean;
  spd: boolean;
  sqk: boolean;
  rt: boolean;
}

export interface MapPreferences {
  labelMode: LabelMode;
  layers: Record<LayerKey, boolean>;
  labelFields: LabelFields;
  basemapId: BasemapId;
  center: { lng: number; lat: number } | null;
  zoom: number | null;
}

export interface SettingsPreferences {
  trailFadeSec: number;
  showTrailTooltip: boolean;
  unitMode: UnitMode;
  unitOverrides: UnitOverrides;
  clock: ClockMode;
  theme: ThemeMode;
}

export interface LayoutPreferences {
  railCollapsed: boolean;
}

export interface ReplayWindowPreferences {
  rangeId: string;
  rangeMs: number;
  fromExpr: string;
  toExpr: "now";
  fixedEndMs: null;
}

export interface ReplayRangeRecent {
  label: string;
  from: string;
  to: string;
}

export interface ReleaseUpdateDismissal {
  version: string;
  dismissedUntil: number;
}

interface PreferencesState {
  map: MapPreferences;
  settings: SettingsPreferences;
  layout: LayoutPreferences;
  replayWindow: ReplayWindowPreferences;
  replayRangeRecents: ReplayRangeRecent[];
  inspectorTab: InspectorTab;
  updateDismissal: ReleaseUpdateDismissal | null;
  setMapPreferences: (next: Partial<MapPreferences>) => void;
  setSettingsPreferences: (next: SettingsPreferences) => void;
  setLayoutPreferences: (next: Partial<LayoutPreferences>) => void;
  setReplayWindow: (next: ReplayWindowPreferences) => void;
  setReplayRangeRecents: (next: ReplayRangeRecent[]) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  dismissReleaseUpdate: (version: string) => void;
  clearExpiredReleaseUpdateDismissal: (now?: number) => void;
}

export const DEFAULT_LABEL_FIELDS: LabelFields = {
  cs: true,
  type: false,
  alt: true,
  spd: true,
  sqk: false,
  rt: false,
};

export const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  rangeRings: true,
  rxRange: false,
  trails: false,
  losRings: false,
};

export const DEFAULT_MAP_PREFERENCES: MapPreferences = {
  labelMode: "arrow",
  layers: DEFAULT_LAYERS,
  labelFields: DEFAULT_LABEL_FIELDS,
  basemapId: "ident",
  center: null,
  zoom: null,
};

export const DEFAULT_SETTINGS_PREFERENCES: SettingsPreferences = {
  trailFadeSec: 180,
  showTrailTooltip: true,
  unitMode: "aviation",
  unitOverrides: presetUnitOverrides("aviation"),
  clock: "utc",
  theme: "system",
};

export const DEFAULT_LAYOUT_PREFERENCES: LayoutPreferences = {
  railCollapsed: false,
};

export const DEFAULT_REPLAY_WINDOW_PREFERENCES: ReplayWindowPreferences = {
  rangeId: "8h",
  rangeMs: 8 * 60 * 60_000,
  fromExpr: "now-8h",
  toExpr: "now",
  fixedEndMs: null,
};

export const DEFAULT_REPLAY_RANGE_RECENTS: ReplayRangeRecent[] = [];

const VALID_BASEMAP_IDS: BasemapId[] = [
  "ident",
  "osm",
  "cartoPositron",
  "cartoDark",
  "esriSat",
  "esriTerrain",
];

export function isReleaseUpdateDismissed(
  version: string | null,
  dismissal: ReleaseUpdateDismissal | null,
  now = Date.now(),
): boolean {
  return (
    version != null &&
    dismissal?.version === version &&
    dismissal.dismissedUntil > now
  );
}

export function normalizeUnitOverrides(
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

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      map: DEFAULT_MAP_PREFERENCES,
      settings: DEFAULT_SETTINGS_PREFERENCES,
      layout: DEFAULT_LAYOUT_PREFERENCES,
      replayWindow: DEFAULT_REPLAY_WINDOW_PREFERENCES,
      replayRangeRecents: DEFAULT_REPLAY_RANGE_RECENTS,
      inspectorTab: "telemetry",
      updateDismissal: null,
      setMapPreferences: (next) =>
        set((st) => ({ map: normalizeMapPreferences(next, st.map) })),
      setSettingsPreferences: (next) => set({ settings: next }),
      setLayoutPreferences: (next) =>
        set((st) => ({ layout: normalizeLayoutPreferences(next, st.layout) })),
      setReplayWindow: (next) => set({ replayWindow: next }),
      setReplayRangeRecents: (next) =>
        set({ replayRangeRecents: normalizeReplayRangeRecents(next) }),
      setInspectorTab: (tab) => set({ inspectorTab: tab }),
      dismissReleaseUpdate: (version) =>
        set(() => {
          const trimmedVersion = version.trim();
          if (!trimmedVersion) return {};
          return {
            updateDismissal: {
              version: trimmedVersion,
              dismissedUntil: Date.now() + RELEASE_UPDATE_DISMISSAL_MS,
            },
          };
        }),
      clearExpiredReleaseUpdateDismissal: (now = Date.now()) =>
        set((st) =>
          st.updateDismissal != null && st.updateDismissal.dismissedUntil <= now
            ? { updateDismissal: null }
            : {},
        ),
    }),
    {
      name: PREFERENCES_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        map: state.map,
        settings: state.settings,
        layout: state.layout,
        replayWindow: state.replayWindow,
        replayRangeRecents: state.replayRangeRecents,
        inspectorTab: state.inspectorTab,
        updateDismissal: state.updateDismissal,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<
          Pick<
            PreferencesState,
            | "map"
            | "settings"
            | "layout"
            | "replayWindow"
            | "replayRangeRecents"
            | "inspectorTab"
            | "updateDismissal"
          >
        >;
        return {
          ...current,
          map: normalizeMapPreferences(saved.map, current.map),
          settings: normalizeSettingsPreferences(
            saved.settings,
            current.settings,
          ),
          layout: normalizeLayoutPreferences(saved.layout, current.layout),
          replayWindow: normalizeReplayWindowPreferences(
            saved.replayWindow,
            current.replayWindow,
          ),
          replayRangeRecents: normalizeReplayRangeRecents(
            saved.replayRangeRecents,
          ),
          inspectorTab: isInspectorTab(saved.inspectorTab)
            ? saved.inspectorTab
            : current.inspectorTab,
          updateDismissal: normalizeReleaseUpdateDismissal(
            saved.updateDismissal,
          ),
        };
      },
    },
  ),
);

export function resetPreferencesStoreForTests(): void {
  usePreferencesStore.persist.clearStorage();
  usePreferencesStore.setState({
    map: DEFAULT_MAP_PREFERENCES,
    settings: DEFAULT_SETTINGS_PREFERENCES,
    layout: DEFAULT_LAYOUT_PREFERENCES,
    replayWindow: DEFAULT_REPLAY_WINDOW_PREFERENCES,
    replayRangeRecents: DEFAULT_REPLAY_RANGE_RECENTS,
    inspectorTab: "telemetry",
    updateDismissal: null,
  });
}

function normalizeMapPreferences(
  raw: Partial<MapPreferences> | undefined,
  defaults: MapPreferences,
): MapPreferences {
  const labelMode =
    raw?.labelMode === "arrow" || raw?.labelMode === "icon"
      ? raw.labelMode
      : defaults.labelMode;
  const basemapId = VALID_BASEMAP_IDS.includes(raw?.basemapId as BasemapId)
    ? (raw?.basemapId as BasemapId)
    : defaults.basemapId;
  const center =
    raw?.center &&
    typeof raw.center.lng === "number" &&
    typeof raw.center.lat === "number"
      ? { lng: raw.center.lng, lat: raw.center.lat }
      : defaults.center;
  const zoom = typeof raw?.zoom === "number" ? raw.zoom : defaults.zoom;
  const layers = {} as Record<LayerKey, boolean>;
  for (const key of Object.keys(DEFAULT_LAYERS) as LayerKey[]) {
    const value = raw?.layers?.[key];
    layers[key] = typeof value === "boolean" ? value : defaults.layers[key];
  }
  return {
    labelMode,
    layers,
    labelFields: { ...defaults.labelFields, ...(raw?.labelFields ?? {}) },
    basemapId,
    center,
    zoom,
  };
}

function normalizeSettingsPreferences(
  raw: Partial<SettingsPreferences> | undefined,
  defaults: SettingsPreferences,
): SettingsPreferences {
  const unitMode = isUnitMode(raw?.unitMode) ? raw.unitMode : defaults.unitMode;
  const presetFallback =
    unitMode === "custom"
      ? defaults.unitOverrides
      : presetUnitOverrides(unitMode);
  return {
    trailFadeSec:
      typeof raw?.trailFadeSec === "number"
        ? raw.trailFadeSec
        : defaults.trailFadeSec,
    showTrailTooltip:
      typeof raw?.showTrailTooltip === "boolean"
        ? raw.showTrailTooltip
        : defaults.showTrailTooltip,
    unitMode,
    unitOverrides: normalizeUnitOverrides(raw?.unitOverrides, presetFallback),
    clock: isClockMode(raw?.clock) ? raw.clock : defaults.clock,
    theme: isThemeMode(raw?.theme) ? raw.theme : defaults.theme,
  };
}

function normalizeLayoutPreferences(
  raw: Partial<LayoutPreferences> | undefined,
  defaults: LayoutPreferences,
): LayoutPreferences {
  return {
    railCollapsed:
      typeof raw?.railCollapsed === "boolean"
        ? raw.railCollapsed
        : defaults.railCollapsed,
  };
}

function normalizeReplayWindowPreferences(
  raw: Partial<ReplayWindowPreferences> | undefined,
  defaults: ReplayWindowPreferences,
): ReplayWindowPreferences {
  const rangeId = typeof raw?.rangeId === "string" ? raw.rangeId.trim() : "";
  const fromExpr = typeof raw?.fromExpr === "string" ? raw.fromExpr.trim() : "";
  return rangeId &&
    fromExpr &&
    raw?.toExpr === "now" &&
    raw.fixedEndMs === null &&
    typeof raw.rangeMs === "number" &&
    Number.isFinite(raw.rangeMs) &&
    raw.rangeMs > 0
    ? {
        rangeId,
        rangeMs: raw.rangeMs,
        fromExpr,
        toExpr: "now",
        fixedEndMs: null,
      }
    : defaults;
}

function normalizeReplayRangeRecents(
  raw: Partial<ReplayRangeRecent>[] | undefined,
): ReplayRangeRecent[] {
  if (!Array.isArray(raw)) return DEFAULT_REPLAY_RANGE_RECENTS;
  const out: ReplayRangeRecent[] = [];
  for (const recent of raw) {
    const label = typeof recent.label === "string" ? recent.label.trim() : "";
    const from = typeof recent.from === "string" ? recent.from.trim() : "";
    const to = typeof recent.to === "string" ? recent.to.trim() : "";
    if (!label || !from || !to) continue;
    if (out.some((item) => item.from === from && item.to === to)) continue;
    out.push({ label, from, to });
    if (out.length === 3) break;
  }
  return out;
}

function normalizeReleaseUpdateDismissal(
  raw: Partial<ReleaseUpdateDismissal> | null | undefined,
): ReleaseUpdateDismissal | null {
  if (
    typeof raw?.version !== "string" ||
    typeof raw.dismissedUntil !== "number" ||
    raw.dismissedUntil <= Date.now()
  ) {
    return null;
  }
  return { version: raw.version, dismissedUntil: raw.dismissedUntil };
}

function isInspectorTab(v: unknown): v is InspectorTab {
  return v === "telemetry" || v === "quality" || v === "signal" || v === "raw";
}

function isUnitMode(v: unknown): v is UnitMode {
  return (
    v === "metric" || v === "imperial" || v === "aviation" || v === "custom"
  );
}

function isClockMode(v: unknown): v is ClockMode {
  return v === "utc" || v === "local";
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
