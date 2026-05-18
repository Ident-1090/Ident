import type { Aircraft } from "../data/types";

export interface SourceLabels {
  adsb: string;
  mlat: string;
}

export function aircraftSourceLabel(
  source: Aircraft["source"],
  labels: SourceLabels,
): string {
  if (source === "mlat") return labels.mlat;
  if (
    source === "adsb_icao" ||
    source === "adsb_icao_nt" ||
    source === "adsb_other"
  ) {
    return labels.adsb;
  }
  if (source) return source;
  return "—";
}
