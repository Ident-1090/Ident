import type { HeyWhatsThatJson } from "./types";

// HeyWhatsThat LOS rings live alongside Ident's static assets.
const LOS_PATH = "/data/upintheair.json";

let losDataCache: Promise<HeyWhatsThatJson | null> | null = null;

export function loadLosData(): Promise<HeyWhatsThatJson | null> {
  if (!losDataCache) {
    losDataCache = fetch(LOS_PATH)
      .then((res) =>
        res.ok ? (res.json() as Promise<HeyWhatsThatJson>) : null,
      )
      .catch(() => null);
  }
  return losDataCache;
}

export function resetLosDataCacheForTests(): void {
  losDataCache = null;
}
