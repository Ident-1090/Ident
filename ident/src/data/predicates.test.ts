import { describe, expect, it } from "vitest";
import { categoryKeyFor, matchesFilter } from "./predicates";
import type { Aircraft } from "./types";

function mkAc(over: Partial<Aircraft> = {}): Aircraft {
  return {
    hex: "a1b2c3",
    seen: 0,
    type: "adsb_icao",
    airground: 0,
    ...over,
  };
}

describe("matchesFilter", () => {
  it("empty filter matches anything", () => {
    expect(matchesFilter(mkAc(), {})).toBe(true);
  });

  it("hideGround drops airground=1", () => {
    expect(matchesFilter(mkAc({ airground: 1 }), { hideGround: true })).toBe(
      false,
    );
    expect(matchesFilter(mkAc({ airground: 0 }), { hideGround: true })).toBe(
      true,
    );
  });

  it("positionOnly drops AC without lat/lon", () => {
    expect(
      matchesFilter(mkAc({ lat: 37, lon: -122 }), { positionOnly: true }),
    ).toBe(true);
    expect(matchesFilter(mkAc({}), { positionOnly: true })).toBe(false);
  });

  it("emergencyOnly requires a non-none emergency string", () => {
    expect(
      matchesFilter(mkAc({ emergency: "general" }), { emergencyOnly: true }),
    ).toBe(true);
    expect(
      matchesFilter(mkAc({ emergency: "none" }), { emergencyOnly: true }),
    ).toBe(false);
    expect(matchesFilter(mkAc({}), { emergencyOnly: true })).toBe(false);
  });

  it("altitude range filters correctly", () => {
    const f = { altMinFt: 10_000, altMaxFt: 40_000 };
    expect(matchesFilter(mkAc({ alt_baro: 5_000 }), f)).toBe(false);
    expect(matchesFilter(mkAc({ alt_baro: 25_000 }), f)).toBe(true);
    expect(matchesFilter(mkAc({ alt_baro: 50_000 }), f)).toBe(false);
    expect(matchesFilter(mkAc({ alt_baro: "ground" }), f)).toBe(false);
  });

  it("category filter uses A/B/C letter prefix", () => {
    const f = { categories: new Set(["A"]) };
    expect(matchesFilter(mkAc({ category: "A3" }), f)).toBe(true);
    expect(matchesFilter(mkAc({ category: "B1" }), f)).toBe(false);
  });

  it("category filter accepts semantic keys (airline/ga/bizjet/mil/rotor)", () => {
    const allOff = {
      airline: false,
      ga: false,
      bizjet: false,
      mil: false,
      rotor: false,
      unknown: false,
    };
    // Empty-selection = match anything.
    expect(
      matchesFilter(mkAc({ category: "A3" }), { categories: { ...allOff } }),
    ).toBe(true);
    // A3 is an airline; selecting airline keeps it, selecting only ga drops it.
    expect(
      matchesFilter(mkAc({ category: "A3" }), {
        categories: { ...allOff, airline: true },
      }),
    ).toBe(true);
    expect(
      matchesFilter(mkAc({ category: "A3" }), {
        categories: { ...allOff, ga: true },
      }),
    ).toBe(false);
    // A7 is rotor.
    expect(
      matchesFilter(mkAc({ category: "A7" }), {
        categories: { ...allOff, rotor: true },
      }),
    ).toBe(true);
    // Uncategorised aircraft are filtered out when any key is selected.
    expect(
      matchesFilter(mkAc({}), { categories: { ...allOff, airline: true } }),
    ).toBe(false);
  });

  it("altRangeFt alias behaves like altMinFt/altMaxFt", () => {
    const f = { altRangeFt: [10_000, 40_000] as [number, number] };
    expect(matchesFilter(mkAc({ alt_baro: 5_000 }), f)).toBe(false);
    expect(matchesFilter(mkAc({ alt_baro: 25_000 }), f)).toBe(true);
    expect(matchesFilter(mkAc({ alt_baro: 50_000 }), f)).toBe(false);
  });

  it("emergOnly / hasPosOnly aliases behave like legacy fields", () => {
    expect(
      matchesFilter(mkAc({ emergency: "general" }), { emergOnly: true }),
    ).toBe(true);
    expect(
      matchesFilter(mkAc({ emergency: "none" }), { emergOnly: true }),
    ).toBe(false);
    expect(matchesFilter(mkAc({}), { hasPosOnly: true })).toBe(false);
    expect(matchesFilter(mkAc({ lat: 0, lon: 0 }), { hasPosOnly: true })).toBe(
      true,
    );
  });

  it("query matches hex, callsign, registration, squawk (case-insensitive)", () => {
    const ac = mkAc({
      hex: "a1b2c3",
      flight: "UAL123",
      r: "N123AB",
      squawk: "1234",
    });
    expect(matchesFilter(ac, { query: "UAL" })).toBe(true);
    expect(matchesFilter(ac, { query: "ual" })).toBe(true);
    expect(matchesFilter(ac, { query: "n123" })).toBe(true);
    expect(matchesFilter(ac, { query: "1234" })).toBe(true);
    expect(matchesFilter(ac, { query: "zzz" })).toBe(false);
  });

  it("query also matches cached route origin and destination text", () => {
    const ac = mkAc({ flight: "UAL123" });
    const routeByCallsign = {
      UAL123: { origin: "BOS", destination: "SNA", route: "BOS-SFO-SNA" },
    };
    expect(matchesFilter(ac, { query: "bos", routeByCallsign })).toBe(true);
    expect(matchesFilter(ac, { query: "sfo", routeByCallsign })).toBe(true);
    expect(matchesFilter(ac, { query: "sna", routeByCallsign })).toBe(true);
    expect(matchesFilter(ac, { query: "ord", routeByCallsign })).toBe(false);
  });

  it("matches plain query text exactly as provided by callers", () => {
    const ac = mkAc({ flight: "UAL123" });
    expect(matchesFilter(ac, { query: "UAL" })).toBe(true);
    expect(matchesFilter(ac, { query: "filter: UAL" })).toBe(false);
  });

  it("matches any expression branch while keeping global query text conjunctive", () => {
    const branches = [
      { callsignPrefix: "FDX" },
      { callsignPrefix: "UPS", altRangeFt: [5000, 45000] as [number, number] },
    ];
    expect(
      matchesFilter(mkAc({ flight: "FDX123", r: "N1FX" }), {
        expressionBranches: branches,
      }),
    ).toBe(true);
    expect(
      matchesFilter(mkAc({ flight: "UPS123", alt_baro: 7000, r: "N2UP" }), {
        expressionBranches: branches,
      }),
    ).toBe(true);
    expect(
      matchesFilter(mkAc({ flight: "UPS123", alt_baro: 3000, r: "N2UP" }), {
        expressionBranches: branches,
      }),
    ).toBe(false);
    expect(
      matchesFilter(mkAc({ flight: "FDX123", r: "N1FX" }), {
        expressionBranches: branches,
        query: "N1",
      }),
    ).toBe(true);
    expect(
      matchesFilter(mkAc({ flight: "FDX123", r: "N1FX" }), {
        expressionBranches: branches,
        query: "ZZZ",
      }),
    ).toBe(false);
  });

  it("countryContains matches ICAO allocation country code and name", () => {
    const ac = mkAc({ hex: "a8469e" });
    expect(matchesFilter(ac, { countryContains: "us" })).toBe(true);
    expect(matchesFilter(ac, { countryContains: "united" })).toBe(true);
    expect(matchesFilter(ac, { countryContains: "gb" })).toBe(false);
  });
});

describe("categoryKeyFor", () => {
  it("dbFlags & 1 classifies as mil regardless of category letter", () => {
    expect(categoryKeyFor("A5", 1)).toBe("mil");
    expect(categoryKeyFor("A1", 3)).toBe("mil");
    expect(categoryKeyFor(undefined, 1)).toBe("mil");
  });

  it("dbFlags without the mil bit falls through to category mapping", () => {
    expect(categoryKeyFor("A5", 0)).toBe("airline");
    expect(categoryKeyFor("A7", 2)).toBe("rotor");
    expect(categoryKeyFor("A1")).toBe("ga");
  });
});
