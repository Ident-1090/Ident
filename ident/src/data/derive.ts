const NM_PER_RAD = (180 * 60) / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export function haversineNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const φ1 = lat1 * DEG_TO_RAD;
  const φ2 = lat2 * DEG_TO_RAD;
  const dφ = (lat2 - lat1) * DEG_TO_RAD;
  const dλ = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a))) * NM_PER_RAD;
}

export function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const φ1 = lat1 * DEG_TO_RAD;
  const φ2 = lat2 * DEG_TO_RAD;
  const dλ = (lon2 - lon1) * DEG_TO_RAD;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  const θ = Math.atan2(y, x);
  return (θ / DEG_TO_RAD + 360) % 360;
}

export function deadReckon(
  lat: number,
  lon: number,
  gsKn: number,
  trackDeg: number,
  dtSec: number,
): { lat: number; lon: number } {
  const distNm = (gsKn * dtSec) / 3600;
  const bearingRad = trackDeg * DEG_TO_RAD;
  const φ1 = lat * DEG_TO_RAD;
  const λ1 = lon * DEG_TO_RAD;
  const δ = distNm / NM_PER_RAD;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) +
      Math.cos(φ1) * Math.sin(δ) * Math.cos(bearingRad),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return { lat: φ2 / DEG_TO_RAD, lon: ((λ2 / DEG_TO_RAD + 540) % 360) - 180 };
}
