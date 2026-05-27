import type { TrailPoint } from "../data/types";

/**
 * Altitude series for the inspector sparkline. Reads the same `trailsByHex`
 * buffer the map uses for its selected-aircraft trail line, keeping the two
 * views in lock-step. No fallback to altTrendsByHex because that ring buffer
 * has no timestamps, so it can't distinguish two sorties of the same hex.
 */
export interface AltitudeTrace {
  samples: number[];
  ts: number[];
}

export function altTraceFromTrail(
  trail: TrailPoint[] | undefined,
): AltitudeTrace {
  if (!trail) return { samples: [], ts: [] };
  const samples: number[] = [];
  const ts: number[] = [];
  for (const p of trail) {
    if (typeof p.alt === "number") {
      samples.push(p.alt);
      ts.push(p.ts);
    }
  }
  return { samples, ts };
}

export function altSamplesFromTrail(trail: TrailPoint[] | undefined): number[] {
  return altTraceFromTrail(trail).samples;
}
