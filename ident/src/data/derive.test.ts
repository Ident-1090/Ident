// biome-ignore-all lint/style/noNonNullAssertion: test fixture — missing elements/mocks fail the test loudly via the test runner.
import { describe, expect, it } from "vitest";
import { bearingDeg, deadReckon, haversineNm } from "./derive";

describe("haversineNm", () => {
  it("returns 0 for same point", () => {
    expect(haversineNm(37.4, -122.2, 37.4, -122.2)).toBeCloseTo(0);
  });
  it("matches a known LAX-JFK great-circle (~2145 nm)", () => {
    const d = haversineNm(33.9416, -118.4085, 40.6413, -73.7781);
    expect(d).toBeGreaterThan(2100);
    expect(d).toBeLessThan(2200);
  });
});

describe("bearingDeg", () => {
  it("due north is 0°", () => {
    expect(bearingDeg(37, -122, 38, -122)).toBeCloseTo(0, 1);
  });
  it("due east is 90°", () => {
    expect(bearingDeg(37, -122, 37, -121)).toBeCloseTo(90, 0);
  });
  it("due south is 180°", () => {
    expect(bearingDeg(37, -122, 36, -122)).toBeCloseTo(180, 1);
  });
});

describe("deadReckon", () => {
  it("projects zero distance to same point", () => {
    const p = deadReckon(37.4, -122.2, 0, 90, 1);
    expect(p.lat).toBeCloseTo(37.4);
    expect(p.lon).toBeCloseTo(-122.2);
  });
  it("projects 60 nm north in one hour at 60 kn", () => {
    const p = deadReckon(37, -122, 60, 0, 3600);
    expect(p.lat).toBeCloseTo(38, 1);
    expect(p.lon).toBeCloseTo(-122, 1);
  });
});
