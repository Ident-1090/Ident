/* eslint-disable */
// biome-ignore-all lint/suspicious/noExplicitAny: generated JSON Schema types preserve open schema objects.
// Generated from schemas/ident/*.schema.json.
// Run `pnpm generate-ident-schemas` from ident/ to refresh.

export interface IdentAircraftFrame {
  schema: "ident.aircraft.v1";
  producer: {
    kind: "readsb" | "dump1090-fa" | "skyaware978" | "unknown";
    version?: string;
  };
  observedAtEpochSec: number;
  frameMessagesTotal?: null | number;
  aircraft:
    | null
    | {
        hex: string;
        idKind: "icao" | "non_icao" | "unknown";
        source:
          | "adsb_icao"
          | "adsb_icao_nt"
          | "adsr_icao"
          | "tisb_icao"
          | "adsb_other"
          | "adsr_other"
          | "tisb_other"
          | "tisb_trackfile"
          | "mode_s"
          | "mode_ac"
          | "mlat"
          | "unknown";
        flight?: string;
        reg?: string;
        typeDesignator?: string;
        desc?: string;
        op?: string;
        cat?: string;
        lat?: null | number;
        lon?: null | number;
        seenPosSec?: null | number;
        nic?: null | number;
        rcM?: null | number;
        altBaroFt?: null | number;
        altGeomFt?: null | number;
        onGround?: null | boolean;
        gsKt?: null | number;
        iasKt?: null | number;
        tasKt?: null | number;
        mach?: null | number;
        trackDeg?: null | number;
        calcTrackDeg?: null | number;
        trackRateDegSec?: null | number;
        rollDeg?: null | number;
        magHeadingDeg?: null | number;
        trueHeadingDeg?: null | number;
        baroRateFpm?: null | number;
        geomRateFpm?: null | number;
        windDirDeg?: null | number;
        windKt?: null | number;
        oatC?: null | number;
        tatC?: null | number;
        pressHPa?: null | number;
        humidity?: null | number;
        turb?: string;
        mrarSource?: string;
        squawk?: string;
        emergency?: string;
        alert?: null | boolean;
        spi?: null | boolean;
        qnhHPa?: null | number;
        mcpAltFt?: null | number;
        fmsAltFt?: null | number;
        navHdgDeg?: null | number;
        navModes?: null | string[];
        adsbVersion?: null | number;
        uatVersion?: null | number;
        nicBaro?: null | number;
        nacP?: null | number;
        nacV?: null | number;
        sil?: null | number;
        silType?: string;
        gva?: null | number;
        sda?: null | number;
        aircraftMessagesTotal?: null | number;
        seenSec?: null | number;
        rssiDbfs?: null | number;
        dbFlags?: null | number;
        mlatFields?: null | string[];
        tisbFields?: null | string[];
      }[];
}

export interface IdentCapabilities {
  schema: "ident.capabilities.v1";
  producer: {
    kind: "readsb" | "dump1090-fa" | "skyaware978" | "unknown";
    version?: string;
  };
  capabilities: {
    aircraft: "producer_provided" | "ident_derived" | "unavailable";
    receiverPosition: "producer_provided" | "ident_derived" | "unavailable";
    messageRate: "producer_provided" | "ident_derived" | "unavailable";
    gain: "producer_provided" | "ident_derived" | "unavailable";
    uptime: "producer_provided" | "ident_derived" | "unavailable";
    maxRange: "producer_provided" | "ident_derived" | "unavailable";
    rangeOutline: "producer_provided" | "ident_derived" | "unavailable";
    signalDiagnostics: "producer_provided" | "ident_derived" | "unavailable";
    meteorology: "producer_provided" | "ident_derived" | "unavailable";
    replay: "producer_provided" | "ident_derived" | "unavailable";
    trails: "producer_provided" | "ident_derived" | "unavailable";
  };
}

export interface IdentConfig {
  schema: "ident.config.v1";
  station?: string;
  lineOfSight?: {
    [k: string]: any;
  };
}

export interface IdentRangeOutline {
  schema: "ident.rangeOutline.v1";
  producer: {
    kind: "readsb" | "dump1090-fa" | "skyaware978" | "unknown";
    version?: string;
  };
  observedAtEpochSec: number;
  source: "outline_json";
  scope: "last24h" | "alltime" | "points" | "other";
  coordinates: null | (null | number[])[];
}

export interface IdentReplayAvailability {
  schema: "ident.replay.availability.v1";
  enabled: boolean;
  fromEpochSec?: null | number;
  toEpochSec?: null | number;
  blockSec: number;
  blockCount: number;
}

export interface IdentRoutes {
  schema: "ident.routes.v1";
  observedAtEpochSec: number;
  routes:
    | null
    | {
        callsign: string;
        origin?: string;
        destination?: string;
        route?: string;
        dropped?: boolean;
      }[];
}

