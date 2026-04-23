import type { StyleSpecification } from "../maplibre";
import { overlayGlyphs } from "./glyphs";

export const cartoDarkStyle: StyleSpecification = {
  version: 8,
  glyphs: overlayGlyphs,
  sources: {
    "carto-dark": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "\u00a9 OpenStreetMap contributors \u00a9 CARTO",
    },
  },
  layers: [
    {
      id: "carto-dark",
      type: "raster",
      source: "carto-dark",
    },
  ],
};
