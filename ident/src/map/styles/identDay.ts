import type { StyleSpecification } from "../maplibre";
import identDayBaseStyle from "./identDay.openfreemap.json";
import { makeIdentDayStyle } from "./identStyle";

export const identDayStyle = makeIdentDayStyle(
  identDayBaseStyle as StyleSpecification,
);
