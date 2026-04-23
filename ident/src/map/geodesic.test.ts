import { describe, expect, it } from "vitest";
import { circleRing, destinationPoint, distanceNm } from "./geodesic";

describe("destinationPoint", () => {
  it("60 nm east of (0,0) is ~1 deg lng at the equator", () => {
    const p = destinationPoint({ lng: 0, lat: 0 }, 90, 60);
    expect(p.lat).toBeCloseTo(0, 6);
    expect(p.lng).toBeCloseTo(1, 2);
  });

  it("60 nm north of (0,0) is ~1 deg lat", () => {
    const p = destinationPoint({ lng: 0, lat: 0 }, 0, 60);
    expect(p.lng).toBeCloseTo(0, 6);
    expect(p.lat).toBeCloseTo(1, 2);
  });

  it("keeps lng normalized to [-180, 180] across the antimeridian", () => {
    const p = destinationPoint({ lng: 179, lat: 0 }, 90, 300);
    expect(p.lng).toBeGreaterThanOrEqual(-180);
    expect(p.lng).toBeLessThanOrEqual(180);
    expect(p.lng).toBeLessThan(0);
  });
});

describe("distanceNm", () => {
  it("round-trips destinationPoint at ~100 nm", () => {
    const a = { lng: -74, lat: 40.7 };
    const b = destinationPoint(a, 90, 100);
    expect(distanceNm(a, b)).toBeCloseTo(100, 3);
  });

  it("is zero for identical points", () => {
    expect(distanceNm({ lng: 0, lat: 0 }, { lng: 0, lat: 0 })).toBeCloseTo(
      0,
      9,
    );
  });
});

describe("circleRing", () => {
  it("returns numPoints + 1 closed vertices", () => {
    const ring = circleRing({ lng: 0, lat: 0 }, 50, 4);
    expect(ring.length).toBe(5);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("all vertices are ~radiusNm from center", () => {
    const center = { lng: 0, lat: 0 };
    const ring = circleRing(center, 50, 4);
    for (const [lng, lat] of ring) {
      expect(distanceNm(center, { lng, lat })).toBeCloseTo(50, 3);
    }
  });

  it("produces sane bounds at lat 40, radius 100 nm", () => {
    const center = { lng: -100, lat: 40 };
    const ring = circleRing(center, 100, 64);
    const lats = ring.map(([, lat]) => lat);
    const lngs = ring.map(([lng]) => lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    // Lat span: ~100 nm = ~1.667 deg on each side.
    expect(maxLat - minLat).toBeGreaterThan(3);
    expect(maxLat - minLat).toBeLessThan(3.7);
    // Lng span stretches with 1/cos(lat40) ≈ 1.305 per deg.
    expect(maxLng - minLng).toBeGreaterThan(3.8);
    expect(maxLng - minLng).toBeLessThan(4.8);
    // Every vertex is at ~100 nm from center.
    for (const [lng, lat] of ring) {
      expect(distanceNm(center, { lng, lat })).toBeCloseTo(100, 3);
    }
  });
});
