import { categoryKeyFor } from "../data/predicates";
import type { Aircraft, ReceiverJson, RouteInfo } from "../data/types";
import {
  compactAirSpeedFromKnots,
  compactAltitudeFromFeet,
  mapDistanceLabelFromNm,
  type resolveUnitOverrides,
} from "../settings/format";
import { altColor } from "./alt";
import { destinationPoint } from "./geodesic";
import { aircraftIconId } from "./mapAircraftIcons";

export type OverlayUnits = ReturnType<typeof resolveUnitOverrides>;

const RANGE_RINGS_NM = [25, 50, 100, 150, 200] as const;
const PREDICTOR_SEC = 60;
const EMERG_SQUAWKS = new Set(["7500", "7600", "7700"]);
export interface BuildAircraftFeatureArgs {
  aircraft: Aircraft[];
  selectedHex: string | null;
  hoveredHex: string | null;
  searchQuery: string;
  units: OverlayUnits;
  routeByCallsign: Record<string, RouteInfo | null>;
}

export interface BuildStationFeatureArgs {
  receiver: Pick<ReceiverJson, "lat" | "lon" | "version"> | null;
  stationOverride: string | null;
}

export interface BuildRangeLabelFeatureArgs {
  receiver: Pick<ReceiverJson, "lat" | "lon"> | null;
  distanceUnit: OverlayUnits["distance"];
  enabled: boolean;
}

export interface BuildPredictorFeatureArgs {
  aircraft: Aircraft[];
  selectedHex: string | null;
}

export function buildAircraftFeatureCollection(
  args: BuildAircraftFeatureArgs,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const ac of args.aircraft) {
    if (ac.lat == null || ac.lon == null) continue;
    const selected = ac.hex === args.selectedHex;
    const hovered = ac.hex === args.hoveredHex;
    const route = routeInfoFor(ac, args.routeByCallsign);
    const labelAtoms = aircraftLabelAtoms(ac, args.units, route);
    features.push(
      pointFeature([ac.lon, ac.lat], {
        hex: ac.hex,
        color: altColor(
          aircraftAltitude(ac),
          aircraftOnGround(ac),
          ac.emergency,
        ),
        track: typeof ac.trackDeg === "number" ? ac.trackDeg : 0,
        icon: aircraftIconId(ac),
        labelCs: labelAtoms.cs,
        labelType: labelAtoms.type,
        labelSqk: labelAtoms.sqk,
        labelTypeSqk: labelAtoms.typeSqk,
        labelAlt: labelAtoms.alt,
        labelSpeed: labelAtoms.speed,
        labelAltSpeed: labelAtoms.altSpeed,
        labelRoute: labelAtoms.route,
        selectedLabelAnchor: selectedLabelAnchor(ac.trackDeg),
        selectedLabelJustify: selectedLabelJustify(ac.trackDeg),
        selectedLabelOffset: selectedLabelOffset(ac.trackDeg),
        priority: labelPriority(ac, args.selectedHex, args.searchQuery),
        selected,
        hovered,
        emergency: isEmergencyAc(ac),
      }),
    );
  }
  return featureCollection(features);
}

function selectedLabelOffset(trackDeg: number | undefined): [number, number] {
  if (typeof trackDeg !== "number") return [1.35, 0];
  const rad = (trackDeg * Math.PI) / 180;
  return [roundOffset(Math.cos(rad) * 2.05), roundOffset(Math.sin(rad) * 2.35)];
}

function selectedLabelAnchor(trackDeg: number | undefined): "left" | "right" {
  return selectedLabelOffset(trackDeg)[0] < -0.2 ? "right" : "left";
}

function selectedLabelJustify(trackDeg: number | undefined): "left" | "right" {
  return selectedLabelAnchor(trackDeg);
}

function roundOffset(value: number): number {
  return Math.round(value * 100) / 100;
}

function aircraftLabelAtoms(
  ac: Aircraft,
  units: OverlayUnits,
  route: RouteInfo | null,
): {
  cs: string;
  type: string;
  sqk: string;
  typeSqk: string;
  alt: string;
  speed: string;
  altSpeed: string;
  route: string;
} {
  const cs = (ac.flight?.trim() || ac.hex).toUpperCase();
  const type = ac.typeDesignator ?? "-";
  const sqk = ac.squawk?.trim();
  const alt = altitudeLabel(ac.altBaroFt, units.altitude);
  const speed =
    typeof ac.gsKt === "number"
      ? compactAirSpeedFromKnots(ac.gsKt, units.horizontalSpeed)
      : "";
  return {
    cs,
    type,
    sqk: sqk ? `SQK ${sqk}` : "",
    typeSqk: sqk ? `${type} / SQK ${sqk}` : type,
    alt,
    speed,
    altSpeed: speed ? `${alt} · ${speed}` : alt,
    route: route ? routeLabel(route) : "",
  };
}

