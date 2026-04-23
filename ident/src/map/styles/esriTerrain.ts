import type { StyleSpecification } from "../maplibre";
import { overlayGlyphs } from "./glyphs";

const ESRI_ATTRIBUTION =
  "Tiles \u00a9 Esri \u2014 Source: Esri, Airbus, USGS, NGA, NASA, CGIAR, NRCAN, JAXA, Intermap";

const TOPO_TILES = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
];

export const esriTerrainDayStyle: StyleSpecification = {
  version: 8,
  glyphs: overlayGlyphs,
  sources: {
    "esri-topo": {
      type: "raster",
      tiles: TOPO_TILES,
      tileSize: 256,
      maxzoom: 19,
      attribution: ESRI_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: "esri-topo",
      type: "raster",
      source: "esri-topo",
      paint: {
        "raster-saturation": -0.7,
      },
    },
  ],
};

// Night reuses World Topo but pulls saturation near zero and clamps brightness
// so the light source reads as a dark grayscale terrain instead of a bright
// day map. No separate night tile service exists for full topo, so we
// transform the day tiles client-side via raster paint properties.
export const esriTerrainNightStyle: StyleSpecification = {
  version: 8,
  glyphs: overlayGlyphs,
  sources: {
    "esri-topo": {
      type: "raster",
      tiles: TOPO_TILES,
      tileSize: 256,
      maxzoom: 19,
      attribution: ESRI_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#0f1216" },
    },
    {
      id: "esri-topo-dark",
      type: "raster",
      source: "esri-topo",
      paint: {
        "raster-saturation": -0.9,
        "raster-brightness-min": 0,
        "raster-brightness-max": 0.45,
        "raster-contrast": 0.1,
      },
    },
  ],
};
