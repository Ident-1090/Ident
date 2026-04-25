import { appPath } from "./basePath";
import type { TrailPoint } from "./types";

// Each aircraft chunk row is a positional tuple [hex, alt_ft, gs_kt, trk_deg,
// lat, lon, seen_pos_s, type, flight, msgs]. Some readsb builds append trailing
// fields, so the parser only relies on the 0..9 prefix.
export type ChunkRow = [
  string, // hex
  number | "ground", // alt_ft (number, or "ground" for on-ground)
  number, // gs_kt
  number | null, // trk_deg (null when stationary on ground)
  number, // lat
  number, // lon
  number, // seen_pos_s
  string, // type
  string | null, // flight
  number, // msgs
  ...unknown[],
];

export interface ChunkSlice {
  now: number; // Unix seconds
  messages: number;
  aircraft: ChunkRow[];
}

export interface ChunkJson {
  files: ChunkSlice[];
}

export interface ChunksIndex {
  chunks: string[];
  chunks_all?: string[];
  enable_uat?: string;
}

const CHUNKS_BASE = "api/chunks";
const STALE_SEEN_POS_MAX_S = 15;
const STALE_SEEN_POS_MAX_ADSC_S = 20 * 60;

export function parseChunkJson(text: string): ChunkJson | null {
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object") return null;
    const files = (v as { files?: unknown }).files;
    if (!Array.isArray(files)) return null;
    return v as ChunkJson;
  } catch {
    return null;
  }
}

// Reconstruct per-hex TrailPoint sequences from one-or-more chunk payloads.
// Rows across slices share the same hex; each slice's `now` is the observation
// timestamp (seconds), while row[6] is the position age in seconds. Output is
// sorted oldest→newest per hex so callers can feed points into
// `recordTrailPoint` in order without a second sort.
function maxSeenPosForType(type: unknown): number {
  return type === "adsc" ? STALE_SEEN_POS_MAX_ADSC_S : STALE_SEEN_POS_MAX_S;
}

export function groupChunkIntoTrails(
  chunks: ChunkJson[],
): Map<string, TrailPoint[]> {
  const byHex = new Map<string, TrailPoint[]>();
  for (const chunk of chunks) {
    for (const slice of chunk.files) {
      for (const row of slice.aircraft) {
        const hex = row[0];
        const altRaw = row[1];
        const lat = row[4];
        const lon = row[5];
        const seenPosRaw = row[6];
        const type = row[7];
        if (typeof lat !== "number" || typeof lon !== "number") continue;
        const seenPosS =
          typeof seenPosRaw === "number" && Number.isFinite(seenPosRaw)
            ? Math.max(0, seenPosRaw)
            : 5;
        if (seenPosS > maxSeenPosForType(type)) continue;
        const alt: number | "ground" =
          altRaw === "ground"
            ? "ground"
            : typeof altRaw === "number"
              ? altRaw
              : "ground";
        const point: TrailPoint = {
          lat,
          lon,
          alt,
          ts: Math.round((slice.now - seenPosS) * 1000),
        };
        const bucket = byHex.get(hex);
        if (bucket) bucket.push(point);
        else byHex.set(hex, [point]);
      }
    }
  }
  for (const points of byHex.values()) {
    points.sort((a, b) => a.ts - b.ts);
  }
  return byHex;
}

// Maximum number of timestamped historical chunks to fetch. Each chunk covers
// ~7.6 min / ~114 slices / ~350 KB wire, so 8 gives ~1 h coverage at ~2.8 MB
// total — enough to seed trails that the live WS stream will extend.
const MAX_HISTORICAL_CHUNKS = 8;

// Names of the in-progress rolling slices. These accumulate between chunk
// rotations and are often empty immediately after a rotation, so they're not
// useful as primary history sources.
const ROLLING_SLICES = new Set(["current_large.gz", "current_small.gz"]);

async function fetchChunk(name: string): Promise<ChunkJson | null> {
  try {
    const res = await fetch(appPath(`${CHUNKS_BASE}/${name}`));
    if (!res.ok) return null;
    // Browser auto-decompresses Content-Encoding: gzip, so .json() works.
    const body = (await res.json()) as unknown;
    if (!body || typeof body !== "object") return null;
    const files = (body as { files?: unknown }).files;
    if (!Array.isArray(files)) return null;
    return body as ChunkJson;
  } catch {
    return null;
  }
}

// Fetch the chunks manifest, then pull the most-recent timestamped chunks in
// parallel and reconstruct per-hex trails. Returns an empty map when the route
// is absent or the manifest is malformed so callers can ignore the failure and
// rely on live WS updates alone.
export async function loadHistoricalTracks(): Promise<
  Map<string, TrailPoint[]>
> {
  let indexRes: Response;
  try {
    indexRes = await fetch(appPath(`${CHUNKS_BASE}/chunks.json`), {
      cache: "no-store",
    });
  } catch {
    return new Map();
  }
  if (!indexRes.ok) return new Map();
  let index: ChunksIndex;
  try {
    index = (await indexRes.json()) as ChunksIndex;
  } catch {
    return new Map();
  }
  if (!Array.isArray(index.chunks) || index.chunks.length === 0)
    return new Map();

  // Timestamped chunks are `chunk_<ms>.gz`; filename sort is chronological.
  // Drop the rolling slices (they're the partially-accumulating current
  // window, not finalised history) and keep the N most recent.
  const historical = index.chunks.filter((n) => !ROLLING_SLICES.has(n)).sort();
  const recent = historical.slice(-MAX_HISTORICAL_CHUNKS);

  const results = await Promise.all(recent.map((name) => fetchChunk(name)));
  const chunks: ChunkJson[] = results.filter((c): c is ChunkJson => c !== null);

  // Tail with current_small.gz to pick up any finalised rows that rolled over
  // before the WS stream attaches. Cheap (often empty) and serial so it can't
  // delay the parallel history fetch above.
  if (index.chunks.includes("current_small.gz")) {
    const tail = await fetchChunk("current_small.gz");
    if (tail) chunks.push(tail);
  }

  if (chunks.length === 0) return new Map();
  return groupChunkIntoTrails(chunks);
}
