import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import aircraftSchema from "../../../schemas/ident/ident.aircraft.v1.schema.json";
import capabilitiesSchema from "../../../schemas/ident/ident.capabilities.v1.schema.json";
import configSchema from "../../../schemas/ident/ident.config.v1.schema.json";
import rangeOutlineSchema from "../../../schemas/ident/ident.rangeOutline.v1.schema.json";
import replayAvailabilitySchema from "../../../schemas/ident/ident.replay.availability.v1.schema.json";
import routesSchema from "../../../schemas/ident/ident.routes.v1.schema.json";
import statusSchema from "../../../schemas/ident/ident.status.v1.schema.json";
import type {
  IdentAircraftFrame,
  IdentCapabilities,
  IdentConfig,
  IdentRangeOutline,
  IdentReplayAvailability,
  IdentRoutes,
  IdentStatus,
} from "./generated/identSchemas";

const schemas = [
  aircraftSchema,
  capabilitiesSchema,
  configSchema,
  rangeOutlineSchema,
  replayAvailabilitySchema,
  routesSchema,
  statusSchema,
];

function ajvForIdentSchemas() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const schema of schemas) {
    ajv.addSchema(schema, schema.properties.schema.const);
  }
  return ajv;
}

describe("Ident JSON schemas", () => {
  it("validates representative Ident payloads", () => {
    const ajv = ajvForIdentSchemas();
    const aircraft: IdentAircraftFrame = {
      schema: "ident.aircraft.v1",
      producer: { kind: "readsb", version: "3.16" },
      observedAtEpochSec: 1770000000,
      frameMessagesTotal: 1200,
      aircraft: [
        {
          hex: "abc123",
          idKind: "icao",
          source: "adsb_icao",
          flight: "TEST123",
          reg: "N12345",
          typeDesignator: "B738",
          lat: 34.1,
          lon: -118.2,
          altBaroFt: 3000,
          gsKt: 120,
          trackDeg: 90,
        },
      ],
    };
    const capabilities: IdentCapabilities = {
      schema: "ident.capabilities.v1",
      producer: { kind: "readsb", version: "3.16" },
      capabilities: {
        aircraft: "producer_provided",
        receiverPosition: "producer_provided",
        messageRate: "producer_provided",
        gain: "producer_provided",
        uptime: "producer_provided",
        maxRange: "producer_provided",
        rangeOutline: "producer_provided",
        signalDiagnostics: "producer_provided",
        meteorology: "unavailable",
        replay: "ident_derived",
        trails: "ident_derived",
      },
    };
    const config: IdentConfig = {
      schema: "ident.config.v1",
      station: "Receiver",
    };
    const rangeOutline: IdentRangeOutline = {
      schema: "ident.rangeOutline.v1",
      producer: { kind: "readsb", version: "3.16" },
      observedAtEpochSec: 1770000000,
      source: "outline_json",
      scope: "last24h",
      coordinates: [
        [-118.2, 34.1],
        [-118.1, 34.2],
        [-118.3, 34.3],
      ],
    };
    const replayAvailability: IdentReplayAvailability = {
      schema: "ident.replay.availability.v1",
      enabled: true,
      fromEpochMs: 1770000000,
      toEpochMs: 1770000300,
      blockSec: 300,
      blockCount: 1,
    };
    const routes: IdentRoutes = {
      schema: "ident.routes.v1",
      observedAtEpochSec: 1770000000,
      routes: [{ callsign: "TEST123", route: "AAA-BBB" }],
    };
    const status: IdentStatus = {
      schema: "ident.status.v1",
      producer: { kind: "readsb", version: "3.16" },
      observedAt: {
        kind: "producer_provided",
        source: "aircraft_now",
        value: { epochSec: 1770000000 },
      },
      freshness: {
        aircraftAgeSec: 0,
        statsAgeSec: 1,
        receiverObservedAgeSec: 2,
      },
      messageRate: {
        kind: "producer_provided",
        source: "stats_last1min_messages_valid",
        value: { hz: 10, basisSec: 60 },
      },
      diagnostics: [],
    };

    for (const payload of [
      aircraft,
      capabilities,
      config,
      rangeOutline,
      replayAvailability,
      routes,
      status,
    ]) {
      const valid = ajv.validate(payload.schema, payload);
      expect(ajv.errorsText(ajv.errors)).toBe("No errors");
      expect(valid).toBe(true);
    }
  });

  it("rejects aircraft rows without normalized identity and source", () => {
    const ajv = ajvForIdentSchemas();
    const payload = {
      schema: "ident.aircraft.v1",
      producer: { kind: "readsb" },
      observedAtEpochSec: 1770000000,
      aircraft: [{ hex: "abc123" }],
    };

    expect(ajv.validate("ident.aircraft.v1", payload)).toBe(false);
    expect(ajv.errorsText(ajv.errors)).toContain("must have required property");
  });
});
