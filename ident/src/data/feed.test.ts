import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFeed } from "./feed";
import { selectDisplayAircraftMap, useIdentStore } from "./store";

const wsHarness = vi.hoisted(() => ({
  instances: [] as Array<{ url: string; emitText: (text: string) => void }>,
}));

vi.mock("./ws", () => ({
  WsClient: class {
    readonly url: string;
    readonly opts: {
      url: string;
      onText?: (text: string) => void;
      onStatus?: (
        status: "connecting" | "open" | "closed",
        info?: {
          isRetry: boolean;
          retryDelayMs?: number;
          nextRetryAt?: number;
        },
      ) => void;
    };

    constructor(opts: {
      url: string;
      onText?: (text: string) => void;
      onStatus?: (
        status: "connecting" | "open" | "closed",
        info?: {
          isRetry: boolean;
          retryDelayMs?: number;
          nextRetryAt?: number;
        },
      ) => void;
    }) {
      this.url = opts.url;
      this.opts = opts;
      wsHarness.instances.push(this);
    }

    start(): void {
      this.opts.onStatus?.("open");
    }

    stop(): void {
      this.opts.onStatus?.("closed");
    }

    emitText(text: string): void {
      this.opts.onText?.(text);
    }
  },
}));
function resetStore() {
  useIdentStore.setState({
    aircraft: new Map(),
    receiver: null,
    stats: null,
    outline: null,
    now: 0,
    connectionStatus: {},
    connectionStatusInfo: {},
    selectedHex: null,
    altTrendsByHex: {},
    rssiBufByHex: {},
    alerts: [],
    trailsByHex: {},
    liveState: { lastMsgTs: 0, mpsBuffer: [], routesViaWs: false },
    replay: useIdentStore.getInitialState().replay,
    settings: {
      trailFadeSec: 180,
      unitMode: "aviation",
      unitOverrides: {
        altitude: "ft",
        horizontalSpeed: "kt",
        distance: "nm",
        verticalSpeed: "fpm",
        temperature: "C",
      },
      clock: "utc",
      theme: "system",
    },
  });
}

