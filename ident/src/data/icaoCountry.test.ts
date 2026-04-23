import { describe, expect, it } from "vitest";
import { findIcaoCountry } from "./icaoCountry";

describe("findIcaoCountry", () => {
  it("returns Unassigned with a null country code for invalid inputs", () => {
    expect(findIcaoCountry(undefined)).toEqual({
      country: "Unassigned",
      countryCode: null,
    });
    expect(findIcaoCountry("")).toEqual({
      country: "Unassigned",
      countryCode: null,
    });
    expect(findIcaoCountry("not-hex")).toEqual({
      country: "Unassigned",
      countryCode: null,
    });
    expect(findIcaoCountry("abc12")).toEqual({
      country: "Unassigned",
      countryCode: null,
    }); // too short
    expect(findIcaoCountry("abcdefg")).toEqual({
      country: "Unassigned",
      countryCode: null,
    }); // too long
  });

  it("is case-insensitive and trims whitespace", () => {
    const upper = findIcaoCountry("A8469E");
    const lower = findIcaoCountry("a8469e");
    const padded = findIcaoCountry("  a8469e  ");
    expect(upper).toEqual(lower);
    expect(padded).toEqual(lower);
    expect(upper.countryCode).toBe("US");
  });

  it("maps a known US-range hex to United States", () => {
    // 0xA8469E lives in the 0xA00000–0xAFFFFF US range.
    expect(findIcaoCountry("a8469e")).toEqual({
      country: "United States",
      countryCode: "US",
    });
  });

  it("maps a known UK-range hex to United Kingdom", () => {
    // 0x400000–0x43FFFF is United Kingdom.
    expect(findIcaoCountry("401abc")).toMatchObject({ countryCode: "GB" });
  });

  it("returns Unassigned for a hex outside every range", () => {
    // 0xFFFFFF is not assigned to any country in the ICAO block allocation.
    const result = findIcaoCountry("ffffff");
    expect(result.country).toBe("Unassigned");
    expect(result.countryCode).toBeNull();
  });
});