export function buildStationFeatureCollection(
  args: BuildStationFeatureArgs,
): GeoJSON.FeatureCollection {
  const receiver = args.receiver;
  if (!receiver || receiver.lat == null || receiver.lon == null) {
    return featureCollection([]);
  }
  const label = stationMarkerLabel(receiver.version, args.stationOverride);
  return featureCollection([
    pointFeature([receiver.lon, receiver.lat], {
      label: label ?? "",
    }),
  ]);
}

export function buildRangeLabelFeatureCollection(
  args: BuildRangeLabelFeatureArgs,
): GeoJSON.FeatureCollection {
  const receiver = args.receiver;
  if (
    !args.enabled ||
    !receiver ||
    receiver.lat == null ||
    receiver.lon == null
  ) {
    return featureCollection([]);
  }
  const center = { lng: receiver.lon, lat: receiver.lat };
  return featureCollection(
    RANGE_RINGS_NM.map((radiusNm) => {
      const edge = destinationPoint(center, 90, radiusNm);
      return pointFeature([edge.lng, edge.lat], {
        radiusNm,
        label: mapDistanceLabelFromNm(radiusNm, args.distanceUnit),
      });
    }),
  );
}

export function buildPredictorFeatureCollection(
  args: BuildPredictorFeatureArgs,
): GeoJSON.FeatureCollection {
  if (!args.selectedHex) return featureCollection([]);
  const ac = args.aircraft.find(
    (candidate) => candidate.hex === args.selectedHex,
  );
  if (!ac || ac.lat == null || ac.lon == null) return featureCollection([]);
  if (ac.onGround) return featureCollection([]);
  if (
    typeof ac.trackDeg !== "number" ||
    typeof ac.gsKt !== "number" ||
    ac.gsKt <= 0
  ) {
    return featureCollection([]);
  }
  const distNm = (ac.gsKt * PREDICTOR_SEC) / 3600;
  const start: [number, number] = [ac.lon, ac.lat];
  const end = destinationPoint(
    { lng: ac.lon, lat: ac.lat },
    ac.trackDeg,
    distNm,
  );
  const endCoord: [number, number] = [end.lng, end.lat];
  return featureCollection([
    {
      type: "Feature",
      properties: { kind: "line" },
      geometry: { type: "LineString", coordinates: [start, endCoord] },
    },
    pointFeature(endCoord, { kind: "end", label: "60s" }),
  ]);
}

function featureCollection(
  features: GeoJSON.Feature[],
): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features };
}

function pointFeature(
  coordinates: [number, number],
  properties: GeoJSON.GeoJsonProperties,
): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: "Feature",
    properties,
    geometry: { type: "Point", coordinates },
  };
}

function routeInfoFor(
  ac: Aircraft,
  routeByCallsign: Record<string, RouteInfo | null>,
): RouteInfo | null {
  const cs = ac.flight?.trim();
  if (!cs) return null;
  return routeByCallsign[cs] ?? null;
}

function aircraftAltitude(ac: Aircraft): number | null {
  return typeof ac.altBaroFt === "number" ? ac.altBaroFt : null;
}

function aircraftOnGround(ac: Aircraft): boolean {
  return ac.onGround === true;
}

function routeLabel(route: RouteInfo): string {
  const fullRoute = route.route?.trim();
  if (fullRoute) return fullRoute.replaceAll("-", "→");
  return `${route.origin}→${route.destination}`;
}

function altitudeLabel(
  alt: number | undefined,
  unit: OverlayUnits["altitude"],
): string {
  if (typeof alt !== "number") return "-";
  return compactAltitudeFromFeet(alt, unit);
}

function isEmergencyAc(ac: Aircraft): boolean {
  if (ac.emergency && ac.emergency !== "none") return true;
  if (ac.squawk && EMERG_SQUAWKS.has(ac.squawk)) return true;
  return false;
}

function labelPriority(
  ac: Aircraft,
  selectedHex: string | null,
  query: string,
): number {
  if (ac.hex === selectedHex) return 0;
  if (isEmergencyAc(ac)) return 1;
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length > 0) {
    const haystack = [ac.hex, ac.flight, ac.reg, ac.squawk]
      .filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      )
      .map((value) => value.toLowerCase());
    if (haystack.some((value) => value.includes(normalizedQuery))) return 2;
  }
  const key = categoryKeyFor(ac.cat, ac.dbFlags);
  if (key === "airline") return 3;
  if (key === "bizjet" || key === "mil") return 4;
  if (key === "rotor" || key === "ga") return 5;
  return 6;
}

function stationMarkerLabel(
  version: string | undefined,
  stationOverride: string | null,
): string | null {
  const station = stationOverride?.trim();
  if (station) return station;
  if (!version) return null;
  const parts = version.trim().split(/\s+/);
  const fallback =
    parts.length >= 2 && !/^git:?$/i.test(parts[1]) ? parts[1] : parts[0];
  return fallback || null;
}
