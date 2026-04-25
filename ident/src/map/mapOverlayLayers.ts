import type { LabelFields } from "../data/store";
import type { LabelMode } from "../data/types";
import {
  labelFieldsKey,
  logMapTiming,
  mapTimingElapsed,
  mapTimingEnabled,
  mapTimingNow,
} from "../debug/mapTiming";
import { type AircraftGlyphColors, ALT_DISCRETE_BANDS } from "./alt";
import {
  AIRCRAFT_ARROW_ICON_ID,
  ensureAircraftIcons,
} from "./mapAircraftIcons";
import type {
  ExpressionSpecification,
  LayerSpecification,
  Map as MlMap,
} from "./maplibre";
import { TRAFFIC_TRAILS_LAYER_ID } from "./trafficTrailsLayer";

export const SRC_AIRCRAFT = "ident-aircraft";
export const LYR_AIRCRAFT_HIT = "ident-aircraft-hit";
export const LYR_AIRCRAFT_SELECTED_PULSE = "ident-aircraft-selected-pulse";
export const LYR_AIRCRAFT_SELECTED_RING = "ident-aircraft-selected-ring";
export const LYR_AIRCRAFT_EMERGENCY_RING = "ident-aircraft-emergency-ring";
export const LYR_AIRCRAFT_ARROW = "ident-aircraft-arrow";
export const LYR_AIRCRAFT_ICON = "ident-aircraft-icon";
export const LYR_AIRCRAFT_SELECTED_ICON = "ident-aircraft-selected-icon";
export const LYR_AIRCRAFT_LABEL = "ident-aircraft-label";
export const LYR_AIRCRAFT_SELECTED_LABEL = "ident-aircraft-selected-label";
export const LYR_AIRCRAFT_HOVER_LABEL = "ident-aircraft-hover-label";

export const SRC_STATION = "ident-station";
export const LYR_STATION_RING_OUTER = "ident-station-ring-outer";
export const LYR_STATION_RING_INNER = "ident-station-ring-inner";
export const LYR_STATION_CORE = "ident-station-core";
export const LYR_STATION_LABEL = "ident-station-label";

export const SRC_RANGE_LABELS = "ident-range-labels";
export const LYR_RANGE_LABELS = "ident-range-labels";

export const SRC_PREDICTOR = "ident-predictor";
export const LYR_PREDICTOR_LINE = "ident-predictor-line";
export const LYR_PREDICTOR_END = "ident-predictor-end";
export const LYR_PREDICTOR_LABEL = "ident-predictor-label";

export const AIRCRAFT_PICK_LAYERS = [
  LYR_AIRCRAFT_HIT,
  LYR_AIRCRAFT_ARROW,
  LYR_AIRCRAFT_ICON,
  LYR_AIRCRAFT_SELECTED_ICON,
];

export const MAP_LABEL_FONT_FAMILY = "IBM Plex Mono";

const FONT_STACK = [MAP_LABEL_FONT_FAMILY];
const FONT_STACK_HEAD = [MAP_LABEL_FONT_FAMILY];
type SymbolLayout = NonNullable<
  Extract<LayerSpecification, { type: "symbol" }>["layout"]
>;
type SymbolPaint = NonNullable<
  Extract<LayerSpecification, { type: "symbol" }>["paint"]
>;

const LABEL_TEXT_SIZE: SymbolLayout["text-size"] = [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  10.5,
  9,
  11.5,
  12,
  13.4,
  15,
  14.2,
];
const SELECTED_LABEL_TEXT_SIZE: SymbolLayout["text-size"] = [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  11,
  9,
  12.1,
  12,
  14,
  15,
  14.8,
];
const LABEL_HALO_WIDTH = 1.8;
const LABEL_HALO_WIDTH_EMPHASIS = 2.1;
const LABEL_HALO_BLUR = 0.12;
const AIRCRAFT_ICON_SIZE: SymbolLayout["icon-size"] = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  0.9,
  12,
  1,
];
const AIRCRAFT_SELECTED_ICON_SIZE: SymbolLayout["icon-size"] = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  1,
  12,
  1.1,
];
const displayControlCache = new WeakMap<MlMap, string>();
const sourceDataCache = new WeakMap<
  MlMap,
  Map<string, GeoJSON.FeatureCollection>
