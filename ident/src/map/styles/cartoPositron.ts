import type { StyleSpecification } from "../maplibre";
import { overlayGlyphs } from "./glyphs";

export const cartoPositronStyle: StyleSpecification = {
  version: 8,
  glyphs: overlayGlyphs,
  sources: {
    "carto-positron": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "\u00a9 OpenStreetMap contributors \u00a9 CARTO",
    },
  },
  layers: [
    {
      id: "carto-positron",
      type: "raster",
      source: "carto-positron",
    },
  ],
};
