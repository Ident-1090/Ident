import { describe, expect, it } from "vitest";
import type { Aircraft } from "../data/types";
import { aircraftIconId } from "./mapAircraftIcons";

describe("aircraftIconId", () => {
  it("uses the aircraft type before ground altitude state", () => {
    const aircraft: Aircraft = {
      hex: "a00001",
      t: "C172",
      alt_baro: "ground",
      airground: "ground",
      category: "A1",
    };

    expect(aircraftIconId(aircraft)).toBe("ident-ac-prop-se-piston");
  });

  it("uses surface categories for ground vehicles", () => {
    expect(aircraftIconId({ hex: "a00002", category: "C2" })).toBe(
      "ident-ac-ground-service",
    );
    expect(aircraftIconId({ hex: "a00003", t: "TWR" })).toBe(
      "ident-ac-ground-tower",
    );
  });
});