>();
const selectedPulseFrames = new WeakMap<MlMap, number>();
const CONTEXT_LAYER_ORDER = [
  LYR_STATION_RING_OUTER,
  LYR_STATION_RING_INNER,
  LYR_STATION_CORE,
  LYR_STATION_LABEL,
  LYR_RANGE_LABELS,
];

export interface OverlayPalette {
  accent: string;
  emergency: string;
  aircraftGlyphColors: AircraftGlyphColors;
  labelInk: string;
  labelInkSoft: string;
  labelHalo: string;
}

export interface SyncMapOverlayArgs {
  aircraft: GeoJSON.FeatureCollection;
  station: GeoJSON.FeatureCollection;
  rangeLabels: GeoJSON.FeatureCollection;
  predictor: GeoJSON.FeatureCollection;
  labelMode: LabelMode;
  labelFields: LabelFields;
  palette: OverlayPalette;
}

export function syncMapOverlayLayers(
  map: MlMap,
  args: SyncMapOverlayArgs,
): void {
  const startedAt = mapTimingNow();
  const sourceChanges: string[] = [];
  const canCreateStyleObjects = map.isStyleLoaded() === true;
  setOrUpdateSource(
    map,
    SRC_AIRCRAFT,
    args.aircraft,
    sourceChanges,
    canCreateStyleObjects,
  );
  setOrUpdateSource(
    map,
    SRC_STATION,
    args.station,
    sourceChanges,
    canCreateStyleObjects,
  );
  setOrUpdateSource(
    map,
    SRC_RANGE_LABELS,
    args.rangeLabels,
    sourceChanges,
    canCreateStyleObjects,
  );
  setOrUpdateSource(
    map,
    SRC_PREDICTOR,
    args.predictor,
    sourceChanges,
    canCreateStyleObjects,
  );
  if (canCreateStyleObjects) ensureAircraftIcons(map);

  let addedLayer = false;
  if (canCreateStyleObjects) {
    for (const layer of layerSpecs(args.palette)) {
      if (!map.getLayer(layer.id)) {
        map.addLayer(layer);
        addedLayer = true;
      }
    }
  }
  const display = applyAircraftDisplayControls(map, args, addedLayer);
  syncSelectedPulse(map, hasSelectedAircraft(args.aircraft));
  enforceMapOverlayLayerOrder(map);
  logMapTiming("layers sync", {
    labelMode: args.labelMode,
    fields: labelFieldsKey(args.labelFields),
    aircraftFeatures: args.aircraft.features.length,
    predictorFeatures: args.predictor.features.length,
    sources: sourceChanges.join(" "),
    display,
    dt: mapTimingElapsed(startedAt),
  });
  scheduleRenderLog(map, startedAt);
}

export function removeMapOverlayLayers(map: MlMap): void {
  stopMapOverlayAnimations(map);
  for (const id of [
    LYR_PREDICTOR_LABEL,
    LYR_PREDICTOR_END,
    LYR_PREDICTOR_LINE,
    LYR_RANGE_LABELS,
    LYR_STATION_LABEL,
    LYR_STATION_CORE,
    LYR_STATION_RING_INNER,
    LYR_STATION_RING_OUTER,
    LYR_AIRCRAFT_HOVER_LABEL,
    LYR_AIRCRAFT_SELECTED_LABEL,
    LYR_AIRCRAFT_LABEL,
    LYR_AIRCRAFT_SELECTED_ICON,
    LYR_AIRCRAFT_ICON,
    LYR_AIRCRAFT_ARROW,
    LYR_AIRCRAFT_EMERGENCY_RING,
    LYR_AIRCRAFT_SELECTED_RING,
    LYR_AIRCRAFT_SELECTED_PULSE,
    LYR_AIRCRAFT_HIT,
  ]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [
    SRC_PREDICTOR,
    SRC_RANGE_LABELS,
    SRC_STATION,
    SRC_AIRCRAFT,
  ]) {
    if (map.getSource(id)) map.removeSource(id);
  }
  sourceDataCache.delete(map);
  displayControlCache.delete(map);
}

