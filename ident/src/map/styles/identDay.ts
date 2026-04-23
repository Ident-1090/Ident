import type { StyleSpecification } from "../maplibre";
import openFreeMapPositron from "./identDay.openfreemap.json";
import { makeIdentDayStyle } from "./identStyle";

export const identDayStyle = makeIdentDayStyle(
  openFreeMapPositron as StyleSpecification,
);
