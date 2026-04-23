// Great-circle math used by range rings and other geodesic overlays.
// All functions are pure and independent of MapLibre / React.

export interface LngLat {
  lng: number;
  lat: number;
}

// Mean Earth radius in nautical miles.
const EARTH_RADIUS_NM = 3440.065;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function normalizeLng(lng: number): number {
  // Map any real lng into [-180, 180].
  let x = ((((lng + 180) % 360) + 360) % 360) - 180;
  // Handle the edge case where the modulo returns -180 vs 180; prefer -180
  // consistently so ring-closure comparisons behave.
  if (x === 180) x = -180;
  return x;
}

/**
 * Haversine forward solution: destination point given a start, initial bearing
 * (degrees clockwise from true north) and a great-circle distance in nm.
 */
export function destinationPoint(
  start: LngLat,
  bearingDeg: number,
  distanceNm: number,
): LngLat {
  const angular = distanceNm / EARTH_RADIUS_NM;
  const bearing = bearingDeg * DEG_TO_RAD;
  const lat1 = start.lat * DEG_TO_RAD;
  const lng1 = start.lng * DEG_TO_RAD;

  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAng = Math.sin(angular);
  const cosAng = Math.cos(angular);

  const sinLat2 = sinLat1 * cosAng + cosLat1 * sinAng * Math.cos(bearing);
  const lat2 = Math.asin(sinLat2);
  const y = Math.sin(bearing) * sinAng * cosLat1;
  const x = cosAng - sinLat1 * sinLat2;
  const lng2 = lng1 + Math.atan2(y, x);

  return {
    lat: lat2 * RAD_TO_DEG,
    lng: normalizeLng(lng2 * RAD_TO_DEG),
  };
}

/**
 * Closed GeoJSON-style ring (first point repeated as last) of `numPoints`
 * vertices at `radiusNm` from `center`, sampled at uniform bearings.
 */
export function circleRing(
  center: LngLat,
  radiusNm: number,
  numPoints = 64,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < numPoints; i++) {
    const bearing = (i * 360) / numPoints;
    const p = destinationPoint(center, bearing, radiusNm);
    pts.push([p.lng, p.lat]);
  }
  pts.push(pts[0]);
  return pts;
}

/**
 * Haversine great-circle distance between two points, in nautical miles.
 */
export function distanceNm(a: LngLat, b: LngLat): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_NM * c;
}
