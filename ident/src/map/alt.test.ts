import { describe, expect, it } from "vitest";
import {
  AIRCRAFT_GLYPH_COLORS_BY_TONE,
  ALT_DISCRETE_BANDS,
  altColor,
  altGlyphGradientCss,
  altGradientCss,
  altLosColor,
  altTrailColor,
} from "./alt";

describe("altColor", () => {
  it("keeps emergency, ground, and missing states on fixed colors", () => {
    expect(altColor(12_000, false, "general")).toBe("#FF3900");
    expect(altColor(null, true)).toBe("#929292");
    expect(altColor(undefined)).toBe("#6B6F73");
  });

  it("snaps airborne values into the six configured discrete altitude bands", () => {
    expect(altColor(200)).toBe("#D44400");
    expect(altColor(999)).toBe("#D44400");
    expect(altColor(1_000)).toBe("#F27200");
    expect(altColor(4_999)).toBe("#F27200");
    expect(altColor(5_000)).toBe("#E89B2B");
    expect(altColor(9_999)).toBe("#E89B2B");
    expect(altColor(10_000)).toBe("#26A671");
    expect(altColor(23_999)).toBe("#26A671");
    expect(altColor(24_000)).toBe("#37A5BE");
    expect(altColor(37_999)).toBe("#37A5BE");
    expect(altColor(38_000)).toBe("#1F5673");
    expect(altColor(55_000)).toBe("#1F5673");
  });

  it("matches the configured discrete band colors at representative altitudes", () => {
    expect(altColor(500)).toBe(ALT_DISCRETE_BANDS[0].color);
    expect(altColor(2_500)).toBe(ALT_DISCRETE_BANDS[1].color);
    expect(altColor(7_500)).toBe(ALT_DISCRETE_BANDS[2].color);
    expect(altColor(20_000)).toBe(ALT_DISCRETE_BANDS[3].color);
    expect(altColor(30_000)).toBe(ALT_DISCRETE_BANDS[4].color);
    expect(altColor(40_000)).toBe(ALT_DISCRETE_BANDS[5].color);
  });
});

describe("altTrailColor", () => {
  it("keeps emergency, ground, and missing states fixed for trails too", () => {
    expect(altTrailColor(12_000, false, "general")).toBe("#FF3900");
    expect(altTrailColor(null, true)).toBe("#929292");
    expect(altTrailColor(undefined)).toBe("#6B6F73");
  });

  it("interpolates between the six discrete airborne anchors", () => {
    expect(altTrailColor(1_000)).toBe(ALT_DISCRETE_BANDS[1].color);
    expect(altTrailColor(3_000)).not.toBe(ALT_DISCRETE_BANDS[1].color);
    expect(altTrailColor(3_000)).not.toBe(ALT_DISCRETE_BANDS[2].color);
    expect(altTrailColor(30_000)).not.toBe(ALT_DISCRETE_BANDS[4].color);
    expect(altTrailColor(30_000)).not.toBe(ALT_DISCRETE_BANDS[5].color);
  });

  it("clamps outside the supported trail range", () => {
    expect(altTrailColor(-500)).toBe("#D44400");
    expect(altTrailColor(55_000)).toBe("#1F5673");
  });

  it("matches the six band colors at the trail gradient endpoints", () => {
    expect(altTrailColor(0)).toBe(ALT_DISCRETE_BANDS[0].color);
    expect(altTrailColor(1_000)).toBe(ALT_DISCRETE_BANDS[1].color);
    expect(altTrailColor(5_000)).toBe(ALT_DISCRETE_BANDS[2].color);
    expect(altTrailColor(10_000)).toBe(ALT_DISCRETE_BANDS[3].color);
    expect(altTrailColor(24_000)).toBe(ALT_DISCRETE_BANDS[4].color);
    expect(altTrailColor(38_000)).toBe(ALT_DISCRETE_BANDS[5].color);
    expect(altTrailColor(45_000)).toBe(ALT_DISCRETE_BANDS[5].color);
  });
});

describe("altLosColor", () => {
  it("mutes LOS coverage colors away from exact aircraft altitude colors", () => {
    expect(altLosColor(500)).not.toBe(altColor(500));
    expect(altLosColor(20_000)).not.toBe(altColor(20_000));
    expect(altLosColor(40_000)).not.toBe(altColor(40_000));
    expect(altLosColor(20_000)).toBe("#4D9D82");
  });
});

describe("altGradientCss", () => {
  it("uses the six band colors at the trail gradient endpoints", () => {
    const gradient = altGradientCss();
    expect(gradient.startsWith("linear-gradient(90deg,")).toBe(true);
    expect(gradient).toContain(ALT_DISCRETE_BANDS[0].color);
    expect(gradient).toContain(ALT_DISCRETE_BANDS[1].color);
    expect(gradient).toContain(ALT_DISCRETE_BANDS[2].color);
    expect(gradient).toContain(ALT_DISCRETE_BANDS[3].color);
    expect(gradient).toContain(ALT_DISCRETE_BANDS[4].color);
    expect(gradient).toContain(ALT_DISCRETE_BANDS[5].color);
  });
});

describe("altGlyphGradientCss", () => {
  it("uses the rendered glyph palette for the active map tone", () => {
    const gradient = altGlyphGradientCss(AIRCRAFT_GLYPH_COLORS_BY_TONE.dark);
    expect(gradient).toContain("#69AFCB");
    expect(gradient).not.toContain("#1F5673");
  });
});
