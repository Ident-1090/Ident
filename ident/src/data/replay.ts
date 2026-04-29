import { appPath } from "./basePath";
import { replayFollowsLiveEdge, useIdentStore } from "./store";
import type {
  ReplayBlockFile,
  ReplayBlockIndex,
  ReplayManifest,
} from "./types";

const MANIFEST_URL = "api/replay/manifest.json";
const REPLAY_FETCH_TIMEOUT_MS = 30 * 1000;
const REPLAY_FETCH_KEEP_BLOCK_MARGIN = 3;
let manifestLoad: Promise<ReplayManifest | null> | null = null;
const rangeLoads = new Map<string, ReplayRangeLoad>();
const blockLoads = new Map<string, ReplayBlockLoad>();
const blockIndexByManifest = new WeakMap<
  ReplayBlockIndex[],
  Map<string, number>
>();
let foregroundRangeLoadCount = 0;

type ReplayRangeLoad = {
  blocks: ReplayBlockIndex[];
  promise: Promise<void>;
};

type ReplayBlockLoad = {
  controller: AbortController;
  promise: Promise<void>;
};

type EnsureReplayRangeOptions = {
  background?: boolean;
};

type RefreshReplayManifestOptions = {
  preserveReplayError?: boolean;
};

class ReplayLoadCanceled extends Error {
  constructor() {
    super("Replay request canceled");
    this.name = "ReplayLoadCanceled";
  }
}

class ReplayBlockFormatError extends Error {
  constructor(readonly url: string) {
    super(`Invalid replay block: ${url}`);
    this.name = "ReplayBlockFormatError";
  }
}

class ReplayBlockLoadError extends Error {
  constructor(
    readonly url: string,
    cause: unknown,
  ) {
    const message =
      cause instanceof Error ? cause.message : "Replay block missing";
    super(`Replay block load failed: ${url}: ${message}`, { cause });
    this.name = "ReplayBlockLoadError";
  }
}

export async function refreshReplayManifest(
  options: RefreshReplayManifestOptions = {},
): Promise<ReplayManifest | null> {
  if (manifestLoad) return manifestLoad;
  manifestLoad = (async () => {
    try {
      const manifest = await fetchJson<ReplayManifest>(appPath(MANIFEST_URL), {
        cache: "no-store",
      });
      useIdentStore.getState().setReplayManifest(normalizeManifest(manifest));
      return manifest;
    } catch (err) {
      if (!options.preserveReplayError) {
        useIdentStore
          .getState()
          .setReplayError(
            err instanceof Error ? err.message : "Replay unavailable",
          );
      }
      return null;
    }
  })().finally(() => {
    manifestLoad = null;
  });
  return manifestLoad;
}

export async function ensureReplayRange(
  sinceMs: number,
  untilMs: number,
  options: EnsureReplayRangeOptions = {},
): Promise<void> {
  const foreground = !options.background;
  const st = useIdentStore.getState();
  if (!st.replay.enabled) return;
  if (replayFollowsLiveEdge(st.replay)) {
    abortStaleBlockLoads(st.replay.blocks, []);
    useIdentStore.getState().setReplayLoading(false);
    return;
  }
  const blocks = blocksForRange(st.replay.blocks, sinceMs, untilMs);
  abortStaleBlockLoads(st.replay.blocks, blocks);
  if (blocks.length === 0) return;

  const key = blocks.map((block) => block.url).join("\n");
  const pending = rangeLoads.get(key);
  if (pending && rangeLoadIsReusable(pending)) return pending.promise;
  if (pending) rangeLoads.delete(key);

  const load = (async () => {
    let loading = false;
    try {
      for (const block of blocks) {
        const blockLoad = loadReplayBlock(block);
        if (!blockLoad) continue;
        if (foreground && !loading) {
          useIdentStore.getState().setReplayLoading(true);
          foregroundRangeLoadCount += 1;
          loading = true;
        }
        await blockLoad;
      }
    } catch (err) {
      if (err instanceof ReplayLoadCanceled) return;
      if (err instanceof ReplayBlockFormatError) {
        await refreshReplayManifest({ preserveReplayError: true });
        useIdentStore.getState().setReplayError(err.message, err.url);
        return;
      }
      if (options.background) {
        console.warn("[ident replay] background block load failed", err);
        try {
          await refreshReplayManifest({ preserveReplayError: true });
        } catch (manifestErr) {
          console.warn(
            "[ident replay] background manifest refresh failed",
            manifestErr,
          );
        }
        return;
      }
      await refreshReplayManifest({ preserveReplayError: true });
      useIdentStore
        .getState()
        .setReplayError(
          err instanceof Error ? err.message : "Replay block missing",
          err instanceof ReplayBlockLoadError ? err.url : null,
        );
    } finally {
      rangeLoads.delete(key);
      if (loading) {
        foregroundRangeLoadCount = Math.max(0, foregroundRangeLoadCount - 1);
      }
      if (loading && foregroundRangeLoadCount === 0) {
        useIdentStore.getState().setReplayLoading(false);
      }
    }
  })();
  rangeLoads.set(key, { blocks, promise: load });
  void load.finally(() => {
    if (rangeLoads.get(key)?.promise === load) rangeLoads.delete(key);
  });
  return load;
}

