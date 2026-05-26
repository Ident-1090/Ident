// Drives the store with synthetic data in place of a live identd connection.
// Wired in from startFeed() when VITE_IDENT_DEMO is set. No websocket, no
// backend: a timer steps the model and feeds the same store ingest methods the
// real transport calls, and a fetch shim answers the REST endpoints (trails,
// replay) the app probes on load. Photo lookups (planespotters) pass through.
import { refreshReplayManifest } from "../data/replay";
import { useIdentStore } from "../data/store";
import type { TrailPoint } from "../data/types";
import {
  buildCapabilities,
  buildConfig,
  buildFrame,
  buildRangeOutline,
  buildReplay,
  buildRoutes,
  buildStatus,
  buildTrailPoint,
  type DemoReplay,
  initPlanes,
  type PlaneState,
  stepPlane,
} from "./generator";

const TICK_MS = 1000;
const STATUS_EVERY = 3;

function installFetchShim(replay: DemoReplay): () => void {
  const original = window.fetch.bind(window);
  const json = (body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("api/trails/recent")) {
      return Promise.resolve(json({ aircraft: {}, replay: null }));
    }
    if (url.includes("api/replay/manifest")) {
      return Promise.resolve(json(replay.manifest));
    }
    if (url.includes("api/replay/blocks/")) {
      const key = Object.keys(replay.blocks).find((k) => url.includes(k));
      if (key) return Promise.resolve(json(replay.blocks[key]));
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    return original(input, init);
  }) as typeof window.fetch;

  return () => {
    window.fetch = original;
  };
}

export function startDemoFeed(): () => void {
  const store = useIdentStore.getState();
  const replay = buildReplay(Date.now());
  const restoreFetch = installFetchShim(replay);
  const planes = initPlanes();
  const config = buildConfig();

  store.ingestConfig({ station: config.station ?? null, ident: config.ident });
  store.ingestCapabilities(buildCapabilities());
  for (const r of buildRoutes(planes, Date.now()).routes) {
    if ("origin" in r) {
      store.setRouteInfo(r.callsign.toUpperCase(), {
        origin: r.origin ?? "—",
        destination: r.destination ?? "—",
        route: r.route,
      });
    }
  }
  store.setConnectionStatus("ws", "open");

  // Warm up a back-trail so the first paint already shows tracks: rewind the
  // model, then replay forward at 1 Hz into trail arrays set in one shot. A
  // direct set (rather than replaying frames through ingestAircraft) is
  // idempotent, so StrictMode's double-invoke can't duplicate the history. The
  // replay ends where the live loop begins, so motion is continuous.
  // Warm the live back-trail to the full replay window so a selected aircraft
  // shows the same length of history live as in replay (and it keeps growing as
  // the demo runs). The live trail isn't point-capped; TRAIL_POINT_CAP only
  // bounds unselected trails during replay reconstruction.
  const HISTORY_SEC = 1800;
  for (let i = 0; i < HISTORY_SEC; i++) {
    for (const p of planes) stepPlane(p, -1);
  }
  const t0 = Date.now();
  const seeded: Record<string, TrailPoint[]> = {};
  for (const p of planes) seeded[p.hex] = [];
  for (let i = HISTORY_SEC; i > 0; i--) {
    for (const p of planes) {
      stepPlane(p, 1);
      seeded[p.hex].push(buildTrailPoint(p, t0 - i * 1000));
    }
  }
  useIdentStore.setState({ trailsByHex: seeded });

  store.ingestReplayAvailability(replay.availability);
  // Pull the manifest now so the scrubber gets the full block index; the demo
  // path doesn't go through the dispatch that normally triggers this.
  void refreshReplayManifest();
  // Preload every block up front (the whole history is already in memory), so a
  // scrubbed-back trail shows immediately instead of "growing" as blocks stream.
  for (const [url, block] of Object.entries(replay.blocks)) {
    store.setReplayBlock(url, block);
  }

  const prime = () => {
    const now = Date.now();
    store.ingestStatus(buildStatus(planes, now));
    store.ingestRangeOutline(buildRangeOutline(now));
    store.ingestAircraft(buildFrame(planes, now));
  };
  prime();

  let tick = 1;
  const timer = window.setInterval(() => {
    const now = Date.now();
    for (const p of planes) stepPlane(p, TICK_MS / 1000);
    store.ingestAircraft(buildFrame(planes, now));
    if (tick % STATUS_EVERY === 0) {
      store.ingestStatus(buildStatus(planes, now));
      store.ingestRangeOutline(buildRangeOutline(now));
    }
    tick++;
  }, TICK_MS);

  return () => {
    window.clearInterval(timer);
    restoreFetch();
  };
}

export type { PlaneState };
