import type { ClockMode } from "../data/types";

function twoDigit(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatTopbarClock(
  date: Date,
  mode: "utc" | "local",
): { primary: string; subtitle: string } {
  const utcHh = String(date.getUTCHours()).padStart(2, "0");
  const utcMm = String(date.getUTCMinutes()).padStart(2, "0");
  const utcSs = String(date.getUTCSeconds()).padStart(2, "0");
  const utcFull = `${utcHh}:${utcMm}:${utcSs}Z`;
  const utcShort = `${utcHh}:${utcMm}Z`;

  const localHh = String(date.getHours()).padStart(2, "0");
  const localMm = String(date.getMinutes()).padStart(2, "0");
  const localSs = String(date.getSeconds()).padStart(2, "0");
  const localFull = `${localHh}:${localMm}:${localSs}`;
  const localShort = `${localHh}:${localMm}`;

  const tz = localTzAbbrev(date);

  if (mode === "local") {
    return { primary: `${localFull} ${tz}`, subtitle: `ZULU ${utcShort}` };
  }
  return { primary: utcFull, subtitle: `LOCAL ${localShort} ${tz}` };
}

export function formatReplayClockLabel(
  playheadMs: number,
  clockMode: ClockMode,
  rangeMs: number,
  pastWindow: boolean,
): string {
  const d = new Date(playheadMs);
  const hh = twoDigit(clockMode === "utc" ? d.getUTCHours() : d.getHours());
  const mm = twoDigit(clockMode === "utc" ? d.getUTCMinutes() : d.getMinutes());
  const ss = twoDigit(clockMode === "utc" ? d.getUTCSeconds() : d.getSeconds());
  if (rangeMs > 24 * 60 * 60_000 || pastWindow) {
    const monthDay = d
      .toLocaleString("en", {
        month: "short",
        day: "numeric",
        timeZone: clockMode === "utc" ? "UTC" : undefined,
      })
      .toUpperCase();
    return `${monthDay} ${hh}:${mm}:${ss}${clockMode === "utc" ? "Z" : ` ${localTzAbbrev(d)}`}`;
  }
  return `${hh}:${mm}:${ss}${clockMode === "utc" ? "Z" : ` ${localTzAbbrev(d)}`}`;
}

function localTzAbbrev(date: Date): string {
  // Best-effort: Intl's "short" timeZoneName yields e.g. "PDT". Falls back to
  // "LT" (local time) when the platform returns a numeric offset instead.
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      timeZoneName: "short",
    }).formatToParts(date);
    const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    if (tz && !/^GMT/i.test(tz) && !/^UTC/i.test(tz)) return tz;
  } catch {
    // fall through
  }
  return "LT";
}