function rangeLoadIsReusable(load: ReplayRangeLoad): boolean {
  return load.blocks.every((block) => {
    if (useIdentStore.getState().replay.cache[block.url]) return true;
    const pending = blockLoads.get(block.url);
    return !pending?.controller.signal.aborted;
  });
}

function loadReplayBlock(block: ReplayBlockIndex): Promise<void> | null {
  if (useIdentStore.getState().replay.cache[block.url]) {
    return null;
  }
  const pending = blockLoads.get(block.url);
  if (pending && !pending.controller.signal.aborted) return pending.promise;
  if (pending) blockLoads.delete(block.url);
  const controller = new AbortController();
  let load!: Promise<void>;
  load = (async () => {
    try {
      if (useIdentStore.getState().replay.cache[block.url]) return;
      const url = appPath(block.url.replace(/^\//, ""));
      const body = await fetchJson<ReplayBlockFile>(
        url,
        {
          cache: "force-cache",
        },
        controller.signal,
      );
      if (controller.signal.aborted) throw new ReplayLoadCanceled();
      if (body.version !== 1 || !Array.isArray(body.frames)) {
        throw new ReplayBlockFormatError(block.url);
      }
      useIdentStore.getState().setReplayBlock(block.url, body);
    } catch (err) {
      if (
        err instanceof ReplayLoadCanceled ||
        err instanceof ReplayBlockFormatError
      ) {
        throw err;
      }
      throw new ReplayBlockLoadError(block.url, err);
    } finally {
      if (blockLoads.get(block.url)?.promise === load) {
        blockLoads.delete(block.url);
      }
    }
  })();
  blockLoads.set(block.url, { controller, promise: load });
  return load;
}

function abortStaleBlockLoads(
  manifestBlocks: ReplayBlockIndex[],
  requestedBlocks: ReplayBlockIndex[],
): void {
  if (blockLoads.size === 0) return;

  const keep = new Set<string>();
  const indexByUrl = manifestIndexByUrl(manifestBlocks);
  for (const block of requestedBlocks) {
    const index = indexByUrl.get(block.url) ?? -1;
    if (index < 0) {
      keep.add(block.url);
      continue;
    }
    const start = Math.max(0, index - REPLAY_FETCH_KEEP_BLOCK_MARGIN);
    const end = Math.min(
      manifestBlocks.length - 1,
      index + REPLAY_FETCH_KEEP_BLOCK_MARGIN,
    );
    for (let i = start; i <= end; i += 1) {
      keep.add(manifestBlocks[i].url);
    }
  }

  for (const [url, load] of blockLoads) {
    if (!keep.has(url)) load.controller.abort();
  }
}

export function blocksForRange(
  blocks: ReplayBlockIndex[],
  sinceMs: number,
  untilMs: number,
): ReplayBlockIndex[] {
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs)) return [];
  const start = Math.min(sinceMs, untilMs);
  const end = Math.max(sinceMs, untilMs);
  const out: ReplayBlockIndex[] = [];
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (blocks[mid].end < start) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < blocks.length && blocks[i].start <= end; i += 1) {
    out.push(blocks[i]);
  }
  return out;
}

function manifestIndexByUrl(blocks: ReplayBlockIndex[]): Map<string, number> {
  const cached = blockIndexByManifest.get(blocks);
  if (cached) return cached;
  const next = new Map<string, number>();
  blocks.forEach((block, i) => {
    next.set(block.url, i);
  });
  blockIndexByManifest.set(blocks, next);
  return next;
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  abortSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let canceled = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REPLAY_FETCH_TIMEOUT_MS);
  const abort = () => {
    canceled = true;
    controller.abort();
  };
  if (abortSignal?.aborted) throw new ReplayLoadCanceled();
  abortSignal?.addEventListener("abort", abort, { once: true });
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`Replay request failed: ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      if (canceled || abortSignal?.aborted) throw new ReplayLoadCanceled();
      if (!timedOut) throw new ReplayLoadCanceled();
      throw new Error("Replay request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    abortSignal?.removeEventListener("abort", abort);
  }
}

function normalizeManifest(manifest: ReplayManifest): ReplayManifest {
  return {
    enabled: Boolean(manifest.enabled),
    from: numberOrNull(manifest.from),
    to: numberOrNull(manifest.to),
    block_sec:
      typeof manifest.block_sec === "number" && manifest.block_sec > 0
        ? manifest.block_sec
        : 300,
    blocks: Array.isArray(manifest.blocks)
      ? manifest.blocks.slice().sort((a, b) => a.start - b.start)
      : [],
  };
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
