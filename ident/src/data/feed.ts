import {
  type ChunkJson,
  groupChunkIntoTrails,
  loadHistoricalTracks,
} from "./chunks";
import { useIdentStore } from "./store";
import type {
  AircraftFrame,
  OutlineJson,
  ReceiverJson,
  StatsJson,
  TrailPoint,
} from "./types";
import { WsClient } from "./ws";

const WS_URL = "/ws";
const BASE_HTTP = "/data";
const CHUNKS_BASE = "/chunks";
const FALLBACK_AFTER_MS = 15_000;
const POLL_INTERVAL_MS = 1000;
const FALLBACK_FETCH_TIMEOUT_MS = 800;
const MAX_FALLBACK_FAILURES = 3;
const TRAIL_POINT_CAP = 1500;
const STARTUP_TRAIL_SLICE = "current_large.gz";

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
  | { type: "config"; data: { station?: string | null } }
  | { type: "routes"; now?: number; data: RouteEntry[] };

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
    case "config":
      if (env.data) store.ingestConfig({ station: env.data.station ?? null });
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

async function fetchChunk(name: string): Promise<ChunkJson | null> {
  try {
    const res = await fetch(`${CHUNKS_BASE}/${name}`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    if (!body || typeof body !== "object") return null;
    const files = (body as { files?: unknown }).files;
    if (!Array.isArray(files)) return null;
    return body as ChunkJson;
  } catch {
    return null;
  }
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

function seedStartupTrails(): void {
  void fetchChunk(STARTUP_TRAIL_SLICE).then((rolling) => {
    if (!rolling) return;
    applyTrailSeed(groupChunkIntoTrails([rolling]));
  });
  void loadHistoricalTracks().then((trails) => applyTrailSeed(trails));
}

export function startFeed(): () => void {
  const store = useIdentStore.getState();
  const wsOrigin = location.origin.replace(/^http/, "ws");
  let trailSeedQueued = false;
  let trailSeedTimer: ReturnType<typeof setTimeout> | null = null;

  const queueTrailSeed = (): void => {
    if (trailSeedQueued) return;
    trailSeedQueued = true;
    trailSeedTimer = setTimeout(() => {
      trailSeedTimer = null;
      seedStartupTrails();
    }, 0);
  };

  const client = new WsClient({
    url: `${wsOrigin}${WS_URL}`,
    onText: (t) => {
      const env = parseJSON<Envelope>(t);
      if (!env?.type) return;
      dispatch(env);
      if (env.type === "aircraft") queueTrailSeed();
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
    if (trailSeedTimer) clearTimeout(trailSeedTimer);
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
        fetchJsonWithTimeout<AircraftFrame>(`${BASE_HTTP}/aircraft.json`),
        fetchJsonWithTimeout<ReceiverJson>(`${BASE_HTTP}/receiver.json`),
        fetchJsonWithTimeout<StatsJson>(`${BASE_HTTP}/stats.json`),
        fetchJsonWithTimeout<OutlineJson>(`${BASE_HTTP}/outline.json`),
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
