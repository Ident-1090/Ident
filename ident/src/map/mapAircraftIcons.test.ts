import { describe, expect, it } from "vitest";
import type { Aircraft } from "../data/types";
import { aircraftIconId } from "./mapAircraftIcons";

describe("aircraftIconId", () => {
  it("uses the aircraft type before ground altitude state", () => {
    const aircraft: Aircraft = {
      hex: "a00001",
      idKind: "icao",
      source: "adsb_icao",
      typeDesignator: "C172",
      onGround: true,
      cat: "A1",
    };

    expect(aircraftIconId(aircraft)).toBe("ident-ac-prop-se-piston");
  });

  it("uses surface categories for ground vehicles", () => {
    expect(
      aircraftIconId({
        hex: "a00002",
        idKind: "icao",
        source: "adsb_icao",
        cat: "C2",
      }),
    ).toBe("ident-ac-ground-service");
    expect(
      aircraftIconId({
        hex: "a00003",
        idKind: "icao",
        source: "adsb_icao",
        typeDesignator: "TWR",
      }),
    ).toBe("ident-ac-ground-tower");
  });
});
