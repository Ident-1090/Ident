import { describe, expect, it } from "vitest";
import type { TrailPoint } from "../data/types";
import { altSamplesFromTrail } from "./Inspector";

function pt(ts: number, alt: number | "ground"): TrailPoint {
  return { lat: 0, lon: 0, alt, ts };
}

describe("altSamplesFromTrail", () => {
  it("returns [] when the trail is undefined or empty", () => {
    expect(altSamplesFromTrail(undefined)).toEqual([]);
    expect(altSamplesFromTrail([])).toEqual([]);
  });

  it("emits numeric alts from the trail in order", () => {
    const trail = [pt(0, 1000), pt(1000, 2000), pt(2000, 3000)];
    expect(altSamplesFromTrail(trail)).toEqual([1000, 2000, 3000]);
  });

  it("filters out 'ground' samples but preserves the airborne sequence", () => {
    const trail = [
      pt(0, "ground"),
      pt(1000, 500),
      pt(2000, 1500),
      pt(3000, "ground"),
    ];
    expect(altSamplesFromTrail(trail)).toEqual([500, 1500]);
  });

  it("mirrors whatever trailsByHex holds — no dedupe, no clip, no fallback", () => {
    // The map's selected-aircraft trail renders every buffered point as-is;
    // the sparkline reads from the same source so the two views stay in
    // lock-step. If trails contains cross-sortie points the sparkline will
    // show them too — the fix for that lives where the trail is assembled,
    // not in the visualizer.
    const trail = [pt(0, 30000), pt(1000, 30000), pt(2000, 30000)];
    expect(altSamplesFromTrail(trail)).toEqual([30000, 30000, 30000]);
  });
});
