import type { Aircraft } from "./types";

export const RECENCY_LIVE_MAX_SEC = 2;
export const RECENCY_STALE_MAX_SEC = 30;

export type RecencyTier = "live" | "stale" | "lost" | "replay";

export function aircraftRecency(
  aircraft: Aircraft,
  replaying: boolean,
): RecencyTier {
  if (replaying) return "replay";
  const seen = aircraft.seenSec;
  if (seen != null && seen <= RECENCY_LIVE_MAX_SEC) return "live";
  if (seen != null && seen <= RECENCY_STALE_MAX_SEC) return "stale";
  return "lost";
}

export function relativeTimeAgo(
  epochMs: number,
  nowMs: number = Date.now(),
): string {
  const sec = Math.max(0, Math.floor((nowMs - epochMs) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
