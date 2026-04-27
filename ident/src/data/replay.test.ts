import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureReplayRange, refreshReplayManifest } from "./replay";
import {
  selectDisplayAircraftMap,
  selectDisplayTrailsByHex,
  useIdentStore,
} from "./store";

const originalFetch = globalThis.fetch;

function resetStore() {
  useIdentStore.setState({
    aircraft: new Map([["live", { hex: "live", flight: "LIVE1" }]]),
    now: 0,
    replay: {
      enabled: false,
      availableFrom: null,
      availableTo: null,
      blockSec: 300,
      blocks: [],
      cache: {},
      mode: "live",
      playheadMs: null,
      playing: false,
      speed: 1,
      lastInteractionAt: null,
      loading: false,
      error: null,
    },
    trailsByHex: {},
  });
}

describe("replay data loading", () => {
  beforeEach(() => {
    resetStore();
    window.history.replaceState(null, "", "/ident/#/");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("loads the manifest from the mounted app path", async () => {
    globalThis.fetch = vi.fn(async () => responseJson(manifest())) as never;

    await refreshReplayManifest();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/ident/api/replay/manifest.json",
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(useIdentStore.getState().replay.enabled).toBe(true);
    expect(useIdentStore.getState().replay.blocks).toHaveLength(1);
  });

  it("deduplicates concurrent manifest refreshes", async () => {
    let resolveManifest: ((value: Response) => void) | null = null;
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveManifest = resolve;
        }),
    ) as never;

    const first = refreshReplayManifest();
    const second = refreshReplayManifest();
    const resolve = resolveManifest as ((value: Response) => void) | null;
    if (!resolve) throw new Error("manifest request was not started");
    resolve(responseJson(manifest()));
    await Promise.all([first, second]);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("fetches needed blocks and drives display selectors in replay mode", async () => {
    const block = replayBlock();
    globalThis.fetch = vi.fn(async (url: string) =>
      url.includes("manifest") ? responseJson(manifest()) : responseJson(block),
    ) as never;

    await refreshReplayManifest();
    useIdentStore.getState().enterReplay(170_000);
    await ensureReplayRange(120_000, 180_000);

    const st = useIdentStore.getState();
    expect(st.replay.cache["/api/replay/blocks/120000-180000.json.zst"]).toBe(
      block,
    );
    expect(selectDisplayAircraftMap(st).get("abc123")?.flight).toBe("UAL123");
    expect(selectDisplayTrailsByHex(st).abc123).toHaveLength(2);
  });

  it("does not request blocks that are already loaded", async () => {
    const block = replayBlock();
    globalThis.fetch = vi.fn(async (url: string) =>
      url.includes("manifest") ? responseJson(manifest()) : responseJson(block),
    ) as never;

    await refreshReplayManifest();
    await ensureReplayRange(120_000, 180_000);
    await ensureReplayRange(120_000, 180_000);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("deduplicates overlapping requests for the same block", async () => {
    const block = replayBlock();
    let resolveBlock: ((value: Response) => void) | null = null;
    globalThis.fetch = vi.fn((url: string) => {
      if (url.includes("manifest"))
        return Promise.resolve(responseJson(manifest()));
      return new Promise<Response>((resolve) => {
        resolveBlock = resolve;
      });
    }) as never;

    await refreshReplayManifest();
    const first = ensureReplayRange(120_000, 180_000);
    const second = ensureReplayRange(120_000, 180_000);
    const resolve = resolveBlock as ((value: Response) => void) | null;
    if (!resolve) throw new Error("block request was not started");
    resolve(responseJson(block));
    await Promise.all([first, second]);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("deduplicates overlapping range requests before issuing block loads", async () => {
    const block = replayBlock();
    let resolveBlock: ((value: Response) => void) | null = null;
    globalThis.fetch = vi.fn((url: string) => {
      if (url.includes("manifest"))
        return Promise.resolve(responseJson(manifest()));
      return new Promise<Response>((resolve) => {
        resolveBlock = resolve;
      });
    }) as never;

    await refreshReplayManifest();
    const first = ensureReplayRange(120_000, 180_000);
    const second = ensureReplayRange(121_000, 179_000);
    const resolve = resolveBlock as ((value: Response) => void) | null;
    if (!resolve) throw new Error("block request was not started");
    resolve(responseJson(block));
    await Promise.all([first, second]);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not substitute live aircraft while replay history is unavailable", () => {
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

    expect([
      ...selectDisplayAircraftMap(useIdentStore.getState()).keys(),
    ]).toEqual([]);
  });

  it("refreshes the manifest and surfaces an error when a block was pruned", async () => {
    globalThis.fetch = vi.fn(async (url: string) =>
      url.includes("manifest")
        ? responseJson(manifest())
        : ({ ok: false, status: 404, json: async () => ({}) } as Response),
    ) as never;

    await refreshReplayManifest();
    await ensureReplayRange(120_000, 180_000);

    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(useIdentStore.getState().replay.error).toContain("404");
  });
});

function manifest() {
  return {
    enabled: true,
    from: 120_000,
    to: 180_000,
    block_sec: 60,
    blocks: [
      {
        start: 120_000,
        end: 180_000,
        url: "/api/replay/blocks/120000-180000.json.zst",
        bytes: 200,
      },
    ],
  };
}

function replayBlock() {
  return {
    version: 1,
    start: 120_000,
    end: 180_000,
    step_ms: 5_000,
    frames: [
      {
        ts: 130_000,
        aircraft: [{ hex: "abc123", flight: "UAL123", lat: 34, lon: -118 }],
      },
      {
        ts: 160_000,
        aircraft: [{ hex: "abc123", flight: "UAL123", lat: 35, lon: -119 }],
      },
    ],
  } as const;
}

function responseJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}
