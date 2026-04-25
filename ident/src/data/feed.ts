import { appPath, appWebSocketUrl } from "./basePath";
import { useIdentStore } from "./store";
import type {
  AircraftFrame,
  HeyWhatsThatJson,
  OutlineJson,
  ReceiverJson,
  StatsJson,
  TrailPoint,
} from "./types";
import { WsClient } from "./ws";

const WS_URL = "api/ws";
const BASE_HTTP = "api/data";
const FALLBACK_AFTER_MS = 15_000;
const POLL_INTERVAL_MS = 1000;
const FALLBACK_FETCH_TIMEOUT_MS = 800;
const MAX_FALLBACK_FAILURES = 3;
const TRAIL_POINT_CAP = 1500;

type RouteEntry = {
  callsign: string;
  origin?: string;
  destination?: string;
  route?: string;
  dropped?: boolean;
};

type Envelope =
  | { type: "aircraft"; data: AircraftFrame }
  | { type: "receiver"; data: ReceiverJson }
  | { type: "stats"; data: StatsJson }
  | { type: "outline"; data: OutlineJson }
  | {
      type: "config";
      data: {
        station?: string | null;
        line_of_sight?: HeyWhatsThatJson | null;
      };
    }
  | { type: "routes"; now?: number; data: RouteEntry[] }
  | { type: "trails"; data: { aircraft?: Record<string, TrailPoint[]> } };

function parseJSON<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function aircraftFrameAdvanced(
  frame: AircraftFrame,
  previousNow: number,
): boolean {
  return (
    typeof frame.now === "number" &&
    Number.isFinite(frame.now) &&
    frame.now > previousNow
  );
}

function aircraftFrameTimestampMs(frame: AircraftFrame): number {
  return typeof frame.now === "number" && Number.isFinite(frame.now)
    ? Math.round(frame.now * 1000)
    : Date.now();
}

function dispatch(env: Envelope): void {
  const store = useIdentStore.getState();
  switch (env.type) {
    case "aircraft": {
      const advanced = aircraftFrameAdvanced(env.data, store.now);
      if (advanced) store.recordSnapshot();
      store.ingestAircraft(env.data);
      if (!advanced) break;
      const nowMs = aircraftFrameTimestampMs(env.data);
      for (const ac of env.data.aircraft) {
        if (typeof ac.lat !== "number" || typeof ac.lon !== "number") continue;
        store.recordTrailPoint(ac.hex, {
          lat: ac.lat,
          lon: ac.lon,
          alt:
            typeof ac.alt_baro === "number" || ac.alt_baro === "ground"
              ? ac.alt_baro
              : "ground",
          ts: nowMs,
        });
      }
      break;
    }
    case "receiver":
      store.ingestReceiver(env.data);
      break;
    case "stats":
      store.ingestStats(env.data);
      break;
    case "outline":
      store.ingestOutline(env.data);
      break;
    case "routes": {
      if (!Array.isArray(env.data) || env.data.length === 0) break;
      for (const entry of env.data) {
        const cs = entry.callsign?.trim().toUpperCase();
        if (!cs) continue;
        if (entry.dropped) {
          store.setRouteInfo(cs, null);
        } else {
          store.setRouteInfo(cs, {
            origin: entry.origin ?? "—",
            destination: entry.destination ?? "—",
            route: entry.route,
          });
        }
      }
      if (!store.liveState.routesViaWs) {
        useIdentStore.setState((st) => ({
          liveState: { ...st.liveState, routesViaWs: true },
        }));
      }
      break;
    }
    case "trails": {
      const trails = new Map<string, TrailPoint[]>();
      for (const [hex, points] of Object.entries(env.data.aircraft ?? {})) {
        if (!Array.isArray(points)) continue;
        trails.set(
          hex,
          points.filter(
            (point): point is TrailPoint =>
              typeof point.lat === "number" &&
              typeof point.lon === "number" &&
              (typeof point.alt === "number" || point.alt === "ground") &&
              typeof point.ts === "number",
          ),
        );
      }
      applyTrailSeed(trails);
      break;
    }
    case "config":
      if (env.data) {
        store.ingestConfig({ station: env.data.station ?? null });
        store.setLosData(env.data.line_of_sight ?? null);
      }
      break;
  }
}

function trailPointKey(point: TrailPoint): string {
  return `${point.ts}:${point.lat}:${point.lon}:${point.alt}`;
}

