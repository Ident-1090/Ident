import type { Map as MlMap } from "maplibre-gl";
import { createContext, useContext } from "react";

interface MapEngineContextValue {
  map: MlMap | null;
  isReady: boolean;
}

export const MapEngineContext = createContext<MapEngineContextValue>({
  map: null,
  isReady: false,
});

export function useMap(): MapEngineContextValue {
  return useContext(MapEngineContext);
}
