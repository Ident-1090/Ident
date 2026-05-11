// biome-ignore-all lint/style/noNonNullAssertion: test fixture — missing elements/mocks fail the test loudly via the test runner.
// React 18 act() requires this flag; set before importing React.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import type { CSSProperties } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPreferencesStoreForTests } from "../data/preferences";
import { useIdentStore } from "../data/store";
import type { Aircraft } from "../data/types";
import { MapEngineContext } from "./MapEngine";
import { MapOverlay } from "./MapOverlay";
import { AIRCRAFT_ARROW_ICON_ID } from "./mapAircraftIcons";
import {
  AIRCRAFT_PICK_LAYERS,
  LYR_AIRCRAFT_ARROW,
  LYR_AIRCRAFT_HIT,
  LYR_AIRCRAFT_HOVER_LABEL,
  LYR_AIRCRAFT_ICON,
  LYR_AIRCRAFT_LABEL,
  LYR_AIRCRAFT_SELECTED_ICON,
  LYR_AIRCRAFT_SELECTED_LABEL,
  LYR_AIRCRAFT_SELECTED_PULSE,
  LYR_AIRCRAFT_SELECTED_RING,
  LYR_RANGE_LABELS,
  LYR_STATION_CORE,
  LYR_STATION_LABEL,
  LYR_STATION_RING_INNER,
  LYR_STATION_RING_OUTER,
  SRC_AIRCRAFT,
  SRC_PREDICTOR,
  SRC_RANGE_LABELS,
  SRC_STATION,
} from "./mapOverlayLayers";
import type { TrafficTrailsSnapshot } from "./trafficTrailsLayer";
import { TRAFFIC_TRAILS_LAYER_ID } from "./trafficTrailsLayer";

const UAL: Aircraft = {
  hex: "abc123",
  flight: "UAL123",
  t: "B738",
  alt_baro: 34000,
  gs: 420,
  track: 90,
  lat: 37.42,
  lon: -122.08,
  seen: 0,
  type: "adsb_icao",
};

const SWA: Aircraft = {
  hex: "def456",
  flight: "SWA456",
  t: "B737",
  alt_baro: 28000,
  gs: 380,
  track: 180,
  lat: 37.7,
  lon: -122.3,
  seen: 0,
  type: "adsb_icao",
};

interface StubSource {
  id: string;
  data: GeoJSON.FeatureCollection;
  setData: ReturnType<typeof vi.fn>;
}

interface StubMap {
  project: ReturnType<typeof vi.fn>;
  getBounds: ReturnType<typeof vi.fn>;
  getCenter: ReturnType<typeof vi.fn>;
  getContainer: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  easeTo: ReturnType<typeof vi.fn>;
  jumpTo: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  getZoom: ReturnType<typeof vi.fn>;
  addSource: ReturnType<typeof vi.fn>;
  getSource: ReturnType<typeof vi.fn>;
  removeSource: ReturnType<typeof vi.fn>;
  addImage: ReturnType<typeof vi.fn>;
  hasImage: ReturnType<typeof vi.fn>;
  addLayer: ReturnType<typeof vi.fn>;
  removeLayer: ReturnType<typeof vi.fn>;
  getLayer: ReturnType<typeof vi.fn>;
  moveLayer: ReturnType<typeof vi.fn>;
  setLayoutProperty: ReturnType<typeof vi.fn>;
  setPaintProperty: ReturnType<typeof vi.fn>;
  isStyleLoaded: ReturnType<typeof vi.fn>;
  triggerRepaint: ReturnType<typeof vi.fn>;
  queryRenderedFeatures: ReturnType<typeof vi.fn>;
  handlers: Map<string, Set<(...args: unknown[]) => void>>;
  layers: Map<string, unknown>;
  sources: Map<string, StubSource>;
  images: Set<string>;
}

