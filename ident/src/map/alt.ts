const EMERGENCY_COLOR = "#FF3900";
const GROUND_COLOR = "#929292";
const UNKNOWN_COLOR = "#6B6F73";
const LOS_MUTE_COLOR = "#83919A";

export type AltPaletteTone = "light" | "dark";
export type AircraftGlyphColors = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
];

export const ALT_DISCRETE_BANDS = [
  { maxAltFt: 1_000, color: "#D44400" },
  { maxAltFt: 5_000, color: "#F27200" },
  { maxAltFt: 10_000, color: "#E89B2B" },
  { maxAltFt: 24_000, color: "#26A671" },
  { maxAltFt: 38_000, color: "#37A5BE" },
  { maxAltFt: Number.POSITIVE_INFINITY, color: "#1F5673" },
] as const;

export const AIRCRAFT_GLYPH_COLORS_BY_TONE: Record<
  AltPaletteTone,
  AircraftGlyphColors
> = {
  light: [
    ALT_DISCRETE_BANDS[0].color,
    ALT_DISCRETE_BANDS[1].color,
    ALT_DISCRETE_BANDS[2].color,
    ALT_DISCRETE_BANDS[3].color,
    ALT_DISCRETE_BANDS[4].color,
    ALT_DISCRETE_BANDS[5].color,
  ],
  dark: ["#F05E24", "#FF8A22", "#F1B846", "#36C98A", "#55C9DE", "#69AFCB"],
};

const TRAIL_COLOR_STOPS = [
  { altFt: 0, color: ALT_DISCRETE_BANDS[0].color },
  { altFt: 1_000, color: ALT_DISCRETE_BANDS[1].color },
  { altFt: 5_000, color: ALT_DISCRETE_BANDS[2].color },
  { altFt: 10_000, color: ALT_DISCRETE_BANDS[3].color },
  { altFt: 24_000, color: ALT_DISCRETE_BANDS[4].color },
  { altFt: 38_000, color: ALT_DISCRETE_BANDS[5].color },
] as const;
const GRADIENT_SEGMENT_STEPS = 6;

// Original discrete altitude palette for aircraft glyphs, traffic dots, and
// other non-trail overlays. Emergency and ground keep their fixed semantics.
export function altColor(
  alt: number | "ground" | null | undefined,
  emergency?: string,
): string {
  if (emergency && emergency !== "none") return EMERGENCY_COLOR;
  if (alt === "ground") return GROUND_COLOR;
  if (alt == null) return UNKNOWN_COLOR;
  for (const band of ALT_DISCRETE_BANDS) {
    if (alt < band.maxAltFt) return band.color;
  }
  return ALT_DISCRETE_BANDS[ALT_DISCRETE_BANDS.length - 1].color;
}

// Trails keep the same semantic palette, but interpolate between the discrete
// airborne anchors in a perceptual color space so transitions stay saturated
// instead of going muddy in sRGB midpoints.
export function altTrailColor(
  alt: number | "ground" | null | undefined,
  emergency?: string,
): string {
  if (emergency && emergency !== "none") return EMERGENCY_COLOR;
  if (alt === "ground") return GROUND_COLOR;
  if (alt == null) return UNKNOWN_COLOR;
  const clamped = Math.max(
    TRAIL_COLOR_STOPS[0].altFt,
    Math.min(alt, TRAIL_COLOR_STOPS[TRAIL_COLOR_STOPS.length - 1].altFt),
  );
  for (let i = 1; i < TRAIL_COLOR_STOPS.length; i++) {
    const lo = TRAIL_COLOR_STOPS[i - 1];
    const hi = TRAIL_COLOR_STOPS[i];
    if (clamped <= hi.altFt) {
      const span = hi.altFt - lo.altFt;
      const t = span === 0 ? 0 : (clamped - lo.altFt) / span;
      return lerpHexPerceptual(lo.color, hi.color, t);
    }
  }
  return TRAIL_COLOR_STOPS[TRAIL_COLOR_STOPS.length - 1].color;
}

export function altLosColor(alt: number | "ground" | null | undefined): string {
  return mixHex(altColor(alt), LOS_MUTE_COLOR, 0.42);
}

export function altGradientCss(): string {
  const gradientStops: string[] = [];
  const segmentCount = TRAIL_COLOR_STOPS.length - 1;
  for (let i = 0; i < segmentCount; i++) {
    const start = TRAIL_COLOR_STOPS[i];
    const end = TRAIL_COLOR_STOPS[i + 1];
    for (let step = 0; step <= GRADIENT_SEGMENT_STEPS; step++) {
      if (i > 0 && step === 0) continue;
      const t = step / GRADIENT_SEGMENT_STEPS;
      const pct = ((i + t) / segmentCount) * 100;
      gradientStops.push(
        `${lerpHexPerceptual(start.color, end.color, t)} ${pct}%`,
      );
    }
  }
  return `linear-gradient(90deg, ${gradientStops.join(", ")})`;
}

export function altGlyphGradientCss(colors: AircraftGlyphColors): string {
  return `linear-gradient(90deg, ${colors
    .map((color, i) => `${color} ${(i / (colors.length - 1)) * 100}%`)
    .join(", ")})`;
}

function lerpHexPerceptual(fromHex: string, toHex: string, t: number): string {
  const from = hexToOklch(fromHex);
  const to = hexToOklch(toHex);
  const hueDelta = shortestHueDelta(from.h, to.h);
  const mixed = {
    l: from.l + (to.l - from.l) * t,
    c: from.c + (to.c - from.c) * t,
    h: normalizeHue(from.h + hueDelta * t),
  };
  return oklchToHex(mixed);
}

function parseHex(hex: string): [number, number, number] {
  const raw = hex.replace("#", "");
  return [
    Number.parseInt(raw.slice(0, 2), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(4, 6), 16),
  ];
}

function toHexColor(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function mixHex(fromHex: string, toHex: string, t: number): string {
  const from = parseHex(fromHex);
  const to = parseHex(toHex);
  return toHexColor(
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  );
}

function srgbToLinear(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
  const v =
    channel <= 0.0031308
      ? 12.92 * channel
      : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(v * 255)));
}

type Oklch = {
  l: number;
  c: number;
  h: number;
};

function hexToOklch(hex: string): Oklch {
  const [r8, g8, b8] = parseHex(hex);
  const r = srgbToLinear(r8);
  const g = srgbToLinear(g8);
  const b = srgbToLinear(b8);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const lOk = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const aOk = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bOk = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  return {
    l: lOk,
    c: Math.hypot(aOk, bOk),
    h: normalizeHue((Math.atan2(bOk, aOk) * 180) / Math.PI),
  };
}

function oklchToHex({ l, c, h }: Oklch): string {
  const hr = (h * Math.PI) / 180;
  const a = Math.cos(hr) * c;
  const b = Math.sin(hr) * c;

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;

  const r = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bLinear = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  return toHexColor(linearToSrgb(r), linearToSrgb(g), linearToSrgb(bLinear));
}

function shortestHueDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function normalizeHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}
