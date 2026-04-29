// biome-ignore-all lint/style/noNonNullAssertion: test fixture — missing elements/mocks fail the test loudly via the test runner.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetPreferencesStoreForTests,
  usePreferencesStore,
} from "./preferences";
import {
  __resetTrailDisplayCachesForTests,
  sampleMpsOnce,
  selectDisplayAircraftMap,
  selectDisplayTrailsByHex,
  trailPointFromAircraft,
  useIdentStore,
} from "./store";
import type { AircraftFrame } from "./types";

function resetStore() {
  __resetTrailDisplayCachesForTests();
  useIdentStore.setState({
    aircraft: new Map(),
    now: 0,
    altTrendsByHex: {},
    gsTrendsByHex: {},
    rssiBufByHex: {},
    selectedHex: null,
    connectionStatus: { ws: "connecting" },
    connectionStatusInfo: { ws: { isRetry: false } },
    filter: useIdentStore.getInitialState().filter,
    search: { query: "" },
    alerts: [],
    trailsByHex: {},
    liveState: { lastMsgTs: 0, mpsBuffer: [], routesViaWs: false },
    camera: {
      trackSelected: false,
      autoFitTraffic: false,
      lastUserInteraction: null,
    },
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
    stats: null,
    update: {
      enabled: true,
      status: "idle",
      current: null,
      latest: null,
      checkedAt: null,
      lastSuccessAt: null,
      error: null,
    },
    replay: useIdentStore.getInitialState().replay,
  });
}

function frame(
  hex: string,
  alt: number | "ground",
  rssi?: number,
): AircraftFrame {
  return {
    now: 0,
    aircraft: [{ hex, alt_baro: alt, ...(rssi != null ? { rssi } : {}) }],
  };
}

describe("initial connection status", () => {
  it("starts with the WebSocket transport connecting", () => {
    expect(useIdentStore.getInitialState().connectionStatus.ws).toBe(
      "connecting",
    );
  });
});

