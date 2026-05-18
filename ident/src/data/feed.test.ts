import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFeed } from "./feed";
import {
  __resetTrailDisplayCachesForTests,
  selectDisplayAircraftMap,
  useIdentStore,
} from "./store";

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
  __resetTrailDisplayCachesForTests();
  useIdentStore.setState({
    aircraft: new Map(),
    receiver: null,
    rangeOutline: null,
    identStatus: null,
    capabilities: null,
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
      showTrailTooltip: true,
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
        data: {
          schema: "ident.routes.v1",
          observedAtEpochSec: 1,
          routes: [
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
        },
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
        data: {
          schema: "ident.routes.v1",
          routes: [{ callsign: "UAL123", dropped: true }],
        },
      }),
    );
    expect(useIdentStore.getState().routeByCallsign.UAL123).toBeNull();
    stop();
  });

  it("writes relay-supplied station name from a config envelope into store", () => {
    const stop = startFeed();
    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "config",
        data: { schema: "ident.config.v1", station: "Home Receiver" },
      }),
    );
    expect(useIdentStore.getState().config.station).toBe("Home Receiver");
    stop();
  });

  it("writes relay-supplied Ident build info from a config envelope into store", () => {
    const stop = startFeed();
    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "config",
        data: {
          schema: "ident.config.v1",
          ident: { version: "dev", shortCommit: "abc1234" },
        },
      }),
    );
    expect(useIdentStore.getState().config.ident).toEqual({
      version: "dev",
      shortCommit: "abc1234",
    });
    stop();
  });

  it("writes relay-supplied lineOfSight rings from the config envelope into store", () => {
    const stop = startFeed();
    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "config",
        data: {
          schema: "ident.config.v1",
          lineOfSight: {
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

  it("stores normalized range outlines from the rangeOutline channel", () => {
    const stop = startFeed();
    const rangeOutline = {
      schema: "ident.rangeOutline.v1",
      producer: { kind: "readsb", version: "3.14" },
      observedAtEpochSec: 100,
      source: "outline_json",
      scope: "last24h",
      coordinates: [
        [-122.1, 37.4],
        [-122.0, 37.5],
        [-122.2, 37.5],
      ],
    };

    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "rangeOutline",
        data: rangeOutline,
      }),
    );

    expect(
      (useIdentStore.getState() as { rangeOutline?: unknown }).rangeOutline,
    ).toEqual(rangeOutline);
    stop();
  });

  it("applies aircraft snapshots and trail points in one store update", () => {
    const stop = startFeed();
    let updates = 0;
    const unsubscribe = useIdentStore.subscribe(() => {
      updates += 1;
    });

    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "aircraft",
        data: {
          observedAtEpochSec: 100,
          aircraft: [
            {
              hex: "abc123",
              idKind: "icao",
              source: "adsb_icao",
              lat: 34.1,
              lon: -118.2,
              altBaroFt: 3000,
            },
            {
              hex: "def456",
              idKind: "icao",
              source: "adsb_icao",
              lat: 35.1,
              lon: -119.2,
              altBaroFt: 4000,
            },
          ],
        },
      }),
    );

    unsubscribe();
    expect(updates).toBe(1);
    expect(useIdentStore.getState().aircraft.size).toBe(2);
    expect(useIdentStore.getState().trailsByHex.abc123).toHaveLength(1);
    expect(useIdentStore.getState().trailsByHex.def456).toHaveLength(1);
    expect(useIdentStore.getState().liveState.lastMsgTs).toBeGreaterThan(0);
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
              { lat: 34.0, lon: -118.1, alt: 2800, ts: 90_000, segment: 0 },
              { lat: 34.2, lon: -118.3, alt: 3200, ts: 110_000, segment: 0 },
            ],
          },
        },
      }),
    );

    expect(useIdentStore.getState().trailsByHex.abc123).toEqual([
      { lat: 34.0, lon: -118.1, alt: 2800, ts: 90_000, segment: 0 },
      { lat: 34.1, lon: -118.2, alt: 3000, ts: 100_000, segment: 0 },
      { lat: 34.2, lon: -118.3, alt: 3200, ts: 110_000, segment: 0 },
    ]);
    stop();
  });

  it("keeps richer metadata when relay points duplicate local trail points", () => {
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
              {
                lat: 34.1,
                lon: -118.2,
                alt: 3000,
                ts: 100_000,
                segment: 1,
                stale: true,
                gs: 155,
                track: 270,
                source: "adsb_icao",
                alt_source: "baro",
              },
            ],
          },
        },
      }),
    );

    expect(useIdentStore.getState().trailsByHex.abc123).toEqual([
      {
        lat: 34.1,
        lon: -118.2,
        alt: 3000,
        ts: 100_000,
        segment: 1,
        stale: true,
        gs: 155,
        track: 270,
        source: "adsb_icao",
        alt_source: "baro",
      },
    ]);
    stop();
  });

  it("retains relay trail points for the current leg before selection", () => {
    const stop = startFeed();
    const points = Array.from({ length: 1600 }, (_, i) => ({
      lat: 34 + i / 10_000,
      lon: -118 - i / 10_000,
      alt: 2800 + i,
      ts: 90_000 + i * 1000,
      segment: 0,
    }));

    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "trails",
        data: {
          aircraft: {
            abc123: points,
          },
        },
      }),
    );

    useIdentStore.setState({ selectedHex: "abc123" });
    expect(useIdentStore.getState().trailsByHex.abc123).toHaveLength(1600);
    stop();
  });

  it("fetches the initial trail seed over HTTP instead of the websocket backlog", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/trails/recent.json")) {
        return {
          ok: true,
          json: async () => ({
            aircraft: {
              abc123: [
                { lat: 34.0, lon: -118.1, alt: 2800, ts: 90_000, segment: 0 },
              ],
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const stop = startFeed();

    await vi.waitFor(() => {
      expect(useIdentStore.getState().trailsByHex.abc123).toEqual([
        { lat: 34.0, lon: -118.1, alt: 2800, ts: 90_000, segment: 0 },
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
              version: 2,
              start: 180_000,
              end: 190_000,
              step_ms: 5_000,
              frames: [
                {
                  ts: 185_000,
                  aircraft: [
                    {
                      hex: "recent",
                      idKind: "icao",
                      source: "adsb_icao",
                      flight: "RECENT1",
                    },
                  ],
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

  it("refreshes the manifest when from/to shift even though blockCount stayed constant (retention rotation)", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.endsWith("/replay/manifest.json")) {
        return {
          ok: true,
          json: async () => ({
            enabled: true,
            from: 100_000,
            to: 200_000,
            block_sec: 300,
            blocks: [
              {
                start: 100_000,
                end: 200_000,
                url: "/api/replay/blocks/100000-200000.json.zst",
                bytes: 1024,
              },
            ],
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const stop = startFeed();

    await vi.waitFor(() => {
      expect(useIdentStore.getState().replay.blocks).toHaveLength(1);
    });
    const initialManifestFetches = fetchSpy.mock.calls.filter(([url]) =>
      String(url).endsWith("/replay/manifest.json"),
    ).length;

    // Retention rotation: block 100k-200k aged out, replaced by block 150k-250k.
    // blockCount unchanged (still 1) but window shifted — manifest must refetch
    // or the stored blocks[] keeps pointing at the evicted block.
    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "replay.availability",
        data: {
          schema: "ident.replay.availability.v1",
          enabled: true,
          fromEpochMs: 150_000,
          toEpochMs: 250_000,
          blockSec: 300,
          blockCount: 1,
        },
      }),
    );

    await vi.waitFor(() => {
      const manifestFetchesAfter = fetchSpy.mock.calls.filter(([url]) =>
        String(url).endsWith("/replay/manifest.json"),
      ).length;
      expect(manifestFetchesAfter).toBeGreaterThan(initialManifestFetches);
    });
    stop();
  });

  it("does not refetch the manifest when no envelope field changed", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.endsWith("/replay/manifest.json")) {
        return {
          ok: true,
          json: async () => ({
            enabled: true,
            from: 100_000,
            to: 200_000,
            block_sec: 300,
            blocks: [
              {
                start: 100_000,
                end: 200_000,
                url: "/api/replay/blocks/100000-200000.json.zst",
                bytes: 1024,
              },
            ],
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const stop = startFeed();

    await vi.waitFor(() => {
      expect(useIdentStore.getState().replay.blocks).toHaveLength(1);
    });
    const initialManifestFetches = fetchSpy.mock.calls.filter(([url]) =>
      String(url).endsWith("/replay/manifest.json"),
    ).length;

    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "replay.availability",
        data: {
          schema: "ident.replay.availability.v1",
          enabled: true,
          fromEpochMs: 100_000,
          toEpochMs: 200_000,
          blockSec: 300,
          blockCount: 1,
        },
      }),
    );

    const st = useIdentStore.getState();
    expect(st.replay.enabled).toBe(true);
    expect(st.replay.availableFrom).toBe(100_000);
    expect(st.replay.availableTo).toBe(200_000);
    expect(st.replay.blockSec).toBe(300);

    const manifestFetchesAfter = fetchSpy.mock.calls.filter(([url]) =>
      String(url).endsWith("/replay/manifest.json"),
    ).length;
    expect(manifestFetchesAfter).toBe(initialManifestFetches);
    stop();
  });

  it("refreshes the manifest when the envelope reports a new blockCount", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.endsWith("/replay/manifest.json")) {
        return {
          ok: true,
          json: async () => ({
            enabled: true,
            from: 100_000,
            to: 200_000,
            block_sec: 300,
            blocks: [
              {
                start: 100_000,
                end: 200_000,
                url: "/api/replay/blocks/100000-200000.json.zst",
                bytes: 1024,
              },
            ],
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const stop = startFeed();
    await vi.waitFor(() => {
      expect(useIdentStore.getState().replay.blocks).toHaveLength(1);
    });
    const initialManifestFetches = fetchSpy.mock.calls.filter(([url]) =>
      String(url).endsWith("/replay/manifest.json"),
    ).length;

    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "replay.availability",
        data: {
          schema: "ident.replay.availability.v1",
          enabled: true,
          fromEpochMs: 100_000,
          toEpochMs: 500_000,
          blockSec: 300,
          blockCount: 2,
        },
      }),
    );

    await vi.waitFor(() => {
      const manifestFetchesAfter = fetchSpy.mock.calls.filter(([url]) =>
        String(url).endsWith("/replay/manifest.json"),
      ).length;
      expect(manifestFetchesAfter).toBe(initialManifestFetches + 1);
    });
    stop();
  });

  it("replaces the diagnostics slice on each diagnostics envelope (snapshot replacement)", () => {
    const stop = startFeed();
    useIdentStore.setState({
      diagnostics: [
        {
          severity: "warning",
          seenAtEpochMs: 0,
          channel: "stale",
          code: "stale.code",
          message: "should be replaced",
        },
      ],
    });
    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "diagnostics",
        data: {
          schema: "ident.diagnostics.v1",
          diagnostics: [
            {
              severity: "error",
              seenAtEpochMs: 0,
              channel: "stats",
              code: "stats.adapter.malformed_file",
              message: "stats.json could not be parsed",
            },
          ],
        },
      }),
    );

    const incoming = useIdentStore.getState().diagnostics;
    expect(incoming).toHaveLength(1);
    expect(incoming[0].code).toBe("stats.adapter.malformed_file");

    // A subsequent envelope with an empty list clears the slice entirely —
    // the wire payload IS the full set, not a delta.
    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "diagnostics",
        data: { schema: "ident.diagnostics.v1", diagnostics: [] },
      }),
    );
    expect(useIdentStore.getState().diagnostics).toHaveLength(0);

    stop();
  });

  it("does not refresh feed freshness from auxiliary websocket envelopes", () => {
    const stop = startFeed();
    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "capabilities",
        data: {
          schema: "ident.capabilities.v1",
          producer: { kind: "readsb", version: "3.14" },
          capabilities: {
            aircraft: "producer_provided",
            receiverPosition: "producer_provided",
            messageRate: "producer_provided",
            gain: "producer_provided",
            uptime: "producer_provided",
            maxRange: "producer_provided",
            rangeOutline: "producer_provided",
            signalDiagnostics: "producer_provided",
            meteorology: "unavailable",
            replay: "ident_derived",
            trails: "ident_derived",
          },
        },
      }),
    );
    wsHarness.instances[0].emitText(
      JSON.stringify({
        type: "status",
        data: {
          schema: "ident.status.v1",
          producer: { kind: "readsb", version: "3.14" },
          receiverPosition: {
            kind: "producer_provided",
            source: "receiver_json",
            value: { lat: 37.4, lon: -122.1 },
          },
          messageRate: {
            kind: "producer_provided",
            source: "stats_last1min_messages_valid",
            value: { hz: 42, basisSec: 60 },
          },
        },
      }),
    );

    const state = useIdentStore.getState();
    expect(state.receiver?.lat).toBe(37.4);
    expect(state.identStatus?.messageRate?.kind).toBe("producer_provided");
    expect(state.capabilities?.capabilities.messageRate).toBe(
      "producer_provided",
    );
    expect(state.liveState.lastMsgTs).toBe(0);

    stop();
  });
});
