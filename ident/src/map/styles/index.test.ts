import { describe, expect, it } from "vitest";
import type { LayerSpecification, StyleSpecification } from "../maplibre";
import { BASEMAPS, type BasemapId, resolveBasemapStyle } from "./index";

type PaintLayer = LayerSpecification & { paint?: Record<string, unknown> };

describe("BASEMAPS registry", () => {
  const ids: BasemapId[] = [
    "ident",
    "osm",
    "cartoPositron",
    "cartoDark",
    "esriSat",
    "esriTerrain",
  ];

  it("contains every BasemapId", () => {
    for (const id of ids) {
      expect(BASEMAPS[id]).toBeDefined();
      expect(BASEMAPS[id].id).toBe(id);
    }
  });

  it("resolves ident to distinct styles per theme", () => {
    expect(resolveBasemapStyle("ident", true)).not.toBe(
      resolveBasemapStyle("ident", false),
    );
  });

  it("uses local Ident styles so day labels can be tuned deterministically", () => {
    expect(typeof resolveBasemapStyle("ident", false)).not.toBe("string");
    expect(typeof resolveBasemapStyle("ident", true)).not.toBe("string");
  });

  it("primary group has exactly 3 members: ident, esriSat, esriTerrain", () => {
    const primary = ids.filter((id) => BASEMAPS[id].group === "primary");
    expect(primary.sort()).toEqual(["esriSat", "ident", "esriTerrain"].sort());
  });

  it("others group has exactly 3 members: osm, cartoPositron, cartoDark", () => {
    const others = ids.filter((id) => BASEMAPS[id].group === "others");
    expect(others.sort()).toEqual(["cartoDark", "cartoPositron", "osm"].sort());
  });

  it("local raster styles provide glyphs for MapLibre overlay labels", () => {
    for (const id of ids) {
      const style = resolveBasemapStyle(id, false);
      if (typeof style === "string") continue;
      expect(style.glyphs).toBeTruthy();
    }
  });

  it("mutes day-mode city labels while leaving night close to upstream", () => {
    const dayCity = findLayer(
      resolveBasemapStyle("ident", false),
      "label_city",
    );
    const nightCity = findLayer(
      resolveBasemapStyle("ident", true),
      "place_city",
    );

    expect(dayCity?.paint?.["text-opacity"]).toBe(0.42);
    expect(dayCity?.paint?.["text-color"]).toBe("#46525a");
    expect(nightCity?.paint?.["text-opacity"]).toBeUndefined();
  });
});

function findLayer(
  style: string | StyleSpecification,
  id: string,
): PaintLayer | undefined {
  if (typeof style === "string") return undefined;
  return style.layers?.find((layer) => layer.id === id) as
    | PaintLayer
    | undefined;
}