describe("replay display selectors", () => {
  beforeEach(resetStore);

  it("returns stable empty replay display collections while history is missing", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 180_000,
        mode: "replay",
        playheadMs: 180_000,
      },
    }));

    const st = useIdentStore.getState();
    expect(selectDisplayAircraftMap(st)).toBe(selectDisplayAircraftMap(st));
    expect(selectDisplayTrailsByHex(st)).toBe(selectDisplayTrailsByHex(st));
  });

  it("uses recent replay frames beyond finalized blocks", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 200_000,
        mode: "replay",
        playheadMs: 195_000,
        recent: {
          version: 1,
          start: 180_000,
          end: 200_000,
          step_ms: 5_000,
          frames: [
            { ts: 190_000, aircraft: [{ hex: "recent", flight: "RECENT1" }] },
          ],
        },
      },
    }));

    expect(
      selectDisplayAircraftMap(useIdentStore.getState()).get("recent"),
    ).toMatchObject({ flight: "RECENT1" });
  });

  it("normalizes fetched replay blocks before selecting a display frame", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 180_000,
        mode: "replay",
        playheadMs: 160_000,
      },
    }));

    useIdentStore.getState().setReplayBlock("/api/replay/blocks/a.json.zst", {
      version: 1,
      start: 120_000,
      end: 180_000,
      step_ms: 5_000,
      frames: [
        { ts: 170_000, aircraft: [{ hex: "future", flight: "FUTURE" }] },
        { ts: 130_000, aircraft: [{ hex: "past", flight: "PAST" }] },
        { ts: 160_000, aircraft: [{ hex: "now", flight: "NOW" }] },
      ],
    });

    expect([
      ...selectDisplayAircraftMap(useIdentStore.getState()).keys(),
    ]).toEqual(["now"]);
  });

  it("builds replay trails from the newest takeoff segment", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 100_000,
        availableTo: 190_000,
        mode: "replay",
        playheadMs: 190_000,
        cache: {
          "/api/replay/blocks/100000-190000.json.zst": {
            version: 1,
            start: 100_000,
            end: 190_000,
            step_ms: 5_000,
            frames: [
              {
                ts: 100_000,
                aircraft: [
                  { hex: "abc123", lat: 34.1, lon: -118.2, alt_baro: 3000 },
                ],
              },
              {
                ts: 130_000,
                aircraft: [
                  {
                    hex: "abc123",
                    lat: 34.2,
                    lon: -118.3,
                    alt_baro: "ground",
                  },
                ],
              },
              {
                ts: 190_000,
                aircraft: [
                  { hex: "abc123", lat: 34.3, lon: -118.4, alt_baro: 1500 },
                ],
              },
            ],
          },
        },
      },
    }));

    expect(selectDisplayTrailsByHex(useIdentStore.getState()).abc123).toEqual([
      {
        lat: 34.3,
        lon: -118.4,
        alt: 1500,
        ts: 190_000,
        ground: false,
        segment: 1,
        alt_source: "baro",
      },
    ]);
  });

  it("uses airground state when deriving replay trail segments", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 100_000,
        availableTo: 190_000,
        mode: "replay",
        playheadMs: 190_000,
        cache: {
          "/api/replay/blocks/100000-190000.json.zst": {
            version: 1,
            start: 100_000,
            end: 190_000,
            step_ms: 5_000,
            frames: [
              {
                ts: 100_000,
                aircraft: [
                  { hex: "abc123", lat: 34.1, lon: -118.2, alt_baro: 3000 },
                ],
              },
              {
                ts: 130_000,
                aircraft: [
                  {
                    hex: "abc123",
                    lat: 34.2,
                    lon: -118.3,
                    airground: "ground",
                    alt_geom: 25,
                  },
                ],
              },
              {
                ts: 190_000,
                aircraft: [
                  { hex: "abc123", lat: 34.3, lon: -118.4, alt_baro: 1500 },
                ],
              },
            ],
          },
        },
      },
    }));

    expect(selectDisplayTrailsByHex(useIdentStore.getState()).abc123).toEqual([
      {
        lat: 34.3,
        lon: -118.4,
        alt: 1500,
        ts: 190_000,
        ground: false,
        segment: 1,
        alt_source: "baro",
      },
    ]);
  });

  it("shows an empty replay display for a true gap between segments", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 200_000,
        mode: "replay",
        playheadMs: 180_000,
        cache: {
          "/api/replay/blocks/120000-170000.json.zst": {
            version: 1,
            start: 120_000,
            end: 170_000,
            step_ms: 5_000,
            frames: [
              { ts: 170_000, aircraft: [{ hex: "old", flight: "OLD1" }] },
            ],
          },
        },
        recent: {
          version: 1,
          start: 190_000,
          end: 200_000,
          step_ms: 5_000,
          frames: [
            { ts: 195_000, aircraft: [{ hex: "recent", flight: "RECENT1" }] },
          ],
        },
      },
    }));

    expect([
      ...selectDisplayAircraftMap(useIdentStore.getState()).keys(),
    ]).toEqual([]);
  });

  it("snaps replay playhead to the next available frame in a cached block", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 220_000,
        mode: "replay",
        playheadMs: 172_000,
        cache: {
          "/api/replay/blocks/120000-170000.json.zst": {
            version: 1,
            start: 120_000,
            end: 170_000,
            step_ms: 5_000,
            frames: [
              { ts: 170_000, aircraft: [{ hex: "old", flight: "OLD1" }] },
            ],
          },
          "/api/replay/blocks/170000-220000.json.zst": {
            version: 1,
            start: 170_000,
            end: 220_000,
            step_ms: 5_000,
            frames: [
              { ts: 175_000, aircraft: [{ hex: "next", flight: "NEXT1" }] },
            ],
          },
        },
      },
    }));

    useIdentStore.getState().setReplayPlayhead(172_000);

    expect(useIdentStore.getState().replay.playheadMs).toBe(175_000);
    expect([
      ...selectDisplayAircraftMap(useIdentStore.getState()).keys(),
    ]).toEqual(["next"]);
  });

  it("snaps replay entry to the next available frame in a cached block", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 220_000,
        mode: "live",
        playheadMs: null,
        cache: {
          "/api/replay/blocks/170000-220000.json.zst": {
            version: 1,
            start: 170_000,
            end: 220_000,
            step_ms: 5_000,
            frames: [
              { ts: 175_000, aircraft: [{ hex: "next", flight: "NEXT1" }] },
            ],
          },
        },
      },
    }));

    useIdentStore.getState().enterReplay(172_000);

    expect(useIdentStore.getState().replay.mode).toBe("replay");
    expect(useIdentStore.getState().replay.playheadMs).toBe(175_000);
  });

  it("snaps through an empty cached block to the next loaded frame", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 260_000,
        mode: "replay",
        playheadMs: 205_000,
        cache: {
          "/api/replay/blocks/200000-220000.json.zst": {
            version: 1,
            start: 200_000,
            end: 220_000,
            step_ms: 5_000,
            frames: [],
          },
          "/api/replay/blocks/220000-260000.json.zst": {
            version: 1,
            start: 220_000,
            end: 260_000,
            step_ms: 5_000,
            frames: [
              { ts: 225_000, aircraft: [{ hex: "next", flight: "NEXT1" }] },
            ],
          },
        },
      },
    }));

    useIdentStore.getState().setReplayPlayhead(205_000);

    expect(useIdentStore.getState().replay.playheadMs).toBe(225_000);
    expect([
      ...selectDisplayAircraftMap(useIdentStore.getState()).keys(),
    ]).toEqual(["next"]);
  });

  it("extends the recent replay window from live aircraft frames", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 180_000,
        mode: "live",
      },
    }));

    useIdentStore.getState().ingestAircraft({
      now: 190,
      aircraft: [{ hex: "live", flight: "LIVE1" }],
    });
    useIdentStore.getState().enterReplay(190_000);

    const st = useIdentStore.getState();
    expect(st.replay.availableTo).toBe(190_000);
    expect(selectDisplayAircraftMap(st).get("live")).toMatchObject({
      flight: "LIVE1",
    });
  });

  it("returns to live when live frames extend a replay at the live edge", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 180_000,
        mode: "replay",
        playheadMs: 180_000,
        playing: true,
      },
    }));

    useIdentStore.getState().ingestAircraft({
      now: 181,
      aircraft: [{ hex: "live", flight: "LIVE1" }],
    });

    const st = useIdentStore.getState();
    expect(st.replay.availableTo).toBe(181_000);
    expect(st.replay.mode).toBe("live");
    expect(st.replay.playheadMs).toBeNull();
    expect(st.replay.playing).toBe(true);
  });

  it("keeps loaded recent replay frames during broad replay browsing", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 0,
        availableTo: 1_000,
        blocks: [
          {
            start: 0,
            end: 1_000,
            url: "/api/replay/blocks/0-1000.json.zst",
            bytes: 10,
          },
        ],
        recent: {
          version: 1,
          start: 1_000,
          end: 1_000,
          step_ms: 1_000,
          frames: [{ ts: 1_000, aircraft: [{ hex: "kept", flight: "KEEP1" }] }],
        },
      },
    }));

    useIdentStore.getState().ingestAircraft({
      now: 7_300,
      aircraft: [{ hex: "head", flight: "HEAD1" }],
    });

    expect(
      useIdentStore.getState().replay.recent?.frames.map((frame) => frame.ts),
    ).toContain(1_000);
  });

  it("returns to live mode when replay playhead reaches the live edge", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 180_000,
        mode: "replay",
        playheadMs: 150_000,
        playing: true,
      },
    }));

    useIdentStore.getState().setReplayPlayhead(180_000);

    expect(useIdentStore.getState().replay.mode).toBe("live");
    expect(useIdentStore.getState().replay.playheadMs).toBeNull();
    expect(useIdentStore.getState().replay.playing).toBe(true);
  });

  it("goes live immediately at the current replay live edge", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 180_000,
        mode: "replay",
        playheadMs: 150_000,
        playing: true,
      },
    }));

    useIdentStore.getState().goLive();

    expect(useIdentStore.getState().replay.mode).toBe("live");
    expect(useIdentStore.getState().replay.playheadMs).toBeNull();
    expect(useIdentStore.getState().replay.playing).toBe(true);
  });

  it("pauses replay while loading and resumes afterward", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 180_000,
        mode: "replay",
        playheadMs: 150_000,
        playing: true,
      },
    }));

    useIdentStore.getState().setReplayLoading(true);

    expect(useIdentStore.getState().replay.loading).toBe(true);
    expect(useIdentStore.getState().replay.playing).toBe(false);

    useIdentStore.getState().setReplayLoading(false);

    expect(useIdentStore.getState().replay.loading).toBe(false);
    expect(useIdentStore.getState().replay.playing).toBe(true);
  });

  it("keeps fixed replay windows in replay mode while loading", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 180_000,
        mode: "replay",
        playheadMs: 180_000,
        playing: true,
        viewWindow: {
          rangeId: "custom",
          rangeMs: 60_000,
          fromExpr: "2026-04-28 00:01",
          toExpr: "2026-04-28 00:02",
          fixedEndMs: 150_000,
        },
      },
    }));

    useIdentStore.getState().setReplayLoading(true);

    expect(useIdentStore.getState().replay.mode).toBe("replay");
    expect(useIdentStore.getState().replay.loading).toBe(true);
    expect(useIdentStore.getState().replay.playing).toBe(false);
    expect(useIdentStore.getState().replay.resumeAfterLoading).toBe(true);
    expect(useIdentStore.getState().replay.viewWindow?.toExpr).toBe(
      "2026-04-28 00:02",
    );
    expect(useIdentStore.getState().replay.viewWindow?.fixedEndMs).toBe(
      150_000,
    );
  });

  it("keeps fixed replay windows during manifest refresh at the live edge", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 180_000,
        mode: "replay",
        playheadMs: 180_000,
        playing: false,
        viewWindow: {
          rangeId: "custom",
          rangeMs: 60_000,
          fromExpr: "2026-04-28 00:01",
          toExpr: "2026-04-28 00:02",
          fixedEndMs: 150_000,
        },
      },
    }));

    useIdentStore.getState().setReplayManifest({
      enabled: true,
      from: 120_000,
      to: 240_000,
      block_sec: 60,
      blocks: [],
    });

    expect(useIdentStore.getState().replay.mode).toBe("replay");
    expect(useIdentStore.getState().replay.playheadMs).toBe(180_000);
    expect(useIdentStore.getState().replay.viewWindow?.fixedEndMs).toBe(
      150_000,
    );
  });

  it("keeps fixed replay windows during playing manifest refresh at the live edge", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 180_000,
        mode: "replay",
        playheadMs: 180_000,
        playing: true,
        viewWindow: {
          rangeId: "custom",
          rangeMs: 60_000,
          fromExpr: "2026-04-28 00:01",
          toExpr: "2026-04-28 00:02",
          fixedEndMs: 150_000,
        },
      },
    }));

    useIdentStore.getState().setReplayManifest({
      enabled: true,
      from: 120_000,
      to: 240_000,
      block_sec: 60,
      blocks: [],
    });

    expect(useIdentStore.getState().replay.mode).toBe("replay");
    expect(useIdentStore.getState().replay.playheadMs).toBe(180_000);
    expect(useIdentStore.getState().replay.playing).toBe(true);
    expect(useIdentStore.getState().replay.viewWindow?.fixedEndMs).toBe(
      150_000,
    );
  });

  it("clears resolved wall-clock range ends when returning live", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        viewWindow: {
          rangeId: "custom",
          rangeMs: 60_000,
          fromExpr: "now-1m",
          toExpr: "now",
          fixedEndMs: null,
          requestedEndMs: 180_000,
        },
      },
    }));

    useIdentStore.getState().goLive();

    expect(useIdentStore.getState().replay.viewWindow?.toExpr).toBe("now");
    expect(useIdentStore.getState().replay.viewWindow?.fixedEndMs).toBeNull();
    expect(
      useIdentStore.getState().replay.viewWindow?.requestedEndMs,
    ).toBeNull();
  });

  it.each([
    { fixedEndMs: null, requestedEndMs: Number.POSITIVE_INFINITY },
    { fixedEndMs: null, requestedEndMs: Number.NaN },
    { fixedEndMs: null, requestedEndMs: -1 },
    { fixedEndMs: null, requestedEndMs: 30_000 },
    { fixedEndMs: Number.NEGATIVE_INFINITY, requestedEndMs: null },
  ])("strips invalid resolved replay window bounds at the store boundary %#", ({
    fixedEndMs,
    requestedEndMs,
  }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    useIdentStore.getState().setReplayViewWindow({
      rangeId: "custom",
      rangeMs: 60_000,
      fromExpr: "now-1m",
      toExpr: "now",
      fixedEndMs,
      requestedEndMs,
    });

    expect(warn).toHaveBeenCalledWith(
      "[ident replay] invalid replay view window",
      expect.objectContaining({
        fixedEndMs,
        rangeMs: 60_000,
        requestedEndMs,
      }),
    );
    expect(useIdentStore.getState().replay.viewWindow?.fixedEndMs).toBeNull();
    expect(
      useIdentStore.getState().replay.viewWindow?.requestedEndMs,
    ).toBeNull();
    warn.mockRestore();
  });

  it("keeps fixed replay windows when the store playhead is moved past global availability", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 180_000,
        mode: "replay",
        playheadMs: 130_000,
        playing: false,
        viewWindow: {
          rangeId: "custom",
          rangeMs: 40_000,
          fromExpr: "2026-04-28 00:02",
          toExpr: "2026-04-28 00:03",
          fixedEndMs: 160_000,
        },
      },
    }));

    useIdentStore.getState().setReplayPlayhead(181_000);

    expect(useIdentStore.getState().replay.mode).toBe("replay");
    expect(useIdentStore.getState().replay.playheadMs).toBe(160_000);
    expect(useIdentStore.getState().replay.viewWindow?.fixedEndMs).toBe(
      160_000,
    );
  });

  it("clamps replay playhead when manifest availability shrinks below it", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 240_000,
        mode: "replay",
        playheadMs: 220_000,
        playing: false,
      },
    }));

    useIdentStore.getState().setReplayManifest({
      enabled: true,
      from: 120_000,
      to: 180_000,
      block_sec: 60,
      blocks: [],
    });

    expect(useIdentStore.getState().replay.mode).toBe("replay");
    expect(useIdentStore.getState().replay.playheadMs).toBe(180_000);
  });

  it("keeps replay loading state when entering another replay time while waiting to resume", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 180_000,
        mode: "replay",
        playheadMs: 130_000,
        playing: false,
        loading: true,
        resumeAfterLoading: true,
      },
    }));

    useIdentStore.getState().enterReplay(150_000);

    expect(useIdentStore.getState().replay.mode).toBe("replay");
    expect(useIdentStore.getState().replay.playheadMs).toBe(150_000);
    expect(useIdentStore.getState().replay.loading).toBe(true);
    expect(useIdentStore.getState().replay.resumeAfterLoading).toBe(true);
    expect(useIdentStore.getState().replay.playing).toBe(false);
  });

  it("does not clear a URL-less replay error when a block loads", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        error: "Replay request failed: 404",
        errorUrl: null,
      },
    }));

    useIdentStore.getState().setReplayBlock("/api/replay/blocks/a.json.zst", {
      version: 1,
      start: 120_000,
      end: 180_000,
      step_ms: 5_000,
      frames: [],
    });

    expect(useIdentStore.getState().replay.error).toBe(
      "Replay request failed: 404",
    );
    expect(useIdentStore.getState().replay.errorUrl).toBeNull();
  });

  it("does not clear an existing replay error when only the message text matches", () => {
    const loadedUrl = "/api/replay/blocks/a.json.zst";
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        error: `Replay block load failed: ${loadedUrl}: Failed to fetch`,
        errorUrl: "/api/replay/blocks/b.json.zst",
      },
    }));

    useIdentStore.getState().setReplayBlock(loadedUrl, {
      version: 1,
      start: 120_000,
      end: 180_000,
      step_ms: 5_000,
      frames: [],
    });

    expect(useIdentStore.getState().replay.error).toContain(loadedUrl);
    expect(useIdentStore.getState().replay.errorUrl).toBe(
      "/api/replay/blocks/b.json.zst",
    );
  });

  it("clears an existing replay error when the matching block loads", () => {
    const url = "/api/replay/blocks/a.json.zst";
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        error: `Replay block load failed: ${url}: Failed to fetch`,
        errorUrl: url,
      },
    }));

    useIdentStore.getState().setReplayBlock(url, {
      version: 1,
      start: 120_000,
      end: 180_000,
      step_ms: 5_000,
      frames: [],
    });

    expect(useIdentStore.getState().replay.error).toBeNull();
    expect(useIdentStore.getState().replay.errorUrl).toBeNull();
  });

  it("does not clear a matching replay error when all input frames are dropped", () => {
    const url = "/api/replay/blocks/a.json.zst";
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        error: `Replay block load failed: ${url}: Failed to fetch`,
        errorUrl: url,
      },
    }));

    useIdentStore.getState().setReplayBlock(url, {
      version: 1,
      start: 120_000,
      end: 180_000,
      step_ms: 5_000,
      frames: [{ ts: "bad", aircraft: [] }] as never,
    });

    expect(useIdentStore.getState().replay.cache[url]?.frames).toEqual([]);
    expect(useIdentStore.getState().replay.error).toContain(url);
    expect(useIdentStore.getState().replay.errorUrl).toBe(url);
  });

  it("does not clear a URL-tagged replay error when live replay recent arrives", () => {
    const url = "/api/replay/blocks/a.json.zst";
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        error: `Replay block load failed: ${url}: Failed to fetch`,
        errorUrl: url,
      },
    }));

    useIdentStore.getState().setReplayRecent({
      version: 1,
      start: 180_000,
      end: 180_000,
      step_ms: 1_000,
      frames: [{ ts: 180_000, aircraft: [] }],
    });

    expect(useIdentStore.getState().replay.error).toContain(url);
    expect(useIdentStore.getState().replay.errorUrl).toBe(url);
  });

  it("keeps playback active when pause is requested at the live edge", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 180_000,
        mode: "replay",
        playheadMs: 180_000,
        playing: true,
      },
    }));

    useIdentStore.getState().setReplayPlaying(false);

    expect(useIdentStore.getState().replay.playing).toBe(true);
  });

  it("clears pending replay resume when a replay error is set", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 180_000,
        mode: "replay",
        playheadMs: 150_000,
        loading: true,
        resumeAfterLoading: true,
      },
    }));

    useIdentStore.getState().setReplayError("Replay block missing");

    expect(useIdentStore.getState().replay.loading).toBe(false);
    expect(useIdentStore.getState().replay.resumeAfterLoading).toBe(false);
  });

  it("enters live mode when replay entry snaps to the live edge", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 180_000,
        mode: "live",
        playheadMs: null,
      },
    }));

    useIdentStore.getState().enterReplay(180_000);

    expect(useIdentStore.getState().replay.mode).toBe("live");
    expect(useIdentStore.getState().replay.playheadMs).toBeNull();
    expect(useIdentStore.getState().replay.playing).toBe(true);
  });

  it("clamps replay playhead below available history", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 180_000,
        mode: "replay",
        playheadMs: 150_000,
      },
    }));

    useIdentStore.getState().setReplayPlayhead(1);

    expect(useIdentStore.getState().replay.playheadMs).toBe(120_000);
  });

  it("does not resume replay after loading when it was already paused", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        enabled: true,
        availableFrom: 120_000,
        availableTo: 180_000,
        mode: "replay",
        playheadMs: 150_000,
        playing: false,
      },
    }));

    useIdentStore.getState().setReplayLoading(true);
    useIdentStore.getState().setReplayLoading(false);

    expect(useIdentStore.getState().replay.playing).toBe(false);
  });

  it("persists replay windows that end at now and restores them on store init", async () => {
    resetPreferencesStoreForTests();
    const viewWindow = {
      rangeId: "custom",
      rangeMs: 6 * 60 * 60_000,
      fromExpr: "now-6h",
      toExpr: "now",
      fixedEndMs: null,
      requestedEndMs: 48 * 60 * 60_000,
    };
    const persistedWindow = {
      rangeId: viewWindow.rangeId,
      rangeMs: viewWindow.rangeMs,
      fromExpr: viewWindow.fromExpr,
      toExpr: viewWindow.toExpr,
      fixedEndMs: viewWindow.fixedEndMs,
    };

    useIdentStore.getState().setReplayViewWindow(viewWindow);

    expect(
      (
        usePreferencesStore.getState() as unknown as {
          replayWindow?: typeof persistedWindow;
        }
      ).replayWindow,
    ).toEqual(persistedWindow);

    vi.resetModules();
    const fresh = await import("./store");
    expect(fresh.useIdentStore.getState().replay.viewWindow).toEqual(
      persistedWindow,
    );
  });

  it("does not persist replay windows with a fixed end time", () => {
    resetPreferencesStoreForTests();
    const saved = {
      rangeId: "1h",
      rangeMs: 60 * 60_000,
      fromExpr: "now-1h",
      toExpr: "now",
      fixedEndMs: null,
    };
    useIdentStore.getState().setReplayViewWindow(saved);

    useIdentStore.getState().setReplayViewWindow({
      rangeId: "custom",
      rangeMs: 12 * 60 * 60_000,
      fromExpr: "now-24h",
      toExpr: "now-12h",
      fixedEndMs: 36 * 60 * 60_000,
    });

    expect(
      (
        usePreferencesStore.getState() as unknown as {
          replayWindow?: typeof saved;
        }
      ).replayWindow,
    ).toEqual(saved);
  });
});