export function stopMapOverlayAnimations(map: MlMap): void {
  const frame = selectedPulseFrames.get(map);
  if (frame != null && typeof window !== "undefined") {
    window.cancelAnimationFrame(frame);
  }
  selectedPulseFrames.delete(map);
}

export function enforceMapOverlayLayerOrder(map: MlMap): void {
  if (!map.getLayer(TRAFFIC_TRAILS_LAYER_ID)) return;
  for (const id of CONTEXT_LAYER_ORDER) {
    moveLayerBefore(map, id, TRAFFIC_TRAILS_LAYER_ID);
  }
  moveLayerBefore(map, TRAFFIC_TRAILS_LAYER_ID, LYR_AIRCRAFT_HIT);
}

function moveLayerBefore(map: MlMap, id: string, beforeId: string): void {
  if (id === beforeId) return;
  if (!map.getLayer(id) || !map.getLayer(beforeId)) return;
  map.moveLayer(id, beforeId);
}

function setOrUpdateSource(
  map: MlMap,
  id: string,
  data: GeoJSON.FeatureCollection,
  sourceChanges: string[],
  canCreate: boolean,
): void {
  const existing = map.getSource(id);
  const cached = cachedSourceData(map, id);
  if (hasSetData(existing)) {
    if (cached === data) {
      sourceChanges.push(`${id}:skip:${data.features.length}`);
      return;
    }
    existing.setData(data);
    sourceChanges.push(`${id}:setData:${data.features.length}`);
    cacheSourceData(map, id, data);
    return;
  }
  if (!canCreate) {
    sourceChanges.push(`${id}:defer:${data.features.length}`);
    return;
  }
  map.addSource(id, { type: "geojson", data });
  sourceChanges.push(`${id}:add:${data.features.length}`);
  cacheSourceData(map, id, data);
}

function cachedSourceData(
  map: MlMap,
  id: string,
): GeoJSON.FeatureCollection | undefined {
  return sourceDataCache.get(map)?.get(id);
}

function cacheSourceData(
  map: MlMap,
  id: string,
  data: GeoJSON.FeatureCollection,
): void {
  let byId = sourceDataCache.get(map);
  if (!byId) {
    byId = new Map();
    sourceDataCache.set(map, byId);
  }
  byId.set(id, data);
}

function hasSetData(
  source: ReturnType<MlMap["getSource"]>,
): source is ReturnType<MlMap["getSource"]> & {
  setData: (data: GeoJSON.FeatureCollection) => void;
} {
  return (
    typeof source === "object" &&
    source !== null &&
    "setData" in source &&
    typeof source.setData === "function"
  );
}

function applyAircraftDisplayControls(
  map: MlMap,
  args: SyncMapOverlayArgs,
  force: boolean,
): "apply" | "skip" {
  const key = displayControlKey(args);
  if (!force && displayControlCache.get(map) === key) {
    return "skip";
  }
  displayControlCache.set(map, key);
  const aircraftColor = aircraftGlyphColorExpression(args.palette);
  setLayerVisibility(map, LYR_AIRCRAFT_ARROW, args.labelMode === "arrow");
  setLayerVisibility(
    map,
    LYR_AIRCRAFT_SELECTED_RING,
    args.labelMode === "arrow",
  );
  setLayerVisibility(map, LYR_AIRCRAFT_ICON, args.labelMode === "icon");
  setLayerVisibility(
    map,
    LYR_AIRCRAFT_SELECTED_ICON,
    args.labelMode === "icon",
  );
  setPaintProperty(map, LYR_AIRCRAFT_ARROW, "icon-color", aircraftColor);
  setPaintProperty(
    map,
    LYR_AIRCRAFT_ARROW,
    "icon-halo-color",
    args.palette.labelHalo,
  );
  setPaintProperty(map, LYR_AIRCRAFT_ICON, "icon-color", aircraftColor);
  setPaintProperty(
    map,
    LYR_AIRCRAFT_ICON,
    "icon-halo-color",
    args.palette.labelHalo,
  );
  setPaintProperty(
    map,
    LYR_AIRCRAFT_SELECTED_ICON,
    "icon-color",
    aircraftColor,
  );
  setPaintProperty(
    map,
    LYR_AIRCRAFT_SELECTED_ICON,
    "icon-halo-color",
    args.palette.labelHalo,
  );
  setTextField(
    map,
    LYR_AIRCRAFT_LABEL,
    normalLabelTextExpression(args.palette, args.labelFields),
  );
  setTextField(
    map,
    LYR_AIRCRAFT_SELECTED_LABEL,
    fullLabelTextExpression(args.palette),
  );
  setTextField(
    map,
    LYR_AIRCRAFT_HOVER_LABEL,
    fullLabelTextExpression(args.palette),
  );
  map.triggerRepaint();
  return "apply";
}