function createStubMap(overrides?: {
  contains?: (pt: { lng: number; lat: number }) => boolean;
  containerRect?: { width: number; height: number };
  inspectorWidth?: number;
  mobileSheetHeight?: number;
  mobileSheetSnap?: "collapsed" | "half" | "full";
  project?: (pt: { lng: number; lat: number }) => { x: number; y: number };
  queryHex?: string | null;
}): StubMap {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const layers = new Map<string, unknown>();
  const sources = new Map<string, StubSource>();
  const images = new Set<string>();
  const contains = overrides?.contains ?? (() => true);
  const host = document.createElement("div");
  host.className = "map-engine";
  host.style.setProperty("--color-accent", "#37a5be");
  host.style.setProperty("--color-emerg", "#ff3900");
  host.style.setProperty("--aircraft-arrow-halo", "rgba(11, 18, 23, 0.42)");
  host.style.setProperty("--aircraft-glyph-lowest", "#D44400");
  host.style.setProperty("--aircraft-glyph-low", "#F27200");
  host.style.setProperty("--aircraft-glyph-mid-low", "#E89B2B");
  host.style.setProperty("--aircraft-glyph-mid", "#26A671");
  host.style.setProperty("--aircraft-glyph-high", "#37A5BE");
  host.style.setProperty("--aircraft-glyph-highest", "#1F5673");
  host.style.setProperty("--label-ink", "#0f1114");
  host.style.setProperty("--label-ink-soft", "#3b4148");
  host.style.setProperty("--label-halo", "rgba(255, 255, 255, 0.92)");
  const container = document.createElement("div");
  const containerRect = overrides?.containerRect ?? { width: 800, height: 600 };
  container.getBoundingClientRect = vi.fn(() => ({
    width: containerRect.width,
    height: containerRect.height,
    top: 0,
    right: containerRect.width,
    bottom: containerRect.height,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }));
  host.appendChild(container);
  if (overrides?.mobileSheetHeight != null) {
    const appShell = document.createElement("div");
    appShell.className = "app-shell";
    appShell.appendChild(host);
    const sheet = document.createElement("div");
    sheet.className = "mobile-bottom-sheet";
    sheet.dataset.snap = overrides.mobileSheetSnap ?? "half";
    sheet.getBoundingClientRect = vi.fn(() => ({
      width: 390,
      height: overrides.mobileSheetHeight ?? 0,
      top: 400,
      right: 390,
      bottom: 800,
      left: 0,
      x: 0,
      y: 400,
      toJSON: () => ({}),
    }));
    appShell.appendChild(sheet);
  }
  if (overrides?.inspectorWidth != null) {
    const inspector = document.createElement("div");
    inspector.className = "floating-inspector-panel";
    inspector.getBoundingClientRect = vi.fn(() => ({
      width: overrides.inspectorWidth ?? 0,
      height: 500,
      top: 0,
      right: 0,
      bottom: 500,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    host.appendChild(inspector);
  }
  const m: StubMap = {
    project: vi.fn(
      overrides?.project ??
        (({ lng, lat }: { lng: number; lat: number }) => ({
          x: lng * 10,
          y: lat * 10,
        })),
    ),
    getBounds: vi.fn(() => ({ contains })),
    getCenter: vi.fn(() => ({ lng: 0, lat: 0 })),
    getContainer: vi.fn(() => container),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(handler);
    }),
    easeTo: vi.fn(),
    jumpTo: vi.fn(),
    fitBounds: vi.fn(),
    resize: vi.fn(),
    getZoom: vi.fn(() => 8),
    addSource: vi.fn(
      (id: string, source: { data: GeoJSON.FeatureCollection }) => {
        sources.set(id, {
          id,
          data: source.data,
          setData: vi.fn((data: GeoJSON.FeatureCollection) => {
            const current = sources.get(id);
            if (current) current.data = data;
          }),
        });
      },
    ),
    getSource: vi.fn((id: string) => sources.get(id)),
    removeSource: vi.fn((id: string) => {
      sources.delete(id);
    }),
    addImage: vi.fn((id: string) => {
      images.add(id);
    }),
    hasImage: vi.fn((id: string) => images.has(id)),
    addLayer: vi.fn((layer: { id: string }) => {
      layers.set(layer.id, layer);
    }),
    removeLayer: vi.fn((id: string) => {
      layers.delete(id);
    }),
    getLayer: vi.fn((id: string) => layers.get(id)),
    moveLayer: vi.fn((id: string) => {
      const layer = layers.get(id);
      if (!layer) return;
      layers.delete(id);
      layers.set(id, layer);
    }),
    setLayoutProperty: vi.fn((id: string, key: string, value: unknown) => {
      const layer = layers.get(id) as
        | { layout?: Record<string, unknown> }
        | undefined;
      if (!layer) return;
      layer.layout = { ...(layer.layout ?? {}), [key]: value };
    }),
    setPaintProperty: vi.fn((id: string, key: string, value: unknown) => {
      const layer = layers.get(id) as
        | { paint?: Record<string, unknown> }
        | undefined;
      if (!layer) return;
      layer.paint = { ...(layer.paint ?? {}), [key]: value };
    }),
    isStyleLoaded: vi.fn(() => true),
    triggerRepaint: vi.fn(),
    queryRenderedFeatures: vi.fn(() => {
      if (
        !overrides ||
        overrides.queryHex === undefined ||
        overrides.queryHex === null
      ) {
        return [];
      }
      return [{ properties: { hex: overrides.queryHex } }];
    }),
    handlers,
    layers,
    sources,
    images,
  };
  return m;
}

function fire(stub: StubMap, event: string, ...args: unknown[]): void {
  const set = stub.handlers.get(event);
  if (!set) return;
  for (const h of set) h(...args);
}

const LIGHT_TONE_STYLE = {
  "--color-accent": "#37a5be",
  "--color-bg": "#f7f7f7",
  "--color-emerg": "#ff3900",
  "--aircraft-arrow-halo": "rgba(11, 18, 23, 0.42)",
  "--aircraft-glyph-lowest": "#D44400",
  "--aircraft-glyph-low": "#F27200",
  "--aircraft-glyph-mid-low": "#E89B2B",
  "--aircraft-glyph-mid": "#26A671",
  "--aircraft-glyph-high": "#37A5BE",
  "--aircraft-glyph-highest": "#1F5673",
  "--label-ink": "#0f1114",
  "--label-ink-soft": "#3b4148",
  "--label-halo": "rgba(255, 255, 255, 0.92)",
} as CSSProperties;

const LIGHT_AIRCRAFT_GLYPH_COLOR_EXPRESSION = [
  "match",
  ["get", "color"],
  "#D44400",
  "#D44400",
  "#F27200",
  "#F27200",
  "#E89B2B",
  "#E89B2B",
  "#26A671",
  "#26A671",
  "#37A5BE",
  "#37A5BE",
  "#1F5673",
  "#1F5673",
  ["get", "color"],
];
const LIGHT_LABEL_HALO = "rgba(255, 255, 255, 0.92)";

function renderOverlay(
  root: Root,
  stub: StubMap | null,
  isReady: boolean,
): void {
  act(() => {
    root.render(
      <div
        className="map-engine"
        data-basemap-tone="light"
        style={LIGHT_TONE_STYLE}
      >
        <MapEngineContext.Provider value={{ map: stub as never, isReady }}>
          <MapOverlay />
        </MapEngineContext.Provider>
      </div>,
    );
  });
}

describe("MapOverlay", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetPreferencesStoreForTests();
    useIdentStore.setState((st) => ({
      ...st,
      aircraft: new Map([
        [UAL.hex, UAL],
        [SWA.hex, SWA],
      ]),
      receiver: { lat: 37.4, lon: -122.1, version: "readsb" },
      selectedHex: null,
      search: { query: "" },
      routeByCallsign: {},
      camera: {
        trackSelected: false,
        autoFitTraffic: false,
        lastUserInteraction: null,
      },
      map: {
        ...st.map,
        basemapId: "ident",
        labelMode: "arrow",
        labelFields: {
          cs: true,
          type: false,
          alt: true,
          spd: true,
          sqk: false,
          rt: false,
        },
        layers: {
          ...st.map.layers,
          trails: true,
          rangeRings: false,
          rxRange: false,
          losRings: false,
        },
        viewportHexes: null,
      },
      labels: {
        hoveredHex: null,
      },
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("does not mount canvas or svg traffic overlays", () => {
    const stub = createStubMap();
    renderOverlay(root, stub, true);

    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector("svg.absolute")).toBeNull();
  });

  it("syncs aircraft, station, and range-label data into MapLibre sources and layers", () => {
    const stub = createStubMap();
    useIdentStore.setState((st) => ({
      config: { ...st.config, station: "Home Receiver" },
      map: { ...st.map, layers: { ...st.map.layers, rangeRings: true } },
    }));

    renderOverlay(root, stub, true);

    expect(stub.sources.get(SRC_AIRCRAFT)?.data.features).toHaveLength(2);
    expect(
      stub.sources.get(SRC_STATION)?.data.features[0].properties?.label,
    ).toBe("Home Receiver");
    expect(stub.sources.get(SRC_RANGE_LABELS)?.data.features).toHaveLength(5);
    expect(stub.layers.has(LYR_AIRCRAFT_ARROW)).toBe(true);
    expect(stub.layers.has(LYR_AIRCRAFT_ICON)).toBe(true);
    expect(stub.layers.has(LYR_AIRCRAFT_SELECTED_PULSE)).toBe(true);
    expect(stub.layers.has(LYR_STATION_LABEL)).toBe(true);
    expect(stub.layers.has(LYR_RANGE_LABELS)).toBe(true);
    expect(stub.images.has(AIRCRAFT_ARROW_ICON_ID)).toBe(true);
    const stationLabelLayer = stub.layers.get(LYR_STATION_LABEL) as {
      minzoom?: number;
      layout?: Record<string, unknown>;
      paint?: Record<string, unknown>;
    };
    expect(stationLabelLayer.minzoom).toBe(8);
    expect(stationLabelLayer.layout?.["text-size"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      8,
      6.4,
      10,
      7.8,
      12,
      9.2,
    ]);
    expect(stationLabelLayer.paint?.["text-halo-width"]).toBe(1.1);
    const stationOuter = stub.layers.get(LYR_STATION_RING_OUTER) as {
      paint?: Record<string, unknown>;
    };
    const stationInner = stub.layers.get(LYR_STATION_RING_INNER) as {
      paint?: Record<string, unknown>;
    };
    const stationCore = stub.layers.get(LYR_STATION_CORE) as {
      paint?: Record<string, unknown>;
    };
    expect(stationOuter.paint?.["circle-radius"]).toEqual([
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
    ]);
    expect(stationInner.paint?.["circle-radius"]).toEqual([
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
    ]);
    expect(stationCore.paint?.["circle-radius"]).toEqual([
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
    ]);
    const arrowLayer = stub.layers.get(LYR_AIRCRAFT_ARROW) as {
      filter?: unknown;
      layout?: Record<string, unknown>;
      paint?: Record<string, unknown>;
    };
    expect(stub.layers.has("ident-aircraft-arrow-halo")).toBe(false);
    expect(arrowLayer.layout?.visibility).toBe("visible");
    expect(arrowLayer.filter).toBeUndefined();
    expect(arrowLayer.layout?.["icon-image"]).toBe(AIRCRAFT_ARROW_ICON_ID);
    expect(arrowLayer.layout?.["icon-size"]).toBe(0.45);
    expect(arrowLayer.layout?.["icon-allow-overlap"]).toBe(true);
    expect(arrowLayer.layout?.["icon-ignore-placement"]).toBe(true);
    expect(arrowLayer.paint?.["icon-color"]).toEqual(
      LIGHT_AIRCRAFT_GLYPH_COLOR_EXPRESSION,
    );
    expect(arrowLayer.paint?.["icon-halo-color"]).toBe(LIGHT_LABEL_HALO);
    expect(arrowLayer.paint?.["icon-halo-width"]).toBe(0);
    expect(arrowLayer.paint?.["icon-halo-blur"]).toBe(0);
    const iconLayer = stub.layers.get(LYR_AIRCRAFT_ICON) as {
      filter?: unknown;
      layout?: Record<string, unknown>;
      paint?: Record<string, unknown>;
    };
    expect(iconLayer.layout?.visibility).toBe("none");
    expect(iconLayer.filter).toEqual(["==", ["get", "selected"], false]);
    expect(iconLayer.layout?.["icon-image"]).toEqual(["get", "icon"]);
    expect(iconLayer.layout?.["icon-size"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      8,
      0.9,
      12,
      1,
    ]);
    expect(iconLayer.layout?.["icon-allow-overlap"]).toBe(true);
    expect(iconLayer.layout?.["icon-ignore-placement"]).toBe(true);
    expect(iconLayer.paint?.["icon-color"]).toEqual(
      LIGHT_AIRCRAFT_GLYPH_COLOR_EXPRESSION,
    );
    expect(iconLayer.paint?.["icon-halo-color"]).toBe(LIGHT_LABEL_HALO);
    expect(iconLayer.paint?.["icon-halo-width"]).toBe(1.4);
    expect(iconLayer.paint?.["icon-halo-blur"]).toBe(0);
    const selectedIconLayer = stub.layers.get(LYR_AIRCRAFT_SELECTED_ICON) as {
      filter?: unknown;
      layout?: Record<string, unknown>;
      paint?: Record<string, unknown>;
    };
    expect(selectedIconLayer.layout?.visibility).toBe("none");
    expect(selectedIconLayer.filter).toEqual(["==", ["get", "selected"], true]);
    expect(selectedIconLayer.layout?.["icon-image"]).toEqual(["get", "icon"]);
    expect(selectedIconLayer.layout?.["icon-size"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      8,
      1,
      12,
      1.1,
    ]);
    expect(selectedIconLayer.layout?.["icon-allow-overlap"]).toBe(true);
    expect(selectedIconLayer.layout?.["icon-ignore-placement"]).toBe(false);
    expect(selectedIconLayer.paint?.["icon-color"]).toEqual(
      LIGHT_AIRCRAFT_GLYPH_COLOR_EXPRESSION,
    );
    expect(selectedIconLayer.paint?.["icon-halo-color"]).toBe(LIGHT_LABEL_HALO);
    expect(selectedIconLayer.paint?.["icon-halo-width"]).toBe(1.6);
    expect(selectedIconLayer.paint?.["icon-halo-blur"]).toBe(0);
    const labelLayer = stub.layers.get(LYR_AIRCRAFT_LABEL) as {
      layout?: Record<string, unknown>;
      paint?: Record<string, unknown>;
    };
    expect(labelLayer.layout?.["text-allow-overlap"]).toBe(false);
    expect(labelLayer.layout?.["text-ignore-placement"]).toBe(false);
    expect(labelLayer.layout?.["symbol-sort-key"]).toEqual(["get", "priority"]);
    expect(labelLayer.paint?.["text-halo-color"]).toBe(
      "rgba(255, 255, 255, 0.92)",
    );
    expect(labelLayer.paint?.["text-halo-width"]).toBe(1.8);
    expect(labelLayer.paint?.["text-halo-blur"]).toBe(0.12);
    expect(labelLayer.layout?.["text-justify"]).toBe("left");
    expect(labelLayer.layout?.["text-field"]).toEqual(
      expect.arrayContaining([
        "format",
        ["coalesce", ["get", "labelCs"], ""],
        expect.objectContaining({
          "text-font": ["literal", ["IBM Plex Mono"]],
        }),
        expect.objectContaining({
          "text-font": ["literal", ["IBM Plex Mono"]],
        }),
      ]),
    );
    expect(JSON.stringify(labelLayer.layout?.["text-field"])).toContain(
      "#0f1114",
    );
    expect(JSON.stringify(labelLayer.layout?.["text-field"])).toContain(
      "#3b4148",
    );
    expect(JSON.stringify(labelLayer.layout?.["text-field"])).toContain(
      "labelAltSpeed",
    );
    const selectedLabelLayer = stub.layers.get(LYR_AIRCRAFT_SELECTED_LABEL) as {
      layout?: Record<string, unknown>;
      paint?: Record<string, unknown>;
    };
    expect(selectedLabelLayer.layout?.["text-anchor"]).toEqual([
      "get",
      "selectedLabelAnchor",
    ]);
    expect(selectedLabelLayer.layout?.["text-justify"]).toEqual([
      "get",
      "selectedLabelJustify",
    ]);
    expect(selectedLabelLayer.layout?.["text-offset"]).toEqual([
      "get",
      "selectedLabelOffset",
    ]);
    expect(selectedLabelLayer.layout?.["text-allow-overlap"]).toBe(false);
    expect(selectedLabelLayer.layout?.["text-ignore-placement"]).toBe(false);
    expect(selectedLabelLayer.layout?.["text-optional"]).toBe(true);
    expect(selectedLabelLayer.layout?.["symbol-sort-key"]).toEqual([
      "get",
      "priority",
    ]);
    expect(selectedLabelLayer.paint?.["text-halo-width"]).toBe(2.1);
    const hoverLabelLayer = stub.layers.get(LYR_AIRCRAFT_HOVER_LABEL) as {
      filter?: unknown;
      layout?: Record<string, unknown>;
      paint?: Record<string, unknown>;
    };
    expect(hoverLabelLayer.filter).toEqual([
      "all",
      ["==", ["get", "hovered"], true],
      ["==", ["get", "selected"], false],
    ]);
    expect(hoverLabelLayer.layout?.["text-justify"]).toBe("left");
    expect(hoverLabelLayer.layout?.["text-allow-overlap"]).toBe(false);
    expect(hoverLabelLayer.layout?.["text-ignore-placement"]).toBe(false);
    expect(hoverLabelLayer.layout?.["text-optional"]).toBe(true);
    expect(hoverLabelLayer.layout?.["symbol-sort-key"]).toEqual([
      "get",
      "priority",
    ]);
    expect(hoverLabelLayer.paint?.["text-halo-width"]).toBe(2.1);
    const layerOrder = Array.from(stub.layers.keys());
    expect(layerOrder.indexOf(LYR_AIRCRAFT_HOVER_LABEL)).toBeGreaterThan(
      layerOrder.indexOf(LYR_AIRCRAFT_LABEL),
    );
    expect(layerOrder.indexOf(LYR_AIRCRAFT_SELECTED_ICON)).toBeLessThan(
      layerOrder.indexOf(LYR_AIRCRAFT_LABEL),
    );
    expect(layerOrder.indexOf(LYR_AIRCRAFT_ICON)).toBeLessThan(
      layerOrder.indexOf(LYR_AIRCRAFT_LABEL),
    );
    expect(layerOrder.indexOf(LYR_AIRCRAFT_SELECTED_LABEL)).toBeGreaterThan(
      layerOrder.indexOf(LYR_AIRCRAFT_LABEL),
    );
    expect(layerOrder.indexOf(LYR_AIRCRAFT_SELECTED_LABEL)).toBeGreaterThan(
      layerOrder.indexOf(LYR_AIRCRAFT_HOVER_LABEL),
    );
    expect(labelLayer.layout?.["text-size"]).toEqual([
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
    ]);
  });

  it("applies icon and label toggles through layer layout updates without waiting for source data", () => {
    const stub = createStubMap();
    renderOverlay(root, stub, true);
    for (const source of stub.sources.values()) {
      source.setData.mockClear();
    }

    act(() => {
      useIdentStore.getState().setLabelMode("icon");
    });

    const arrowLayer = stub.layers.get(LYR_AIRCRAFT_ARROW) as {
      layout?: Record<string, unknown>;
    };
    const iconLayer = stub.layers.get(LYR_AIRCRAFT_ICON) as {
      layout?: Record<string, unknown>;
    };
    const selectedIconLayer = stub.layers.get(LYR_AIRCRAFT_SELECTED_ICON) as {
      layout?: Record<string, unknown>;
    };
    const selectedRingLayer = stub.layers.get(LYR_AIRCRAFT_SELECTED_RING) as {
      layout?: Record<string, unknown>;
    };
    expect(arrowLayer.layout?.visibility).toBe("none");
    expect(iconLayer.layout?.visibility).toBe("visible");
    expect(selectedIconLayer.layout?.visibility).toBe("visible");
    expect(selectedRingLayer.layout?.visibility).toBe("none");
    for (const source of stub.sources.values()) {
      expect(source.setData).not.toHaveBeenCalled();
    }

    act(() => {
      useIdentStore.setState((st) => ({
        map: {
          ...st.map,
          labelFields: {
            cs: false,
            type: true,
            alt: false,
            spd: false,
            sqk: false,
            rt: false,
          },
        },
      }));
    });

    const labelLayer = stub.layers.get(LYR_AIRCRAFT_LABEL) as {
      layout?: Record<string, unknown>;
    };
    const textField = JSON.stringify(labelLayer.layout?.["text-field"]);
    expect(textField).toContain("labelType");
    expect(textField).not.toContain("labelCs");
    for (const source of stub.sources.values()) {
      expect(source.setData).not.toHaveBeenCalled();
    }
    expect(stub.setLayoutProperty).toHaveBeenCalledWith(
      LYR_AIRCRAFT_LABEL,
      "text-field",
      labelLayer.layout?.["text-field"],
    );
    expect(stub.triggerRepaint).toHaveBeenCalled();
  });

  it("updates selected marker and predictor source data in the same render turn", () => {
    const stub = createStubMap();
    renderOverlay(root, stub, true);
    expect(stub.sources.get(SRC_PREDICTOR)?.data.features).toHaveLength(0);

    act(() => {
      useIdentStore.setState({ selectedHex: UAL.hex });
    });

    const selectedAircraft = stub.sources
      .get(SRC_AIRCRAFT)
      ?.data.features.find((feature) => feature.properties?.hex === UAL.hex);
    expect(selectedAircraft?.properties?.selected).toBe(true);
    expect(stub.sources.get(SRC_PREDICTOR)?.data.features).toHaveLength(2);

    act(() => {
      useIdentStore.setState({ selectedHex: null });
    });

    const clearedAircraft = stub.sources
      .get(SRC_AIRCRAFT)
      ?.data.features.find((feature) => feature.properties?.hex === UAL.hex);
    expect(clearedAircraft?.properties?.selected).toBe(false);
    expect(stub.sources.get(SRC_PREDICTOR)?.data.features).toHaveLength(0);
  });

  it("updates existing overlay sources even while the basemap style is still loading", () => {
    const stub = createStubMap();
    renderOverlay(root, stub, true);
    stub.isStyleLoaded.mockReturnValue(false);

    act(() => {
      useIdentStore.setState({ selectedHex: UAL.hex });
    });

    const selectedAircraft = stub.sources
      .get(SRC_AIRCRAFT)
      ?.data.features.find((feature) => feature.properties?.hex === UAL.hex);
    expect(selectedAircraft?.properties?.selected).toBe(true);
    expect(stub.sources.get(SRC_PREDICTOR)?.data.features).toHaveLength(2);
  });

  it("keeps the selected aircraft in the map source when filters would hide it", () => {
    const stub = createStubMap();
    useIdentStore.setState({
      selectedHex: UAL.hex,
      search: { query: "SWA" },
    });

    renderOverlay(root, stub, true);

    const selectedAircraft = stub.sources
      .get(SRC_AIRCRAFT)
      ?.data.features.find((feature) => feature.properties?.hex === UAL.hex);
    expect(selectedAircraft?.properties?.selected).toBe(true);
  });

  it("renders a selected aircraft at its last trail point when its current position is missing", () => {
    const stub = createStubMap();
    useIdentStore.setState({
      aircraft: new Map([
        [UAL.hex, { ...UAL, lat: undefined, lon: undefined }],
      ]),
      selectedHex: UAL.hex,
      trailsByHex: {
        [UAL.hex]: [
          { lat: 37.1, lon: -122.1, alt: 33000, ts: 1, segment: 0 },
          { lat: 37.2, lon: -122.2, alt: 33000, ts: 2, segment: 0 },
        ],
      },
    });

    renderOverlay(root, stub, true);

    const selectedAircraft = stub.sources
      .get(SRC_AIRCRAFT)
      ?.data.features.find((feature) => feature.properties?.hex === UAL.hex);
    expect(selectedAircraft?.geometry.type).toBe("Point");
    expect(
      (selectedAircraft?.geometry as GeoJSON.Point | undefined)?.coordinates,
    ).toEqual([-122.2, 37.2]);
    expect(selectedAircraft?.properties?.selected).toBe(true);
  });

  it("tracks a selected aircraft at its rendered trail point when its current position is missing", () => {
    const stub = createStubMap();
    useIdentStore.setState((st) => ({
      aircraft: new Map([
        [UAL.hex, { ...UAL, lat: undefined, lon: undefined }],
      ]),
      selectedHex: UAL.hex,
      camera: { ...st.camera, trackSelected: true },
      trailsByHex: {
        [UAL.hex]: [
          { lat: 37.1, lon: -122.1, alt: 33000, ts: 1, segment: 0 },
          { lat: 37.2, lon: -122.2, alt: 33000, ts: 2, segment: 0 },
        ],
      },
    }));

    renderOverlay(root, stub, true);

    expect(stub.easeTo).toHaveBeenCalledWith({
      center: [-122.2, 37.2],
      duration: 350,
      offset: [0, 0],
    });
  });

  it("does not recenter selected aircraft when unrelated aircraft update", () => {
    const stub = createStubMap();
    useIdentStore.setState((st) => ({
      selectedHex: UAL.hex,
      camera: { ...st.camera, trackSelected: true },
    }));
    renderOverlay(root, stub, true);
    expect(stub.easeTo).toHaveBeenCalledTimes(1);

    act(() => {
      useIdentStore.setState((st) => {
        const aircraft = new Map(st.aircraft);
        aircraft.set(SWA.hex, { ...SWA, lat: 37.8, lon: -122.4 });
        return { aircraft };
      });
    });

    expect(stub.easeTo).toHaveBeenCalledTimes(1);
  });

  it("defers missing selected layers during style load and restores them once loaded", () => {
    const stub = createStubMap();
    renderOverlay(root, stub, true);
    stub.layers.delete(LYR_AIRCRAFT_SELECTED_LABEL);
    stub.addLayer.mockClear();
    stub.isStyleLoaded.mockReturnValue(false);

    act(() => {
      useIdentStore.setState({ selectedHex: UAL.hex });
    });

    expect(stub.layers.has(LYR_AIRCRAFT_SELECTED_LABEL)).toBe(false);
    expect(stub.addLayer).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: LYR_AIRCRAFT_SELECTED_LABEL }),
    );

    stub.isStyleLoaded.mockReturnValue(true);
    act(() => {
      fire(stub, "styledata");
    });

    expect(stub.layers.has(LYR_AIRCRAFT_SELECTED_LABEL)).toBe(true);
  });

  it("selects aircraft from MapLibre rendered feature picking", () => {
    const stub = createStubMap({ queryHex: UAL.hex });
    renderOverlay(root, stub, true);

    act(() => {
      fire(stub, "click", { point: { x: 1, y: 2 } });
    });

    expect(stub.queryRenderedFeatures).toHaveBeenCalledWith([1, 2], {
      layers: expect.arrayContaining([LYR_AIRCRAFT_HIT]),
    });
    expect(useIdentStore.getState().selectedHex).toBe(UAL.hex);
  });

  it("deselects when feature picking misses all aircraft", () => {
    const stub = createStubMap({ queryHex: null });
    useIdentStore.setState({ selectedHex: UAL.hex });
    renderOverlay(root, stub, true);

    act(() => {
      fire(stub, "click", { point: { x: 9999, y: 9999 } });
    });

    expect(useIdentStore.getState().selectedHex).toBeNull();
  });

  it("does not query or clear selection while pick layers are absent during style reload", () => {
    const stub = createStubMap({ queryHex: null });
    useIdentStore.setState({ selectedHex: UAL.hex });
    renderOverlay(root, stub, true);
    for (const id of AIRCRAFT_PICK_LAYERS) {
      stub.layers.delete(id);
    }

    act(() => {
      fire(stub, "click", { point: { x: 1, y: 2 } });
    });

    expect(stub.queryRenderedFeatures).not.toHaveBeenCalled();
    expect(useIdentStore.getState().selectedHex).toBe(UAL.hex);
  });

  it("eases selected aircraft into the visible map area", () => {
    const stub = createStubMap({ inspectorWidth: 340 });
    renderOverlay(root, stub, true);
    act(() => {
      useIdentStore.getState().select(UAL.hex);
    });
    expect(stub.resize).not.toHaveBeenCalled();
    expect(stub.jumpTo).not.toHaveBeenCalled();
    expect(stub.easeTo).toHaveBeenCalledTimes(1);
    expect(stub.easeTo).toHaveBeenCalledWith({
      center: [UAL.lon, UAL.lat],
      duration: 350,
      offset: [-182, 0],
    });

    act(() => {
      useIdentStore.getState().select(SWA.hex);
    });
    expect(stub.easeTo).toHaveBeenCalledTimes(2);
    expect(stub.easeTo).toHaveBeenCalledWith({
      center: [SWA.lon, SWA.lat],
      duration: 350,
      offset: [-182, 0],
    });
  });

  it("offsets selected mobile aircraft above the inspector sheet", () => {
    const stub = createStubMap({
      mobileSheetHeight: 500,
      mobileSheetSnap: "half",
    });
    renderOverlay(root, stub, true);

    act(() => {
      useIdentStore.getState().select(UAL.hex);
    });

    expect(stub.easeTo).toHaveBeenCalledWith({
      center: [UAL.lon, UAL.lat],
      duration: 350,
      offset: [0, -250],
    });
  });

  it("offsets bottom map controls when the floating inspector is open", () => {
    const stub = createStubMap();
    useIdentStore.setState({ selectedHex: UAL.hex });
    renderOverlay(root, stub, true);

    const controls = container.querySelector<HTMLElement>(
      '[data-testid="map-bottom-controls"]',
    );
    expect(controls?.dataset.inspectorOpen).toBe("true");
  });

  it("places the mobile feed status in the scale HUD stack", () => {
    const stub = createStubMap();
    useIdentStore.setState((st) => ({
      connectionStatus: { ws: "open" },
      liveState: {
        ...st.liveState,
        lastMsgTs: Date.now(),
        mpsBuffer: [8],
      },
    }));
    renderOverlay(root, stub, true);

    const scaleControls = container.querySelector<HTMLElement>(
      ".map-scale-controls",
    );
    expect(scaleControls).toBeTruthy();
    expect(scaleControls!.className).toContain("flex-col");
    const feed = scaleControls!.querySelector<HTMLElement>("[data-feed-state]");
    expect(feed?.getAttribute("data-feed-state")).toBe("fresh");
    expect(feed?.className).toContain("liquid-glass");
    expect(scaleControls!.textContent).toContain("Live");
  });

  it("recenter button fits bounds around receiver and all aircraft", () => {
    const stub = createStubMap();
    act(() => {
      useIdentStore.getState().select(UAL.hex);
    });
    renderOverlay(root, stub, true);
    stub.fitBounds.mockClear();
    const btn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Recenter map"]',
    );
    expect(btn).toBeTruthy();
    expect(btn!.getAttribute("title")).toBeNull();

    act(() => {
      btn!.focus();
    });

    expect(btn!.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Refit map",
    );

    act(() => {
      btn!.blur();
    });

    expect(document.querySelector('[role="tooltip"]')).toBeNull();

    act(() => {
      btn!.click();
    });
    expect(stub.fitBounds).toHaveBeenCalledTimes(1);
    expect(useIdentStore.getState().camera.trackSelected).toBe(false);
    const call = stub.fitBounds.mock.calls[0];
    const bbox = call[0] as [[number, number], [number, number]];
    expect(bbox[0][0]).toBeCloseTo(Math.min(UAL.lon!, SWA.lon!, -122.1));
    expect(bbox[0][1]).toBeCloseTo(Math.min(UAL.lat!, SWA.lat!, 37.4));
    expect(bbox[1][0]).toBeCloseTo(Math.max(UAL.lon!, SWA.lon!, -122.1));
    expect(bbox[1][1]).toBeCloseTo(Math.max(UAL.lat!, SWA.lat!, 37.7));
  });

  it("keeps selected tracking on aircraft position updates until the user pans", () => {
    const stub = createStubMap({ inspectorWidth: 340 });
    renderOverlay(root, stub, true);

    act(() => {
      useIdentStore.getState().select(UAL.hex);
    });
    stub.easeTo.mockClear();

    act(() => {
      useIdentStore.setState({
        aircraft: new Map([
          [UAL.hex, { ...UAL, lat: 37.5, lon: -122.2 }],
          [SWA.hex, SWA],
        ]),
      });
    });

    expect(stub.easeTo).toHaveBeenCalledTimes(1);
    expect(stub.easeTo).toHaveBeenCalledWith({
      center: [-122.2, 37.5],
      duration: 350,
      offset: [-182, 0],
    });

    act(() => {
      fire(stub, "dragstart");
    });
    expect(useIdentStore.getState().camera.trackSelected).toBe(false);
    stub.easeTo.mockClear();

    act(() => {
      useIdentStore.setState({
        aircraft: new Map([
          [UAL.hex, { ...UAL, lat: 37.6, lon: -122.25 }],
          [SWA.hex, SWA],
        ]),
      });
    });

    expect(stub.easeTo).not.toHaveBeenCalled();
  });

  it("re-enables selected tracking while preserving the aircraft screen offset", () => {
    const stub = createStubMap({
      containerRect: { width: 800, height: 600 },
      inspectorWidth: 340,
      project: ({ lng, lat }) => {
        if (lng === UAL.lon && lat === UAL.lat) {
          return { x: 140, y: 460 };
        }
        return { x: lng * 10, y: lat * 10 };
      },
    });
    renderOverlay(root, stub, true);

    act(() => {
      useIdentStore.getState().select(UAL.hex);
      fire(stub, "dragstart");
    });
    stub.easeTo.mockClear();

    const trackButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Track selected aircraft UAL123"]',
    );
    expect(trackButton).toBeTruthy();

    act(() => {
      trackButton!.click();
    });

    expect(useIdentStore.getState().camera.trackSelected).toBe(true);
    expect(stub.easeTo).not.toHaveBeenCalled();

    act(() => {
      useIdentStore.setState({
        aircraft: new Map([
          [UAL.hex, { ...UAL, lat: 37.5, lon: -122.2 }],
          [SWA.hex, SWA],
        ]),
      });
    });

    expect(stub.easeTo).toHaveBeenCalledTimes(1);
    expect(stub.easeTo).toHaveBeenCalledWith({
      center: [-122.2, 37.5],
      duration: 350,
      offset: [-260, 160],
    });
  });

  it("keeps selected tracking through user zoom gestures", () => {
    const stub = createStubMap();
    renderOverlay(root, stub, true);

    act(() => {
      useIdentStore.getState().select(UAL.hex);
      fire(stub, "zoomstart");
    });

    expect(useIdentStore.getState().camera).toMatchObject({
      trackSelected: true,
      lastUserInteraction: { kind: "zoom" },
    });
  });

  it("renders an icon-only selected tracking toggle", () => {
    const stub = createStubMap();
    renderOverlay(root, stub, true);

    act(() => {
      useIdentStore.getState().select(UAL.hex);
    });

    const trackButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Stop tracking UAL123"]',
    );
    expect(trackButton).toBeTruthy();
    expect(trackButton!.textContent).toBe("");
    expect(trackButton!.getAttribute("title")).toBeNull();
    expect(trackButton!.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      trackButton!.focus();
    });

    expect(trackButton!.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Tracking UAL123",
    );

    act(() => {
      trackButton!.blur();
    });

    expect(document.querySelector('[role="tooltip"]')).toBeNull();

    act(() => {
      trackButton!.click();
    });

    expect(useIdentStore.getState().camera.trackSelected).toBe(false);
  });

  it("shows custom help for the auto-fit traffic checkbox", () => {
    const stub = createStubMap();
    renderOverlay(root, stub, true);

    const autoFit = container.querySelector<HTMLInputElement>(
      'input[aria-label="Auto-fit traffic"]',
    );
    expect(autoFit).toBeTruthy();
    expect(autoFit!.getAttribute("title")).toBeNull();

    act(() => {
      autoFit!.focus();
    });

    expect(autoFit!.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Refit to traffic after idle",
    );

    act(() => {
      autoFit!.blur();
    });

    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("auto-fits traffic after the idle timeout when enabled", () => {
    vi.useFakeTimers();
    try {
      const stub = createStubMap();
      renderOverlay(root, stub, true);
      stub.fitBounds.mockClear();

      const autoFit = container.querySelector<HTMLInputElement>(
        'input[aria-label="Auto-fit traffic"]',
      );
      expect(autoFit).toBeTruthy();

      act(() => {
        autoFit!.click();
      });
      expect(useIdentStore.getState().camera.autoFitTraffic).toBe(true);

      act(() => {
        vi.advanceTimersByTime(11_999);
      });
      expect(stub.fitBounds).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(stub.fitBounds).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not restart the auto-fit idle timeout on traffic frame updates", () => {
    vi.useFakeTimers();
    try {
      const stub = createStubMap();
      renderOverlay(root, stub, true);
      stub.fitBounds.mockClear();

      const autoFit = container.querySelector<HTMLInputElement>(
        'input[aria-label="Auto-fit traffic"]',
      );
      expect(autoFit).toBeTruthy();

      act(() => {
        autoFit!.click();
      });

      act(() => {
        vi.advanceTimersByTime(6_000);
      });
      expect(stub.fitBounds).not.toHaveBeenCalled();

      act(() => {
        useIdentStore.setState({
          aircraft: new Map([
            [UAL.hex, { ...UAL, lat: 37.5, lon: -122.2 }],
            [SWA.hex, SWA],
          ]),
        });
      });

      act(() => {
        vi.advanceTimersByTime(5_999);
      });
      expect(stub.fitBounds).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(stub.fitBounds).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the recenter button when traffic exists outside the viewport", () => {
    const stub = createStubMap({ contains: () => false });
    renderOverlay(root, stub, true);

    const btn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Recenter map"]',
    );
    expect(btn).toBeTruthy();
    expect(btn?.dataset.offscreenTraffic).toBe("true");
    expect(btn?.className).toContain("animate-livepulse");
    expect(btn?.className).toContain("motion-reduce:animate-none");
  });

  it("uploads the selected trail on mount even when trails are disabled", () => {
    const stub = createStubMap();
    useIdentStore.setState((st) => ({
      selectedHex: UAL.hex,
      trailsByHex: {
        [UAL.hex]: [
          { lat: 37.4, lon: -122.1, alt: 10_000, ts: 1_000, segment: 0 },
          {
            lat: 37.42,
            lon: -122.08,
            alt: 12_000,
            ts: 2_000,
            segment: 0,
          },
        ],
      },
      map: {
        ...st.map,
        layers: { ...st.map.layers, trails: false },
      },
    }));

    renderOverlay(root, stub, true);

    const layer = stub.layers.get(TRAFFIC_TRAILS_LAYER_ID) as
      | { snapshot?: TrafficTrailsSnapshot }
      | undefined;
    expect(layer?.snapshot?.vertexCount).toBe(18);
  });

  it("does not refit on startup when traffic is already visible", () => {
    useIdentStore.setState({ aircraft: new Map() });
    const stub = createStubMap();
    renderOverlay(root, stub, true);
    expect(stub.fitBounds).not.toHaveBeenCalled();

    act(() => {
      useIdentStore.setState({
        aircraft: new Map([
          [UAL.hex, UAL],
          [SWA.hex, SWA],
        ]),
      });
    });

    expect(stub.fitBounds).not.toHaveBeenCalled();
  });

  it("fits bounds when startup traffic is only partially visible", () => {
    const stub = createStubMap({
      contains: ({ lng }) => lng === UAL.lon,
    });
    renderOverlay(root, stub, true);
    expect(stub.fitBounds).not.toHaveBeenCalled();

    act(() => {
      fire(stub, "idle");
    });

    expect(stub.fitBounds).toHaveBeenCalledTimes(1);
    const call = stub.fitBounds.mock.calls[0];
    const bbox = call[0] as [[number, number], [number, number]];
    expect(bbox[0][0]).toBeCloseTo(Math.min(UAL.lon!, SWA.lon!, -122.1));
    expect(bbox[0][1]).toBeCloseTo(Math.min(UAL.lat!, SWA.lat!, 37.4));
    expect(bbox[1][0]).toBeCloseTo(Math.max(UAL.lon!, SWA.lon!, -122.1));
    expect(bbox[1][1]).toBeCloseTo(Math.max(UAL.lat!, SWA.lat!, 37.7));
  });

  it("keeps watching startup traffic through the receiver-centered camera move", () => {
    let containsAll = true;
    const stub = createStubMap({
      contains: ({ lng }) => containsAll || lng === UAL.lon,
    });
    renderOverlay(root, stub, true);
    expect(stub.fitBounds).not.toHaveBeenCalled();

    act(() => {
      containsAll = false;
      fire(stub, "moveend");
    });
    expect(stub.fitBounds).not.toHaveBeenCalled();

    act(() => {
      fire(stub, "idle");
    });

    expect(stub.fitBounds).toHaveBeenCalledTimes(1);
    const call = stub.fitBounds.mock.calls[0];
    const bbox = call[0] as [[number, number], [number, number]];
    expect(bbox[0][0]).toBeCloseTo(Math.min(UAL.lon!, SWA.lon!, -122.1));
    expect(bbox[1][0]).toBeCloseTo(Math.max(UAL.lon!, SWA.lon!, -122.1));
  });

  it("stops watching startup traffic after the first settled visible view", () => {
    let containsAll = true;
    const stub = createStubMap({
      contains: ({ lng }) => containsAll || lng === UAL.lon,
    });
    renderOverlay(root, stub, true);
    expect(stub.fitBounds).not.toHaveBeenCalled();

    act(() => {
      fire(stub, "idle");
    });

    act(() => {
      containsAll = false;
      fire(stub, "moveend");
      fire(stub, "idle");
    });

    expect(stub.fitBounds).not.toHaveBeenCalled();
  });

  it("fits bounds once when first startup traffic is outside the viewport", () => {
    useIdentStore.setState({ aircraft: new Map() });
    const stub = createStubMap({ contains: () => false });
    renderOverlay(root, stub, true);
    expect(stub.fitBounds).not.toHaveBeenCalled();

    act(() => {
      useIdentStore.setState({
        aircraft: new Map([
          [UAL.hex, UAL],
          [SWA.hex, SWA],
        ]),
      });
    });

    act(() => {
      fire(stub, "idle");
    });

    expect(stub.fitBounds).toHaveBeenCalledTimes(1);
    const call = stub.fitBounds.mock.calls[0];
    const bbox = call[0] as [[number, number], [number, number]];
    expect(bbox[0][0]).toBeCloseTo(Math.min(UAL.lon!, SWA.lon!, -122.1));
    expect(bbox[0][1]).toBeCloseTo(Math.min(UAL.lat!, SWA.lat!, 37.4));
    expect(bbox[1][0]).toBeCloseTo(Math.max(UAL.lon!, SWA.lon!, -122.1));
    expect(bbox[1][1]).toBeCloseTo(Math.max(UAL.lat!, SWA.lat!, 37.7));
  });

  it("publishes visible aircraft hexes to the store without projecting offscreen aircraft", () => {
    const stub = createStubMap({
      contains: ({ lng, lat }) => lng === UAL.lon && lat === UAL.lat,
    });
    renderOverlay(root, stub, true);

    const hexes = useIdentStore.getState().map.viewportHexes;
    expect(hexes).toBeInstanceOf(Set);
    expect(hexes!.has(UAL.hex)).toBe(true);
    expect(hexes!.has(SWA.hex)).toBe(false);
    expect(stub.project).not.toHaveBeenCalledWith({
      lng: SWA.lon,
      lat: SWA.lat,
    });
  });

  it("adds the MapLibre trails layer by default and re-adds it after a style reload", () => {
    const stub = createStubMap();
    renderOverlay(root, stub, true);

    expect(stub.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: TRAFFIC_TRAILS_LAYER_ID, type: "custom" }),
      LYR_AIRCRAFT_HIT,
    );
    const callsAfterMount = stub.addLayer.mock.calls.length;
    stub.layers.delete(TRAFFIC_TRAILS_LAYER_ID);

    act(() => {
      fire(stub, "styledata");
    });

    expect(stub.addLayer.mock.calls.length).toBe(callsAfterMount + 1);
  });

  it("updates hoveredHex from MapLibre feature picking", () => {
    const stub = createStubMap({ queryHex: SWA.hex });
    renderOverlay(root, stub, true);

    act(() => {
      fire(stub, "mousemove", { point: { x: 1, y: 2 } });
    });
    expect(useIdentStore.getState().labels.hoveredHex).toBe(SWA.hex);

    act(() => {
      fire(stub, "mouseout");
    });
    expect(useIdentStore.getState().labels.hoveredHex).toBeNull();
  });

  it("highlights a selected trail dot when the pointer is below it", () => {
    const trail = [
      { lat: 37.4, lon: -122.1, alt: 10_000, ts: 1_000, segment: 0 },
      { lat: 37.42, lon: -122.08, alt: 12_000, ts: 2_000, segment: 0 },
    ];
    const stub = createStubMap({
      project: ({ lng, lat }) => ({ x: lng * 10, y: lat * 10 }),
    });
    useIdentStore.setState({
      selectedHex: UAL.hex,
      trailsByHex: { [UAL.hex]: trail },
    });

    renderOverlay(root, stub, true);

    const dot = { x: trail[1].lon * 10, y: trail[1].lat * 10 };
    act(() => {
      fire(stub, "mousemove", { point: { x: dot.x, y: dot.y + 12 } });
    });

    const layer = stub.layers.get(TRAFFIC_TRAILS_LAYER_ID) as
      | { snapshot?: TrafficTrailsSnapshot }
      | undefined;
    const vertices = Array.from(layer?.snapshot?.vertices ?? []);
    const hasHighlightedDot = vertices.some(
      (_value, index) =>
        index % 11 === 7 &&
        vertices[index] === 1 &&
        vertices[index + 1] === 1 &&
        vertices[index + 2] === 1,
    );
    expect(hasHighlightedDot).toBe(true);
  });

  it("does not rebind pointer handlers while recomputing trail dot targets during pan", () => {
    const trail = [
      { lat: 37.4, lon: -122.1, alt: 10_000, ts: 1_000, segment: 0 },
      { lat: 37.42, lon: -122.08, alt: 12_000, ts: 2_000, segment: 0 },
    ];
    const stub = createStubMap({
      project: ({ lng, lat }) => ({ x: lng * 10, y: lat * 10 }),
    });
    useIdentStore.setState({
      selectedHex: UAL.hex,
      trailsByHex: { [UAL.hex]: trail },
    });

    renderOverlay(root, stub, true);
    const onCalls = stub.on.mock.calls.length;
    const offCalls = stub.off.mock.calls.length;

    act(() => {
      fire(stub, "move");
    });

    expect(stub.on.mock.calls.length).toBe(onCalls);
    expect(stub.off.mock.calls.length).toBe(offCalls);
  });
});