describe("ingestAircraft rolling buffers", () => {
  beforeEach(resetStore);

  it("appends alt_baro samples to altTrendsByHex and trims to 60", () => {
    const store = useIdentStore.getState();
    for (let i = 0; i < 70; i++)
      store.ingestAircraft(frame("abc123", 10000 + i));
    const buf = useIdentStore.getState().altTrendsByHex.abc123;
    expect(buf).toBeDefined();
    expect(buf.length).toBe(60);
    expect(buf[0]).toBe(10010);
    expect(buf[59]).toBe(10069);
  });

  it("skips alt_baro === 'ground' samples", () => {
    const store = useIdentStore.getState();
    store.ingestAircraft(frame("abc123", "ground"));
    expect(useIdentStore.getState().altTrendsByHex.abc123).toBeUndefined();
  });

  it("appends rssi samples to rssiBufByHex", () => {
    const store = useIdentStore.getState();
    store.ingestAircraft(frame("abc123", 10000, -12.3));
    store.ingestAircraft(frame("abc123", 10000, -11.1));
    expect(useIdentStore.getState().rssiBufByHex.abc123).toEqual([
      -12.3, -11.1,
    ]);
  });

  it("preserves selected aircraft when it disappears from the latest frame", () => {
    useIdentStore.setState({
      aircraft: new Map([
        ["abc123", { hex: "abc123", alt_baro: 12000, lat: 1, lon: 2, seen: 1 }],
      ]),
      now: 10,
      selectedHex: "abc123",
      camera: {
        ...useIdentStore.getState().camera,
        trackSelected: true,
      },
    });
    useIdentStore.getState().ingestAircraft({
      now: 16,
      aircraft: [{ hex: "def456", alt_baro: 10000 }],
    });

    const state = useIdentStore.getState();
    expect(state.selectedHex).toBe("abc123");
    expect(state.camera.trackSelected).toBe(true);
    expect(state.aircraft.get("abc123")).toMatchObject({
      hex: "abc123",
      lat: 1,
      lon: 2,
      seen: 7,
    });
    expect(state.aircraft.get("abc123")?.seen_pos).toBeUndefined();
  });

  it("preserves selectedHex when the selected aircraft is still present", () => {
    useIdentStore.setState({ selectedHex: "abc123" });
    useIdentStore.getState().ingestAircraft(frame("abc123", 10000));
    expect(useIdentStore.getState().selectedHex).toBe("abc123");
  });
});

