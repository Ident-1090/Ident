import { ICAO_COUNTRY_RANGES } from "./icaoCountryRanges";

export interface IcaoCountry {
  country: string;
  countryCode: string | null;
}

const UNASSIGNED_RANGE: IcaoCountry = {
  country: "Unassigned",
  countryCode: null,
};

export function findIcaoCountry(hex: string | undefined): IcaoCountry {
  if (!hex) return UNASSIGNED_RANGE;

  const normalized = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(normalized)) return UNASSIGNED_RANGE;

  const numeric = Number.parseInt(normalized, 16);
  for (const [start, end, country, countryCode] of ICAO_COUNTRY_RANGES) {
    if (numeric >= start && numeric <= end) {
      return { country, countryCode };
    }
  }

  return UNASSIGNED_RANGE;
}