function displayControlKey(args: SyncMapOverlayArgs): string {
  const fields = args.labelFields;
  return [
    args.labelMode,
    fields.cs,
    fields.type,
    fields.alt,
    fields.spd,
    fields.sqk,
    fields.rt,
    args.palette.accent,
    args.palette.emergency,
    ...args.palette.aircraftGlyphColors,
    args.palette.labelInk,
    args.palette.labelInkSoft,
    args.palette.labelHalo,
  ].join("|");
}

function setLayerVisibility(
  map: MlMap,
  layerId: string,
  visible: boolean,
): void {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

function setTextField(
  map: MlMap,
  layerId: string,
  textField: SymbolLayout["text-field"],
): void {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, "text-field", textField);
}

function setPaintProperty(
  map: MlMap,
  layerId: string,
  property: string,
  value: ExpressionSpecification | string | number,
): void {
  if (!map.getLayer(layerId)) return;
  map.setPaintProperty(layerId, property, value);
}

function scheduleRenderLog(map: MlMap, startedAt: number): void {
  if (!mapTimingEnabled()) return;
  let rendered = false;
  const onRender = (): void => {
    rendered = true;
    logMapTiming("map render after overlay sync", {
      dt: mapTimingElapsed(startedAt),
    });
  };
  map.once?.("render", onRender);
  window.setTimeout(() => {
    if (!rendered) {
      logMapTiming("map render pending after overlay sync", {
        dt: mapTimingElapsed(startedAt),
      });
    }
  }, 100);
}

function hasSelectedAircraft(collection: GeoJSON.FeatureCollection): boolean {
  return collection.features.some(
    (feature) => feature.properties?.selected === true,
  );
}

function syncSelectedPulse(map: MlMap, active: boolean): void {
  if (!active) {
    stopMapOverlayAnimations(map);
    return;
  }
  if (selectedPulseFrames.has(map)) return;
  if (
    typeof window === "undefined" ||
    typeof window.requestAnimationFrame !== "function"
  )
    return;

  const tick = (time: number): void => {
    if (!map.getLayer(LYR_AIRCRAFT_SELECTED_PULSE)) {
      selectedPulseFrames.delete(map);
      return;
    }
    const phase = (Math.sin(time / 360) + 1) / 2;
    map.setPaintProperty(
      LYR_AIRCRAFT_SELECTED_PULSE,
      "circle-radius",
      9 + phase * 7,
    );
    map.setPaintProperty(
      LYR_AIRCRAFT_SELECTED_PULSE,
      "circle-stroke-width",
      1.3 - phase * 0.45,
    );
    map.setPaintProperty(
      LYR_AIRCRAFT_SELECTED_PULSE,
      "circle-stroke-opacity",
      0.55 - phase * 0.42,
    );
    map.triggerRepaint();
    selectedPulseFrames.set(map, window.requestAnimationFrame(tick));
  };

  selectedPulseFrames.set(map, window.requestAnimationFrame(tick));
}

function aircraftGlyphColorExpression(
  palette: OverlayPalette,
): ExpressionSpecification {
  return [
    "match",
    ["get", "color"],
    ALT_DISCRETE_BANDS[0].color,
    palette.aircraftGlyphColors[0],
    ALT_DISCRETE_BANDS[1].color,
    palette.aircraftGlyphColors[1],
    ALT_DISCRETE_BANDS[2].color,
    palette.aircraftGlyphColors[2],
    ALT_DISCRETE_BANDS[3].color,
    palette.aircraftGlyphColors[3],
    ALT_DISCRETE_BANDS[4].color,
    palette.aircraftGlyphColors[4],
    ALT_DISCRETE_BANDS[5].color,
    palette.aircraftGlyphColors[5],
    ["get", "color"],
  ];
}

