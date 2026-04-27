// biome-ignore-all lint/style/noNonNullAssertion: test fixture — missing elements/mocks fail the test loudly via the test runner.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdentStore } from "../data/store";
import { MapEngine } from "./MapEngine";
import type { BasemapId } from "./styles";

interface FakeMap {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  addSource: ReturnType<typeof vi.fn>;
  addLayer: ReturnType<typeof vi.fn>;
  addImage: ReturnType<typeof vi.fn>;
  hasImage: ReturnType<typeof vi.fn>;
  removeSource: ReturnType<typeof vi.fn>;
  removeLayer: ReturnType<typeof vi.fn>;
  getSource: ReturnType<typeof vi.fn>;
  getLayer: ReturnType<typeof vi.fn>;
  moveLayer: ReturnType<typeof vi.fn>;
  setStyle: ReturnType<typeof vi.fn>;
  setPaintProperty: ReturnType<typeof vi.fn>;
  setGlyphs: ReturnType<typeof vi.fn>;
  getGlyphs: ReturnType<typeof vi.fn>;
  getCenter: ReturnType<typeof vi.fn>;
  getZoom: ReturnType<typeof vi.fn>;
  easeTo: ReturnType<typeof vi.fn>;
  addControl: ReturnType<typeof vi.fn>;
  isStyleLoaded: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
}

function makeFakeMap(): FakeMap {
  return {
    on: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    addImage: vi.fn(),
    hasImage: vi.fn(() => false),
    removeSource: vi.fn(),
    removeLayer: vi.fn(),
    getSource: vi.fn(() => undefined),
    getLayer: vi.fn(() => undefined),
    moveLayer: vi.fn(),
    setStyle: vi.fn(),
    setPaintProperty: vi.fn(),
    setGlyphs: vi.fn(),
    getGlyphs: vi.fn(() => "https://fonts.example/{fontstack}/{range}.pbf"),
    getCenter: vi.fn(() => ({ lng: 0, lat: 0 })),
    getZoom: vi.fn(() => 4),
    easeTo: vi.fn(),
    addControl: vi.fn(),
    isStyleLoaded: vi.fn(() => true),
    resize: vi.fn(),
  };
}