describe("recordAircraftSample", () => {
  beforeEach(resetStore);

  it("appends to both buffers when values are numeric", () => {
    useIdentStore.getState().recordAircraftSample("abc123", {
      hex: "abc123",
      alt_baro: 12000,
      rssi: -9,
    });
    const st = useIdentStore.getState();
    expect(st.altTrendsByHex.abc123).toEqual([12000]);
    expect(st.rssiBufByHex.abc123).toEqual([-9]);
  });
});

describe("pushAlert", () => {
  beforeEach(resetStore);

  it("prepends and caps at 50 entries", () => {
    const store = useIdentStore.getState();
    for (let i = 0; i < 60; i++) {
      store.pushAlert({
        id: String(i),
        ts: 1_000_000 + i,
        kind: "weak-signal",
        title: `t${i}`,
      });
    }
    const alerts = useIdentStore.getState().alerts;
    expect(alerts.length).toBe(50);
    // Most recent first.
    expect(alerts[0].id).toBe("59");
  });

  it("drops entries older than the 30-minute window", () => {
    const store = useIdentStore.getState();
    const now = 10_000_000;
    store.pushAlert({
      id: "old",
      ts: now - 31 * 60_000,
      kind: "weak-signal",
      title: "old",
    });
    store.pushAlert({ id: "new", ts: now, kind: "weak-signal", title: "new" });
    const alerts = useIdentStore.getState().alerts;
    expect(alerts.map((a) => a.id)).toEqual(["new"]);
  });
});

