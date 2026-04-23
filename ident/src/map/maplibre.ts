// Types come from the `maplibre-gl` devDep; the runtime is loaded from
// jsdelivr via `<script>` in index.html and lives on window.maplibregl. This
// module is the single import site for the rest of the app so we never
// accidentally pull the library into the bundle.
import type mlgl from "maplibre-gl";

declare global {
  interface Window {
    maplibregl: typeof mlgl;
  }
}

export function getMaplibre(): typeof mlgl {
  const g = window.maplibregl;
  if (!g) throw new Error("maplibregl runtime not loaded");
  return g;
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