describe("MapEngine", () => {
  let container: HTMLDivElement;
  let root: Root;
  let lastMap: FakeMap | null = null;
  let ctor: ReturnType<typeof vi.fn>;
  let originalResizeObserver: typeof ResizeObserver | undefined;

  beforeEach(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    lastMap = null;
    ctor = vi.fn().mockImplementation(function MapLibreMap() {
      const m = makeFakeMap();
      lastMap = m;
      return m;
    });
    (window as unknown as { maplibregl: unknown }).maplibregl = {
      Map: ctor,
      AttributionControl: vi
        .fn()
        .mockImplementation(function AttributionControl() {
          return {};
        }),
    };

    // Seed the store with a MapSlice shape matching the post-migration spec.
    useIdentStore.setState((st) => ({
      ...st,
      map: {
        ...st.map,
        basemapId: "ident" as BasemapId,
        center: null,
        zoom: null,
        layers: {
          ...st.map.layers,
          rangeRings: false,
          rxRange: false,
          losRings: false,
        },
      } as typeof st.map,
      receiver: null,
      outline: null,
      losData: null,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => root.unmount());
    container.remove();
    delete (window as unknown as { maplibregl?: unknown }).maplibregl;
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      delete (globalThis as unknown as { ResizeObserver?: unknown })
        .ResizeObserver;
    }
  });

  it("constructs a MapLibre instance on mount", () => {
    act(() => {
      root.render(<MapEngine />);
    });
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(ctor).toHaveBeenCalledWith(
      expect.objectContaining({ fadeDuration: 0 }),
    );
    expect(container.querySelector(".map-canvas-host")).toBeTruthy();
    expect(lastMap).not.toBeNull();
    expect(lastMap!.on).toHaveBeenCalledWith("load", expect.any(Function));
    expect(lastMap!.on).toHaveBeenCalledWith("moveend", expect.any(Function));
  });

  it("does not overlay feed status text on the map viewport", () => {
    useIdentStore.setState((st) => ({
      ...st,
      connectionStatus: { ws: "connecting" },
      liveState: { ...st.liveState, lastMsgTs: 0 },
    }));
    act(() => {
      root.render(<MapEngine />);
    });
    const load = lastMap!.on.mock.calls.find(
      ([event]) => event === "load",
    )?.[1] as (() => void) | undefined;

    act(() => load?.());

    expect(container.querySelector('[data-testid="map-viewport-state"]')).toBe(
      null,
    );
    expect(container.textContent).not.toContain("Listening for blips");
  });

  it("unsets remote glyph URLs after style load so overlay web fonts render locally", () => {
    act(() => {
      root.render(<MapEngine />);
    });
    const m = lastMap!;
    const load = m.on.mock.calls.find(([event]) => event === "load")?.[1] as
      | (() => void)
      | undefined;

    act(() => load?.());

    expect(m.setGlyphs).toHaveBeenCalledWith(null);
  });

  it("adds a transparent placeholder for missing basemap circle sprite images", () => {
    act(() => {
      root.render(<MapEngine />);
    });
    const m = lastMap!;
    const handler = m.on.mock.calls.find(
      ([event]) => event === "styleimagemissing",
    )?.[1] as ((event: { id: string }) => void) | undefined;

    act(() => handler?.({ id: "circle-11" }));

    expect(m.addImage).toHaveBeenCalledWith(
      "circle-11",
      expect.objectContaining({ width: 11, height: 11 }),
    );
  });

  it("renders a fallback and does not call map methods when maplibregl is missing", () => {
    delete (window as unknown as { maplibregl?: unknown }).maplibregl;
    act(() => {
      root.render(<MapEngine />);
    });
    expect(ctor).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Chart took a detour");
    expect(
      container
        .querySelector('[data-testid="map-init-error"]')
        ?.getAttribute("title"),
    ).toContain("maplibregl");
  });

  it("calls setStyle when basemapId changes", () => {
    act(() => {
      root.render(<MapEngine />);
    });
    const m = lastMap!;
    const before = m.setStyle.mock.calls.length;

    act(() => {
      useIdentStore.setState((st) => ({
        ...st,
        map: { ...st.map, basemapId: "osm" as BasemapId } as typeof st.map,
      }));
    });

    expect(m.setStyle.mock.calls.length).toBeGreaterThan(before);
  });

  it("writes the current camera back to the store on moveend", () => {
    act(() => {
      root.render(<MapEngine />);
    });
    const m = lastMap!;
    m.getCenter.mockReturnValue({ lng: -122.4194, lat: 37.7749 });
    m.getZoom.mockReturnValue(8.5);

    const moveEnd = m.on.mock.calls.find(
      ([event]) => event === "moveend",
    )?.[1] as (() => void) | undefined;

    expect(moveEnd).toBeTypeOf("function");
    expect(useIdentStore.getState().map.center).toBeNull();
    expect(useIdentStore.getState().map.zoom).toBeNull();

    act(() => moveEnd?.());

    expect(useIdentStore.getState().map.center).toEqual({
      lng: -122.4194,
      lat: 37.7749,
    });
    expect(useIdentStore.getState().map.zoom).toBe(8.5);
  });

  it("centers on the receiver even if startup moveend stored the fallback camera", () => {
    act(() => {
      root.render(<MapEngine />);
    });
    const m = lastMap!;
    m.getCenter.mockReturnValue({ lng: -100, lat: 40 });
    m.getZoom.mockReturnValue(4);

    const moveEnd = m.on.mock.calls.find(
      ([event]) => event === "moveend",
    )?.[1] as (() => void) | undefined;
    const load = m.on.mock.calls.find(([event]) => event === "load")?.[1] as
      | (() => void)
      | undefined;

    act(() => {
      moveEnd?.();
      load?.();
    });

    expect(useIdentStore.getState().map.center).toEqual({
      lng: -100,
      lat: 40,
    });

    act(() => {
      useIdentStore.setState((st) => ({
        ...st,
        receiver: { lat: 37.4, lon: -122.1, version: "readsb" },
      }));
    });

    expect(m.easeTo).toHaveBeenCalledWith({
      center: [-122.1, 37.4],
      zoom: 8,
      duration: 0,
    });
  });

  it("unmount calls remove()", () => {
    act(() => {
      root.render(<MapEngine />);
    });
    const m = lastMap!;
    act(() => root.unmount());
    // Re-create root so afterEach's unmount is safe.
    root = createRoot(container);
    expect(m.remove).toHaveBeenCalled();
  });

  it("resizes MapLibre when its host box changes", () => {
    let onResize: ResizeObserverCallback | null = null;
    class FakeResizeObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        onResize = callback;
      }
    }
    globalThis.ResizeObserver =
      FakeResizeObserver as unknown as typeof ResizeObserver;

    act(() => {
      root.render(<MapEngine />);
    });
    expect(onResize).toBeTypeOf("function");

    act(() => {
      onResize?.([], {} as ResizeObserver);
    });

    expect(lastMap!.resize).toHaveBeenCalledTimes(1);
  });

  it("keeps receiver overlay layers below traffic overlays", () => {
    useIdentStore.setState((st) => ({
      ...st,
      receiver: { lat: 37.4, lon: -122.1, version: "readsb" },
      map: {
        ...st.map,
        layers: {
          ...st.map.layers,
          rangeRings: true,
          rxRange: false,
          losRings: false,
        },
      } as typeof st.map,
    }));

    act(() => {
      root.render(<MapEngine />);
    });
    const m = lastMap!;
    m.getLayer.mockImplementation((id: string) => {
      if (id === "ident-station-ring-outer" || id === "ident-range-rings-line")
        return {};
      return undefined;
    });
    const styleDataHandlers = m.on.mock.calls
      .filter(([event]) => event === "styledata")
      .map(([, handler]) => handler as () => void);

    act(() => {
      for (const handler of styleDataHandlers) handler();
    });

    expect(m.moveLayer).toHaveBeenCalledWith(
      "ident-range-rings-line",
      "ident-station-ring-outer",
    );
  });

  it("renders LOS rings as muted context lines below traffic", () => {
    useIdentStore.setState((st) => ({
      ...st,
      losData: {
        rings: [
          {
            alt: 3000,
            points: [
              [37.4, -122.1],
              [37.5, -122.1],
              [37.5, -122.0],
            ],
          },
        ],
      },
      map: {
        ...st.map,
        layers: {
          ...st.map.layers,
          rangeRings: false,
          rxRange: false,
          losRings: true,
        },
      } as typeof st.map,
    }));

    act(() => {
      root.render(<MapEngine />);
    });

    const losLayer = lastMap!.addLayer.mock.calls.find(
      ([layer]) => layer.id === "ident-los-line",
    )?.[0];
    expect(losLayer?.paint).toEqual(
      expect.objectContaining({
        "line-color": ["get", "color"],
        "line-opacity": 0.7,
      }),
    );
  });
});