function mergeTrailSeries(
  existing: TrailPoint[] | undefined,
  incoming: TrailPoint[],
): TrailPoint[] {
  const merged = [...(existing ?? []), ...incoming];
  merged.sort((a, b) => a.ts - b.ts);

  const deduped: TrailPoint[] = [];
  let lastKey: string | null = null;
  for (const point of merged) {
    const key = trailPointKey(point);
    if (key === lastKey) continue;
    deduped.push(point);
    lastKey = key;
  }
  if (deduped.length > TRAIL_POINT_CAP) {
    deduped.splice(0, deduped.length - TRAIL_POINT_CAP);
  }
  return deduped;
}

function applyTrailSeed(trails: Map<string, TrailPoint[]>): void {
  if (trails.size === 0) return;
  useIdentStore.setState((st) => {
    const trailsByHex = { ...st.trailsByHex };
    for (const [hex, points] of trails) {
      trailsByHex[hex] = mergeTrailSeries(trailsByHex[hex], points);
    }
    return { trailsByHex };
  });
}

async function fetchJsonWithTimeout<T>(url: string): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const response = fetch(url, {
    cache: "no-store",
    signal: controller.signal,
  }).then((r) => r.json() as Promise<T>);
  const timeoutReached = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("fallback request timed out"));
    }, FALLBACK_FETCH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([response, timeoutReached]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function startFeed(): () => void {
  const store = useIdentStore.getState();
  const client = new WsClient({
    url: appWebSocketUrl(WS_URL),
    onText: (t) => {
      const env = parseJSON<Envelope>(t);
      if (!env?.type) return;
      dispatch(env);
    },
    onStatus: (s, info) => store.setConnectionStatus("ws", s, info),
  });

  client.start();

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const fallbackCheck = setTimeout(() => {
    if (useIdentStore.getState().connectionStatus.ws !== "open") {
      pollTimer = startPolling();
    }
  }, FALLBACK_AFTER_MS);

  const unsub = useIdentStore.subscribe((st) => {
    if (pollTimer && st.connectionStatus.ws === "open") {
      clearInterval(pollTimer);
      pollTimer = null;
      useIdentStore.getState().setConnectionStatus("http", "closed");
    }
  });

  return () => {
    clearTimeout(fallbackCheck);
    if (pollTimer) clearInterval(pollTimer);
    store.setConnectionStatus("http", "closed");
    unsub();
    client.stop();
  };
}

function startPolling(): ReturnType<typeof setInterval> {
  let consecutiveFailures = 0;
  let inFlight = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const stopPolling = () => {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  };
  const tick = async () => {
    if (inFlight || consecutiveFailures >= MAX_FALLBACK_FAILURES) return;
    inFlight = true;
    useIdentStore.getState().setConnectionStatus("http", "connecting");
    try {
      const [ac, rx, st, ol] = await Promise.allSettled([
        fetchJsonWithTimeout<AircraftFrame>(
          appPath(`${BASE_HTTP}/aircraft.json`),
        ),
        fetchJsonWithTimeout<ReceiverJson>(
          appPath(`${BASE_HTTP}/receiver.json`),
        ),
        fetchJsonWithTimeout<StatsJson>(appPath(`${BASE_HTTP}/stats.json`)),
        fetchJsonWithTimeout<OutlineJson>(appPath(`${BASE_HTTP}/outline.json`)),
      ]);
      const httpOk = ac.status === "fulfilled";
      // Receiver first so downstream consumers see site coords on the first tick.
      if (rx.status === "fulfilled")
        dispatch({ type: "receiver", data: rx.value });
      if (ac.status === "fulfilled")
        dispatch({ type: "aircraft", data: ac.value });
      if (st.status === "fulfilled")
        dispatch({ type: "stats", data: st.value });
      if (ol.status === "fulfilled")
        dispatch({ type: "outline", data: ol.value });
      consecutiveFailures = httpOk ? 0 : consecutiveFailures + 1;
      const exhausted = consecutiveFailures >= MAX_FALLBACK_FAILURES;
      useIdentStore
        .getState()
        .setConnectionStatus(
          "http",
          httpOk ? "open" : exhausted ? "closed" : "connecting",
        );
      if (exhausted) stopPolling();
    } finally {
      inFlight = false;
    }
  };
  void tick();
  pollTimer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  return pollTimer;
}
