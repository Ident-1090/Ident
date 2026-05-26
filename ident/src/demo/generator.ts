// Synthetic feed generator for the public demo. Aircraft identities come from a
// captured real-world snapshot; motion is dead-reckoned here so the demo runs
// from a small committed seed.
import type {
  Aircraft,
  AircraftFrame,
  IdentCapabilitiesEnvelope,
  IdentConfig,
  IdentRangeOutline,
  IdentReplayAvailability,
  IdentRoutes,
  IdentStatus,
  ReplayBlockFile,
  ReplayBlockIndex,
  ReplayFrame,
  ReplayManifest,
  TrailPoint,
} from "../data/types";
import seedData from "./seed.json";

interface SeedAircraft {
  hex: string;
  flight: string;
  type: string;
  reg?: string;
  cls: string;
  cat: string;
  role: "cruise" | "arrival" | "departure" | "ga";
  lat: number;
  lon: number;
  altBaroFt: number;
  gsKt: number;
  trackDeg: number;
  baroRateFpm: number;
  squawk: string;
}

interface Seed {
  station: { lat: number; lon: number };
  aircraft: SeedAircraft[];
}

const SEED = seedData as Seed;
export const DEMO_STATION = SEED.station;

export interface PlaneState extends SeedAircraft {
  turnRateDegSec: number; // gentle constant turn keeps traffic in view
  altTargetFt: number;
  altDir: 1 | -1;
}

const hash = (s: string): number => {
  let h = 2166136261;
  for (const c of s) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 2 ** 32;
};

export function initPlanes(): PlaneState[] {
  return SEED.aircraft.map((a) => {
    const h = hash(a.hex);
    // A large-radius turn for everyone (~50-80 nm radius): a sweeping arc rather
    // than tight circling, but enough turn that aircraft stay roughly in their
    // area over 30 min instead of drifting straight off and bunching up.
    const turn = 0.06 + h * 0.05; // deg/sec
    return {
      ...a,
      turnRateDegSec: (h < 0.5 ? -1 : 1) * turn,
      altTargetFt: a.altBaroFt,
      altDir: a.baroRateFpm >= 0 ? 1 : -1,
    };
  });
}

const ALT_BAND_FT = 6000;

// Advance one aircraft by dt seconds. Mutates and returns the state.
export function stepPlane(p: PlaneState, dtSec: number): PlaneState {
  p.trackDeg = (p.trackDeg + p.turnRateDegSec * dtSec + 360) % 360;
  const distNm = (p.gsKt * dtSec) / 3600;
  const rad = (p.trackDeg * Math.PI) / 180;
  p.lat += (distNm * Math.cos(rad)) / 60;
  p.lon += (distNm * Math.sin(rad)) / (60 * Math.cos((p.lat * Math.PI) / 180));

  if (p.role !== "cruise") {
    // Bounce the altitude inside a band around the seed value so arrivals and
    // departures show a live vertical rate without flying off the scale.
    p.altBaroFt += (p.baroRateFpm * p.altDir * dtSec) / 60;
    const lo = p.altTargetFt - ALT_BAND_FT / 2;
    const hi = p.altTargetFt + ALT_BAND_FT / 2;
    if (p.altBaroFt > hi) {
      p.altBaroFt = hi;
      p.altDir = -1;
    } else if (p.altBaroFt < lo) {
      p.altBaroFt = lo;
      p.altDir = 1;
    }
  }
  return p;
}

