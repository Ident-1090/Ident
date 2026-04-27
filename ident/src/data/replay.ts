import { appPath } from "./basePath";
import { useIdentStore } from "./store";
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

type ReplayRangeLoad = {
  blocks: ReplayBlockIndex[];
  promise: Promise<void>;
};

type ReplayBlockLoad = {
  controller: AbortController;
  promise: Promise<void>;
};

class ReplayLoadCanceled extends Error {
  constructor() {
    super("Replay request canceled");
    this.name = "ReplayLoadCanceled";
  }
}

export async function refreshReplayManifest(): Promise<ReplayManifest | null> {
  if (manifestLoad) return manifestLoad;
  manifestLoad = (async () => {
    try {
      const manifest = await fetchJson<ReplayManifest>(appPath(MANIFEST_URL), {
        cache: "no-store",
      });
      useIdentStore.getState().setReplayManifest(normalizeManifest(manifest));
      return manifest;
    } catch (err) {
      useIdentStore
        .getState()
        .setReplayError(
          err instanceof Error ? err.message : "Replay unavailable",
        );
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
): Promise<void> {
  const st = useIdentStore.getState();
  if (!st.replay.enabled) return;
  const blocks = blocksForRange(st.replay.blocks, sinceMs, untilMs);
  abortStaleBlockLoads(st.replay.blocks, blocks);
  if (blocks.length === 0) return;

  const key = blocks.map((block) => block.url).join("\n");
  const pending = rangeLoads.get(key);
  if (pending && rangeLoadIsReusable(pending)) return pending.promise;
  if (pending) rangeLoads.delete(key);

  useIdentStore.getState().setReplayLoading(true);
  const load = (async () => {
    try {
      for (const block of blocks) {
        await loadReplayBlock(block);
      }
    } catch (err) {
      if (err instanceof ReplayLoadCanceled) return;
      await refreshReplayManifest();
      useIdentStore
        .getState()
        .setReplayError(
          err instanceof Error ? err.message : "Replay block missing",
        );
    } finally {
      rangeLoads.delete(key);
      if (rangeLoads.size === 0) {
        useIdentStore.getState().setReplayLoading(false);
      }
    }
  })();
  rangeLoads.set(key, { blocks, promise: load });
  return load;
}

function rangeLoadIsReusable(load: ReplayRangeLoad): boolean {
  return load.blocks.every((block) => {
    if (useIdentStore.getState().replay.cache[block.url]) return true;
    const pending = blockLoads.get(block.url);
    return !pending?.controller.signal.aborted;
  });
}

function loadReplayBlock(block: ReplayBlockIndex): Promise<void> {
  if (useIdentStore.getState().replay.cache[block.url]) {
    return Promise.resolve();
  }
  const pending = blockLoads.get(block.url);
  if (pending && !pending.controller.signal.aborted) return pending.promise;
  if (pending) blockLoads.delete(block.url);
  const controller = new AbortController();
  const load = (async () => {
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
      throw new Error("Invalid replay block");
    }
    useIdentStore.getState().setReplayBlock(block.url, body);
  })();
  blockLoads.set(block.url, { controller, promise: load });
  load.then(
    () => {
      if (blockLoads.get(block.url)?.promise === load)
        blockLoads.delete(block.url);
    },
    () => {
      if (blockLoads.get(block.url)?.promise === load)
        blockLoads.delete(block.url);
    },
  );
  return load;
}

function abortStaleBlockLoads(
  manifestBlocks: ReplayBlockIndex[],
  requestedBlocks: ReplayBlockIndex[],
): void {
  if (blockLoads.size === 0) return;

  const keep = new Set<string>();
  for (const block of requestedBlocks) {
    const index = manifestBlocks.findIndex(
      (candidate) => candidate.url === block.url,
    );
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
  return blocks.filter((block) => block.end >= start && block.start <= end);
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
    blocks: Array.isArray(manifest.blocks) ? manifest.blocks : [],
  };
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
