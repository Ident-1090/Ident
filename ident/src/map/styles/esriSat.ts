import type { StyleSpecification } from "../maplibre";
import { overlayGlyphs } from "./glyphs";

export const esriSatStyle: StyleSpecification = {
  version: 8,
  glyphs: overlayGlyphs,
  sources: {
    "esri-sat": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        "Imagery \u00a9 Esri \u2014 Maxar, Earthstar Geographics, GIS User Community",
    },
  },
  layers: [
    {
      id: "esri-sat",
      type: "raster",
      source: "esri-sat",
    },
  ],
};
