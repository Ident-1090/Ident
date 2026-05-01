import { Crosshair, Focus } from "lucide-react";
import type { MapGeoJSONFeature, Map as MlMap } from "maplibre-gl";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { matchesFilter } from "../data/predicates";
import {
  selectDisplayAircraftMap,
  selectDisplayTrailNowMs,
  selectDisplayTrailsByHex,
  useIdentStore,
} from "../data/store";
import type { Aircraft, TrailPoint } from "../data/types";
import { labelFieldsKey, logMapTiming } from "../debug/mapTiming";
import { MobileLogoHud } from "../mobile/MobileShell";
import { queryTextFromOmnibox } from "../omnibox/grammar";
import { resolveUnitOverrides } from "../settings/format";
import { FeedStatusCell } from "../statusbar/StatusBar";
import { Tooltip } from "../ui/Tooltip";
import { AIRCRAFT_GLYPH_COLORS_BY_TONE, type AircraftGlyphColors } from "./alt";
import { destinationPoint } from "./geodesic";
import { InViewHUD } from "./huds/InViewHUD";
import { LayersHUD } from "./huds/LayersHUD";
import { ScaleHUD } from "./huds/ScaleHUD";
import { ZoomHUD } from "./huds/ZoomHUD";
import { useMap } from "./MapEngine";
import {
  buildAircraftFeatureCollection,
  buildPredictorFeatureCollection,
  buildRangeLabelFeatureCollection,
  buildStationFeatureCollection,
} from "./mapOverlayFeatures";
import {
  AIRCRAFT_PICK_LAYERS,
  enforceMapOverlayLayerOrder,
  LYR_AIRCRAFT_HIT,
  type OverlayPalette,
  SRC_AIRCRAFT,
  stopMapOverlayAnimations,
  syncMapOverlayLayers,
} from "./mapOverlayLayers";
import {
  buildTrafficTrailsSnapshot,
  TrafficTrailsLayer,
} from "./trafficTrailsLayer";

const RECENTER_PADDING_PX = 60;
const SELECT_EASE_MS = 350;
const AUTO_FIT_IDLE_MS = 12_000;

