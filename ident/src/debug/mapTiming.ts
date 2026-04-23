export interface LabelFieldFlags {
  cs: boolean;
  type: boolean;
  alt: boolean;
  spd: boolean;
  sqk: boolean;
  rt: boolean;
}

export type MapTimingDetails = Record<
  string,
  string | number | boolean | null | undefined
>;
const TRACE_WINDOW_MS = 2500;

let traceUntilMs = 0;
let traceId = 0;

export function mapTimingNow(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function mapTimingElapsed(startMs: number): number {
  return Math.round((mapTimingNow() - startMs) * 10) / 10;
}

export function labelFieldsKey(fields: LabelFieldFlags): string {
  return [
    fields.cs ? "cs" : "-",
    fields.type ? "type" : "-",
    fields.alt ? "alt" : "-",
    fields.spd ? "spd" : "-",
    fields.sqk ? "sqk" : "-",
    fields.rt ? "rt" : "-",
  ].join(",");
}

export function startMapTimingTrace(
  event: string,
  details: MapTimingDetails = {},
  windowMs = TRACE_WINDOW_MS,
): void {
  if (!mapTimingAvailable()) return;
  const now = mapTimingNow();
  traceId += 1;
  traceUntilMs = Math.max(traceUntilMs, now + windowMs);
  writeMapTiming(event, { trace: traceId, ...details });
}

export function mapTimingEnabled(): boolean {
  return mapTimingAvailable() && mapTimingNow() <= traceUntilMs;
}

export function logMapTiming(
  event: string,
  details: MapTimingDetails = {},
): void {
  if (!mapTimingEnabled()) return;
  writeMapTiming(event, { trace: traceId, ...details });
}

function mapTimingAvailable(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof console === "undefined") return false;
  if (
    typeof navigator !== "undefined" &&
    /\bjsdom\b/i.test(navigator.userAgent)
  ) {
    return false;
  }
  return mapTimingDebugEnabled();
}

function writeMapTiming(event: string, details: MapTimingDetails): void {
  const compacted = compactDetails(details);
  console.info(
    `[ident:map] ${mapTimingNow().toFixed(1)}ms ${event}`,
    compacted,
  );
}

function mapTimingDebugEnabled(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("identMapTiming") === "1") return true;
    return window.localStorage?.getItem("ident:debug:mapTiming") === "1";
  } catch {
    return false;
  }
}

function compactDetails(details: MapTimingDetails): MapTimingDetails {
  const compacted: MapTimingDetails = {};
  for (const [key, value] of Object.entries(details)) {
    if (value !== undefined) compacted[key] = value;
  }
  return compacted;
}