function layerSpecs(palette: OverlayPalette): LayerSpecification[] {
  const aircraftColor = aircraftGlyphColorExpression(palette);
  return [
    {
      id: LYR_AIRCRAFT_HIT,
      type: "circle",
      source: SRC_AIRCRAFT,
      paint: {
        "circle-radius": 13,
        "circle-color": "#000000",
        "circle-opacity": 0.01,
      },
    },
    {
      id: LYR_AIRCRAFT_SELECTED_PULSE,
      type: "circle",
      source: SRC_AIRCRAFT,
      filter: ["==", ["get", "selected"], true],
      paint: {
        "circle-radius": 9,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": palette.accent,
        "circle-stroke-width": 1.3,
        "circle-stroke-opacity": 0.45,
      },
    },
    {
      id: LYR_AIRCRAFT_SELECTED_RING,
      type: "circle",
      source: SRC_AIRCRAFT,
      filter: ["==", ["get", "selected"], true],
      paint: {
        "circle-radius": 8,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": palette.accent,
        "circle-stroke-width": 1.5,
        "circle-stroke-opacity": 0.95,
      },
    },
    {
      id: LYR_AIRCRAFT_EMERGENCY_RING,
      type: "circle",
      source: SRC_AIRCRAFT,
      filter: [
        "all",
        ["==", ["get", "emergency"], true],
        ["==", ["get", "selected"], false],
      ],
      paint: {
        "circle-radius": 10,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": palette.emergency,
        "circle-stroke-width": 1.8,
        "circle-stroke-opacity": 0.8,
      },
    },
    {
      id: LYR_AIRCRAFT_ARROW,
      type: "symbol",
      source: SRC_AIRCRAFT,
      layout: {
        "icon-image": AIRCRAFT_ARROW_ICON_ID,
        "icon-size": 0.45,
        "icon-rotate": ["get", "track"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-color": aircraftColor,
        "icon-halo-color": palette.labelHalo,
        "icon-halo-width": 0,
        "icon-halo-blur": 0,
      },
    },
    {
      id: LYR_AIRCRAFT_ICON,
      type: "symbol",
      source: SRC_AIRCRAFT,
      filter: ["==", ["get", "selected"], false],
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": AIRCRAFT_ICON_SIZE,
        "icon-rotate": ["get", "track"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-color": aircraftColor,
        "icon-halo-color": palette.labelHalo,
        "icon-halo-width": 1.4,
        "icon-halo-blur": 0,
      },
    },
    {
      id: LYR_AIRCRAFT_SELECTED_ICON,
      type: "symbol",
      source: SRC_AIRCRAFT,
      filter: ["==", ["get", "selected"], true],
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": AIRCRAFT_SELECTED_ICON_SIZE,
        "icon-rotate": ["get", "track"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": false,
      },
      paint: {
        "icon-color": aircraftColor,
        "icon-halo-color": palette.labelHalo,
        "icon-halo-width": 1.6,
        "icon-halo-blur": 0,
      },
    },
    {
      id: LYR_AIRCRAFT_LABEL,
      type: "symbol",
      source: SRC_AIRCRAFT,
      filter: [
        "all",
        ["==", ["get", "selected"], false],
        ["==", ["get", "hovered"], false],
      ],
      layout: {
        "text-field": normalLabelTextExpression(palette, {
          cs: true,
          type: true,
          alt: true,
          spd: true,
          sqk: true,
          rt: true,
        }),
        "text-font": FONT_STACK,
        "text-size": LABEL_TEXT_SIZE,
        "text-anchor": "left",
        "text-justify": "left",
        "text-offset": [1.35, 0],
        "text-line-height": 1.22,
        "text-max-width": 16,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        "text-optional": true,
        "symbol-sort-key": ["get", "priority"],
      },
      paint: labelPaint(palette, false),
    },
    {
      id: LYR_AIRCRAFT_HOVER_LABEL,
      type: "symbol",
      source: SRC_AIRCRAFT,
      filter: [
        "all",
        ["==", ["get", "hovered"], true],
        ["==", ["get", "selected"], false],
      ],
      layout: {
        "text-field": fullLabelTextExpression(palette),
        "text-font": FONT_STACK,
        "text-size": SELECTED_LABEL_TEXT_SIZE,
        "text-anchor": "left",
        "text-justify": "left",
        "text-offset": [1.35, 0],
        "text-line-height": 1.2,
        "text-max-width": 18,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        "text-optional": true,
        "symbol-sort-key": ["get", "priority"],
      },
      paint: labelPaint(palette, true),
    },
    {
      id: LYR_AIRCRAFT_SELECTED_LABEL,
      type: "symbol",
      source: SRC_AIRCRAFT,
      filter: ["==", ["get", "selected"], true],
      layout: {
        "text-field": fullLabelTextExpression(palette),
        "text-font": FONT_STACK,
        "text-size": SELECTED_LABEL_TEXT_SIZE,
        "text-anchor": ["get", "selectedLabelAnchor"],
        "text-justify": ["get", "selectedLabelJustify"],
        "text-offset": ["get", "selectedLabelOffset"],
        "text-line-height": 1.2,
        "text-max-width": 18,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        "text-optional": true,
        "symbol-sort-key": ["get", "priority"],
      },
      paint: labelPaint(palette, true),
    },
    {
      id: LYR_STATION_RING_OUTER,
      type: "circle",
      source: SRC_STATION,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          7,
          8,
          9,
          10,
          12,
          12,
          14,
        ],
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": palette.accent,
        "circle-stroke-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          0.45,
          8,
          0.5,
          10,
          0.58,
        ],
        "circle-stroke-opacity": 0.28,
      },
    },
    {
      id: LYR_STATION_RING_INNER,
      type: "circle",
      source: SRC_STATION,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          4.5,
          8,
          6,
          10,
          8,
          12,
          9,
        ],
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": palette.accent,
        "circle-stroke-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          0.55,
          8,
          0.65,
          10,
          0.78,
        ],
        "circle-stroke-opacity": 0.55,
      },
    },
    {
      id: LYR_STATION_CORE,
      type: "circle",
      source: SRC_STATION,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          2.2,
          8,
          3,
          10,
          3.6,
          12,
          4,
        ],
        "circle-color": palette.accent,
        "circle-opacity": 0.9,
      },
    },
    {
      id: LYR_STATION_LABEL,
      type: "symbol",
      source: SRC_STATION,
      minzoom: 8,
      filter: ["!=", ["get", "label"], ""],
      layout: {
        "text-field": ["get", "label"],
        "text-font": FONT_STACK,
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          6.4,
          10,
          7.8,
          12,
          9.2,
        ],
        "text-anchor": "left",
        "text-offset": [1, -0.45],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": palette.labelInkSoft,
        "text-halo-color": palette.labelHalo,
        "text-halo-width": 1.1,
      },
    },
    {
      id: LYR_RANGE_LABELS,
      type: "symbol",
      source: SRC_RANGE_LABELS,
      layout: {
        "text-field": ["get", "label"],
        "text-font": FONT_STACK,
        "text-size": 10,
        "text-anchor": "left",
        "text-offset": [0.45, -0.2],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": palette.labelInkSoft,
        "text-halo-color": palette.labelHalo,
        "text-halo-width": 1.4,
      },
    },
    {
      id: LYR_PREDICTOR_LINE,
      type: "line",
      source: SRC_PREDICTOR,
      filter: ["==", ["get", "kind"], "line"],
      paint: {
        "line-color": palette.accent,
        "line-width": 1.2,
        "line-opacity": 0.75,
        "line-dasharray": [4, 3],
      },
    },
    {
      id: LYR_PREDICTOR_END,
      type: "circle",
      source: SRC_PREDICTOR,
      filter: ["==", ["get", "kind"], "end"],
      paint: {
        "circle-radius": 2.5,
        "circle-color": palette.accent,
        "circle-opacity": 0.85,
      },
    },
    {
      id: LYR_PREDICTOR_LABEL,
      type: "symbol",
      source: SRC_PREDICTOR,
      filter: ["==", ["get", "kind"], "end"],
      layout: {
        "text-field": ["get", "label"],
        "text-font": FONT_STACK,
        "text-size": 9,
        "text-anchor": "left",
        "text-offset": [0.45, -0.35],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": palette.labelInkSoft,
        "text-halo-color": palette.labelHalo,
        "text-halo-width": 1.4,
      },
    },
  ];
}

