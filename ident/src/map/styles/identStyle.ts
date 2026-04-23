import type { LayerSpecification, StyleSpecification } from "../maplibre";

type MutableLayer = LayerSpecification & {
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

const DAY_MUTED_PLACE_LABELS = new Set([
  "label_other",
  "label_village",
  "label_town",
  "label_city",
  "label_city_capital",
]);

const DAY_CONTEXT_PLACE_LABELS = new Set([
  "label_state",
  "label_country_1",
  "label_country_2",
  "label_country_3",
]);

export function makeIdentDayStyle(
  base: StyleSpecification,
): StyleSpecification {
  return makeIdentStyle(base, "day");
}

export function makeIdentNightStyle(
  base: StyleSpecification,
): StyleSpecification {
  return makeIdentStyle(base, "night");
}

function makeIdentStyle(
  base: StyleSpecification,
  mode: "day" | "night",
): StyleSpecification {
  const style = cloneStyle(base);
  style.name = mode === "day" ? "ident-day" : "ident-night";
  if (mode === "day") {
    style.layers = style.layers?.map(tuneDayLayer);
  }
  return style;
}

function tuneDayLayer(layer: LayerSpecification): LayerSpecification {
  if (DAY_MUTED_PLACE_LABELS.has(layer.id)) {
    const next = cloneLayer(layer);
    next.paint = {
      ...next.paint,
      "text-color": "#46525a",
      "text-opacity": 0.42,
      "text-halo-color": "rgba(247, 251, 251, 0.56)",
      "text-halo-width": 0.8,
      "icon-opacity": 0.24,
    };
    return next;
  }
  if (DAY_CONTEXT_PLACE_LABELS.has(layer.id)) {
    const next = cloneLayer(layer);
    next.paint = {
      ...next.paint,
      "text-color": "#657078",
      "text-opacity": 0.38,
      "text-halo-color": "rgba(247, 251, 251, 0.48)",
      "text-halo-width": 0.7,
    };
    return next;
  }
  return layer;
}

function cloneStyle(base: StyleSpecification): StyleSpecification {
  return JSON.parse(JSON.stringify(base)) as StyleSpecification;
}

function cloneLayer(layer: LayerSpecification): MutableLayer {
  return JSON.parse(JSON.stringify(layer)) as MutableLayer;
}
