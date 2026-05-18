import type { ReceiverJson } from "./types";

// Site tag = relay-configured station name (pushed via the `config` WS
// channel) or the second whitespace-delimited field in readsb's version
// string as a fallback. Ident carries no receiver-hex slot yet.
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
