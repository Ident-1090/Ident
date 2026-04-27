import { appPath, appWebSocketUrl } from "./basePath";
import { refreshReplayManifest } from "./replay";
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
const TRAILS_HTTP_URL = "api/trails/recent.json";
const TRAIL_SEED_FETCH_TIMEOUT_MS = 30_000;
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
  | { type: "trails"; data: { aircraft?: Record<string, TrailPoint[]> } }
  | { type: "replay.availability"; data: unknown };

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
      applyTrailSeed(normalizeTrailSeed(env.data.aircraft));
      break;
    }
    case "config":
      if (env.data) {
        store.ingestConfig({ station: env.data.station ?? null });
        store.setLosData(env.data.line_of_sight ?? null);
      }
      break;
    case "replay.availability":
      void refreshReplayManifest();
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

function normalizeTrailSeed(
  aircraft: Record<string, TrailPoint[]> | undefined,
): Map<string, TrailPoint[]> {
  const trails = new Map<string, TrailPoint[]>();
  for (const [hex, points] of Object.entries(aircraft ?? {})) {
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
  return trails;
}

async function fetchTrailSeed(signal: AbortSignal): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, TRAIL_SEED_FETCH_TIMEOUT_MS);
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) return;
    const res = await fetch(appPath(TRAILS_HTTP_URL), {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      aircraft?: Record<string, TrailPoint[]>;
    };
    applyTrailSeed(normalizeTrailSeed(data.aircraft));
  } catch {
    // Trail history is opportunistic; live aircraft downlink must keep priority.
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export function startFeed(): () => void {
  const store = useIdentStore.getState();
  const trailSeedController = new AbortController();
  const client = new WsClient({
    url: appWebSocketUrl(WS_URL),
    onText: (t) => {
      const env = parseJSON<Envelope>(t);
      if (!env?.type) return;
      dispatch(env);
    },
    onStatus: (s, info) => store.setConnectionStatus("ws", s, info),
  });

  void refreshReplayManifest();
  void fetchTrailSeed(trailSeedController.signal);
  client.start();

  return () => {
    trailSeedController.abort();
    client.stop();
  };
}
