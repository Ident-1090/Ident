export function replayDeltaLabel(
  playheadMs: number,
  liveMs: number | null,
): string {
  if (liveMs == null || playheadMs >= liveMs) return "REPLAY";
  const minutes = Math.round((liveMs - playheadMs) / 60000);
  if (minutes < 60) return `REPLAY · T-${minutes}M`;
  return `REPLAY · T-${Math.round(minutes / 60)}H`;
}

export function rewindRangeLabel(rangeMs: number): string {
  const minutes = Math.max(1, Math.round(Math.max(0, rangeMs) / 60000));
  if (minutes < 60) return `-${minutes}M`;
  const hours = minutes / 60;
  if (hours < 24) {
    const rounded = Math.round(hours * 10) / 10;
    return `-${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}H`;
  }
  const days = Math.round((hours / 24) * 10) / 10;
  return `-${Number.isInteger(days) ? days.toFixed(0) : days}D`;
}