function toAircraft(p: PlaneState, nowMs: number): Aircraft {
  const h = hash(p.hex);
  const alt = Math.round(p.altBaroFt);
  const gs = Math.round(p.gsKt);
  const track = Math.round(p.trackDeg);
  const isJet = p.cls !== "ga";
  // True airspeed ≈ ground speed here (no modelled wind); indicated airspeed
  // falls off with altitude. Mach only above the transonic-relevant band.
  const tas = gs + Math.round((h - 0.5) * 18);
  const ias = Math.max(70, Math.round(tas * (1 - (alt / 1000) * 0.0135)));
  const mach = alt > 18000 ? +(tas / 602).toFixed(2) : undefined;
  const selAlt =
    p.role === "cruise"
      ? Math.round(p.altTargetFt / 1000) * 1000
      : p.role === "arrival"
        ? 3000
        : Math.round((p.altTargetFt + 12000) / 1000) * 1000;
  const navModes = !isJet
    ? undefined
    : alt > 18000
      ? ["autopilot", "vnav", "lnav", "tcas"]
      : ["autopilot", "lnav", "tcas"];

  return {
    hex: p.hex,
    idKind: "icao",
    source: "adsb_icao",
    flight: p.flight,
    reg: p.reg,
    typeDesignator: p.type,
    cat: p.cat,
    lat: +p.lat.toFixed(5),
    lon: +p.lon.toFixed(5),
    seenPosSec: 0,
    altBaroFt: alt,
    altGeomFt: alt + Math.round((h - 0.3) * 175),
    gsKt: gs,
    iasKt: ias,
    tasKt: tas,
    mach,
    trackDeg: track,
    magHeadingDeg: (track - Math.round(1 + h * 4) + 360) % 360,
    trueHeadingDeg: track,
    baroRateFpm: p.role === "cruise" ? 0 : Math.round(p.baroRateFpm * p.altDir),
    geomRateFpm:
      p.role === "cruise" ? 0 : Math.round(p.baroRateFpm * p.altDir * 0.95),
    squawk: p.squawk,
    navHdgDeg: Math.round(track / 5) * 5,
    mcpAltFt: selAlt,
    navModes,
    adsbVersion: 2,
    nic: isJet ? 8 : 7,
    nicBaro: 1,
    nacP: isJet ? 9 : 8,
    nacV: 2,
    sil: 3,
    silType: "perhour",
    gva: 2,
    sda: 2,
    rcM: 186,
    aircraftMessagesTotal: Math.round(8000 * h + ((nowMs / 1000) % 90000)),
    rssiDbfs: -+(3 + h * 21).toFixed(1),
    seenSec: 0,
  };
}

export function buildTrailPoint(p: PlaneState, tsMs: number): TrailPoint {
  const alt = Math.round(p.altBaroFt);
  return {
    lat: +p.lat.toFixed(5),
    lon: +p.lon.toFixed(5),
    alt,
    ts: tsMs,
    segment: 0,
    gs: Math.round(p.gsKt),
    track: Math.round(p.trackDeg),
    source: "adsb_icao",
    alt_source: "baro",
    altGeomFt: alt + 60,
  };
}

export function buildFrame(planes: PlaneState[], nowMs: number): AircraftFrame {
  return {
    schema: "ident.aircraft.v1",
    observedAtEpochSec: nowMs / 1000,
    aircraft: planes.map((p) => toAircraft(p, nowMs)),
  };
}

// Plausible origin/destination per airline callsign prefix. Bizjets and GA
// carry no scheduled route.
const ROUTES: Record<string, [string, string]> = {
  ASA: ["SEA", "BOS"],
  TAM: ["GRU", "JFK"],
  RPA: ["DCA", "BOS"],
  JIA: ["PHL", "BOS"],
  SWA: ["BWI", "BOS"],
  DAL: ["ATL", "BOS"],
  FFT: ["DEN", "BOS"],
  PDT: ["BOS", "PHL"],
  AAL: ["BOS", "DFW"],
  JBU: ["BOS", "MCO"],
  EDV: ["BOS", "DTW"],
};

export function buildRoutes(planes: PlaneState[], nowMs: number): IdentRoutes {
  const routes = [];
  for (const p of planes) {
    const od = ROUTES[p.flight.slice(0, 3)];
    if (od) {
      routes.push({
        callsign: p.flight,
        origin: od[0],
        destination: od[1],
        route: `${od[0]}-${od[1]}`,
      });
    }
  }
  return {
    schema: "ident.routes.v1",
    observedAtEpochSec: nowMs / 1000,
    routes,
  };
}

const REPLAY_SEC = 1800;
const REPLAY_SAMPLE_SEC = 5;
const REPLAY_BLOCK_SEC = 300;

export interface DemoReplay {
  manifest: ReplayManifest;
  blocks: Record<string, ReplayBlockFile>;
  availability: IdentReplayAvailability;
}