describe("filter setters", () => {
  beforeEach(() => {
    useIdentStore.setState({
      filter: {
        categories: {
          airline: false,
          ga: false,
          bizjet: false,
          mil: false,
          rotor: false,
          unknown: false,
        },
        altRangeFt: [0, 45000],
        emergOnly: false,
        hideGround: false,
        hasPosOnly: false,
        operatorContains: "",
        callsignPrefix: "",
        routeContains: "",
        countryContains: "",
        hexContains: "",
        regPrefix: "",
        squawkEquals: "",
        typePrefix: "",
        sourceEquals: "",
        gsRangeKt: null,
        distRangeNm: null,
        vsRangeFpm: null,
        hdgCenter: null,
        hdgTolerance: null,
        militaryOnly: false,
        inViewOnly: false,
        expressionBranches: null,
      },
    });
  });

  it("toggleFilterCategory flips a single key", () => {
    useIdentStore.getState().toggleFilterCategory("airline");
    expect(useIdentStore.getState().filter.categories.airline).toBe(true);
    useIdentStore.getState().toggleFilterCategory("airline");
    expect(useIdentStore.getState().filter.categories.airline).toBe(false);
  });

  it("setFilterAltRange replaces the range tuple", () => {
    useIdentStore.getState().setFilterAltRange([5000, 30000]);
    expect(useIdentStore.getState().filter.altRangeFt).toEqual([5000, 30000]);
  });
});