describe("startFeed route envelopes", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetStore();
    wsHarness.instances = [];
    globalThis.fetch = vi.fn(
      async () =>
        ({ ok: false, status: 404, json: async () => ({}) }) as Response,
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
    globalThis.fetch = originalFetch;
  });

  it("populates routeByCallsign for every entry in a batched routes envelope", () => {
    const stop = startFeed();
    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "routes",
        now: 1,
        data: [
          {
            callsign: "UAL123",
            origin: "SFO",
            destination: "LAX",
            route: "SFO-LAX",
          },
          {
            callsign: "DAL456",
            origin: "ATL",
            destination: "JFK",
            route: "ATL-JFK",
          },
        ],
      }),
    );
    const st = useIdentStore.getState();
    expect(st.routeByCallsign.UAL123).toEqual({
      origin: "SFO",
      destination: "LAX",
      route: "SFO-LAX",
    });
    expect(st.routeByCallsign.DAL456).toEqual({
      origin: "ATL",
      destination: "JFK",
      route: "ATL-JFK",
    });
    expect(st.liveState.routesViaWs).toBe(true);
    stop();
  });

  it("connects websocket relative to the mounted document path", () => {
    window.history.replaceState(null, "", "/ident/#/aircraft/abc123");

    const stop = startFeed();

    expect(wsHarness.instances[0].url).toBe("ws://localhost:3000/ident/api/ws");
    stop();
  });

  it("evicts cached routes on a dropped entry in a batched envelope", () => {
    const stop = startFeed();
    useIdentStore
      .getState()
      .setRouteInfo("UAL123", { origin: "SFO", destination: "LAX" });
    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "routes",
        data: [{ callsign: "UAL123", dropped: true }],
      }),
    );
    expect(useIdentStore.getState().routeByCallsign.UAL123).toBeNull();
    stop();
  });

  it("writes relay-supplied station name from a config envelope into store", () => {
    const stop = startFeed();
    wsHarness.instances[0].emitText(
      JSON.stringify({ type: "config", data: { station: "Home Receiver" } }),
    );
    expect(useIdentStore.getState().config.station).toBe("Home Receiver");
    stop();
  });

  it("writes relay-supplied line_of_sight rings from the config envelope into store", () => {
    const stop = startFeed();
    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "config",
        data: {
          line_of_sight: {
            rings: [{ alt: 3048, points: [[37, -122]] }],
          },
        },
      }),
    );
    expect(useIdentStore.getState().losData).toEqual({
      rings: [{ alt: 3048, points: [[37, -122]] }],
    });
    stop();
  });

  it("merges relay-supplied trail points into the local trail cache", () => {
    const stop = startFeed();
    useIdentStore.getState().recordTrailPoint("abc123", {
      lat: 34.1,
      lon: -118.2,
      alt: 3000,
      ts: 100_000,
    });

    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "trails",
        data: {
          aircraft: {
            abc123: [
              { lat: 34.0, lon: -118.1, alt: 2800, ts: 90_000 },
              { lat: 34.2, lon: -118.3, alt: 3200, ts: 110_000 },
            ],
          },
        },
      }),
    );

    expect(useIdentStore.getState().trailsByHex.abc123).toEqual([
      { lat: 34.0, lon: -118.1, alt: 2800, ts: 90_000 },
      { lat: 34.1, lon: -118.2, alt: 3000, ts: 100_000 },
      { lat: 34.2, lon: -118.3, alt: 3200, ts: 110_000 },
    ]);
    stop();
  });

  it("fetches the initial trail seed over HTTP instead of the websocket backlog", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/trails/recent.json")) {
        return {
          ok: true,
          json: async () => ({
            aircraft: {
              abc123: [{ lat: 34.0, lon: -118.1, alt: 2800, ts: 90_000 }],
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const stop = startFeed();

    await vi.waitFor(() => {
      expect(useIdentStore.getState().trailsByHex.abc123).toEqual([
        { lat: 34.0, lon: -118.1, alt: 2800, ts: 90_000 },
      ]);
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/trails/recent.json",
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );

    stop();
  });

  it("seeds recent replay frames through the recent trail endpoint", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/replay/manifest.json")) {
        return {
          ok: true,
          json: async () => ({
            enabled: true,
            from: 120_000,
            to: 180_000,
            block_sec: 60,
            blocks: [],
          }),
        } as Response;
      }
      if (url.endsWith("/trails/recent.json")) {
        return {
          ok: true,
          json: async () => ({
            aircraft: {},
            replay: {
              version: 1,
              start: 180_000,
              end: 190_000,
              step_ms: 5_000,
              frames: [
                {
                  ts: 185_000,
                  aircraft: [{ hex: "recent", flight: "RECENT1" }],
                },
              ],
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const stop = startFeed();

    await vi.waitFor(() => {
      useIdentStore.getState().enterReplay(185_000);
      expect(
        selectDisplayAircraftMap(useIdentStore.getState()).get("recent"),
      ).toMatchObject({ flight: "RECENT1" });
    });

    stop();
  });

  it("does not refresh feed freshness from auxiliary websocket envelopes", () => {
    const stop = startFeed();
    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "receiver",
        data: { lat: 37.4, lon: -122.1, version: "readsb" },
      }),
    );
    wsHarness.instances[0].emitText(
      JSON.stringify({ type: "stats", data: { now: 42 } }),
    );
    wsHarness.instances[0].emitText(
      JSON.stringify({ type: "outline", data: { points: [[37.4, -122.1]] } }),
    );

    const state = useIdentStore.getState();
    expect(state.receiver?.lat).toBe(37.4);
    expect(state.stats?.now).toBe(42);
    expect(state.outline?.points).toEqual([[37.4, -122.1]]);
    expect(state.liveState.lastMsgTs).toBe(0);

    stop();
  });

  it("does not start receiver JSON polling when the websocket is unavailable", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/trails/recent.json")) {
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const stop = startFeed();
    useIdentStore.getState().setConnectionStatus("ws", "closed");

    await vi.advanceTimersByTimeAsync(60_000);

    const requestedUrls = vi
      .mocked(globalThis.fetch)
      .mock.calls.map(([url]) => String(url));
    expect(requestedUrls).toContain("/api/replay/manifest.json");
    expect(requestedUrls).toContain("/api/trails/recent.json");
    expect(requestedUrls.some((url) => url.startsWith("/api/data/"))).toBe(
      false,
    );
    expect(useIdentStore.getState().connectionStatus.http).toBeUndefined();

    stop();
  });
});