export interface IdentStatus {
  schema: "ident.status.v1";
  producer: {
    kind: "readsb" | "dump1090-fa" | "skyaware978" | "unknown";
    version?: string;
  };
  observedAt:
    | {
        kind: "producer_provided";
        source:
          | "stats_now"
          | "stats_window_end"
          | "aircraft_now"
          | "ingest_clock";
        value: {
          epochSec: number;
        };
      }
    | {
        kind: "ident_derived";
        source:
          | "stats_now"
          | "stats_window_end"
          | "aircraft_now"
          | "ingest_clock";
        value: {
          epochSec: number;
        };
      }
    | {
        kind: "unavailable";
        reason:
          | "not_provided_by_producer"
          | "awaiting_classification"
          | "awaiting_second_sample"
          | "producer_changed"
          | "counter_reset"
          | "clock_not_advanced"
          | "stale_sample"
          | "malformed_file";
      };
  freshness: {
    aircraftAgeSec: null | number;
    statsAgeSec: null | number;
    receiverObservedAgeSec: null | number;
  };
  receiverPosition?:
    | {
        kind: "producer_provided";
        source: "receiver_json";
        value: {
          lat: number;
          lon: number;
        };
      }
    | {
        kind: "ident_derived";
        source: "receiver_json";
        value: {
          lat: number;
          lon: number;
        };
      }
    | {
        kind: "unavailable";
        reason:
          | "not_provided_by_producer"
          | "awaiting_classification"
          | "awaiting_second_sample"
          | "producer_changed"
          | "counter_reset"
          | "clock_not_advanced"
          | "stale_sample"
          | "malformed_file";
      };
  messageRate?:
    | {
        kind: "producer_provided";
        source:
          | "stats_last1min_messages_valid"
          | "stats_last1min_messages"
          | "aircraft_counter_delta";
        value: {
          hz: number;
          basisSec?: number;
        };
      }
    | {
        kind: "ident_derived";
        source:
          | "stats_last1min_messages_valid"
          | "stats_last1min_messages"
          | "aircraft_counter_delta";
        value: {
          hz: number;
          basisSec?: number;
        };
      }
    | {
        kind: "unavailable";
        reason:
          | "not_provided_by_producer"
          | "awaiting_classification"
          | "awaiting_second_sample"
          | "producer_changed"
          | "counter_reset"
          | "clock_not_advanced"
          | "stale_sample"
          | "malformed_file";
      };
  gain?:
    | {
        kind: "producer_provided";
        source:
          | "top_level"
          | "latest_local"
          | "last1min_local"
          | "last5min_local"
          | "last15min_local"
          | "total_local";
        value: {
          db: number;
        };
      }
    | {
        kind: "ident_derived";
        source:
          | "top_level"
          | "latest_local"
          | "last1min_local"
          | "last5min_local"
          | "last15min_local"
          | "total_local";
        value: {
          db: number;
        };
      }
    | {
        kind: "unavailable";
        reason:
          | "not_provided_by_producer"
          | "awaiting_classification"
          | "awaiting_second_sample"
          | "producer_changed"
          | "counter_reset"
          | "clock_not_advanced"
          | "stale_sample"
          | "malformed_file";
      };
  uptime?:
    | {
        kind: "producer_provided";
        source:
          | "stats_now_minus_total_start"
          | "window_end_minus_total_start"
          | "ident_process_start";
        value: {
          sec: number;
          subject: "receiver" | "ident";
        };
      }
    | {
        kind: "ident_derived";
        source:
          | "stats_now_minus_total_start"
          | "window_end_minus_total_start"
          | "ident_process_start";
        value: {
          sec: number;
          subject: "receiver" | "ident";
        };
      }
    | {
        kind: "unavailable";
        reason:
          | "not_provided_by_producer"
          | "awaiting_classification"
          | "awaiting_second_sample"
          | "producer_changed"
          | "counter_reset"
          | "clock_not_advanced"
          | "stale_sample"
          | "malformed_file";
      };
  maxRange?:
    | {
        kind: "producer_provided";
        source:
          | "outline_last24h_vertices"
          | "outline_alltime_vertices"
          | "outline_points_vertices"
          | "outline_other_vertices"
          | "stats_max_distance_meters";
        value: {
          nm: number;
          scope: "last24h" | "alltime" | "points" | "other" | "stats";
          computation:
            | "max_receiver_to_outline_vertex"
            | "producer_reported_distance";
        };
      }
    | {
        kind: "ident_derived";
        source:
          | "outline_last24h_vertices"
          | "outline_alltime_vertices"
          | "outline_points_vertices"
          | "outline_other_vertices"
          | "stats_max_distance_meters";
        value: {
          nm: number;
          scope: "last24h" | "alltime" | "points" | "other" | "stats";
          computation:
            | "max_receiver_to_outline_vertex"
            | "producer_reported_distance";
        };
      }
    | {
        kind: "unavailable";
        reason:
          | "not_provided_by_producer"
          | "awaiting_classification"
          | "awaiting_second_sample"
          | "producer_changed"
          | "counter_reset"
          | "clock_not_advanced"
          | "stale_sample"
          | "malformed_file";
      };
  diagnostics:
    | null
    | {
        severity: string;
        channel: string;
        code: string;
        message: string;
        actionLabel?: string;
        actionUrl?: string;
      }[];
}