function labelPaint(palette: OverlayPalette, emphasis: boolean): SymbolPaint {
  return {
    "text-color": [
      "case",
      ["==", ["get", "emergency"], true],
      palette.emergency,
      emphasis ? palette.labelInk : palette.labelInkSoft,
    ],
    "text-halo-color": palette.labelHalo,
    "text-halo-width": emphasis ? LABEL_HALO_WIDTH_EMPHASIS : LABEL_HALO_WIDTH,
    "text-halo-blur": LABEL_HALO_BLUR,
  };
}

type TextExpression = string | ExpressionSpecification;

function normalLabelTextExpression(
  palette: OverlayPalette,
  fields: LabelFields,
): SymbolLayout["text-field"] {
  const typeLine = labelTypeLineExpression(fields);
  const altSpeedLine = labelAltSpeedLineExpression(fields);
  const routeLine: TextExpression = fields.rt
    ? propertyExpression("labelRoute")
    : "";
  return labelTextExpression(
    palette,
    fields.cs ? propertyExpression("labelCs") : "",
    joinLabelLines([typeLine, altSpeedLine, routeLine]),
  );
}

function fullLabelTextExpression(
  palette: OverlayPalette,
): SymbolLayout["text-field"] {
  return labelTextExpression(
    palette,
    propertyExpression("labelCs"),
    joinLabelLines([
      propertyExpression("labelTypeSqk"),
      propertyExpression("labelAltSpeed"),
      propertyExpression("labelRoute"),
    ]),
  );
}

