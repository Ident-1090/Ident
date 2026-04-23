import type {
  AltitudeUnit,
  ClockMode,
  DistanceUnit,
  HorizontalSpeedUnit,
  TemperatureUnit,
  UnitMode,
  UnitOverrides,
  VerticalSpeedUnit,
} from "../data/types";

const FT_TO_M = 0.3048;
const KT_TO_KMH = 1.852;
const KT_TO_MPH = 1.150779;
const NM_TO_KM = 1.852;
const NM_TO_MI = 1.150779;
const FPM_TO_MPS = 0.00508;

export interface Quantity {
  value: string;
  unit: string;
}

export function presetUnitOverrides(
  mode: Exclude<UnitMode, "custom">,
): UnitOverrides {
  switch (mode) {
    case "metric":
      return {
        altitude: "m",
        horizontalSpeed: "km/h",
        distance: "km",
        verticalSpeed: "m/s",
        temperature: "C",
      };
    case "imperial":
      return {
        altitude: "ft",
        horizontalSpeed: "mph",
        distance: "mi",
        verticalSpeed: "ft/min",
        temperature: "F",
      };
    case "aviation":
      return {
        altitude: "ft",
        horizontalSpeed: "kt",
        distance: "nm",
        verticalSpeed: "fpm",
        temperature: "C",
      };
  }
}

export function resolveUnitOverrides(
  mode: UnitMode,
  overrides: UnitOverrides,
): UnitOverrides {
  return mode === "custom" ? overrides : presetUnitOverrides(mode);
}

export function quantityLabel(q: Quantity): string {
  return `${q.value} ${q.unit}`;
}

export function compactQuantityLabel(q: Quantity): string {
  return `${q.value}${q.unit}`;
}

export function altitudeFromFeet(ft: number, unit: AltitudeUnit): Quantity {
  if (unit === "m") {
    return { value: Math.round(ft * FT_TO_M).toLocaleString(), unit: "m" };
  }
  return { value: Math.round(ft).toLocaleString(), unit: "ft" };
}

export function altitudeLabelFromFeet(ft: number, unit: AltitudeUnit): string {
  return quantityLabel(altitudeFromFeet(ft, unit));
}

export function compactAltitudeFromFeet(
  ft: number,
  unit: AltitudeUnit,
): string {
  return compactQuantityLabel(altitudeFromFeet(ft, unit));
}

export function altitudeBandLabelFromFeet(
  minFt: number | null,
  maxFt: number | null,
  unit: AltitudeUnit,
): string {
  if (minFt == null && maxFt != null)
    return `< ${altitudeLabelFromFeet(maxFt, unit)}`;
  if (minFt != null && maxFt == null)
    return `> ${altitudeLabelFromFeet(minFt, unit)}`;
  if (minFt != null && maxFt != null) {
    return `${altitudeLabelFromFeet(minFt, unit)}-${altitudeLabelFromFeet(maxFt, unit)}`;
  }
  return "—";
}

export function verticalRateFromFpm(
  fpm: number,
  unit: VerticalSpeedUnit,
): Quantity {
  if (unit === "m/s") {
    return { value: Math.abs(fpm * FPM_TO_MPS).toFixed(1), unit: "m/s" };
  }
  return { value: Math.abs(Math.round(fpm)).toLocaleString(), unit };
}

export function airSpeedFromKnots(
  knots: number,
  unit: HorizontalSpeedUnit,
): Quantity {
  if (unit === "km/h") {
    return {
      value: Math.round(knots * KT_TO_KMH).toLocaleString(),
      unit: "km/h",
    };
  }
  if (unit === "mph") {
    return {
      value: Math.round(knots * KT_TO_MPH).toLocaleString(),
      unit: "mph",
    };
  }
  return { value: Math.round(knots).toLocaleString(), unit: "kt" };
}

export function airSpeedLabelFromKnots(
  knots: number,
  unit: HorizontalSpeedUnit,
): string {
  return quantityLabel(airSpeedFromKnots(knots, unit));
}

export function compactAirSpeedFromKnots(
  knots: number,
  unit: HorizontalSpeedUnit,
): string {
  return compactQuantityLabel(airSpeedFromKnots(knots, unit));
}

export function airDistanceFromNm(
  nm: number,
  unit: DistanceUnit,
  fractionDigits = 1,
): Quantity {
  if (unit === "km") {
    return { value: (nm * NM_TO_KM).toFixed(fractionDigits), unit: "km" };
  }
  if (unit === "mi") {
    return { value: (nm * NM_TO_MI).toFixed(fractionDigits), unit: "mi" };
  }
  return { value: nm.toFixed(fractionDigits), unit: "nm" };
}

export function airDistanceLabelFromNm(
  nm: number,
  unit: DistanceUnit,
  fractionDigits = 1,
): string {
  return quantityLabel(airDistanceFromNm(nm, unit, fractionDigits));
}

export function airDistanceLabelFromMeters(
  meters: number,
  unit: DistanceUnit,
  fractionDigits = unit === "nm" ? 1 : 2,
): string {
  return airDistanceLabelFromNm(meters / 1852, unit, fractionDigits);
}

export function mapDistanceLabelFromNm(nm: number, unit: DistanceUnit): string {
  return airDistanceLabelFromNm(nm, unit, 0);
}

export function distanceMeaning(
  n: number | undefined,
  mapMeters: Record<number, number>,
  unit: DistanceUnit,
): string {
  if (n == null) return "—";
  const meters = mapMeters[n];
  if (meters == null) return String(n);
  return `${n} (<${airDistanceLabelFromMeters(meters, unit)})`;
}

export function temperatureFromC(
  celsius: number,
  unit: TemperatureUnit,
): Quantity {
  if (unit === "F") {
    return {
      value: Math.round((celsius * 9) / 5 + 32).toLocaleString(),
      unit: "°F",
    };
  }
  return { value: Math.round(celsius).toLocaleString(), unit: "°C" };
}

export function temperatureLabelFromC(
  celsius: number,
  unit: TemperatureUnit,
): string {
  return quantityLabel(temperatureFromC(celsius, unit));
}

export function formatClock(
  date: Date,
  clock: ClockMode,
): { label: string; value: string } {
  if (clock === "local") {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return { label: "Local", value: `${hh}:${mm}:${ss}` };
  }
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return { label: "UTC", value: `${hh}:${mm}:${ss}Z` };
}
