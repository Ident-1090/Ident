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
        "raster-saturation": -0.75,
        "raster-brightness-min": 0,
        "raster-brightness-max": 0.76,
        "raster-contrast": 0.1,
      },
    },
  ],
};

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
        "raster-saturation": -0.95,
        "raster-brightness-min": 0,
        "raster-brightness-max": 0.38,
        "raster-contrast": 0.1,
      },
    },
  ],
};
