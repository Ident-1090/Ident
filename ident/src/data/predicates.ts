import { haversineNm } from "./derive";
import { findIcaoCountry } from "./icaoCountry";
import type { Aircraft, CategoryKey, RouteInfo } from "./types";

export interface FilterState {
  // Accepts two shapes:
  //   - Set<string> of letter-prefix codes (e.g. Set(["A", "B"])): legacy call
  //     sites and tests filter by the first character of aircraft.category.
  //   - Record<CategoryKey, boolean>: the store-slice shape consumed by the
  //     rail's FiltersCard. Empty / all-false means "match anything".
  categories?: Set<string> | Record<CategoryKey, boolean>;
  altMinFt?: number;
  altMaxFt?: number;
  emergencyOnly?: boolean;
  hideGround?: boolean;
  positionOnly?: boolean;
  query?: string;

  // Aliases used by the store slice so `get().filter` can be passed directly.
  altRangeFt?: [number, number];
  emergOnly?: boolean;
  hasPosOnly?: boolean;
  routeByCallsign?: Record<string, RouteInfo | null>;

  // Omnibox-grammar fields. Each is an empty string (no filter) or a
  // substring/prefix pattern matched case-insensitively against the
  // aircraft's operator / callsign.
  operatorContains?: string;
  callsignPrefix?: string;
  routeContains?: string;
  countryContains?: string;

  // Identifier / numeric clauses from the omnibox grammar. Empty string or
  // null means "no filter".
  hexContains?: string;
  regPrefix?: string;
  squawkEquals?: string;
  typePrefix?: string;
  sourceEquals?: string;
  gsRangeKt?: [number, number] | null;
  distRangeNm?: [number, number] | null;
  vsRangeFpm?: [number, number] | null;
  hdgCenter?: number | null;
  hdgTolerance?: number | null;

  // Keyword toggles.
  militaryOnly?: boolean;
  inViewOnly?: boolean;
  expressionBranches?: FilterState[] | null;

  // Context needed by some clauses. `receiver` is required for nm:…;
  // `viewportHexes` is required for inview. When missing, the corresponding
  // filter becomes a no-op (treat as not-set).
  receiver?: { lat: number; lon: number };
  viewportHexes?: Set<string> | null;
}

// Map an aircraft.category letter code (A0..C7) to a semantic category key.
// When `dbFlags` is provided and its low bit is set, readsb has tagged the
// airframe as military (via its aircraft DB lookup); that wins over the ADS-B
// category code so a military C-17 counts as `mil` rather than `airline`.
// Returns null when nothing matches a filter bucket.
export function categoryKeyFor(
  category: string | undefined,
  dbFlags?: number,
): CategoryKey {
  if (typeof dbFlags === "number" && (dbFlags & 1) === 1) return "mil";
  if (!category || category.length < 2) return "unknown";
  switch (category) {
    case "A7":
      return "rotor";
    // A1 (light) maps to GA; A2/A3/A4/A5 are commercial airliner sizes; A6 is
    // high-performance (treated as bizjet in the absence of richer metadata).
    case "A1":
      return "ga";
    case "A2":
    case "A3":
    case "A4":
    case "A5":
      return "airline";
    case "A6":
      return "bizjet";
    default:
      return "unknown";
  }
}

function anyCategoryKeySelected(rec: Record<CategoryKey, boolean>): boolean {
  return (
    rec.airline || rec.ga || rec.bizjet || rec.mil || rec.rotor || rec.unknown
  );
}

