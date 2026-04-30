import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  blocksForRange,
  ensureReplayRange,
  refreshReplayManifest,
} from "./replay";
import {
  __resetTrailDisplayCachesForTests,
  selectDisplayAircraftMap,
  selectDisplayTrailsByHex,
  useIdentStore,
} from "./store";

const originalFetch = globalThis.fetch;

function resetStore() {
  __resetTrailDisplayCachesForTests();
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
      trailStartMs: null,
      playing: false,
      speed: 1,
      followLiveEdge: false,
      lastInteractionAt: null,
      loading: false,
      resumeAfterLoading: false,
      error: null,
      errorUrl: null,
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

  it("normalizes manifest block order for bounded range lookup", async () => {
    globalThis.fetch = vi.fn(async () =>
      responseJson({
        ...longManifest(),
        blocks: [...longManifest().blocks].reverse(),
      }),
    ) as never;

    await refreshReplayManifest();

    expect(
      blocksForRange(
        useIdentStore.getState().replay.blocks,
        180_001,
        239_999,
      ).map((block) => block.url),
    ).toEqual(["/api/replay/blocks/180000-240000.json.zst"]);
  });

  it("handles empty and single-block manifests in bounded range lookup", () => {
    const block = {
      start: 120_000,
      end: 180_000,
      url: "/api/replay/blocks/120000-180000.json.zst",
      bytes: 200,
    };

    expect(blocksForRange([], 120_000, 180_000)).toEqual([]);
    expect(blocksForRange([block], 0, 119_999)).toEqual([]);
    expect(blocksForRange([block], 180_001, 240_000)).toEqual([]);
    expect(blocksForRange([block], 130_000, 140_000)).toEqual([block]);
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
    expect(
      st.replay.cache["/api/replay/blocks/120000-180000.json.zst"],
    ).toStrictEqual(block);
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

  it("does not toggle loading for blocks that are already loaded", async () => {
    const block = replayBlock();
    globalThis.fetch = vi.fn(async (url: string) =>
      url.includes("manifest") ? responseJson(manifest()) : responseJson(block),
    ) as never;

    await refreshReplayManifest();
    await ensureReplayRange(120_000, 180_000);
    const loadingStates: boolean[] = [];
    const unsubscribe = useIdentStore.subscribe((state) => {
      loadingStates.push(state.replay.loading);
    });

    await ensureReplayRange(120_000, 180_000);
    unsubscribe();

    expect(loadingStates).toEqual([]);
    expect(useIdentStore.getState().replay.loading).toBe(false);
  });

  it("does not keep replay loading for pending background preload blocks", async () => {
    const requests = new Map<string, PendingBlockRequest>();
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("manifest")) {
        return Promise.resolve(responseJson(longManifest()));
      }
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        throw new Error("block request missing abort signal");
      }
      return new Promise<Response>((resolve, reject) => {
        requests.set(url, { signal, resolve });
        signal.addEventListener("abort", () => reject(abortError()), {
          once: true,
        });
      });
    }) as never;

    await refreshReplayManifest();
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        mode: "replay",
        playheadMs: 30_000,
        playing: true,
        cache: {
          "/api/replay/blocks/0-60000.json.zst": {
            version: 1,
            start: 0,
            end: 60_000,
            step_ms: 1000,
            frames: [],
          },
        },
      },
    }));

    const preload = ensureReplayRange(0, 119_999, { background: true });
    await vi.waitFor(() => {
      expect(
        requests.has("/ident/api/replay/blocks/60000-120000.json.zst"),
      ).toBe(true);
    });

    expect(useIdentStore.getState().replay.loading).toBe(false);
    expect(useIdentStore.getState().replay.playing).toBe(true);
    expect(
      requests.get("/ident/api/replay/blocks/60000-120000.json.zst")?.signal
        .aborted,
    ).toBe(false);

    requests
      .get("/ident/api/replay/blocks/60000-120000.json.zst")
      ?.resolve(responseJson(replayBlock()));
    await preload;
  });

  it("does not leave a completed cached range reusable after state changes", async () => {
    const block = replayBlock();
    globalThis.fetch = vi.fn(async (url: string) =>
      url.includes("manifest") ? responseJson(manifest()) : responseJson(block),
    ) as never;

    await refreshReplayManifest();
    await ensureReplayRange(120_000, 180_000);
    await ensureReplayRange(120_000, 180_000);
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        cache: {},
      },
    }));

    await ensureReplayRange(120_000, 180_000);

    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
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

  it("cancels stale in-flight block requests outside the current range margin", async () => {
    const requests = new Map<string, PendingBlockRequest>();
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("manifest")) {
        return Promise.resolve(responseJson(longManifest()));
      }
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        throw new Error("block request missing abort signal");
      }
      return new Promise<Response>((resolve, reject) => {
        requests.set(url, { signal, resolve });
        signal.addEventListener("abort", () => reject(abortError()), {
          once: true,
        });
      });
    }) as never;

    await refreshReplayManifest();
    const stale = ensureReplayRange(0, 60_000);
    await vi.waitFor(() => {
      expect(requests.has("/ident/api/replay/blocks/0-60000.json.zst")).toBe(
        true,
      );
    });

    const current = ensureReplayRange(600_001, 659_999);
    await vi.waitFor(() => {
      expect(
        requests.get("/ident/api/replay/blocks/0-60000.json.zst")?.signal
          .aborted,
      ).toBe(true);
    });

    await stale;
    expect(useIdentStore.getState().replay.error).toBeNull();
    expect(useIdentStore.getState().replay.loading).toBe(true);
    expect(
      requests.has("/ident/api/replay/blocks/600000-660000.json.zst"),
    ).toBe(true);

    requests
      .get("/ident/api/replay/blocks/600000-660000.json.zst")
      ?.resolve(responseJson(replayBlock()));
    await current;
  });

  it("cancels stale in-flight block requests when replay returns to the live edge", async () => {
    const requests = new Map<string, PendingBlockRequest>();
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("manifest")) {
        return Promise.resolve(responseJson(longManifest()));
      }
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        throw new Error("block request missing abort signal");
      }
      return new Promise<Response>((resolve, reject) => {
        requests.set(url, { signal, resolve });
        signal.addEventListener("abort", () => reject(abortError()), {
          once: true,
        });
      });
    }) as never;

    await refreshReplayManifest();
    const stale = ensureReplayRange(0, 59_999);
    await vi.waitFor(() => {
      expect(requests.has("/ident/api/replay/blocks/0-60000.json.zst")).toBe(
        true,
      );
    });

    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        mode: "replay",
        playheadMs: st.replay.availableTo,
        playing: true,
      },
    }));
    await ensureReplayRange(180_000, 180_000);

    expect(
      requests.get("/ident/api/replay/blocks/0-60000.json.zst")?.signal.aborted,
    ).toBe(true);
    await stale;
    expect(useIdentStore.getState().replay.loading).toBe(false);
  });

  it("refetches a canceled range when replay returns before abort settlement", async () => {
    const requests = new Map<string, PendingBlockRequest[]>();
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("manifest")) {
        return Promise.resolve(responseJson(longManifest()));
      }
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        throw new Error("block request missing abort signal");
      }
      return new Promise<Response>((resolve, reject) => {
        const request = { signal, resolve };
        requests.set(url, [...(requests.get(url) ?? []), request]);
        signal.addEventListener("abort", () => reject(abortError()), {
          once: true,
        });
      });
    }) as never;

    await refreshReplayManifest();
    const first = ensureReplayRange(0, 59_999);
    await vi.waitFor(() => {
      expect(
        requests.get("/ident/api/replay/blocks/0-60000.json.zst"),
      ).toHaveLength(1);
    });

    const far = ensureReplayRange(600_001, 659_999);
    await vi.waitFor(() => {
      expect(
        requests.get("/ident/api/replay/blocks/0-60000.json.zst")?.[0].signal
          .aborted,
      ).toBe(true);
    });

    const returned = ensureReplayRange(0, 59_999);
    await vi.waitFor(() => {
      expect(
        requests.get("/ident/api/replay/blocks/0-60000.json.zst"),
      ).toHaveLength(2);
    });

    requests
      .get("/ident/api/replay/blocks/0-60000.json.zst")?.[1]
      .resolve(responseJson(replayBlock()));
    requests
      .get("/ident/api/replay/blocks/600000-660000.json.zst")
      ?.at(0)
      ?.resolve(responseJson(replayBlock()));
    await Promise.all([first, far, returned]);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/ident/api/replay/blocks/0-60000.json.zst",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("keeps in-flight block requests inside the current range margin", async () => {
    const requests = new Map<string, PendingBlockRequest>();
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("manifest")) {
        return Promise.resolve(responseJson(longManifest()));
      }
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        throw new Error("block request missing abort signal");
      }
      return new Promise<Response>((resolve, reject) => {
        requests.set(url, { signal, resolve });
        signal.addEventListener("abort", () => reject(abortError()), {
          once: true,
        });
      });
    }) as never;

    await refreshReplayManifest();
    const first = ensureReplayRange(180_001, 239_999);
    await vi.waitFor(() => {
      expect(
        requests.has("/ident/api/replay/blocks/180000-240000.json.zst"),
      ).toBe(true);
    });

    const second = ensureReplayRange(360_001, 419_999);

    expect(
      requests.get("/ident/api/replay/blocks/180000-240000.json.zst")?.signal
        .aborted,
    ).toBe(false);
    requests
      .get("/ident/api/replay/blocks/180000-240000.json.zst")
      ?.resolve(responseJson(replayBlock()));
    requests
      .get("/ident/api/replay/blocks/360000-420000.json.zst")
      ?.resolve(responseJson(replayBlock()));
    await Promise.all([first, second]);
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

  it("keeps the block error tag when recovery manifest refresh also fails", async () => {
    let manifestCalls = 0;
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("manifest")) {
        manifestCalls += 1;
        if (manifestCalls === 1) return responseJson(manifest());
        return { ok: false, status: 503, json: async () => ({}) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as never;

    await refreshReplayManifest();
    await ensureReplayRange(120_000, 180_000);

    expect(useIdentStore.getState().replay.error).toContain("404");
    expect(useIdentStore.getState().replay.errorUrl).toBe(
      "/api/replay/blocks/120000-180000.json.zst",
    );
  });

  it("refreshes the manifest and logs background replay block failures", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async (url: string) =>
      url.includes("manifest")
        ? responseJson(manifest())
        : ({ ok: false, status: 404, json: async () => ({}) } as Response),
    ) as never;

    await refreshReplayManifest();
    await ensureReplayRange(120_000, 180_000, { background: true });

    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(
      "[ident replay] background block load failed",
      expect.any(Error),
    );
    expect(useIdentStore.getState().replay.error).toBeNull();
  });

  it("surfaces malformed replay blocks from background loads", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async (url: string) =>
      url.includes("manifest")
        ? responseJson(manifest())
        : responseJson({ version: 1, frames: null }),
    ) as never;

    await refreshReplayManifest();
    await ensureReplayRange(120_000, 180_000, { background: true });

    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(warn).not.toHaveBeenCalledWith(
      "[ident replay] background block load failed",
      expect.any(Error),
    );
    expect(useIdentStore.getState().replay.error).toContain(
      "Invalid replay block",
    );
    expect(useIdentStore.getState().replay.error).toContain(
      "/api/replay/blocks/120000-180000.json.zst",
    );
    expect(useIdentStore.getState().replay.errorUrl).toBe(
      "/api/replay/blocks/120000-180000.json.zst",
    );
  });

  it("retries malformed replay blocks and clears the matching error after recovery", async () => {
    let malformed = true;
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("manifest")) return responseJson(manifest());
      if (malformed) {
        malformed = false;
        return responseJson({ version: 1, frames: null });
      }
      return responseJson(replayBlock());
    }) as never;

    await refreshReplayManifest();
    await ensureReplayRange(120_000, 180_000, { background: true });
    await ensureReplayRange(120_000, 180_000);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/ident/api/replay/blocks/120000-180000.json.zst",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(useIdentStore.getState().replay.error).toBeNull();
    expect(useIdentStore.getState().replay.errorUrl).toBeNull();
    expect(
      useIdentStore.getState().replay.cache[
        "/api/replay/blocks/120000-180000.json.zst"
      ],
    ).toBeTruthy();
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

function longManifest() {
  return {
    enabled: true,
    from: 0,
    to: 900_000,
    block_sec: 60,
    blocks: Array.from({ length: 15 }, (_, i) => {
      const start = i * 60_000;
      const end = start + 60_000;
      return {
        start,
        end,
        url: `/api/replay/blocks/${start}-${end}.json.zst`,
        bytes: 200,
      };
    }),
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

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

type PendingBlockRequest = {
  signal: AbortSignal;
  resolve: (value: Response) => void;
};
