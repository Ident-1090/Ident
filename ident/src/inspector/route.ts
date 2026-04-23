import { useIdentStore } from "../data/store";
import type { Aircraft, RouteInfo } from "../data/types";

const ROUTE_ENDPOINT = "https://adsb.im/api/0/routeset";
const ROUTE_BATCH_DELAY_MS = 250;

type RouteAirport = {
  iata?: string;
  icao?: string;
  location?: string;
  name?: string;
  city?: string;
  code?: string;
};

type PendingRoute = {
  aircraft: Aircraft;
  resolve: (route: RouteInfo | null) => void;
};

const inflightByCallsign = new Map<string, Promise<RouteInfo | null>>();
const queuedByCallsign = new Map<string, PendingRoute[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function resetRouteCacheForTests(): void {
  inflightByCallsign.clear();
  queuedByCallsign.clear();
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  useIdentStore.setState({ routeByCallsign: {} });
}

export function routeTextForAircraft(aircraft: Aircraft): string {
  const callsign = aircraft.flight?.trim().toUpperCase();
  if (!callsign) return "";
  const route = useIdentStore.getState().routeByCallsign[callsign];
  if (!route) return "";
  return `${route.route ?? ""} ${route.origin} ${route.destination}`
    .trim()
    .toLowerCase();
}

export async function loadRouteForAircraft(
  aircraft: Aircraft,
): Promise<RouteInfo | null> {
  const callsign = aircraft.flight?.trim().toUpperCase();
  if (
    !callsign ||
    typeof aircraft.lat !== "number" ||
    typeof aircraft.lon !== "number"
  ) {
    return null;
  }

  const state = useIdentStore.getState();
  const cached = state.routeByCallsign[callsign];
  if (cached !== undefined) return cached;

  // Whenever the WebSocket is alive (connecting or open), the Go relay owns
  // route lookups and pushes envelopes back. We must not hit adsb.im from the
  // browser in that window — even before the first route frame lands — so the
  // upstream isn't flooded on initial page load. Only fall through to the
  // client fetch when the WS lifecycle has failed ("closed").
  if (state.connectionStatus.ws !== "closed") return null;

  const inflight = inflightByCallsign.get(callsign);
  if (inflight) return inflight;

  const promise = new Promise<RouteInfo | null>((resolve) => {
    const pending = queuedByCallsign.get(callsign) ?? [];
    pending.push({ aircraft, resolve });
    queuedByCallsign.set(callsign, pending);
    scheduleFlush();
  });
  inflightByCallsign.set(callsign, promise);
  return promise;
}

export function preloadRoutesForAircraft(aircraft: Iterable<Aircraft>): void {
  for (const ac of aircraft) {
    void loadRouteForAircraft(ac);
  }
}

function scheduleFlush(): void {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueuedRoutes();
  }, ROUTE_BATCH_DELAY_MS);
}

async function flushQueuedRoutes(): Promise<void> {
  const batch = Array.from(queuedByCallsign.entries());
  queuedByCallsign.clear();
  if (batch.length === 0) return;

  const planes = batch.map(([callsign, requests]) => ({
    callsign,
    lat: requests[0].aircraft.lat as number,
    lng: requests[0].aircraft.lon as number,
  }));

  let byCallsign = new Map<string, RouteInfo | null>();
  try {
    const res = await fetch(ROUTE_ENDPOINT, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Accept: "application/json",
      },
      body: JSON.stringify({ planes }),
    });
    if (res.ok) {
      byCallsign = parseRoutePayload(
        await res.json(),
        planes.map((p) => p.callsign),
      );
    }
  } catch {
    // Keep null fallbacks below.
  }

  for (const [callsign, requests] of batch) {
    const route = byCallsign.get(callsign) ?? null;
    useIdentStore.getState().setRouteInfo(callsign, route);
    inflightByCallsign.delete(callsign);
    for (const request of requests) request.resolve(route);
  }
}

