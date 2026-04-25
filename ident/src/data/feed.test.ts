import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFeed } from "./feed";
import { useIdentStore } from "./store";

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
        info?: { isRetry: boolean },
      ) => void;
    };

    constructor(opts: {
      url: string;
      onText?: (text: string) => void;
      onStatus?: (
        status: "connecting" | "open" | "closed",
        info?: { isRetry: boolean },
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

  it("publishes HTTP fallback connection status while polling backup data", async () => {
    vi.useFakeTimers();
    let aircraftPolls = 0;
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/aircraft.json")) {
        aircraftPolls++;
        return { json: async () => ({ now: 1, aircraft: [] }) } as Response;
      }
      if (url.endsWith("/receiver.json")) {
        return { json: async () => ({ lat: 37.4, lon: -122.1 }) } as Response;
      }
      if (url.endsWith("/stats.json")) {
        return { json: async () => ({ now: 1 }) } as Response;
      }
      if (url.endsWith("/outline.json")) {
        return { json: async () => ({ points: [] }) } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const stop = startFeed();
    useIdentStore.getState().setConnectionStatus("ws", "closed");

    await vi.advanceTimersByTimeAsync(15_000);

    expect(aircraftPolls).toBe(1);
    expect(useIdentStore.getState().connectionStatus.http).toBe("open");

    stop();
  });

  it("does not refresh feed freshness when fallback serves the same aircraft frame again", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/aircraft.json")) {
        return { json: async () => ({ now: 42, aircraft: [] }) } as Response;
      }
      if (url.endsWith("/receiver.json")) {
        return { json: async () => ({ lat: 37.4, lon: -122.1 }) } as Response;
      }
      if (url.endsWith("/stats.json")) {
        return { json: async () => ({ now: 42 }) } as Response;
      }
      if (url.endsWith("/outline.json")) {
        return { json: async () => ({ points: [] }) } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const stop = startFeed();
    useIdentStore.getState().setConnectionStatus("ws", "closed");

    await vi.advanceTimersByTimeAsync(15_000);
    const firstSeenAt = useIdentStore.getState().liveState.lastMsgTs;

    await vi.advanceTimersByTimeAsync(1000);
    const secondSeenAt = useIdentStore.getState().liveState.lastMsgTs;

    expect(firstSeenAt).toBeGreaterThan(0);
    expect(secondSeenAt).toBe(firstSeenAt);

    stop();
  });

  it("records fallback trail samples only when the aircraft frame advances", async () => {
    vi.useFakeTimers();
    const frames = [
      {
        now: 42,
        aircraft: [{ hex: "abc123", lat: 37.7, lon: -122.0, alt_baro: 2600 }],
      },
      {
        now: 42,
        aircraft: [{ hex: "abc123", lat: 37.7, lon: -122.0, alt_baro: 2600 }],
      },
      {
        now: 43,
        aircraft: [{ hex: "abc123", lat: 37.8, lon: -121.9, alt_baro: 2700 }],
      },
    ];
    let aircraftPolls = 0;
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/aircraft.json")) {
        return {
          json: async () =>
            frames[Math.min(aircraftPolls++, frames.length - 1)],
        } as Response;
      }
      if (url.endsWith("/receiver.json")) {
        return { json: async () => ({ lat: 37.4, lon: -122.1 }) } as Response;
      }
      if (url.endsWith("/stats.json")) {
        return { json: async () => ({ now: 42 }) } as Response;
      }
      if (url.endsWith("/outline.json")) {
        return { json: async () => ({ points: [] }) } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const stop = startFeed();
    useIdentStore.getState().setConnectionStatus("ws", "closed");

    await vi.advanceTimersByTimeAsync(15_000);
    const firstSeenAt = useIdentStore.getState().liveState.lastMsgTs;
    expect(useIdentStore.getState().trailsByHex.abc123).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(useIdentStore.getState().liveState.lastMsgTs).toBe(firstSeenAt);
    expect(useIdentStore.getState().trailsByHex.abc123).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    const state = useIdentStore.getState();
    expect(state.liveState.lastMsgTs).toBeGreaterThan(firstSeenAt);
    expect(state.trailsByHex.abc123).toEqual([
      expect.objectContaining({ lat: 37.7, lon: -122.0, alt: 2600 }),
      expect.objectContaining({ lat: 37.8, lon: -121.9, alt: 2700 }),
    ]);

    stop();
  });

  it("keeps fallback retrying without freshness when aircraft polling fails", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/aircraft.json")) {
        throw new Error("aircraft unavailable");
      }
      if (url.endsWith("/receiver.json")) {
        return { json: async () => ({ lat: 37.4, lon: -122.1 }) } as Response;
      }
      if (url.endsWith("/stats.json")) {
        return { json: async () => ({ now: 1 }) } as Response;
      }
      if (url.endsWith("/outline.json")) {
        return { json: async () => ({ points: [] }) } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const stop = startFeed();
    useIdentStore.getState().setConnectionStatus("ws", "closed");

    await vi.advanceTimersByTimeAsync(15_000);

    const state = useIdentStore.getState();
    expect(state.receiver?.lat).toBe(37.4);
    expect(state.stats?.now).toBe(1);
    expect(state.outline?.points).toEqual([]);
    expect(state.liveState.lastMsgTs).toBe(0);
    expect(state.connectionStatus.http).toBe("connecting");

    stop();
  });

  it("times out fallback attempts and stops polling after repeated aircraft failures", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch;

    const stop = startFeed();
    useIdentStore.getState().setConnectionStatus("ws", "closed");

    await vi.advanceTimersByTimeAsync(15_000);
    expect(useIdentStore.getState().connectionStatus.http).toBe("connecting");

    await vi.advanceTimersByTimeAsync(900);
    expect(useIdentStore.getState().connectionStatus.http).toBe("connecting");

    await vi.advanceTimersByTimeAsync(4_100);
    const callsAfterFailures = vi.mocked(globalThis.fetch).mock.calls.length;
    expect(useIdentStore.getState().connectionStatus.http).toBe("closed");
    expect(callsAfterFailures).toBe(13);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(
      callsAfterFailures,
    );

    stop();
  });
});
