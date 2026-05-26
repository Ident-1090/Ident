import { appPath, appWebSocketUrl } from "./basePath";
import { refreshReplayManifest } from "./replay";
import { pruneRetainedTrail, useIdentStore } from "./store";
import type {
  AircraftFrame,
  IdentCapabilitiesEnvelope,
  IdentConfig,
  IdentDiagnosticsEnvelope,
  IdentRangeOutline,
  IdentReplayAvailability,
  IdentRoutes,
  IdentStatus,
  ReplayBlockFile,
  TrailPoint,
} from "./types";
import { WsClient } from "./ws";

const WS_URL = "api/ws";
const TRAILS_HTTP_URL = "api/trails/recent.json";
const TRAIL_SEED_FETCH_TIMEOUT_MS = 30_000;

type Envelope =
  | { type: "aircraft"; data: AircraftFrame }
  | { type: "capabilities"; data: IdentCapabilitiesEnvelope }
  | { type: "status"; data: IdentStatus }
  | { type: "diagnostics"; data: IdentDiagnosticsEnvelope }
  | { type: "rangeOutline"; data: IdentRangeOutline }
  | { type: "config"; data: IdentConfig }
  | { type: "routes"; data: IdentRoutes }
  | {
      type: "trails";
      data: {
        aircraft?: Record<string, TrailPoint[]>;
        replay?: ReplayBlockFile | null;
      };
    }
  | { type: "replay.availability"; data: IdentReplayAvailability };

function parseJSON<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    // A malformed envelope would otherwise vanish — "Live" stays green
    // while updates silently stop. Log so operators can spot WS-protocol
    // drift instead of debugging an empty UI.
    console.warn("feed: malformed envelope", {
      err,
      preview: text.slice(0, 200),
    });
    return null;
  }
}

function dispatch(env: Envelope): void {
  const store = useIdentStore.getState();
  switch (env.type) {
    case "aircraft": {
      store.ingestAircraft(env.data);
      break;
    }
    case "capabilities":
      store.ingestCapabilities(env.data);
      break;
    case "status":
      store.ingestStatus(env.data);
      break;
    case "diagnostics":
      store.ingestDiagnostics(env.data.diagnostics ?? []);
      break;
    case "rangeOutline":
      store.ingestRangeOutline(env.data);
      break;
    case "routes": {
      if (!Array.isArray(env.data.routes) || env.data.routes.length === 0)
        break;
      for (const entry of env.data.routes) {
        const cs = entry.callsign?.trim().toUpperCase();
        if (!cs) continue;
        if ("dropped" in entry && entry.dropped) {
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
      applyRecentSeed(env.data);
      break;
    }
    case "config":
      if (env.data) {
        store.ingestConfig({
          station: env.data.station ?? null,
          ident: env.data.ident ?? null,
        });
        store.setLosData(env.data.lineOfSight ?? null);
      }
      break;
    case "replay.availability": {
      store.ingestReplayAvailability(env.data);
      // The envelope carries availability bounds but not the per-block index;
      // refetch the manifest when any of the four envelope fields diverges
      // from what we already hold. blockCount alone misses retention
      // rotation — an evicted block replaced by a new one keeps count
      // constant but shifts from/to, leaving stored blocks[] stale.
      const knownBlockCount = store.replay.blocks.length;
      const reportedBlockCount = env.data.blockCount;
      const reportedFrom = env.data.fromEpochMs;
      const reportedTo = env.data.toEpochMs;
      const reportedBlockSec = env.data.blockSec;
      const countChanged =
        typeof reportedBlockCount === "number" &&
        reportedBlockCount !== knownBlockCount;
      const fromChanged =
        typeof reportedFrom === "number" &&
        reportedFrom !== store.replay.availableFrom;
      const toChanged =
        typeof reportedTo === "number" &&
        reportedTo !== store.replay.availableTo;
      const blockSecChanged =
        typeof reportedBlockSec === "number" &&
        reportedBlockSec !== store.replay.blockSec;
      if (countChanged || fromChanged || toChanged || blockSecChanged) {
        void refreshReplayManifest();
      }
      break;
    }
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
    if (key === lastKey) {
      deduped[deduped.length - 1] = {
        ...deduped[deduped.length - 1],
        ...point,
      };
      continue;
    }
    deduped.push(point);
    lastKey = key;
  }
  return pruneRetainedTrail(deduped);
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

function isTrailPoint(point: unknown): point is TrailPoint {
  if (typeof point !== "object" || point == null) return false;
  const candidate = point as Partial<TrailPoint>;
  return (
    typeof candidate.lat === "number" &&
    typeof candidate.lon === "number" &&
    (typeof candidate.alt === "number" || candidate.alt === null) &&
    typeof candidate.ts === "number" &&
    typeof candidate.segment === "number"
  );
}

function normalizeTrailSeed(
  aircraft: Record<string, TrailPoint[]> | undefined,
): Map<string, TrailPoint[]> {
  const trails = new Map<string, TrailPoint[]>();
  let dropped = 0;
  for (const [hex, points] of Object.entries(aircraft ?? {})) {
    if (!Array.isArray(points)) continue;
    const valid = points.filter(isTrailPoint);
    dropped += points.length - valid.length;
    if (valid.length > 0) trails.set(hex, valid);
  }
  if (dropped > 0) {
    console.warn(`trail seed dropped ${dropped} invalid point(s)`);
  }
  return trails;
}

function applyRecentSeed(data: {
  aircraft?: Record<string, TrailPoint[]>;
  replay?: ReplayBlockFile | null;
}): void {
  applyTrailSeed(normalizeTrailSeed(data.aircraft));
  if (isReplayBlock(data.replay)) {
    useIdentStore.getState().setReplayRecent(data.replay);
  }
}

function isReplayBlock(value: unknown): value is ReplayBlockFile {
  return (
    typeof value === "object" &&
    value != null &&
    (value as ReplayBlockFile).version === 2 &&
    Array.isArray((value as ReplayBlockFile).frames)
  );
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
      replay?: ReplayBlockFile | null;
    };
    applyRecentSeed(data);
  } catch {
    // Trail history is opportunistic; live aircraft downlink must keep priority.
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export function startFeed(): () => void {
  if (import.meta.env.VITE_IDENT_DEMO === "true") {
    // Demo build: no backend. Load the synthetic feed lazily so its seed data
    // stays out of the normal app bundle.
    let stop = () => {};
    void import("../demo/demoFeed").then((m) => {
      stop = m.startDemoFeed();
    });
    return () => stop();
  }

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
