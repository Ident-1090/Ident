import { appPath } from "./basePath";
import { useIdentStore } from "./store";
import type {
  ReplayBlockFile,
  ReplayBlockIndex,
  ReplayManifest,
} from "./types";

const MANIFEST_URL = "api/replay/manifest.json";
const blockLoads = new Map<string, Promise<void>>();

export async function refreshReplayManifest(): Promise<ReplayManifest | null> {
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
}

export async function ensureReplayRange(
  sinceMs: number,
  untilMs: number,
): Promise<void> {
  const st = useIdentStore.getState();
  if (!st.replay.enabled) return;
  const blocks = blocksForRange(st.replay.blocks, sinceMs, untilMs);
  if (blocks.length === 0) return;

  useIdentStore.getState().setReplayLoading(true);
  try {
    for (const block of blocks) {
      await loadReplayBlock(block);
    }
    useIdentStore.getState().setReplayLoading(false);
  } catch (err) {
    await refreshReplayManifest();
    useIdentStore
      .getState()
      .setReplayError(
        err instanceof Error ? err.message : "Replay block missing",
      );
  }
}

function loadReplayBlock(block: ReplayBlockIndex): Promise<void> {
  if (useIdentStore.getState().replay.cache[block.url]) {
    return Promise.resolve();
  }
  const pending = blockLoads.get(block.url);
  if (pending) return pending;
  const load = (async () => {
    if (useIdentStore.getState().replay.cache[block.url]) return;
    const url = appPath(block.url.replace(/^\//, ""));
    const body = await fetchJson<ReplayBlockFile>(url, {
      cache: "force-cache",
    });
    if (body.version !== 1 || !Array.isArray(body.frames)) {
      throw new Error("Invalid replay block");
    }
    useIdentStore.getState().setReplayBlock(block.url, body);
  })();
  blockLoads.set(block.url, load);
  load.then(
    () => blockLoads.delete(block.url),
    () => blockLoads.delete(block.url),
  );
  return load;
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

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Replay request failed: ${res.status}`);
  return (await res.json()) as T;
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
