import type {
  LayerSpecification,
  MapStyleImageMissingEvent,
  Map as MlMap,
} from "maplibre-gl";
import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { emitFrontendDiagnostic } from "../data/frontendDiagnostics";
import { useIdentStore } from "../data/store";
import type {
  HeyWhatsThatJson,
  HeyWhatsThatRing,
  IdentRangeOutline,
} from "../data/types";
import { altLosColor } from "./alt";
import { circleRing } from "./geodesic";
import { MapEngineContext } from "./MapEngineContext";
import { getMaplibre } from "./maplibre";
import {
  LYR_AIRCRAFT_HIT,
  LYR_STATION_RING_OUTER,
  MAP_LABEL_FONT_FAMILY,
} from "./mapOverlayLayers";
import { resolveBasemapTone, useThemeIsDark } from "./mapTone";
import { type BasemapId, resolveBasemapStyle } from "./styles";
import { TRAFFIC_TRAILS_LAYER_ID } from "./trafficTrailsLayer";

const RING_RADII_NM = [25, 50, 100, 150, 200];
const RING_POINTS = 64;
const DEFAULT_CENTER: [number, number] = [-100, 40];
const DEFAULT_ZOOM = 4;
const RECEIVER_ZOOM = 8;
const METERS_TO_FEET = 3.28084;
const MAP_LABEL_FONT_LOADS = [
  `12px '${MAP_LABEL_FONT_FAMILY}'`,
  `600 12px '${MAP_LABEL_FONT_FAMILY}'`,
];

// Source / layer ids. Kept stable so re-adds after setStyle can reference them.
const SRC_RANGE_RINGS = "ident-range-rings";
const LYR_RANGE_RINGS = "ident-range-rings-line";
const SRC_RX_RANGE = "ident-rx-range";
const LYR_RX_RANGE_FILL = "ident-rx-range-fill";
const LYR_RX_RANGE_LINE = "ident-rx-range-line";
const SRC_LOS = "ident-los";
const LYR_LOS_FILL = "ident-los-fill";
const LYR_LOS_LINE = "ident-los-line";
const sourceDataCache = new WeakMap<
  MlMap,
  Map<string, GeoJSON.FeatureCollection>
>();

function readCssVar(host: Element | null, ...names: string[]): string {
  if (typeof document === "undefined") return "";
  const target = host ?? document.documentElement;
  const style = getComputedStyle(target);
  for (const name of names) {
    const value = style.getPropertyValue(name).trim();
    if (value) return value;
  }
  return "";
}

function rangeRingsGeoJson(center: {
  lng: number;
  lat: number;
}): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: RING_RADII_NM.map((r) => ({
      type: "Feature",
      properties: { radiusNm: r },
      geometry: {
        type: "LineString",
        coordinates: circleRing(center, r, RING_POINTS),
      },
    })),
  };
}

function rxRangeGeoJson(
  rangeOutline: IdentRangeOutline | null,
): GeoJSON.FeatureCollection {
  if (!rangeOutline || rangeOutline.coordinates.length < 3)
    return { type: "FeatureCollection", features: [] };
  const ring = rangeOutline.coordinates;
  // Close the polygon if the source ring isn't already closed.
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed =
    first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [closed] },
      },
    ],
  };
}

function losGeoJson(los: HeyWhatsThatJson | null): GeoJSON.FeatureCollection {
  if (!los) return { type: "FeatureCollection", features: [] };
  const features: GeoJSON.Feature[] = [];
  for (const ring of los.rings as HeyWhatsThatRing[]) {
    if (!ring.points || ring.points.length < 3) continue;
    // HWT points are [lat, lon]; GeoJSON wants [lon, lat].
    const coords = ring.points.map(
      ([lat, lon]) => [lon, lat] as [number, number],
    );
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);
    const altMeters =
      typeof ring.alt === "string" ? Number.parseFloat(ring.alt) : ring.alt;
    const altFt = Number.isFinite(altMeters) ? altMeters * METERS_TO_FEET : 0;
    features.push({
      type: "Feature",
      properties: { altFt, color: altLosColor(altFt) },
      geometry: { type: "Polygon", coordinates: [coords] },
    });
  }
  return { type: "FeatureCollection", features };
}

interface MapEngineProps {
  children?: ReactNode;
}

