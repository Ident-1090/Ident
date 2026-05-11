import type { StyleSpecification } from "../maplibre";
import { overlayGlyphs } from "./glyphs";

const ESRI_SAT_TILES = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
];

const ESRI_SAT_ATTRIBUTION =
  "Imagery \u00a9 Esri \u2014 Maxar, Earthstar Geographics, GIS User Community";

export const esriSatDayStyle: StyleSpecification = {
  version: 8,
  glyphs: overlayGlyphs,
  sources: {
    "esri-sat": {
      type: "raster",
      tiles: ESRI_SAT_TILES,
      tileSize: 256,
      maxzoom: 19,
      attribution: ESRI_SAT_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: "esri-sat",
      type: "raster",
      source: "esri-sat",
      paint: {
        "raster-saturation": -0.35,
        "raster-brightness-min": 0,
        "raster-brightness-max": 0.62,
        "raster-contrast": 0.06,
      },
    },
  ],
};

export const esriSatNightStyle: StyleSpecification = {
  version: 8,
  glyphs: overlayGlyphs,
  sources: {
    "esri-sat": {
      type: "raster",
      tiles: ESRI_SAT_TILES,
      tileSize: 256,
      maxzoom: 19,
      attribution: ESRI_SAT_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#0b0d10" },
    },
    {
      id: "esri-sat-dark",
      type: "raster",
      source: "esri-sat",
      paint: {
        "raster-saturation": -0.45,
        "raster-brightness-min": 0,
        "raster-brightness-max": 0.52,
        "raster-contrast": 0.08,
      },
    },
  ],
};
