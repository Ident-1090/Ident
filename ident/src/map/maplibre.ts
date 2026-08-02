import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibre from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

maplibre.setWorkerUrl(maplibreWorkerUrl);

declare global {
  interface Window {
    maplibregl?: typeof maplibre;
  }
}

export function getMaplibre(): typeof maplibre {
  return window.maplibregl ?? maplibre;
}

export type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  ExpressionSpecification,
  GeoJSONSource,
  LayerSpecification,
  LngLatLike,
  Map,
  MapLibreEvent,
  SourceSpecification,
  StyleSpecification,
} from "maplibre-gl";