export function MapEngine({ children }: MapEngineProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const basemapId = useIdentStore(
    (s) => s.map.basemapId as BasemapId | undefined,
  );
  const theme = useIdentStore((s) => s.settings.theme);
  const layers = useIdentStore((s) => s.map.layers);
  const receiver = useIdentStore((s) => s.receiver);
  const rangeOutline = useIdentStore((s) => s.rangeOutline);
  const losData = useIdentStore((s) => s.losData);

  // Store center/zoom used only for initial placement; moveend writes back.
  const storedCenter = useIdentStore((s) => s.map.center);
  const storedZoom = useIdentStore((s) => s.map.zoom);
  const setMapView = useIdentStore((s) => s.setMapView);

  const themeIsDark = useThemeIsDark(theme);
  const firstPaintRef = useRef(false);
  const hasSavedInitialCenterRef = useRef(storedCenter != null);

  // Mount MapLibre once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — seeds initial map state from basemapId/storedCenter/storedZoom/themeIsDark/setMapView; subsequent changes handled by later effects
  useEffect(() => {
    if (!containerRef.current) return;
    let mlgl: ReturnType<typeof getMaplibre>;
    try {
      mlgl = getMaplibre();
    } catch (e) {
      setInitError((e as Error).message);
      return;
    }

    const resolvedStyle = resolveBasemapStyle(
      (basemapId ?? "ident") as BasemapId,
      themeIsDark,
    );
    const initialCenter: [number, number] = storedCenter
      ? [storedCenter.lng, storedCenter.lat]
      : DEFAULT_CENTER;
    const initialZoom = storedZoom ?? DEFAULT_ZOOM;

    preloadMapLabelFonts();
    const instance = new mlgl.Map({
      container: containerRef.current,
      style: resolvedStyle,
      center: initialCenter,
      zoom: initialZoom,
      fadeDuration: 0,
      attributionControl: false,
    });
    instance.addControl(
      new mlgl.AttributionControl({ compact: false }),
      "bottom-left",
    );

    mapRef.current = instance;
    setMap(instance);

    // Lock the map in the demo so the page can scroll past the full-bleed map:
    // desktop disables scroll-zoom (wheel scrolls the page); phone also drops
    // drag/touch so swipes scroll the landing.
    const cleanupDemoLock =
      import.meta.env.VITE_IDENT_DEMO === "true"
        ? lockMapForDemo(
            instance,
            containerRef.current,
            window.matchMedia("(max-width: 767px)").matches,
          )
        : undefined;

    const onLoad = (): void => {
      disableRemoteGlyphs(instance);
      setIsReady(true);
    };
    const onMoveEnd = (): void => {
      if (!setMapView) return;
      const c = instance.getCenter();
      setMapView({
        center: { lng: c.lng, lat: c.lat },
        zoom: instance.getZoom(),
      });
    };
    const onStyleData = (): void => disableRemoteGlyphs(instance);
    const onStyleImageMissing = (event: MapStyleImageMissingEvent): void => {
      ensureMissingStyleImage(instance, event.id);
    };

    instance.on("load", onLoad);
    instance.on("moveend", onMoveEnd);
    instance.on("styledata", onStyleData);
    instance.on("styleimagemissing", onStyleImageMissing);

    return () => {
      cleanupDemoLock?.();
      instance.off("load", onLoad);
      instance.off("moveend", onMoveEnd);
      instance.off("styledata", onStyleData);
      instance.off("styleimagemissing", onStyleImageMissing);
      instance.remove();
      mapRef.current = null;
      setMap(null);
      setIsReady(false);
    };
  }, []);

  // CSS viewport variables can resize the map host without a classic window
  // resize event. Keep MapLibre's canvas in sync with the actual host box.
  useEffect(() => {
    const m = mapRef.current;
    const host = containerRef.current;
    if (!m || !host || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => m.resize());
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // Swap style when basemap or theme changes. Overlays re-added on `styledata`.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !basemapId) return;
    m.setStyle(resolveBasemapStyle(basemapId, themeIsDark));
  }, [basemapId, themeIsDark]);

  // Re-add overlays after every style load. `styledata` also fires on initial
  // load, so this serves both paths.
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;

    const siteCenter = receiverCenter(receiver);
    const rangeRingsData =
      layers.rangeRings && siteCenter ? rangeRingsGeoJson(siteCenter) : null;
    const rxRangeData = layers.rxRange ? rxRangeGeoJson(rangeOutline) : null;
    const losRingsData = layers.losRings ? losGeoJson(losData) : null;

    const apply = (): void => {
      // MapLibre throws on addSource/addLayer while a setStyle swap is still
      // in flight; defer until the new style reports fully loaded. The
      // `styledata` / `idle` handlers below will fire again once it is.
      if (!m.isStyleLoaded()) return;
      // Resolve tone-scoped vars at the engine container so ring + outline
      // colors shift with the active basemap tone, not just the app theme.
      const host = containerRef.current;
      const ringColor = readCssVar(
        host,
        "--label-ink-soft",
        "--color-ink-faint",
      );
      const accentColor = readCssVar(host, "--color-accent");
      try {
        syncRangeRings(m, rangeRingsData, ringColor);
        syncRxRange(m, rxRangeData, accentColor);
        syncLosRings(m, losRingsData);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[MapEngine] overlay sync failed", err);
      }
    };

    apply();
    m.on("styledata", apply);
    m.on("idle", apply);
    return () => {
      m.off("styledata", apply);
      m.off("idle", apply);
    };
  }, [
    layers.rangeRings,
    layers.rxRange,
    layers.losRings,
    receiver,
    rangeOutline,
    losData,
  ]);

  // Ease to receiver once we have one and haven't painted yet.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !isReady || firstPaintRef.current) return;
    if (hasSavedInitialCenterRef.current) {
      // Stored view already applied at construction; nothing to do.
      firstPaintRef.current = true;
      return;
    }
    const c = receiverCenter(receiver);
    if (c) {
      m.easeTo({ center: [c.lng, c.lat], zoom: RECEIVER_ZOOM, duration: 0 });
      firstPaintRef.current = true;
    }
  }, [isReady, receiver]);

  const tone = resolveBasemapTone(basemapId, themeIsDark);
  return (
    <div
      className="map-engine [grid-area:canvas] relative overflow-hidden min-h-0"
      data-basemap-tone={tone}
    >
      {/* Named host for viewport sizing tests and MapLibre resize observation. */}
      <div ref={containerRef} className="map-canvas-host w-full h-full" />
      {initError ? <MapInitError message={initError} /> : null}
      <MapEngineContext.Provider value={{ map, isReady }}>
        {children}
      </MapEngineContext.Provider>
    </div>
  );
}