export function matchesFilter(ac: Aircraft, f: FilterState): boolean {
  if (f.expressionBranches && f.expressionBranches.length > 0) {
    return f.expressionBranches.some((branch) =>
      matchesFilter(ac, {
        ...branch,
        query: f.query,
        routeByCallsign: f.routeByCallsign,
        receiver: f.receiver,
        viewportHexes: f.viewportHexes,
        expressionBranches: null,
      }),
    );
  }

  const hideGround = f.hideGround ?? false;
  const hasPosOnly = f.hasPosOnly ?? f.positionOnly ?? false;
  const emergOnly = f.emergOnly ?? f.emergencyOnly ?? false;

  if (hideGround && ac.airground === 1) return false;
  if (hasPosOnly && (ac.lat == null || ac.lon == null)) return false;
  if (emergOnly && (!ac.emergency || ac.emergency === "none")) return false;

  if (f.categories) {
    if (f.categories instanceof Set) {
      if (f.categories.size > 0) {
        const cat = ac.category ? ac.category[0] : "";
        if (!f.categories.has(cat)) return false;
      }
    } else if (anyCategoryKeySelected(f.categories)) {
      const key = categoryKeyFor(ac.category, ac.dbFlags);
      if (!f.categories[key]) return false;
    }
  }

  const altMinFt = f.altMinFt ?? f.altRangeFt?.[0];
  const altMaxFt = f.altMaxFt ?? f.altRangeFt?.[1];
  if (altMinFt != null || altMaxFt != null) {
    const alt = typeof ac.alt_baro === "number" ? ac.alt_baro : null;
    if (alt == null) return false;
    if (altMinFt != null && alt < altMinFt) return false;
    if (altMaxFt != null && alt > altMaxFt) return false;
  }

  if (f.operatorContains && f.operatorContains.length > 0) {
    const needle = f.operatorContains.toLowerCase();
    const hay = [ac.ownOp, ac.desc]
      .filter(Boolean)
      .map((s) => (s as string).toLowerCase());
    if (!hay.some((s) => s.includes(needle))) return false;
  }

  if (f.callsignPrefix && f.callsignPrefix.length > 0) {
    const needle = f.callsignPrefix.toUpperCase();
    const cs =
      typeof ac.flight === "string" ? ac.flight.trim().toUpperCase() : "";
    if (!cs.startsWith(needle)) return false;
  }

  if (f.routeContains && f.routeContains.length > 0) {
    const needle = f.routeContains.toLowerCase();
    const cs =
      typeof ac.flight === "string" ? ac.flight.trim().toUpperCase() : "";
    const route = cs ? f.routeByCallsign?.[cs] : null;
    if (!route) return false;
    const hay = [route.origin, route.destination, route.route]
      .filter(Boolean)
      .map((s) => (s as string).toLowerCase());
    if (!hay.some((s) => s.includes(needle))) return false;
  }

  if (f.countryContains && f.countryContains.length > 0) {
    const needle = f.countryContains.toLowerCase();
    const country = findIcaoCountry(ac.hex);
    const hay = [country.country, country.countryCode]
      .filter(Boolean)
      .map((s) => (s as string).toLowerCase());
    if (!hay.some((s) => s.includes(needle))) return false;
  }

  if (f.hexContains && f.hexContains.length > 0) {
    const needle = f.hexContains.toLowerCase();
    if (!ac.hex.toLowerCase().includes(needle)) return false;
  }

  if (f.regPrefix && f.regPrefix.length > 0) {
    const needle = f.regPrefix.toLowerCase();
    const reg = (ac.r ?? "").toLowerCase();
    if (!reg.startsWith(needle)) return false;
  }

  if (f.squawkEquals && f.squawkEquals.length > 0) {
    const want = f.squawkEquals.trim();
    const sqk = (ac.squawk ?? "").trim();
    if (sqk !== want) return false;
  }

  if (f.typePrefix && f.typePrefix.length > 0) {
    const needle = f.typePrefix.toLowerCase();
    const t = (ac.t ?? "").toLowerCase();
    if (!t.startsWith(needle)) return false;
  }

  if (f.sourceEquals && f.sourceEquals.length > 0) {
    const want = f.sourceEquals.toLowerCase();
    const src = (ac.type ?? "").toLowerCase();
    if (want === "adsb") {
      if (!src.startsWith("adsb_")) return false;
    } else if (want === "tisb") {
      if (!src.startsWith("tisb_")) return false;
    } else {
      if (src !== want) return false;
    }
  }

  if (f.gsRangeKt) {
    const [min, max] = f.gsRangeKt;
    const gs = typeof ac.gs === "number" ? ac.gs : null;
    if (gs == null) return false;
    if (gs < min || gs > max) return false;
  }

  if (f.vsRangeFpm) {
    const [min, max] = f.vsRangeFpm;
    const vs = typeof ac.baro_rate === "number" ? ac.baro_rate : null;
    if (vs == null) return false;
    if (vs < min || vs > max) return false;
  }

  if (f.distRangeNm) {
    if (!f.receiver || ac.lat == null || ac.lon == null) return false;
    const d = haversineNm(f.receiver.lat, f.receiver.lon, ac.lat, ac.lon);
    const [min, max] = f.distRangeNm;
    if (d < min || d > max) return false;
  }

  if (f.hdgCenter != null && f.hdgTolerance != null) {
    const hdg =
      typeof ac.track === "number"
        ? ac.track
        : typeof ac.true_heading === "number"
          ? ac.true_heading
          : null;
    if (hdg == null) return false;
    // Shortest angular distance, modulo 360.
    let diff = (Math.abs(((hdg - f.hdgCenter) % 360) + 540) % 360) - 180;
    diff = Math.abs(diff);
    if (diff > f.hdgTolerance) return false;
  }

  if (f.militaryOnly) {
    if (((ac.dbFlags ?? 0) & 1) !== 1) return false;
  }

  if (f.inViewOnly && f.viewportHexes) {
    if (!f.viewportHexes.has(ac.hex)) return false;
  }

  const plainQuery = f.query?.trim() ?? "";
  if (plainQuery.length > 0) {
    const q = plainQuery.toLowerCase();
    const callsign =
      typeof ac.flight === "string" ? ac.flight.trim().toUpperCase() : "";
    const route = callsign ? f.routeByCallsign?.[callsign] : null;
    const hay = [ac.hex, ac.flight, ac.r, ac.t, ac.squawk]
      .filter(Boolean)
      .map((s) => (s as string).toLowerCase());
    if (route) {
      if (route.route) hay.push(route.route.toLowerCase());
      hay.push(route.origin.toLowerCase(), route.destination.toLowerCase());
    }
    if (!hay.some((s) => s.includes(q))) return false;
  }

  return true;
}
