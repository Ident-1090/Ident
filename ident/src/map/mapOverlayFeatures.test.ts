// biome-ignore-all lint/style/noNonNullAssertion: test fixture — missing elements/mocks fail the test loudly via the test runner.
import { describe, expect, it } from "vitest";
import type { Aircraft, RouteInfo } from "../data/types";
import { presetUnitOverrides, resolveUnitOverrides } from "../settings/format";
import {
  buildAircraftFeatureCollection,
  buildPredictorFeatureCollection,
  buildRangeLabelFeatureCollection,
  buildStationFeatureCollection,
} from "./mapOverlayFeatures";

const UAL: Aircraft = {
  hex: "abc123",
  flight: "UAL123",
  t: "B738",
  alt_baro: 34000,
  gs: 420,
  track: 90,
  lat: 37.42,
  lon: -122.08,
  seen: 0,
  type: "adsb_icao",
};

const units = resolveUnitOverrides("metric", presetUnitOverrides("metric"));

describe("map overlay feature builders", () => {
  it("builds aircraft features with MapLibre label and glyph properties", () => {
    const routes: Record<string, RouteInfo | null> = {
      UAL123: { origin: "SFO", destination: "ORD", route: "SFO-DEN-ORD" },
    };

    const collection = buildAircraftFeatureCollection({
      aircraft: [UAL],
      selectedHex: UAL.hex,
      hoveredHex: null,
      searchQuery: "",
      units,
      routeByCallsign: routes,
    });
    const feature = collection.features[0] as GeoJSON.Feature<GeoJSON.Point>;
    const properties = feature.properties!;

    expect(collection.features).toHaveLength(1);
    expect(feature.geometry.coordinates).toEqual([UAL.lon, UAL.lat]);
    expect(properties.hex).toBe(UAL.hex);
    expect(properties.labelMode).toBeUndefined();
    expect(properties.track).toBe(90);
    expect(properties.icon).toBe("ident-aircraft-arrow");
    expect(properties.priority).toBe(0);
    expect(properties.label).toBeUndefined();
    expect(properties.labelHead).toBeUndefined();
    expect(properties.labelTail).toBeUndefined();
    expect(properties.hoverLabel).toBeUndefined();
    expect(properties.hoverLabelHead).toBeUndefined();
    expect(properties.hoverLabelTail).toBeUndefined();
    expect(properties.labelCs).toBe("UAL123");
    expect(properties.labelType).toBe("B738");
    expect(properties.labelTypeSqk).toBe("B738");
    expect(properties.labelAlt).toBe("10,363m");
    expect(properties.labelSpeed).toBe("778km/h");
    expect(properties.labelAltSpeed).toBe("10,363m · 778km/h");
    expect(properties.labelRoute).toBe("SFO→DEN→ORD");
    expect(properties.selectedLabelAnchor).toBe("left");
    expect(properties.selectedLabelJustify).toBe("left");
    expect(properties.selectedLabelOffset).toEqual([0, 2.35]);
    expect(properties.selected).toBe(true);
  });

  it("omits aircraft without coordinates", () => {
    const collection = buildAircraftFeatureCollection({
      aircraft: [{ ...UAL, lat: undefined }],
      selectedHex: null,
      hoveredHex: null,
      searchQuery: "",
      units,
      routeByCallsign: {},
    });

    expect(collection.features).toHaveLength(0);
  });

  it("builds a station feature with a zoom-scaled label", () => {
    const collection = buildStationFeatureCollection({
      receiver: { lat: 37.4, lon: -122.1, version: "readsb HomeReceiver" },
      stationOverride: null,
    });
    const feature = collection.features[0] as GeoJSON.Feature<GeoJSON.Point>;

    expect(collection.features).toHaveLength(1);
    expect(feature.geometry.coordinates).toEqual([-122.1, 37.4]);
    expect(feature.properties!.label).toBe("HomeReceiver");
  });

  it("builds range label features on the east edge of each ring", () => {
    const collection = buildRangeLabelFeatureCollection({
      receiver: { lat: 37.4, lon: -122.1 },
      distanceUnit: "km",
      enabled: true,
    });

    expect(collection.features.map((f) => f.properties!.radiusNm)).toEqual([
      25, 50, 100, 150, 200,
    ]);
    const feature = collection.features[0] as GeoJSON.Feature<GeoJSON.Point>;
    expect(feature.properties!.label).toBe("46 km");
    expect(feature.geometry.coordinates[0]).toBeGreaterThan(-122.1);
  });

  it("builds selected-aircraft predictor geometry", () => {
    const collection = buildPredictorFeatureCollection({
      aircraft: [UAL],
      selectedHex: UAL.hex,
    });

    expect(collection.features).toHaveLength(2);
    expect(collection.features[0].geometry.type).toBe("LineString");
    expect(collection.features[0].properties!.kind).toBe("line");
    expect(collection.features[1].geometry.type).toBe("Point");
    expect(collection.features[1].properties!.kind).toBe("end");
    expect(collection.features[1].properties!.label).toBe("60s");
  });
});