function parseRoutePayload(
  payload: unknown,
  callsigns: string[],
): Map<string, RouteInfo | null> {
  const out = new Map<string, RouteInfo | null>();
  for (const callsign of callsigns) out.set(callsign, null);
  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (!item || typeof item !== "object") continue;
      collectRouteRecord(out, item as Record<string, unknown>, []);
    }
    return out;
  }
  if (!payload || typeof payload !== "object") return out;

  const root = payload as Record<string, unknown>;
  const airports = Array.isArray(root._airports) ? root._airports : [];
  collectRouteRecord(out, root, airports);

  for (const key of ["routes", "planes", "results", "data"]) {
    const bucket = root[key];
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      if (!item || typeof item !== "object") continue;
      collectRouteRecord(out, item as Record<string, unknown>, airports);
    }
  }

  for (const callsign of callsigns) {
    const topLevel = root[callsign];
    if (topLevel && typeof topLevel === "object") {
      collectRouteRecord(
        out,
        topLevel as Record<string, unknown>,
        airports,
        callsign,
      );
    }
  }
  return out;
}

function collectRouteRecord(
  out: Map<string, RouteInfo | null>,
  record: Record<string, unknown>,
  airports: unknown[],
  fallbackCallsign?: string,
): void {
  const recordAirports = Array.isArray(record._airports)
    ? record._airports
    : airports;
  const recordCallsign = toUpperString(
    record.callsign ??
      record.flight ??
      record.ident ??
      record.callsign_icao ??
      fallbackCallsign,
  );
  if (!recordCallsign || !out.has(recordCallsign)) return;

  const routeCodes = extractRouteCodes(record, recordAirports);
  const origin = resolveAirport(
    record.origin ??
      record.from ??
      record.departure ??
      record.dep ??
      record.airport1,
    recordAirports,
  );
  const destination = resolveAirport(
    record.destination ??
      record.to ??
      record.arrival ??
      record.arr ??
      record.airport2,
    recordAirports,
  );
  const route =
    routeCodes.length > 0
      ? routeCodes.join("-")
      : [origin, destination]
          .filter((code): code is string => Boolean(code))
          .join("-");

  const firstRouteCode = routeCodes[0] ?? null;
  const lastRouteCode =
    routeCodes.length > 0 ? routeCodes[routeCodes.length - 1] : null;
  if (!origin && !destination && !firstRouteCode && !lastRouteCode) return;
  out.set(recordCallsign, {
    origin: origin ?? firstRouteCode ?? "—",
    destination: destination ?? lastRouteCode ?? "—",
    route: route || undefined,
  });
}

function extractRouteCodes(
  record: Record<string, unknown>,
  airports: unknown[],
): string[] {
  const fromAirports =
    Array.isArray(record._airports) && record._airports.length > 0
      ? record._airports
      : Array.isArray(record.airports) && record.airports.length > 0
        ? record.airports
        : airports;
  const airportCodes = fromAirports
    .map((airport) => formatAirport(airport))
    .filter(isUsableRouteCode);
  if (airportCodes.length > 0) return airportCodes;

  for (const key of ["_airport_codes_iata", "airport_codes"]) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const codes = value
      .split("-")
      .map((code) => code.trim().toUpperCase())
      .filter(isUsableRouteCode);
    if (codes.length > 0) return codes;
  }
  return [];
}

function resolveAirport(value: unknown, airports: unknown[]): string | null {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < airports.length
  ) {
    return formatAirport(airports[value]);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const idx = Number.parseInt(trimmed, 10);
      if (idx >= 0 && idx < airports.length)
        return formatAirport(airports[idx]);
    }
    const upper = trimmed.toUpperCase();
    return isUsableRouteCode(upper) ? upper : null;
  }
  if (value && typeof value === "object") {
    return formatAirport(value);
  }
  return null;
}

function formatAirport(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const airport = value as RouteAirport;
  const code = airport.iata || airport.icao || airport.code || null;
  return code ? code.toUpperCase() : null;
}

function isUsableRouteCode(value: string | null): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.toLowerCase() !== "unknown"
  );
}

function toUpperString(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().toUpperCase()
    : null;
}
