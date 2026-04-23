import type { ReceiverJson } from "./types";

// Site tag = relay-configured station name (pushed via the `config` WS
// channel) or the second whitespace-delimited token in readsb's version
// string as a fallback (e.g. "3.16.10 wiedehopf git: 7d341c6 ..." →
// "wiedehopf"). Ident carries no receiver-hex slot yet.
export function formatSiteTag(
  receiver: ReceiverJson | null,
  stationOverride: string | null,
): string | null {
  if (stationOverride) return stationOverride;
  const v = receiver?.version;
  if (!v) return null;
  const parts = v.trim().split(/\s+/);
  const station =
    parts.length >= 2 && !/^git:?$/i.test(parts[1]) ? parts[1] : parts[0];
  return station || null;
}