function MapInitError({ message }: { message: string }): ReactElement {
  return (
    <div className="absolute inset-0 grid place-items-center px-4 pointer-events-none">
      <div
        data-testid="map-init-error"
        role="alert"
        title={message}
        className="liquid-glass max-w-70 px-4 py-3 rounded-sm text-center font-mono text-[12px] text-(--color-ink)"
      >
        Chart took a detour
      </div>
    </div>
  );
}

function receiverCenter(
  receiver: { lat?: number | null; lon?: number | null } | null,
): { lng: number; lat: number } | null {
  if (!receiver || receiver.lat == null || receiver.lon == null) return null;
  return { lng: receiver.lon, lat: receiver.lat };
}

function setOrUpdateSource(
  m: MlMap,
  id: string,
  data: GeoJSON.FeatureCollection,
): void {
  const existing = m.getSource(id) as
    | { setData?: (d: GeoJSON.FeatureCollection) => void }
    | undefined;
  if (existing && typeof existing.setData === "function") {
    if (cachedSourceData(m, id) === data) return;
    existing.setData(data);
    cacheSourceData(m, id, data);
  } else {
    m.addSource(id, { type: "geojson", data });
    cacheSourceData(m, id, data);
  }
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

function clearSourceData(map: MlMap, id: string): void {
  sourceDataCache.get(map)?.delete(id);
}

function preloadMapLabelFonts(): void {
  if (typeof document === "undefined") return;
  const fonts = document.fonts;
  if (!fonts || typeof fonts.load !== "function") return;
  for (const descriptor of MAP_LABEL_FONT_LOADS) {
    void fonts.load(descriptor);
  }
}

function disableRemoteGlyphs(m: MlMap): void {
  if (!m.isStyleLoaded()) return;
  if (m.getGlyphs() === null) return;
  m.setGlyphs(null);
}

function ensureMissingStyleImage(m: MlMap, id: string): void {
  const match = /^circle-(\d+)$/.exec(id);
  if (!match || m.hasImage(id)) return;
  const size = Math.max(1, Math.min(64, Number.parseInt(match[1], 10) || 1));
  m.addImage(id, {
    width: size,
    height: size,
    data: new Uint8Array(size * size * 4),
  });
}

function removeLayerIfPresent(m: MlMap, id: string): void {
  if (m.getLayer(id)) m.removeLayer(id);
}

function removeSourceIfPresent(m: MlMap, id: string): void {
  if (m.getSource(id)) m.removeSource(id);
  clearSourceData(m, id);
}

function firstTrafficOverlayAnchor(m: MlMap): string | undefined {
  if (m.getLayer(LYR_STATION_RING_OUTER)) return LYR_STATION_RING_OUTER;
  if (m.getLayer(TRAFFIC_TRAILS_LAYER_ID)) return TRAFFIC_TRAILS_LAYER_ID;
  if (m.getLayer(LYR_AIRCRAFT_HIT)) return LYR_AIRCRAFT_HIT;
  return undefined;
}

function addLayerBelowTrafficOverlays(
  m: MlMap,
  layer: LayerSpecification,
): void {
  m.addLayer(layer, firstTrafficOverlayAnchor(m));
}

function keepLayerBelowTrafficOverlays(m: MlMap, id: string): void {
  const beforeId = firstTrafficOverlayAnchor(m);
  if (!beforeId || beforeId === id || !m.getLayer(id)) return;
  m.moveLayer(id, beforeId);
}

function syncRangeRings(
  m: MlMap,
  data: GeoJSON.FeatureCollection | null,
  color: string,
): void {
  if (!data) {
    removeLayerIfPresent(m, LYR_RANGE_RINGS);
    removeSourceIfPresent(m, SRC_RANGE_RINGS);
    return;
  }
  setOrUpdateSource(m, SRC_RANGE_RINGS, data);
  if (!m.getLayer(LYR_RANGE_RINGS)) {
    addLayerBelowTrafficOverlays(m, {
      id: LYR_RANGE_RINGS,
      type: "line",
      source: SRC_RANGE_RINGS,
      paint: {
        "line-color": color,
        "line-width": 1.25,
        "line-dasharray": [2, 4],
        "line-opacity": 0.85,
      },
    });
  } else {
    m.setPaintProperty(LYR_RANGE_RINGS, "line-color", color);
    keepLayerBelowTrafficOverlays(m, LYR_RANGE_RINGS);
  }
}

function syncRxRange(
  m: MlMap,
  data: GeoJSON.FeatureCollection | null,
  color: string,
): void {
  if (!data) {
    removeLayerIfPresent(m, LYR_RX_RANGE_LINE);
    removeLayerIfPresent(m, LYR_RX_RANGE_FILL);
    removeSourceIfPresent(m, SRC_RX_RANGE);
    return;
  }
  setOrUpdateSource(m, SRC_RX_RANGE, data);
  if (!m.getLayer(LYR_RX_RANGE_FILL)) {
    addLayerBelowTrafficOverlays(m, {
      id: LYR_RX_RANGE_FILL,
      type: "fill",
      source: SRC_RX_RANGE,
      paint: { "fill-color": color, "fill-opacity": 0.12 },
    });
  } else {
    m.setPaintProperty(LYR_RX_RANGE_FILL, "fill-color", color);
    keepLayerBelowTrafficOverlays(m, LYR_RX_RANGE_FILL);
  }
  if (!m.getLayer(LYR_RX_RANGE_LINE)) {
    addLayerBelowTrafficOverlays(m, {
      id: LYR_RX_RANGE_LINE,
      type: "line",
      source: SRC_RX_RANGE,
      paint: { "line-color": color, "line-width": 1.25, "line-opacity": 0.8 },
    });
  } else {
    m.setPaintProperty(LYR_RX_RANGE_LINE, "line-color", color);
    keepLayerBelowTrafficOverlays(m, LYR_RX_RANGE_LINE);
  }
}

function syncLosRings(m: MlMap, data: GeoJSON.FeatureCollection | null): void {
  if (!data) {
    removeLayerIfPresent(m, LYR_LOS_LINE);
    removeLayerIfPresent(m, LYR_LOS_FILL);
    removeSourceIfPresent(m, SRC_LOS);
    return;
  }
  setOrUpdateSource(m, SRC_LOS, data);
  removeLayerIfPresent(m, LYR_LOS_FILL);
  if (!m.getLayer(LYR_LOS_LINE)) {
    addLayerBelowTrafficOverlays(m, {
      id: LYR_LOS_LINE,
      type: "line",
      source: SRC_LOS,
      paint: {
        "line-color": ["get", "color"],
        "line-width": 1.25,
        "line-opacity": 0.7,
      },
    });
  } else {
    keepLayerBelowTrafficOverlays(m, LYR_LOS_LINE);
  }
}

// On the desktop hero, disable only scroll-to-zoom so the wheel scrolls the
// page past the full-bleed map; dragging still pans. The first wheel raises a
// diagnostic that explains it and showcases the notification surface.
function lockMapForDemo(
  map: MlMap,
  host: HTMLElement | null,
  phone: boolean,
): () => void {
  map.scrollZoom?.disable();

  if (phone) {
    // A full-bleed map would otherwise trap vertical swipes; let them scroll the
    // landing instead, and drop zoom/rotate gestures so the demo stays framed.
    map.dragPan?.disable();
    map.touchZoomRotate?.disable();
    map.touchPitch?.disable();
    map.doubleClickZoom?.disable();
    const prevTouchAction = host?.style.touchAction ?? "";
    if (host) host.style.touchAction = "pan-y";
    return () => {
      if (host) host.style.touchAction = prevTouchAction;
    };
  }

  const onWheel = (): void => {
    emitFrontendDiagnostic({
      severity: "info",
      channel: "frontend.demo",
      code: "demo.map_locked",
      message:
        "Scroll zooms the page in this demo — use the +/- buttons to zoom the map.",
      ttlMs: 10000,
    });
  };

  host?.addEventListener("wheel", onWheel, { passive: true });

  return () => {
    host?.removeEventListener("wheel", onWheel);
  };
}
