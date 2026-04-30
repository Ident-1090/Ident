import type { Aircraft } from "./types";

export const RECENCY_LIVE_MAX_SEC = 2;
export const RECENCY_STALE_MAX_SEC = 30;

export type RecencyTier = "live" | "stale" | "lost" | "replay";

export function aircraftRecency(
  aircraft: Aircraft,
  replaying: boolean,
): RecencyTier {
  if (replaying) return "replay";
  const seen = aircraft.seen;
  if (seen != null && seen <= RECENCY_LIVE_MAX_SEC) return "live";
  if (seen != null && seen <= RECENCY_STALE_MAX_SEC) return "stale";
  return "lost";
}