describe("map setters", () => {
  beforeEach(() => {
    useIdentStore.setState((st) => ({
      map: {
        ...st.map,
        center: null,
        zoom: null,
        viewportHexes: null,
      },
    }));
  });

  it("toggleLayer flips a single layer key", () => {
    const start = useIdentStore.getState().map.layers.rangeRings;
    useIdentStore.getState().toggleLayer("rangeRings");
    expect(useIdentStore.getState().map.layers.rangeRings).toBe(!start);
  });

  it("setLabelMode updates in place", () => {
    useIdentStore.getState().setLabelMode("icon");
    expect(useIdentStore.getState().map.labelMode).toBe("icon");
  });

  it("toggleLayer handles losRings", () => {
    expect(useIdentStore.getState().map.layers.losRings).toBe(false);
    useIdentStore.getState().toggleLayer("losRings");
    expect(useIdentStore.getState().map.layers.losRings).toBe(true);
  });

  it("toggleLayer persists through preferences and a fresh store init restores it", async () => {
    resetPreferencesStoreForTests();
    const before = useIdentStore.getState().map.layers.rangeRings;
    useIdentStore.getState().toggleLayer("rangeRings");
    expect(usePreferencesStore.getState().map.layers.rangeRings).toBe(!before);

    vi.resetModules();
    const fresh = await import("./store");
    expect(fresh.useIdentStore.getState().map.layers.rangeRings).toBe(!before);
  });

  it("setMapViewportHexes is a no-op when the visible hex set is unchanged", () => {
    useIdentStore.getState().setMapViewportHexes(new Set(["abc123", "def456"]));
    const prevMap = useIdentStore.getState().map;

    useIdentStore.getState().setMapViewportHexes(new Set(["def456", "abc123"]));

    expect(useIdentStore.getState().map).toBe(prevMap);
    expect(useIdentStore.getState().map.viewportHexes).toBe(
      prevMap.viewportHexes,
    );
  });

  it("setMapView ignores equivalent camera jitter and skips persisting it", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    useIdentStore
      .getState()
      .setMapView({ center: { lng: -122.4, lat: 37.7 }, zoom: 8.25 });
    const prevMap = useIdentStore.getState().map;
    const persistedWrites = setItemSpy.mock.calls.length;

    useIdentStore.getState().setMapView({
      center: { lng: -122.3999997, lat: 37.7000002 },
      zoom: 8.2504,
    });

    expect(useIdentStore.getState().map).toBe(prevMap);
    expect(setItemSpy).toHaveBeenCalledTimes(persistedWrites);
    setItemSpy.mockRestore();
  });
});

describe("camera slice", () => {
  beforeEach(resetStore);

  it("selecting aircraft enables selected tracking and clearing selection disables it", () => {
    const store = useIdentStore.getState();

    store.select("abc123");
    expect(useIdentStore.getState().selectedHex).toBe("abc123");
    expect(useIdentStore.getState().camera.trackSelected).toBe(true);

    store.select(null);
    expect(useIdentStore.getState().selectedHex).toBeNull();
    expect(useIdentStore.getState().camera.trackSelected).toBe(false);
  });

  it("records map interactions as an ADT and only pan disables selected tracking", () => {
    useIdentStore.getState().select("abc123");

    useIdentStore.getState().recordMapInteraction({ kind: "zoom", at: 1_000 });
    expect(useIdentStore.getState().camera).toMatchObject({
      trackSelected: true,
      lastUserInteraction: { kind: "zoom", at: 1_000 },
    });

    useIdentStore.getState().recordMapInteraction({ kind: "pan", at: 2_000 });
    expect(useIdentStore.getState().camera).toMatchObject({
      trackSelected: false,
      lastUserInteraction: { kind: "pan", at: 2_000 },
    });
  });

  it("toggles auto-fit traffic independently from selected tracking", () => {
    useIdentStore.getState().select("abc123");
    useIdentStore.getState().setAutoFitTraffic(true);

    expect(useIdentStore.getState().camera).toMatchObject({
      trackSelected: true,
      autoFitTraffic: true,
    });
  });
});