export function MapOverlay() {
  const { map, isReady } = useMap();
  const aircraft = useIdentStore(selectDisplayAircraftMap);
  const receiver = useIdentStore((s) => s.receiver);
  const stationOverride = useIdentStore((s) => s.config.station);
  const filter = useIdentStore((s) => s.filter);
  const selectedHex = useIdentStore((s) => s.selectedHex);
  const select = useIdentStore((s) => s.select);
  const trackSelected = useIdentStore((s) => s.camera.trackSelected);
  const autoFitTraffic = useIdentStore((s) => s.camera.autoFitTraffic);
  const lastUserInteraction = useIdentStore(
    (s) => s.camera.lastUserInteraction,
  );
  const setTrackSelected = useIdentStore((s) => s.setTrackSelected);
  const setAutoFitTraffic = useIdentStore((s) => s.setAutoFitTraffic);
  const recordMapInteraction = useIdentStore((s) => s.recordMapInteraction);
  const labelMode = useIdentStore((s) => s.map.labelMode);
  const labelFields = useIdentStore((s) => s.map.labelFields);
  const layersOn = useIdentStore((s) => s.map.layers);
  const recenterRequestId = useIdentStore((s) => s.map.recenterRequestId);
  const viewportHexes = useIdentStore((s) => s.map.viewportHexes);
  const trailsByHex = useIdentStore(selectDisplayTrailsByHex);
  const trailFadeSec = useIdentStore((s) => s.settings.trailFadeSec);
  const trailNowMs = useIdentStore(selectDisplayTrailNowMs);
  const hoveredHex = useIdentStore((s) => s.labels.hoveredHex);
  const setHoveredHex = useIdentStore((s) => s.setHoveredHex);
  const setMapViewportHexes = useIdentStore((s) => s.setMapViewportHexes);
  const searchQuery = useIdentStore((s) => s.search.query);
  const routeByCallsign = useIdentStore((s) => s.routeByCallsign);
  const settings = useIdentStore((s) => s.settings);
  const units = useMemo(
    () => resolveUnitOverrides(settings.unitMode, settings.unitOverrides),
    [settings.unitMode, settings.unitOverrides],
  );
  const trafficTrailsLayerRef = useRef<TrafficTrailsLayer | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const recenterToTrafficRef = useRef<(() => void) | null>(null);
  const lastTrackedPosition = useRef<{
    hex: string;
    lat: number;
    lon: number;
  } | null>(null);
  const selectedTrackingOffset = useRef<{
    hex: string;
    offset: [number, number];
  } | null>(null);
  const lastRecenterRequestId = useRef(recenterRequestId);
  const didInitialTrafficRecenter = useRef(false);
  const [viewTick, setViewTick] = useState(0);
  const hasSelectedAircraft = selectedHex != null && aircraft.has(selectedHex);
  const selectedAircraft = selectedHex ? aircraft.get(selectedHex) : undefined;
  const selectedMapAircraft = useMemo(
    () =>
      selectedAircraft
        ? aircraftWithTrailPosition(
            selectedAircraft,
            selectedHex ? trailsByHex[selectedHex] : undefined,
          )
        : undefined,
    [selectedAircraft, selectedHex, trailsByHex],
  );
  const selectedAircraftLabel = selectedAircraftLabelText(selectedAircraft);
  const queryText = useMemo(
    () => queryTextFromOmnibox(searchQuery),
    [searchQuery],
  );

  useEffect(() => {
    if (!map) return;
    const bump = (): void => setViewTick((n) => n + 1);
    map.on("move", bump);
    map.on("zoom", bump);
    map.on("resize", bump);
    map.on("moveend", bump);
    return () => {
      map.off("move", bump);
      map.off("zoom", bump);
      map.off("resize", bump);
      map.off("moveend", bump);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const onDragStart = (): void => {
      recordMapInteraction({ kind: "pan" });
    };
    const onZoomStart = (): void => {
      recordMapInteraction({ kind: "zoom" });
    };
    map.on("dragstart", onDragStart);
    map.on("zoomstart", onZoomStart);
    return () => {
      map.off("dragstart", onDragStart);
      map.off("zoomstart", onZoomStart);
    };
  }, [map, recordMapInteraction]);

  useLayoutEffect(() => {
    if (!map) return;
    if (!selectedHex) {
      lastTrackedPosition.current = null;
      selectedTrackingOffset.current = null;
      return;
    }
    const ac = selectedMapAircraft;
    if (!ac || ac.lat == null || ac.lon == null) return;
    const position = { lat: ac.lat, lon: ac.lon };
    if (!trackSelected) {
      lastTrackedPosition.current = {
        hex: selectedHex,
        ...position,
      };
      selectedTrackingOffset.current = null;
      return;
    }
    const previous = lastTrackedPosition.current;
    if (selectedTrackingOffset.current?.hex !== selectedHex) {
      selectedTrackingOffset.current = {
        hex: selectedHex,
        offset: startSelectedTrackingOffset(
          map,
          selectedHex,
          position,
          previous,
        ),
      };
    }
    if (
      previous?.hex === selectedHex &&
      previous.lat === ac.lat &&
      previous.lon === ac.lon
    ) {
      return;
    }
    lastTrackedPosition.current = {
      hex: selectedHex,
      ...position,
    };
    const offset =
      selectedTrackingOffset.current?.hex === selectedHex
        ? selectedTrackingOffset.current.offset
        : selectedAircraftCameraOffset(map);
    logMapTiming("overlay selection center", {
      selectedHex,
      tracking: trackSelected,
      action: "easeTo",
      offsetX: offset[0],
      offsetY: offset[1],
    });
    map.easeTo({ center: [ac.lon, ac.lat], duration: SELECT_EASE_MS, offset });
  }, [selectedHex, trackSelected, selectedMapAircraft, map]);

  const filteredAircraft = useMemo(() => {
    const out: Aircraft[] = [];
    for (const ac of aircraft.values()) {
      const selected = ac.hex === selectedHex;
      const mapAircraft =
        selected && selectedMapAircraft ? selectedMapAircraft : ac;
      if (
        !selected &&
        !matchesFilter(ac, {
          ...filter,
          inViewOnly: false,
          query: queryText,
          routeByCallsign,
          receiver: receiver
            ? { lat: receiver.lat, lon: receiver.lon }
            : undefined,
        })
      ) {
        continue;
      }
      out.push(mapAircraft);
    }
    return out;
  }, [
    aircraft,
    filter,
    queryText,
    routeByCallsign,
    receiver,
    selectedHex,
    selectedMapAircraft,
  ]);

  const aircraftFeatures = useMemo(
    () =>
      buildAircraftFeatureCollection({
        aircraft: filteredAircraft,
        selectedHex,
        hoveredHex,
        searchQuery: queryText,
        units,
        routeByCallsign,
      }),
    [
      filteredAircraft,
      selectedHex,
      hoveredHex,
      queryText,
      units,
      routeByCallsign,
    ],
  );

  const stationFeatures = useMemo(
    () => buildStationFeatureCollection({ receiver, stationOverride }),
    [receiver, stationOverride],
  );

  const rangeLabelFeatures = useMemo(
    () =>
      buildRangeLabelFeatureCollection({
        receiver,
        distanceUnit: units.distance,
        enabled: layersOn.rangeRings,
      }),
    [receiver, units.distance, layersOn.rangeRings],
  );

  const predictorFeatures = useMemo(
    () =>
      buildPredictorFeatureCollection({
        aircraft: filteredAircraft,
        selectedHex,
      }),
    [filteredAircraft, selectedHex],
  );

  useLayoutEffect(() => {
    logMapTiming("overlay layout commit", {
      selectedHex: selectedHex ?? "none",
      hoveredHex: hoveredHex ?? "none",
      labelMode,
      fields: labelFieldsKey(labelFields),
      aircraftFeatures: aircraftFeatures.features.length,
      predictorFeatures: predictorFeatures.features.length,
    });
  }, [
    selectedHex,
    hoveredHex,
    labelMode,
    labelFields,
    aircraftFeatures,
    predictorFeatures,
  ]);

  const trafficTrailsSnapshot = useMemo(
    () =>
      buildTrafficTrailsSnapshot({
        aircraft: filteredAircraft,
        trailsByHex,
        selectedHex,
        trailFadeSec,
        nowMs: trailNowMs,
        enabled: layersOn.trails,
      }),
    [
      filteredAircraft,
      trailsByHex,
      selectedHex,
      trailFadeSec,
      trailNowMs,
      layersOn.trails,
    ],
  );

  useLayoutEffect(() => {
    if (!map || !isReady) return;
    const apply = (): void => {
      if (!map.isStyleLoaded() && !map.getSource(SRC_AIRCRAFT)) {
        logMapTiming("overlay sync deferred", {
          selectedHex: selectedHex ?? "none",
          reason: "style-loading",
        });
        return;
      }
      logMapTiming("overlay sync effect", {
        selectedHex: selectedHex ?? "none",
        labelMode,
        fields: labelFieldsKey(labelFields),
        aircraftFeatures: aircraftFeatures.features.length,
        predictorFeatures: predictorFeatures.features.length,
      });
      syncMapOverlayLayers(map, {
        aircraft: aircraftFeatures,
        station: stationFeatures,
        rangeLabels: rangeLabelFeatures,
        predictor: predictorFeatures,
        labelMode,
        labelFields,
        palette: readOverlayPalette(map),
      });
    };
    apply();
    map.on("styledata", apply);
    map.on("idle", apply);
    return () => {
      map.off("styledata", apply);
      map.off("idle", apply);
      stopMapOverlayAnimations(map);
    };
  }, [
    map,
    isReady,
    aircraftFeatures,
    stationFeatures,
    rangeLabelFeatures,
    predictorFeatures,
    labelMode,
    labelFields,
    selectedHex,
  ]);

  // Register after syncMapOverlayLayers so the aircraft hit layer exists for
  // ordering, but before snapshot delivery so initial trail data is not dropped.
  useLayoutEffect(() => {
    if (!map || !isReady) return;
    const layer = trafficTrailsLayerRef.current ?? new TrafficTrailsLayer();
    trafficTrailsLayerRef.current = layer;
    const syncLayer = (): void => {
      if (!map.isStyleLoaded()) return;
      const beforeId = map.getLayer(LYR_AIRCRAFT_HIT)
        ? LYR_AIRCRAFT_HIT
        : undefined;
      if (!map.getLayer(layer.id)) {
        map.addLayer(layer, beforeId);
      } else if (beforeId) {
        map.moveLayer(layer.id, beforeId);
      }
      enforceMapOverlayLayerOrder(map);
    };
    syncLayer();
    map.on("styledata", syncLayer);
    map.on("idle", syncLayer);
    return () => {
      map.off("styledata", syncLayer);
      map.off("idle", syncLayer);
      if (map.getLayer(layer.id)) map.removeLayer(layer.id);
    };
  }, [map, isReady]);

  useLayoutEffect(() => {
    trafficTrailsLayerRef.current?.setSnapshot(trafficTrailsSnapshot);
  }, [trafficTrailsSnapshot]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: viewTick is a cache-bust for map.getBounds() which is imperative state not tracked by React
  const visibleHexes = useMemo(() => {
    if (!map || !isReady) return new Set<string>();
    return visibleAircraftHexes(map, filteredAircraft);
  }, [map, isReady, filteredAircraft, viewTick]);

  useEffect(() => {
    setMapViewportHexes(visibleHexes);
  }, [visibleHexes, setMapViewportHexes]);

  const positionedAircraftCount = filteredAircraft.reduce(
    (count, ac) =>
      typeof ac.lat === "number" && typeof ac.lon === "number"
        ? count + 1
        : count,
    0,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: viewTick is a cache-bust for map.getCenter()/project() which are imperative state not tracked by React
  const pxPerNm = useMemo(() => {
    if (!map || !isReady) return 0;
    const c = map.getCenter();
    const a = map.project({ lng: c.lng, lat: c.lat });
    const east = destinationPoint({ lng: c.lng, lat: c.lat }, 90, 10);
    const b = map.project({ lng: east.lng, lat: east.lat });
    return Math.hypot(b.x - a.x, b.y - a.y) / 10;
  }, [map, isReady, viewTick]);

  useEffect(() => {
    if (!map) return;
    const pick = (
      point: { x: number; y: number } | undefined,
    ): string | null | undefined => {
      if (!point) return null;
      const layers = AIRCRAFT_PICK_LAYERS.filter((id) => map.getLayer(id));
      if (layers.length === 0) return undefined;
      return firstAircraftHex(
        map.queryRenderedFeatures([point.x, point.y], { layers }),
      );
    };
    const onClick = (evt?: { point?: { x: number; y: number } }): void => {
      const hex = pick(evt?.point);
      if (hex !== undefined) select(hex);
    };
    const onMouseMove = (evt?: { point?: { x: number; y: number } }): void => {
      pointerRef.current = evt?.point ?? null;
      const hex = pick(evt?.point);
      if (hex !== undefined) setHoveredHex(hex);
    };
    const onMouseOut = (): void => {
      pointerRef.current = null;
      setHoveredHex(null);
    };
    const onMove = (): void => {
      if (!pointerRef.current) return;
      const hex = pick(pointerRef.current);
      if (hex !== undefined) setHoveredHex(hex);
    };
    map.on("click", onClick);
    map.on("mousemove", onMouseMove);
    map.on("mouseout", onMouseOut);
    map.on("move", onMove);
    return () => {
      map.off("click", onClick);
      map.off("mousemove", onMouseMove);
      map.off("mouseout", onMouseOut);
      map.off("move", onMove);
    };
  }, [map, select, setHoveredHex]);

  const recenterToTraffic = useCallback((): void => {
    if (!map) return;
    if (filteredAircraft.length === 0) {
      if (receiver && receiver.lat != null && receiver.lon != null) {
        map.easeTo({
          center: [receiver.lon, receiver.lat],
          zoom: 8,
          duration: 400,
        });
      }
      return;
    }
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const ac of filteredAircraft) {
      if (ac.lat == null || ac.lon == null) continue;
      if (ac.lon < minLng) minLng = ac.lon;
      if (ac.lon > maxLng) maxLng = ac.lon;
      if (ac.lat < minLat) minLat = ac.lat;
      if (ac.lat > maxLat) maxLat = ac.lat;
    }
    if (receiver && receiver.lat != null && receiver.lon != null) {
      if (receiver.lon < minLng) minLng = receiver.lon;
      if (receiver.lon > maxLng) maxLng = receiver.lon;
      if (receiver.lat < minLat) minLat = receiver.lat;
      if (receiver.lat > maxLat) maxLat = receiver.lat;
    }
    if (!Number.isFinite(minLng) || !Number.isFinite(maxLng)) return;
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: RECENTER_PADDING_PX, duration: 400, maxZoom: 11 },
    );
  }, [filteredAircraft, map, receiver]);

  useEffect(() => {
    recenterToTrafficRef.current = recenterToTraffic;
  }, [recenterToTraffic]);

  const onRecenter = useCallback((): void => {
    setTrackSelected(false);
    recenterToTraffic();
  }, [recenterToTraffic, setTrackSelected]);

  useEffect(() => {
    if (recenterRequestId === lastRecenterRequestId.current) return;
    lastRecenterRequestId.current = recenterRequestId;
    onRecenter();
  }, [onRecenter, recenterRequestId]);

  useEffect(() => {
    if (!autoFitTraffic || trackSelected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (delayMs = AUTO_FIT_IDLE_MS): void => {
      timer = setTimeout(() => {
        if (cancelled) return;
        recenterToTrafficRef.current?.();
        schedule();
      }, delayMs);
    };
    const now = Date.now();
    const firstIdleAt = (lastUserInteraction?.at ?? now) + AUTO_FIT_IDLE_MS;
    schedule(Math.max(0, firstIdleAt - now));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [autoFitTraffic, trackSelected, lastUserInteraction]);

  useEffect(() => {
    if (!map || !isReady) return;
    if (didInitialTrafficRecenter.current) return;
    if (positionedAircraftCount === 0) return;
    if (!receiver || receiver.lat == null || receiver.lon == null) return;

    const decide = (): void => {
      if (didInitialTrafficRecenter.current) return;
      didInitialTrafficRecenter.current = true;
      if (
        visibleAircraftHexes(map, filteredAircraft).size <
        positionedAircraftCount
      ) {
        recenterToTraffic();
      }
    };
    map.on("idle", decide);
    return () => {
      map.off("idle", decide);
    };
  }, [
    isReady,
    filteredAircraft,
    map,
    positionedAircraftCount,
    receiver,
    recenterToTraffic,
  ]);

  const hasOffscreenTraffic =
    map != null &&
    isReady &&
    positionedAircraftCount > 0 &&
    visibleHexes.size === 0;

  return (
    <>
      <div className="map-top-controls absolute flex flex-col items-start gap-2 pointer-events-none [&>*]:pointer-events-auto">
        <div className="md:hidden">
          <MobileLogoHud />
        </div>
        <LayersHUD />
      </div>
      <div className="map-scale-controls absolute flex flex-col items-start gap-2 pointer-events-none [&>*]:pointer-events-auto">
        <ScaleHUD pxPerNm={pxPerNm} distanceUnit={units.distance} />
        <div className="md:hidden">
          <FeedStatusCell variant="hud" />
        </div>
      </div>
      <div
        data-testid="map-bottom-controls"
        data-inspector-open={hasSelectedAircraft ? "true" : "false"}
        className="map-bottom-controls absolute bottom-3 flex items-end gap-2 pointer-events-none [&>*]:pointer-events-auto"
      >
        <InViewHUD count={viewportHexes?.size ?? visibleHexes.size} />
        <div className="flex flex-col items-end gap-2">
          {hasSelectedAircraft && (
            <TrackSelectedButton
              active={trackSelected}
              aircraftLabel={selectedAircraftLabel}
              onClick={() => setTrackSelected(!trackSelected)}
            />
          )}
          <RecenterButton
            autoFitTraffic={autoFitTraffic}
            onAutoFitTrafficChange={setAutoFitTraffic}
            onClick={onRecenter}
            hasOffscreenTraffic={hasOffscreenTraffic}
          />
          <ZoomHUD />
        </div>
      </div>

      {!isReady && (
        <div className="absolute inset-0 grid place-items-center font-mono text-[12px] text-ink-faint pointer-events-none">
          loading map...
        </div>
      )}
    </>
  );
}

function TrackSelectedButton({
  active,
  aircraftLabel,
  onClick,
}: {
  active: boolean;
  aircraftLabel: string;
  onClick: () => void;
}) {
  const label = active ? `Tracking ${aircraftLabel}` : `Track ${aircraftLabel}`;

  return (
    <Tooltip label={label} side="left">
      <button
        type="button"
        aria-pressed={active}
        aria-label={
          active
            ? `Stop tracking ${aircraftLabel}`
            : `Track selected aircraft ${aircraftLabel}`
        }
        onClick={onClick}
        className={
          "liquid-glass w-7.5 h-7.5 rounded-sm grid place-items-center cursor-pointer " +
          (active
            ? "text-(--color-accent)"
            : "text-(--color-ink) hover:text-(--color-accent)")
        }
      >
        <Crosshair size={14} strokeWidth={1.85} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

function RecenterButton({
  autoFitTraffic,
  onAutoFitTrafficChange,
  onClick,
  hasOffscreenTraffic,
}: {
  autoFitTraffic: boolean;
  onAutoFitTrafficChange: (enabled: boolean) => void;
  onClick: () => void;
  hasOffscreenTraffic: boolean;
}) {
  const label = hasOffscreenTraffic
    ? "Show aircraft outside view"
    : "Refit map";
  return (
    <div className="group relative h-7.5 w-7.5">
      <label className="liquid-glass pointer-events-none absolute top-0 right-full z-10 mr-2 hidden h-7.5 max-w-0 items-center gap-2 rounded-sm px-0 font-mono text-[10px] text-ink-soft opacity-0 transition-[max-width,opacity,padding] duration-150 group-hover:pointer-events-auto group-hover:max-w-42 group-hover:px-2.5 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:max-w-42 group-focus-within:px-2.5 group-focus-within:opacity-100 md:flex">
        <Tooltip label="Refit to traffic after idle" side="top">
          <input
            type="checkbox"
            aria-label="Auto-fit traffic"
            checked={autoFitTraffic}
            onChange={(e) => onAutoFitTrafficChange(e.currentTarget.checked)}
            className="h-3 w-3 accent-(--color-accent)"
          />
        </Tooltip>
        <span className="whitespace-nowrap uppercase tracking-[0.08em]">
          Auto-fit traffic
        </span>
      </label>
      <Tooltip label={label} side="top-end">
        <button
          type="button"
          onClick={onClick}
          aria-label="Recenter map"
          data-offscreen-traffic={hasOffscreenTraffic ? "true" : undefined}
          className={
            "liquid-glass w-7.5 h-7.5 text-(--color-ink) rounded-sm grid place-items-center cursor-pointer " +
            (hasOffscreenTraffic
              ? "animate-livepulse motion-reduce:animate-none"
              : "")
          }
        >
          <Focus size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}

function selectedAircraftLabelText(ac: Aircraft | undefined): string {
  return ac?.flight?.trim() || ac?.hex.toUpperCase() || "selected aircraft";
}

function aircraftWithTrailPosition(
  aircraft: Aircraft,
  trail: TrailPoint[] | undefined,
): Aircraft {
  if (typeof aircraft.lat === "number" && typeof aircraft.lon === "number") {
    return aircraft;
  }
  const lastPoint = trail?.at(-1);
  if (!lastPoint) return aircraft;
  return { ...aircraft, lat: lastPoint.lat, lon: lastPoint.lon };
}

function selectedAircraftCameraOffset(map: {
  getContainer: () => HTMLElement;
}): [number, number] {
  const container = map.getContainer();
  const host = container.closest(".map-engine");
  const inspector = host?.querySelector<HTMLElement>(
    ".floating-inspector-panel",
  );
  const width = inspector?.getBoundingClientRect().width ?? 0;
  const x = width > 0 ? -Math.round((width + 24) / 2) : 0;

  const appShell = container.closest(".app-shell");
  const sheet = appShell?.querySelector<HTMLElement>(".mobile-bottom-sheet");
  const sheetHeight = sheet ? measuredMobileSheetHeight(sheet) : 0;
  const y = sheetHeight > 0 ? -Math.round(sheetHeight / 2) : 0;

  return [x, y];
}

function aircraftScreenOffset(
  map: {
    getContainer: () => HTMLElement;
    project: (point: { lng: number; lat: number }) => { x: number; y: number };
  },
  position: { lat: number; lon: number },
): [number, number] {
  const point = map.project({ lng: position.lon, lat: position.lat });
  const rect = map.getContainer().getBoundingClientRect();
  return [
    Math.round(point.x - rect.width / 2),
    Math.round(point.y - rect.height / 2),
  ];
}

function startSelectedTrackingOffset(
  map: {
    getContainer: () => HTMLElement;
    project: (point: { lng: number; lat: number }) => { x: number; y: number };
  },
  selectedHex: string,
  position: { lat: number; lon: number },
  previous: { hex: string; lat: number; lon: number } | null,
): [number, number] {
  if (previous?.hex === selectedHex) {
    return aircraftScreenOffset(map, position);
  }
  return selectedAircraftCameraOffset(map);
}

function measuredMobileSheetHeight(sheet: HTMLElement): number {
  const rectHeight = sheet.getBoundingClientRect().height;
  const viewportHeight =
    typeof window !== "undefined" && Number.isFinite(window.innerHeight)
      ? window.innerHeight
      : 0;

  const snap = sheet.dataset.snap;
  const targetHeight =
    viewportHeight > 0 && snap === "half"
      ? viewportHeight * 0.5
      : viewportHeight > 0 && snap === "full"
        ? viewportHeight * 0.92
        : 0;

  return Math.max(rectHeight, targetHeight);
}

function visibleAircraftHexes(map: MlMap, aircraft: Aircraft[]): Set<string> {
  const bounds = map.getBounds();
  const hexes = new Set<string>();
  for (const ac of aircraft) {
    if (ac.lat == null || ac.lon == null) continue;
    if (bounds.contains({ lng: ac.lon, lat: ac.lat })) hexes.add(ac.hex);
  }
  return hexes;
}

function firstAircraftHex(features: MapGeoJSONFeature[]): string | null {
  for (const feature of features) {
    const hex = feature.properties?.hex;
    if (typeof hex === "string" && hex.length > 0) return hex;
  }
  return null;
}

function readOverlayPalette(map: {
  getContainer: () => HTMLElement;
}): OverlayPalette {
  const host =
    map.getContainer().closest(".map-engine") ?? document.documentElement;
  const css = getComputedStyle(host);
  const read = (name: string, fallback: string): string => {
    const value = css.getPropertyValue(name).trim();
    return value || fallback;
  };
  const glyphFallback = AIRCRAFT_GLYPH_COLORS_BY_TONE.light;
  const aircraftGlyphColors: AircraftGlyphColors = [
    read("--aircraft-glyph-lowest", glyphFallback[0]),
    read("--aircraft-glyph-low", glyphFallback[1]),
    read("--aircraft-glyph-mid-low", glyphFallback[2]),
    read("--aircraft-glyph-mid", glyphFallback[3]),
    read("--aircraft-glyph-high", glyphFallback[4]),
    read("--aircraft-glyph-highest", glyphFallback[5]),
  ];
  return {
    accent: read("--color-accent", "#37a5be"),
    emergency: read("--color-emerg", "#ff3900"),
    aircraftGlyphColors,
    labelInk: read("--label-ink", read("--color-ink", "#f1f3f5")),
    labelInkSoft: read("--label-ink-soft", read("--color-ink-soft", "#c2c7cd")),
    labelHalo: read("--label-halo", read("--color-bg", "rgba(0,0,0,0.78)")),
  };
}
