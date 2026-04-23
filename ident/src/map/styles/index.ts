import type { StyleSpecification } from "../maplibre";
import { cartoDarkStyle } from "./cartoDark";
import { cartoPositronStyle } from "./cartoPositron";
import { esriSatStyle } from "./esriSat";
import { esriTerrainDayStyle, esriTerrainNightStyle } from "./esriTerrain";
import { identDayStyle } from "./identDay";
import { identNightStyle } from "./identNight";
import { osmStyle } from "./osm";

export type BasemapId =
  | "ident"
  | "osm"
  | "cartoPositron"
  | "cartoDark"
  | "esriSat"
  | "esriTerrain";

export interface BasemapDef {
  id: BasemapId;
  label: string;
  tooltip: string;
  // Whether the basemap itself renders dark. For `ident` this reflects the
  // Day variant; callers that care about the resolved Night theme should
  // branch on the app theme directly rather than reading this field.
  isDark: boolean;
  group: "primary" | "others";
  style: string | StyleSpecification;
}

export const BASEMAPS: Record<BasemapId, BasemapDef> = {
  ident: {
    id: "ident",
    label: "MAP",
    tooltip: "Regular map",
    isDark: false,
    group: "primary",
    style: identDayStyle,
  },
  esriSat: {
    id: "esriSat",
    label: "SAT",
    tooltip: "Satellite map",
    isDark: true,
    group: "primary",
    style: esriSatStyle,
  },
  esriTerrain: {
    id: "esriTerrain",
    label: "TER",
    tooltip: "Terrain map",
    isDark: false,
    group: "primary",
    style: esriTerrainDayStyle,
  },
  osm: {
    id: "osm",
    label: "OSM",
    tooltip: "OpenStreetMap",
    isDark: false,
    group: "others",
    style: osmStyle,
  },
  cartoPositron: {
    id: "cartoPositron",
    label: "POSITRON",
    tooltip: "Positron map",
    isDark: false,
    group: "others",
    style: cartoPositronStyle,
  },
  cartoDark: {
    id: "cartoDark",
    label: "DARK",
    tooltip: "Dark map",
    isDark: true,
    group: "others",
    style: cartoDarkStyle,
  },
};

export function resolveBasemapStyle(
  id: BasemapId,
  themeIsDark: boolean,
): string | StyleSpecification {
  if (id === "ident") return themeIsDark ? identNightStyle : identDayStyle;
  if (id === "esriTerrain")
    return themeIsDark ? esriTerrainNightStyle : esriTerrainDayStyle;
  return BASEMAPS[id].style;
}

export {
  cartoDarkStyle,
  cartoPositronStyle,
  esriSatStyle,
  esriTerrainDayStyle,
  esriTerrainNightStyle,
  identDayStyle,
  identNightStyle,
  osmStyle,
};