describe("recordTrailPoint", () => {
  beforeEach(resetStore);

  it("retains points across a wide age range, capping at 1500 with the oldest dropped", () => {
    const store = useIdentStore.getState();
    const base = 2_000_000;
    // Span ~2 h of 4 s cadence: 1800 points, across which age-based trimming
    // used to drop the olds. The new buffer keeps them, bounded only by the
    // 1500-point cap.
    for (let i = 0; i < 2000; i++) {
      store.recordTrailPoint("abc123", {
        lat: 0,
        lon: 0,
        alt: null,
        ts: base + i * 4000,
        ground: true,
      });
    }
    const buf = useIdentStore.getState().trailsByHex.abc123;
    expect(buf.length).toBe(1500);
    // Oldest kept point is i=500 because we rolled 500 off the front.
    expect(buf[0].ts).toBe(base + 500 * 4000);
    expect(buf[1499].ts).toBe(base + 1999 * 4000);
  });

  it("assigns live trail segments from ground dwell boundaries", () => {
    const store = useIdentStore.getState();

    store.recordTrailPoint("abc123", {
      lat: 34.1,
      lon: -118.2,
      alt: 3000,
      ts: 100_000,
      ground: false,
    });
    store.recordTrailPoint("abc123", {
      lat: 34.2,
      lon: -118.3,
      alt: null,
      ts: 130_000,
      ground: true,
    });
    store.recordTrailPoint("abc123", {
      lat: 34.25,
      lon: -118.35,
      alt: 500,
      ts: 189_999,
      ground: false,
    });
    store.recordTrailPoint("def456", {
      lat: 35.1,
      lon: -119.2,
      alt: 3000,
      ts: 100_000,
      ground: false,
    });
    store.recordTrailPoint("def456", {
      lat: 35.2,
      lon: -119.3,
      alt: null,
      ts: 130_000,
      ground: true,
    });
    store.recordTrailPoint("def456", {
      lat: 35.3,
      lon: -119.4,
      alt: 1500,
      ts: 190_000,
      ground: false,
    });

    expect(useIdentStore.getState().trailsByHex.abc123.at(-1)?.segment).toBe(0);
    expect(useIdentStore.getState().trailsByHex.def456.at(-1)?.segment).toBe(1);
  });

  it("keeps live trail dwell across repeated airborne blips", () => {
    const store = useIdentStore.getState();

    store.recordTrailPoint("abc123", {
      lat: 34.1,
      lon: -118.2,
      alt: 3000,
      ts: 100_000,
      ground: false,
    });
    store.recordTrailPoint("abc123", {
      lat: 34.2,
      lon: -118.3,
      alt: null,
      ts: 130_000,
      ground: true,
    });
    store.recordTrailPoint("abc123", {
      lat: 34.21,
      lon: -118.31,
      alt: 25,
      ts: 150_000,
      ground: false,
    });
    store.recordTrailPoint("abc123", {
      lat: 34.22,
      lon: -118.32,
      alt: 30,
      ts: 155_000,
      ground: false,
    });
    store.recordTrailPoint("abc123", {
      lat: 34.3,
      lon: -118.4,
      alt: 1500,
      ts: 195_000,
      ground: false,
    });

    expect(useIdentStore.getState().trailsByHex.abc123.at(-1)?.segment).toBe(1);
  });

  it("setTrailFadeSec clamps to 10..600", () => {
    const store = useIdentStore.getState();
    store.setTrailFadeSec(5);
    expect(useIdentStore.getState().settings.trailFadeSec).toBe(10);
    store.setTrailFadeSec(9999);
    expect(useIdentStore.getState().settings.trailFadeSec).toBe(600);
  });
});

describe("selectDisplayTrailsByHex", () => {
  beforeEach(resetStore);

  it("shows only the newest segment by default", () => {
    useIdentStore.setState((st) => ({
      trailsByHex: {
        ...st.trailsByHex,
        abc123: [
          { lat: 1, lon: 1, alt: 1000, ts: 1_000, segment: 0 },
          { lat: 2, lon: 2, alt: null, ground: true, ts: 2_000, segment: 0 },
          { lat: 3, lon: 3, alt: 1500, ts: 3_000, segment: 1 },
        ],
      },
    }));

    expect(selectDisplayTrailsByHex(useIdentStore.getState()).abc123).toEqual([
      { lat: 3, lon: 3, alt: 1500, ts: 3_000, segment: 1 },
    ]);
  });
});

describe("settings slice", () => {
  beforeEach(resetStore);

  it("defaults the unit system to aviation", async () => {
    resetPreferencesStoreForTests();
    vi.resetModules();

    const fresh = await import("./store");

    expect(fresh.useIdentStore.getState().settings.unitMode).toBe("aviation");
    expect(fresh.useIdentStore.getState().settings.unitOverrides).toEqual({
      altitude: "ft",
      horizontalSpeed: "kt",
      distance: "nm",
      verticalSpeed: "fpm",
      temperature: "C",
    });
  });

  it("stores custom unit selections without losing the chosen mode", () => {
    useIdentStore.getState().setSettings({
      unitMode: "custom",
      unitOverrides: {
        altitude: "ft",
        horizontalSpeed: "kt",
        distance: "nm",
        verticalSpeed: "fpm",
        temperature: "F",
      },
    });
    const settings = useIdentStore.getState().settings;
    expect(settings.unitMode).toBe("custom");
    expect(settings.unitOverrides.temperature).toBe("F");
    expect(settings.unitOverrides.distance).toBe("nm");
  });
});