// Pre-render an on-disk-style replay history from the same motion model: rewind
// a fresh model, step forward sampling frames, and pack them into blocks the
// frontend can scrub through. Generated once at startup and served from memory.
export function buildReplay(nowMs: number): DemoReplay {
  const planes = initPlanes();
  for (let i = 0; i < REPLAY_SEC; i++) {
    for (const p of planes) stepPlane(p, -1);
  }
  const startMs = nowMs - REPLAY_SEC * 1000;

  // One forward pass; snapshot a frame every REPLAY_SAMPLE_SEC seconds.
  const allFrames: ReplayFrame[] = [];
  for (let s = 0; s <= REPLAY_SEC; s++) {
    for (const p of planes) stepPlane(p, 1);
    if (s % REPLAY_SAMPLE_SEC === 0) {
      const ts = startMs + s * 1000;
      allFrames.push({ ts, aircraft: planes.map((p) => toAircraft(p, ts)) });
    }
  }

  // Pack frames into fixed-duration blocks.
  const blocks: Record<string, ReplayBlockFile> = {};
  const index: ReplayBlockIndex[] = [];
  const blockMs = REPLAY_BLOCK_SEC * 1000;
  const blockCount = Math.ceil(REPLAY_SEC / REPLAY_BLOCK_SEC);
  for (let b = 0; b < blockCount; b++) {
    const blockStart = startMs + b * blockMs;
    const blockEnd = Math.min(blockStart + blockMs, nowMs);
    const frames = allFrames.filter(
      (f) => f.ts >= blockStart && f.ts <= blockEnd,
    );
    if (frames.length === 0) continue;
    const url = `api/replay/blocks/demo-${String(b).padStart(3, "0")}.json`;
    const file: ReplayBlockFile = {
      version: 2,
      start: blockStart,
      end: blockEnd,
      step_ms: REPLAY_SAMPLE_SEC * 1000,
      frames,
    };
    blocks[url] = file;
    index.push({
      start: blockStart,
      end: blockEnd,
      url,
      bytes: JSON.stringify(file).length,
    });
  }

  return {
    manifest: {
      enabled: true,
      from: startMs,
      to: nowMs,
      block_sec: REPLAY_BLOCK_SEC,
      blocks: index,
    },
    blocks,
    availability: {
      schema: "ident.replay.availability.v1",
      enabled: true,
      fromEpochMs: startMs,
      toEpochMs: nowMs,
      blockSec: REPLAY_BLOCK_SEC,
      blockCount: index.length,
    },
  };
}

export function buildConfig(): IdentConfig {
  return {
    schema: "ident.config.v1",
    station: "Demo",
    ident: { version: "demo", shortCommit: "demo" },
  };
}

export function buildCapabilities(): IdentCapabilitiesEnvelope {
  const p = "producer_provided" as const;
  const d = "ident_derived" as const;
  return {
    schema: "ident.capabilities.v1",
    producer: { kind: "readsb", version: "demo" },
    capabilities: {
      aircraft: p,
      receiverPosition: p,
      messageRate: p,
      gain: p,
      uptime: d,
      maxRange: d,
      rangeOutline: p,
      signalDiagnostics: p,
      meteorology: "unavailable",
      replay: p,
      trails: d,
    },
  };
}

export function buildStatus(planes: PlaneState[], nowMs: number): IdentStatus {
  const epochSec = nowMs / 1000;
  // A believable message rate: scales with traffic plus a little jitter.
  const hz = planes.length * 22 + Math.round((Math.sin(nowMs / 7000) + 1) * 40);
  return {
    schema: "ident.status.v1",
    observedAt: {
      kind: "producer_provided",
      source: "aircraft_now",
      value: { epochSec },
    },
    freshness: {
      aircraftAgeSec: 0,
      statsAgeSec: 0,
      receiverObservedAgeSec: 0,
    },
    receiverPosition: {
      kind: "producer_provided",
      source: "receiver_json",
      value: { lat: DEMO_STATION.lat, lon: DEMO_STATION.lon },
    },
    messageRate: {
      kind: "producer_provided",
      source: "stats_last1min_messages_valid",
      value: { hz, basisSec: 60 },
    },
    gain: {
      kind: "producer_provided",
      source: "latest_local",
      value: { db: 49.6 },
    },
    uptime: {
      kind: "ident_derived",
      source: "ident_process_start",
      value: { sec: 3600 * 26 + ((nowMs / 1000) % 60), subject: "receiver" },
    },
    maxRange: {
      kind: "ident_derived",
      source: "outline_last24h_vertices",
      value: {
        nm: 211,
        scope: "last24h",
        computation: "max_receiver_to_outline_vertex",
      },
    },
  };
}

// A coverage polygon roughly framing the traffic, so the map shows a receiver
// range outline like a real deployment.
export function buildRangeOutline(nowMs: number): IdentRangeOutline {
  const { lat, lon } = DEMO_STATION;
  const pts: Array<[number, number]> = [];
  const n = 48;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // Irregular radius so it reads as observed coverage, not a circle.
    const r = 1.7 + 0.55 * Math.sin(a * 3 + 1) + 0.3 * Math.cos(a * 5);
    pts.push([
      +(lat + r * Math.cos(a)).toFixed(4),
      +(lon + (r / Math.cos((lat * Math.PI) / 180)) * Math.sin(a)).toFixed(4),
    ]);
  }
  return {
    schema: "ident.rangeOutline.v1",
    observedAtEpochSec: nowMs / 1000,
    source: "outline_json",
    scope: "last24h",
    coordinates: pts,
  };
}