function labelTypeLineExpression(fields: LabelFields): TextExpression {
  if (fields.type && fields.sqk) {
    return [
      "case",
      ["!=", propertyExpression("labelSqk"), ""],
      propertyExpression("labelTypeSqk"),
      propertyExpression("labelType"),
    ];
  }
  if (fields.type) return propertyExpression("labelType");
  if (fields.sqk) return propertyExpression("labelSqk");
  return "";
}

function labelAltSpeedLineExpression(fields: LabelFields): TextExpression {
  if (fields.alt && fields.spd) {
    return [
      "case",
      ["!=", propertyExpression("labelSpeed"), ""],
      propertyExpression("labelAltSpeed"),
      propertyExpression("labelAlt"),
    ];
  }
  if (fields.alt) return propertyExpression("labelAlt");
  if (fields.spd) return propertyExpression("labelSpeed");
  return "";
}

function joinLabelLines(lines: TextExpression[]): TextExpression {
  const [first, ...restLines] = lines;
  if (first == null) return "";
  if (restLines.length === 0) return first;
  const rest = joinLabelLines(restLines);
  return [
    "case",
    ["==", first, ""],
    rest,
    ["==", rest, ""],
    first,
    ["concat", first, "\n", rest],
  ];
}

function labelTextExpression(
  palette: OverlayPalette,
  head: TextExpression,
  tail: TextExpression,
): SymbolLayout["text-field"] {
  const headColor: ExpressionSpecification = [
    "case",
    ["==", ["get", "emergency"], true],
    palette.emergency,
    palette.labelInk,
  ];
  const tailColor: ExpressionSpecification = [
    "case",
    ["==", ["get", "emergency"], true],
    palette.emergency,
    palette.labelInkSoft,
  ];
  const headFont: ExpressionSpecification = ["literal", FONT_STACK_HEAD];
  const tailFont: ExpressionSpecification = ["literal", FONT_STACK];
  const tailWithLineBreak: TextExpression = [
    "case",
    ["==", tail, ""],
    "",
    ["==", head, ""],
    tail,
    ["concat", "\n", tail],
  ];
  return [
    "format",
    head,
    {
      "text-font": headFont,
      "text-color": headColor,
      "font-scale": 1,
    },
    tailWithLineBreak,
    {
      "text-font": tailFont,
      "text-color": tailColor,
      "font-scale": 0.94,
    },
  ];
}

function propertyExpression(name: string): ExpressionSpecification {
  return ["coalesce", ["get", name], ""];
}
