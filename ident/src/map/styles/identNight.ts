import type { StyleSpecification } from "../maplibre";
import openFreeMapDark from "./identNight.openfreemap.json";
import { makeIdentNightStyle } from "./identStyle";

export const identNightStyle = makeIdentNightStyle(
  openFreeMapDark as StyleSpecification,
);