describe("update dismissal persistence", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetPreferencesStoreForTests();
  });

  it("stores release dismissal and restores it on fresh preferences init", async () => {
    resetPreferencesStoreForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    usePreferencesStore.getState().dismissReleaseUpdate(" v1.1.0 ");

    expect(usePreferencesStore.getState().updateDismissal).toEqual({
      version: "v1.1.0",
      dismissedUntil: Date.parse("2026-01-08T00:00:00Z"),
    });

    vi.resetModules();
    const fresh = await import("./preferences");
    expect(fresh.usePreferencesStore.getState().updateDismissal).toEqual({
      version: "v1.1.0",
      dismissedUntil: Date.parse("2026-01-08T00:00:00Z"),
    });
  });

  it("drops expired release dismissal on fresh preferences init", async () => {
    resetPreferencesStoreForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    usePreferencesStore.getState().dismissReleaseUpdate("v1.1.0");
    vi.setSystemTime(new Date("2026-01-08T00:00:01Z"));

    vi.resetModules();
    const fresh = await import("./preferences");

    expect(fresh.usePreferencesStore.getState().updateDismissal).toBeNull();
  });
});

describe("trailPointFromAircraft", () => {
  it("stores upstream ground altitude as null plus ground state", () => {
    expect(
      trailPointFromAircraft(
        { hex: "abc123", lat: 34.1, lon: -118.2, alt_baro: "ground" },
        100_000,
      ),
    ).toMatchObject({
      lat: 34.1,
      lon: -118.2,
      alt: null,
      ts: 100_000,
      ground: true,
    });
  });
});

describe("liveState msg-rate buffer", () => {
  beforeEach(resetStore);

  it("trims mpsBuffer to 60 samples", () => {
    useIdentStore.setState({
      stats: { now: 0, last1min: { messages_valid: 600 } },
    });
    for (let i = 0; i < 75; i++) sampleMpsOnce();
    const buf = useIdentStore.getState().liveState.mpsBuffer;
    expect(buf.length).toBe(60);
    // 600 msgs / 60 s = 10 msg/s in every slot.
    expect(buf.every((v) => v === 10)).toBe(true);
  });

  it("falls back to 0 when stats are missing", () => {
    sampleMpsOnce();
    expect(useIdentStore.getState().liveState.mpsBuffer).toEqual([0]);
  });
});

describe("labels slice setters", () => {
  beforeEach(() => {
    useIdentStore.setState({
      labels: {
        hoveredHex: null,
      },
    });
  });

  it("setHoveredHex round-trips", () => {
    useIdentStore.getState().setHoveredHex("abc123");
    expect(useIdentStore.getState().labels.hoveredHex).toBe("abc123");
    useIdentStore.getState().setHoveredHex(null);
    expect(useIdentStore.getState().labels.hoveredHex).toBeNull();
  });
});

describe("search slice setter", () => {
  beforeEach(() => {
    useIdentStore.setState({
      filter: useIdentStore.getInitialState().filter,
      search: { query: "" },
    });
  });

  it("setSearchQuery round-trips an empty string and a non-empty string", () => {
    useIdentStore.getState().setSearchQuery("UAL123");
    expect(useIdentStore.getState().search.query).toBe("UAL123");
    useIdentStore.getState().setSearchQuery("");
    expect(useIdentStore.getState().search.query).toBe("");
  });

  it("derives filter state from structured query text", () => {
    useIdentStore
      .getState()
      .setSearchQuery("op:United alt:>30000 !ground cat:a2");
    const st = useIdentStore.getState();
    expect(st.search.query).toBe("op:United alt:>30000 !ground cat:a2");
    expect(st.filter.operatorContains).toBe("United");
    expect(st.filter.altRangeFt).toEqual([30000, 45000]);
    expect(st.filter.hideGround).toBe(true);
    expect(st.filter.categories.airline).toBe(true);
  });

  it("plain search text clears structured filter derivation", () => {
    const store = useIdentStore.getState();
    store.setSearchQuery("op:United alt:>30000");
    expect(useIdentStore.getState().filter.operatorContains).toBe("United");

    useIdentStore.getState().setSearchQuery("UAL123");
    const st = useIdentStore.getState();
    expect(st.search.query).toBe("UAL123");
    expect(st.filter.operatorContains).toBe("");
    expect(st.filter.altRangeFt).toEqual([0, 45000]);
  });

  it("derives expression branches from grouped OR query text", () => {
    useIdentStore.getState().setSearchQuery("cs:FDX | (cs:UPS alt:>5000)");
    const st = useIdentStore.getState();
    expect(st.search.query).toBe("cs:FDX | (cs:UPS alt:>5000)");
    expect(st.filter.expressionBranches).toHaveLength(2);
    expect(st.filter.expressionBranches?.[0].callsignPrefix).toBe("FDX");
    expect(st.filter.expressionBranches?.[1].callsignPrefix).toBe("UPS");
    expect(st.filter.expressionBranches?.[1].altRangeFt).toEqual([5000, 45000]);
  });

  it("resetFilter clears both derived filter and query text", () => {
    useIdentStore.getState().setSearchQuery("op:United");
    useIdentStore.getState().resetFilter();
    const st = useIdentStore.getState();
    expect(st.search.query).toBe("");
    expect(st.filter.operatorContains).toBe("");
  });
});

describe("recordSnapshot / setLosData", () => {
  beforeEach(resetStore);

  it("recordSnapshot updates lastMsgTs to a current timestamp", () => {
    const before = useIdentStore.getState().liveState.lastMsgTs;
    useIdentStore.getState().recordSnapshot();
    const after = useIdentStore.getState().liveState.lastMsgTs;
    expect(after).toBeGreaterThan(before);
  });

  it("setLosData stores and clears the payload", () => {
    const data = {
      rings: [{ alt: 3048, points: [[37, -122] as [number, number]] }],
    };
    useIdentStore.getState().setLosData(data);
    expect(useIdentStore.getState().losData).toEqual(data);
    useIdentStore.getState().setLosData(null);
    expect(useIdentStore.getState().losData).toBeNull();
  });
});
