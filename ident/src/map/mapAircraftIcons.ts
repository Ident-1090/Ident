import type { Aircraft } from "../data/types";
import type { Map as MlMap } from "./maplibre";

export const AIRCRAFT_ARROW_ICON_ID = "ident-aircraft-arrow";

const AIRCRAFT_ICON_DEFS = [
  {
    id: AIRCRAFT_ARROW_ICON_ID,
    image: createAircraftArrowIcon(),
  },
] as const;

export function aircraftIconId(_ac: Aircraft): string {
  return AIRCRAFT_ARROW_ICON_ID;
}

export function ensureAircraftIcons(map: MlMap): void {
  for (const def of AIRCRAFT_ICON_DEFS) {
    if (map.hasImage(def.id)) continue;
    map.addImage(def.id, def.image, { sdf: true, pixelRatio: 2 });
  }
}

function createAircraftArrowIcon(): {
  width: number;
  height: number;
  data: Uint8ClampedArray;
} {
  const width = 32;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);
  const body: Array<[number, number]> = [
    [16, 2],
    [26, 28],
    [16, 22],
    [6, 28],
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pointInPolygon(x + 0.5, y + 0.5, body)) continue;
      const i = (y * width + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function pointInPolygon(
  x: number,
  y: number,
  polygon: Array<[number, number]>,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const crosses = yi > y !== yj > y;
    if (!crosses) continue;
    const atX = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (x < atX) inside = !inside;
  }
  return inside;
}
