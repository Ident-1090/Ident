import { appPath } from "./basePath";
import { emitFrontendDiagnostic } from "./frontendDiagnostics";
import {
  decodeReplayBlockResponse,
  ReplayBlockBodyError,
} from "./replayBlockBody";
import {
  type ReplaySlice,
  replayFollowsLiveEdge,
  useIdentStore,
} from "./store";
import type {
  ReplayBlockFile,
  ReplayBlockIndex,
  ReplayManifest,
  TrailPoint,
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

export function __resetReplayLoaderForTests(): void {
  manifestLoad = null;
  rangeLoads.clear();
  blockLoads.clear();
  foregroundRangeLoadCount = 0;
}

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
  constructor(
    readonly url: string,
    options?: { cause?: unknown },
  ) {
    super(`Invalid replay block: ${url}`, options);
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
      const normalized = normalizeManifest(manifest);
      useIdentStore.getState().setReplayManifest(normalized);
      return normalized;
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
  const blocks = blocksForRange(st.replay.blocks, sinceMs, untilMs).filter(
    (block) =>
      !st.replay.unavailableBlockUrls?.[block.url] &&
      !replayBlockCoveredLocally(
        st.replay,
        st.trailsByHex,
        block,
        sinceMs,
        untilMs,
      ),
  );
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
    const replay = useIdentStore.getState().replay;
    if (replay.cache[block.url]) return true;
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
      const bytes = await fetchReplayBlockBytes(
        url,
        { cache: "force-cache" },
        controller.signal,
      );
      if (controller.signal.aborted) throw new ReplayLoadCanceled();
      const body = decodeReplayBlockResponse(bytes) as ReplayBlockFile;
      if (
        body.version !== 2 ||
        !Array.isArray(body.frames) ||
        !hasReplayFrameSample(body.frames)
      ) {
        throw new ReplayBlockFormatError(block.url);
      }
      useIdentStore.getState().setReplayBlock(block.url, body);
    } catch (err) {
      if (err instanceof ReplayLoadCanceled) {
        throw err;
      }
      useIdentStore.getState().markReplayBlockUnavailable(block.url);
      if (err instanceof ReplayBlockFormatError) {
        emitFrontendDiagnostic({
          severity: "warning",
          channel: "frontend.replay",
          code: "replay.block_decode_failed",
          message: `Could not decode replay block ${block.url}`,
        });
        throw err;
      }
      if (err instanceof ReplayBlockBodyError) {
        emitFrontendDiagnostic({
          severity: "warning",
          channel: "frontend.replay",
          code: "replay.block_decode_failed",
          message: `Could not decode replay block ${block.url}`,
        });
        // Forward the fzstd / JSON.parse cause so console + debuggers can
        // surface why the body failed; the bare format error otherwise only
        // names the URL.
        throw new ReplayBlockFormatError(block.url, { cause: err });
      }
      emitFrontendDiagnostic({
        severity: "warning",
        channel: "frontend.replay",
        code: "replay.block_load_failed",
        message: `Could not load replay block ${block.url}`,
      });
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

function replayBlockCoveredLocally(
  replay: ReplaySlice,
  trailsByHex: Record<string, TrailPoint[]>,
  block: ReplayBlockIndex,
  sinceMs: number,
  untilMs: number,
): boolean {
  const start = Math.max(block.start, Math.min(sinceMs, untilMs));
  const end = Math.min(block.end, Math.max(sinceMs, untilMs));
  if (end < start) return true;
  return rangeCoveredByIntervals(start, end, [
    ...replayLocalIntervals(replay),
    ...trailStoreIntervals(trailsByHex),
  ]);
}

function replayLocalIntervals(replay: ReplaySlice): Array<ReplayRangeInterval> {
  const intervals = Object.values(replay.cache)
    .filter((block) => block.frames.length > 0)
    .map((block) => ({ start: block.start, end: block.end }));
  if (replay.recent && replay.recent.frames.length > 0) {
    intervals.push({ start: replay.recent.start, end: replay.recent.end });
  }
  return intervals.sort((a, b) => a.start - b.start);
}

function trailStoreIntervals(
  trailsByHex: Record<string, TrailPoint[]>,
): Array<ReplayRangeInterval> {
  const intervals: Array<ReplayRangeInterval> = [];
  for (const points of Object.values(trailsByHex)) {
    if (points.length === 0) continue;
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    for (const point of points) {
      if (!Number.isFinite(point.ts)) continue;
      start = Math.min(start, point.ts);
      end = Math.max(end, point.ts);
    }
    if (Number.isFinite(start) && Number.isFinite(end)) {
      intervals.push({ start, end });
    }
  }
  return intervals.sort((a, b) => a.start - b.start);
}

type ReplayRangeInterval = { start: number; end: number };

function rangeCoveredByIntervals(
  start: number,
  end: number,
  intervals: Array<ReplayRangeInterval>,
): boolean {
  let coveredUntil = start;
  for (const interval of intervals) {
    if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end))
      continue;
    if (interval.end < coveredUntil) continue;
    if (interval.start > coveredUntil) return false;
    coveredUntil = Math.max(coveredUntil, interval.end);
    if (coveredUntil >= end) return true;
  }
  return false;
}

function hasReplayFrameSample(frames: unknown[]): boolean {
  return frames.some(
    (frame) =>
      frame != null &&
      typeof frame === "object" &&
      typeof (frame as { ts?: unknown }).ts === "number" &&
      Number.isFinite((frame as { ts: number }).ts),
  );
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

// fetchReplayBlockBytes returns the raw response body for a block URL. The
// caller decides whether to parse as JSON or zstd-decompress-then-parse via
// decodeReplayBlockResponse — we cannot tell from the response which form
// the server delivered, since modern browsers strip Content-Encoding once
// they've natively decoded.
async function fetchReplayBlockBytes(
  url: string,
  init: RequestInit,
  abortSignal: AbortSignal,
): Promise<Uint8Array> {
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
  if (abortSignal.aborted) throw new ReplayLoadCanceled();
  abortSignal.addEventListener("abort", abort, { once: true });
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`Replay request failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      if (canceled || abortSignal.aborted) throw new ReplayLoadCanceled();
      if (!timedOut) throw new ReplayLoadCanceled();
      throw new Error("Replay request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    abortSignal.removeEventListener("abort", abort);
  }
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
