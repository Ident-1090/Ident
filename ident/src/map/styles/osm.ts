import type { StyleSpecification } from "../maplibre";
import { overlayGlyphs } from "./glyphs";

export const osmStyle: StyleSpecification = {
  version: 8,
  glyphs: overlayGlyphs,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "\u00a9 OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
    },
  ],
};
