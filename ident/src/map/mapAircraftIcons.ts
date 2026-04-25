import type { Aircraft } from "../data/types";
import type { Map as MlMap } from "./maplibre";

type AircraftIconId =
  | "ident-ac-arrow"
  | "ident-ac-unknown"
  | "ident-ac-airliner-generic"
  | "ident-ac-airliner-narrow"
  | "ident-ac-airliner-wide"
  | "ident-ac-airliner-regional"
  | "ident-ac-bizjet"
  | "ident-ac-milfast"
  | "ident-ac-prop-se-piston"
  | "ident-ac-prop-se-turbo"
  | "ident-ac-prop-twin-piston"
  | "ident-ac-prop-twin-turbo"
  | "ident-ac-cargo-heavy"
  | "ident-ac-helicopter"
  | "ident-ac-gyrocopter"
  | "ident-ac-glider"
  | "ident-ac-balloon"
  | "ident-ac-blimp"
  | "ident-ac-uav"
  | "ident-ac-tiltrotor"
  | "ident-ac-ground-unknown"
  | "ident-ac-ground-service"
  | "ident-ac-ground-emergency"
  | "ident-ac-ground-tower";

export const AIRCRAFT_UNKNOWN_ICON_ID: AircraftIconId = "ident-ac-unknown";

export const AIRCRAFT_ARROW_ICON_ID: AircraftIconId = "ident-ac-arrow";

const ICON_SIZE = 32;
const C = ICON_SIZE / 2;

const LIGHT_JETS = new Set([
  "A700",
  "ASTR",
  "BE40",
  "C25A",
  "C25B",
  "C25C",
  "C501",
  "C510",
  "C525",
  "C550",
  "C560",
  "C56X",
  "C650",
  "C680",
  "C68A",
  "C750",
  "CL30",
  "CL35",
  "CL60",
  "E50P",
  "E55P",
  "EA50",
  "F2TH",
  "F900",
  "FA10",
  "FA20",
  "FA50",
  "FA7X",
  "FA8X",
  "G150",
  "G200",
  "G280",
  "GA5C",
  "GA6C",
  "GA7C",
  "GA8C",
  "GL5T",
  "GL6T",
  "GL7T",
  "GLEX",
  "GLF2",
  "GLF3",
  "GLF4",
  "GLF5",
  "GLF6",
  "H25A",
  "H25B",
  "H25C",
  "HDJT",
  "HA4T",
  "LJ23",
  "LJ24",
  "LJ25",
  "LJ28",
  "LJ31",
  "LJ35",
  "LJ40",
  "LJ45",
  "LJ55",
  "LJ60",
  "LJ70",
  "LJ75",
  "LJ85",
  "LR35",
  "LR45",
  "PRM1",
  "SF50",
]);

const REGIONAL_JETS = new Set([
  "A148",
  "B461",
  "B462",
  "B463",
  "BCS1",
  "BCS3",
  "CRJ1",
  "CRJ2",
  "CRJ7",
  "CRJ9",
  "CRJX",
  "E135",
  "E145",
  "E170",
  "E175",
  "E190",
  "E195",
  "E290",
  "E295",
  "E35L",
  "E45X",
  "E545",
  "E75L",
  "E75S",
  "E75S/L",
  "F100",
  "F28",
  "F70",
  "J328",
  "RJ70",
  "RJ85",
  "RJ1H",
]);

const NARROW_BODY_JETS = new Set([
  "A318",
  "A319",
  "A19N",
  "A320",
  "A20N",
  "A321",
  "A21N",
  "B712",
  "B721",
  "B722",
  "B731",
  "B732",
  "B733",
  "B734",
  "B735",
  "B736",
  "B737",
  "B738",
  "B739",
  "B37M",
  "B38M",
  "B39M",
  "B3XM",
  "DC91",
  "DC92",
  "DC93",
  "DC94",
  "DC95",
  "MD80",
  "MD81",
  "MD82",
  "MD83",
  "MD87",
  "MD88",
  "MD90",
  "T154",
]);

const WIDE_BODY_JETS = new Set([
  "A306",
  "A310",
  "A330",
  "A332",
  "A333",
  "A338",
  "A339",
  "A342",
  "A343",
  "A345",
  "A346",
  "A359",
  "A35K",
  "A388",
  "B741",
  "B742",
  "B743",
  "B744",
  "B748",
  "B752",
  "B753",
  "B762",
  "B763",
  "B764",
  "B772",
  "B773",
  "B77L",
  "B77W",
  "B788",
  "B789",
  "B78X",
  "DC10",
  "IL62",
  "MD11",
]);

const CARGO_HEAVY = new Set([
  "A124",
  "A225",
  "A3ST",
  "A400",
  "BLCF",
  "BSCA",
  "C130",
  "C17",
  "C30J",
  "C5",
  "C5M",
  "E390",
  "K35E",
  "K35R",
  "P3",
  "P8",
  "SGUP",
  "SLCH",
  "WHK2",
]);

const FAST_MILITARY = new Set([
  "A10",
  "A37",
  "A4",
  "A6",
  "AJET",
  "ALPH",
  "AT3",
  "EUFI",
  "F1",
  "F14",
  "F15",
  "F16",
  "F18",
  "F18H",
  "F18S",
  "F22",
  "F22A",
  "F35",
  "F4",
  "F5",
  "F104",
  "F111",
  "F117",
  "HUNT",
  "L159",
  "L39",
  "M346",
  "MG29",
  "MG31",
  "MIR2",
  "MIR4",
  "RFAL",
  "SB39",
  "SU24",
  "SU25",
  "SU27",
  "T2",
  "T33",
  "T37",
  "T38",
  "TOR",
  "U2",
  "VF35",
]);

const HELICOPTERS = new Set([
  "A109",
  "A139",
  "A149",
  "A169",
  "A189",
  "ALO2",
  "ALO3",
  "AS32",
  "AS3B",
  "AS50",
  "AS55",
  "AS65",
  "EC25",
  "EC55",
  "EC75",
  "EH10",
  "GAZL",
  "H46",
  "H47",
  "H53",
  "H53S",
  "H60",
  "H64",
  "H160",
  "MI24",
  "NH90",
  "PUMA",
  "R22",
  "R44",
  "R66",
  "S61",
  "S61R",
  "S76",
  "S92",
  "TIGR",
]);

const GLIDERS = new Set([
  "A20J",
  "A32E",
  "A32P",
  "A33E",
  "A33P",
  "A34E",
  "ARCE",
  "ARCP",
  "AS14",
  "AS16",
  "AS20",
  "AS21",
  "AS22",
  "AS24",
  "AS25",
  "AS26",
  "AS28",
  "AS29",
  "AS30",
  "AS31",
  "DISC",
  "DG1T",
  "DG80",
  "DUOD",
  "GLID",
  "JANU",
  "LK17",
  "LK19",
  "LK20",
  "LS8",
  "LS9",
  "LS10",
  "NIMB",
  "PK20",
  "QINT",
  "S6",
  "S10S",
  "S12",
  "S12S",
  "TS1J",
  "VENT",
  "VNTE",
]);

const SINGLE_TURBOPROP = new Set([
  "BE9L",
  "C208",
  "EPIC",
  "PC12",
  "PC21",
  "TBM7",
  "TBM8",
  "TBM9",
]);

const TWIN_TURBOPROP = new Set([
  "AT43",
  "AT45",
  "AT46",
  "AT72",
  "BE20",
  "BE30",
  "BE35",
  "BE99",
  "B350",
  "D228",
  "D328",
  "DH8A",
  "DH8B",
  "DH8C",
  "DH8D",
  "E110",
  "E120",
  "F50",
  "JS32",
  "JS41",
  "L410",
  "P180",
  "PC24",
  "SB20",
  "SW4",
]);

const TWIN_PISTON = new Set([
  "BE55",
  "BE58",
  "C310",
  "C340",
  "C414",
  "C421",
  "PA23",
  "PA30",
  "PA31",
  "PA34",
  "P68",
]);

const SINGLE_PISTON = new Set([
  "BE36",
  "C150",
  "C152",
  "C172",
  "C182",
  "C185",
  "C206",
  "C210",
  "C25M",
  "C42",
  "DA40",
  "DA42",
  "EV97",
  "FDCT",
  "PA24",
  "PA28",
  "PA32",
  "PA46",
  "PIVI",
  "SR20",
  "SR22",
  "S22T",
  "ULAC",
  "WT9",
]);

const UAVS = new Set(["DRON", "Q1", "Q4", "Q9", "Q25", "HRON"]);
const TILTROTORS = new Set(["B609", "B609F", "V22", "V22F"]);

const TYPE_DESIGNATOR_ICONS = new Map<string, AircraftIconId>();
for (const type of LIGHT_JETS)
  TYPE_DESIGNATOR_ICONS.set(type, "ident-ac-bizjet");
for (const type of REGIONAL_JETS) {
  TYPE_DESIGNATOR_ICONS.set(type, "ident-ac-airliner-regional");
}
for (const type of NARROW_BODY_JETS) {
  TYPE_DESIGNATOR_ICONS.set(type, "ident-ac-airliner-narrow");
}
for (const type of WIDE_BODY_JETS) {
  TYPE_DESIGNATOR_ICONS.set(type, "ident-ac-airliner-wide");
}
for (const type of CARGO_HEAVY)
  TYPE_DESIGNATOR_ICONS.set(type, "ident-ac-cargo-heavy");
for (const type of FAST_MILITARY)
  TYPE_DESIGNATOR_ICONS.set(type, "ident-ac-milfast");
for (const type of HELICOPTERS)
  TYPE_DESIGNATOR_ICONS.set(type, "ident-ac-helicopter");
for (const type of GLIDERS) TYPE_DESIGNATOR_ICONS.set(type, "ident-ac-glider");
for (const type of SINGLE_TURBOPROP) {
  TYPE_DESIGNATOR_ICONS.set(type, "ident-ac-prop-se-turbo");
}
for (const type of TWIN_TURBOPROP) {
  TYPE_DESIGNATOR_ICONS.set(type, "ident-ac-prop-twin-turbo");
}
for (const type of TWIN_PISTON) {
  TYPE_DESIGNATOR_ICONS.set(type, "ident-ac-prop-twin-piston");
}
for (const type of SINGLE_PISTON) {
  TYPE_DESIGNATOR_ICONS.set(type, "ident-ac-prop-se-piston");
}
for (const type of UAVS) TYPE_DESIGNATOR_ICONS.set(type, "ident-ac-uav");
for (const type of TILTROTORS)
  TYPE_DESIGNATOR_ICONS.set(type, "ident-ac-tiltrotor");
TYPE_DESIGNATOR_ICONS.set("SHIP", "ident-ac-blimp");
TYPE_DESIGNATOR_ICONS.set("BALL", "ident-ac-balloon");
TYPE_DESIGNATOR_ICONS.set("GYRO", "ident-ac-gyrocopter");
TYPE_DESIGNATOR_ICONS.set("GND", "ident-ac-ground-unknown");
TYPE_DESIGNATOR_ICONS.set("GRND", "ident-ac-ground-unknown");
TYPE_DESIGNATOR_ICONS.set("SERV", "ident-ac-ground-service");
TYPE_DESIGNATOR_ICONS.set("EMER", "ident-ac-ground-emergency");
TYPE_DESIGNATOR_ICONS.set("TWR", "ident-ac-ground-tower");

const CATEGORY_ICONS: Record<string, AircraftIconId> = {
  A1: "ident-ac-prop-se-piston",
  A2: "ident-ac-bizjet",
  A3: "ident-ac-airliner-generic",
  A4: "ident-ac-airliner-generic",
  A5: "ident-ac-airliner-wide",
  A6: "ident-ac-milfast",
  A7: "ident-ac-helicopter",
  B1: "ident-ac-glider",
  B2: "ident-ac-balloon",
  B4: "ident-ac-prop-se-piston",
  B6: "ident-ac-uav",
  C0: "ident-ac-ground-unknown",
  C1: "ident-ac-ground-emergency",
  C2: "ident-ac-ground-service",
  C3: "ident-ac-ground-tower",
};

const ICON_SHAPES: Record<AircraftIconId, IconShape> = {
  "ident-ac-arrow": {
    paths: ["M16 2 L26 28 L16 22 L6 28 Z"],
  },
  "ident-ac-unknown": {
    paths: [circlePath(16, 16, 5.4), ...ringSegmentPaths(16, 16, 8.8, 10.4, 8)],
  },
  "ident-ac-airliner-generic": {
    paths: [
      jetAirframePath({
        len: 25,
        bodyW: 2,
        span: 22,
        wingY: 11.5,
        wingSweep: 4.2,
        wingChord: 2.3,
        tailSpan: 9.5,
        tailY: 21,
        tailSweep: 1.7,
        tailChord: 1.5,
      }),
      rectPath(8.4, 15.6, 2.6, 3),
      rectPath(21, 15.6, 2.6, 3),
    ],
  },
  "ident-ac-airliner-narrow": {
    paths: [
      jetAirframePath({
        len: 26,
        bodyW: 2.1,
        span: 24,
        wingY: 12,
        wingSweep: 4.5,
        wingChord: 2.4,
        tailSpan: 10,
        tailY: 22,
        tailSweep: 1.8,
        tailChord: 1.6,
      }),
    ],
  },
  "ident-ac-airliner-wide": {
    paths: [
      jetAirframePath({
        len: 30,
        bodyW: 2.8,
        span: 28,
        wingY: 13,
        wingSweep: 5.5,
        wingChord: 2.8,
        tailSpan: 12,
        tailY: 24,
        tailSweep: 2.1,
        tailChord: 1.9,
      }),
    ],
  },
  "ident-ac-airliner-regional": {
    paths: [
      jetAirframePath({
        len: 22,
        bodyW: 1.75,
        span: 19,
        wingY: 10,
        wingSweep: 3.6,
        wingChord: 2.1,
        tailSpan: 8.5,
        tailY: 18,
        tailSweep: 1.5,
        tailChord: 1.4,
      }),
    ],
  },
  "ident-ac-bizjet": {
    paths: [
      jetAirframePath({
        len: 20,
        bodyW: 1.55,
        span: 15,
        wingY: 9.5,
        wingSweep: 2.8,
        wingChord: 1.9,
        tailSpan: 8.5,
        tailY: 17,
        tailSweep: 1.4,
        tailChord: 1.6,
      }),
      rectPath(12.2, 18.5, 2.2, 2.6),
      rectPath(17.6, 18.5, 2.2, 2.6),
    ],
  },
  "ident-ac-milfast": {
    paths: [
      "M16 3 L17.5 4.5 L17.6 10 L17.8 13.4 L28 20.2 L28 22 L17.8 19.2 L17.8 23 L19.3 27.6 L19.3 28.6 L16 27 L12.7 28.6 L12.7 27.6 L14.2 23 L14.2 19.2 L4 22 L4 20.2 L14.2 13.4 L14.4 10 L14.5 4.5 Z",
    ],
  },
  "ident-ac-prop-se-piston": {
    paths: [
      capsuleBodyPath({
        cx: 16,
        top: 9.5,
        bottom: 25,
        bodyW: 4.4,
        noseClip: 1.2,
        tailClip: 1,
      }),
      rectPath(12.8, 8, 6.4, 1.4),
      rectPath(6, 13.2, 20, 3),
      rectPath(11.5, 23.4, 9, 2.4),
    ],
  },
  "ident-ac-prop-se-turbo": {
    paths: [
      capsuleBodyPath({
        cx: 16,
        top: 8.2,
        bottom: 26,
        bodyW: 5,
        noseClip: 1.4,
        tailClip: 1.2,
      }),
      rectPath(12, 6.6, 8, 1.6),
      rectPath(5, 13, 22, 3.4),
      rectPath(11, 24, 10, 2.6),
    ],
  },
  "ident-ac-prop-twin-piston": {
    paths: [
      capsuleBodyPath({
        cx: 16,
        top: 8,
        bottom: 26.4,
        bodyW: 4.8,
        noseClip: 1.3,
        tailClip: 1.1,
      }),
      rectPath(4, 13.4, 24, 3),
      rectPath(7.6, 11, 2.8, 8.2),
      rectPath(21.6, 11, 2.8, 8.2),
      rectPath(10.8, 25, 10.4, 2.4),
    ],
  },
  "ident-ac-prop-twin-turbo": {
    paths: [
      capsuleBodyPath({
        cx: 16,
        top: 6.6,
        bottom: 27.6,
        bodyW: 5.4,
        noseClip: 1.5,
        tailClip: 1.3,
      }),
      rectPath(2.5, 13, 27, 3.6),
      "M5.8 10 L10.8 10 L10.8 19.2 L8 20.4 L5.8 19.2 Z",
      "M21.2 10 L26.2 10 L26.2 19.2 L24 20.4 L21.2 19.2 Z",
      rectPath(10.2, 25.8, 11.6, 2.6),
    ],
  },
  "ident-ac-cargo-heavy": {
    paths: [
      jetAirframePath({
        len: 30,
        bodyW: 3,
        span: 28,
        wingY: 13,
        wingSweep: 5.8,
        wingChord: 3.1,
        tailSpan: 12.5,
        tailY: 24,
        tailSweep: 2.2,
        tailChord: 2,
      }),
      rectPath(4.8, 16.2, 2.2, 3.2),
      rectPath(9.2, 14.4, 2.2, 3.2),
      rectPath(20.6, 14.4, 2.2, 3.2),
      rectPath(25, 16.2, 2.2, 3.2),
    ],
  },
  "ident-ac-helicopter": {
    paths: [
      ...rotorXPath({ cx: 16, cy: 12, r: 11.5, t: 0.8 }),
      capsuleBodyPath({
        cx: 16,
        top: 7,
        bottom: 24.6,
        bodyW: 10.8,
        noseClip: 3.6,
        tailClip: 3.2,
      }),
      rectPath(14.8, 24, 2.4, 6),
      rectPath(12.4, 29, 7.2, 2),
    ],
  },
  "ident-ac-gyrocopter": {
    paths: [
      ...rotorXPath({ cx: 16, cy: 12, r: 11, t: 0.6 }),
      "M13.4 14 L18.6 14 L17.8 22 L19.2 26 L12.8 26 L14.2 22 Z",
      rectPath(14, 26.4, 4, 1.8),
    ],
  },
  "ident-ac-glider": {
    paths: [
      rectPath(1, 14, 30, 2.4),
      capsuleBodyPath({
        cx: 16,
        top: 6,
        bottom: 27.2,
        bodyW: 3.4,
        noseClip: 1,
        tailClip: 0.9,
      }),
      rectPath(11.4, 24.6, 9.2, 2),
    ],
  },
  "ident-ac-balloon": {
    paths: [
      ellipsePath(16, 13.4, 9, 9),
      roundedRectPath(12.6, 22.4, 6.8, 3.2, 0.8),
    ],
  },
  "ident-ac-blimp": {
    paths: [
      ellipsePath(16, 16, 6.6, 12.5),
      roundedRectPath(13.4, 26, 5.2, 3.4, 0.7),
      "M10 26.5 L13.4 24.6 L13.4 28.6 Z",
      "M22 26.5 L18.6 24.6 L18.6 28.6 Z",
    ],
  },
  "ident-ac-uav": {
    paths: [
      rotatedRectPath(16, 16, 16, 2.4, 45),
      rotatedRectPath(16, 16, 16, 2.4, -45),
      ellipsePath(16, 16, 3, 3),
      ellipsePath(10, 10, 2.4, 2.4),
      ellipsePath(22, 10, 2.4, 2.4),
      ellipsePath(10, 22, 2.4, 2.4),
      ellipsePath(22, 22, 2.4, 2.4),
    ],
  },
  "ident-ac-tiltrotor": {
    paths: [
      capsuleBodyPath({
        cx: 16,
        top: 5.4,
        bottom: 27.4,
        bodyW: 6.4,
        noseClip: 1.6,
        tailClip: 1.4,
      }),
      rectPath(4, 13, 24, 3.2),
      ...rotorXPath({ cx: 5.4, cy: 11, r: 4.8, t: 0.65 }),
      ...rotorXPath({ cx: 26.6, cy: 11, r: 4.8, t: 0.65 }),
    ],
  },
  "ident-ac-ground-unknown": {
    paths: [
      capsuleBodyPath({
        cx: 16,
        top: 10,
        bottom: 22,
        bodyW: 14,
        noseClip: 2.4,
        tailClip: 2.4,
      }),
    ],
  },
  "ident-ac-ground-service": {
    paths: [
      capsuleBodyPath({
        cx: 16,
        top: 10,
        bottom: 22,
        bodyW: 15,
        noseClip: 2,
        tailClip: 2,
      }),
      "M12 13.6 L16 16.6 L20 13.6 L20 15 L16 18 L12 15 Z",
    ],
  },
  "ident-ac-ground-emergency": {
    paths: [
      capsuleBodyPath({
        cx: 16,
        top: 10,
        bottom: 22,
        bodyW: 17,
        noseClip: 2,
        tailClip: 2,
      }),
      rectPath(15, 12.2, 2, 7.6),
      rectPath(12.2, 15, 7.6, 2),
    ],
  },
  "ident-ac-ground-tower": {
    paths: ["M16 6 L26 16 L16 26 L6 16 Z"],
  },
};

const AIRCRAFT_ICON_DEFS: Array<{
  id: AircraftIconId;
  createImage: () => { width: number; height: number; data: Uint8ClampedArray };
}> = Object.entries(ICON_SHAPES).map(([id, shape]) => ({
  id: id as AircraftIconId,
  createImage: () => createIconImage(shape),
}));

export function aircraftIconId(ac: Aircraft): AircraftIconId {
  const type = cleanType(ac.t);
  const category = cleanType(ac.category);
  const desc = ac.desc?.toLowerCase() ?? "";

  const typeMatch = TYPE_DESIGNATOR_ICONS.get(type);
  if (typeMatch) return typeMatch;

  if (CATEGORY_ICONS[category]) return CATEGORY_ICONS[category];
  if (isLikelyRotorcraft(type, desc)) return "ident-ac-helicopter";
  if (isLikelyJet(type, desc)) return "ident-ac-bizjet";
  return AIRCRAFT_UNKNOWN_ICON_ID;
}

export function ensureAircraftIcons(map: MlMap): void {
  for (const def of AIRCRAFT_ICON_DEFS) {
    if (map.hasImage(def.id)) continue;
    map.addImage(def.id, def.createImage(), { sdf: true, pixelRatio: 1 });
  }
}

function cleanType(value: string | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function isLikelyRotorcraft(type: string, desc: string): boolean {
  return type.startsWith("H") || desc.includes("helicopter");
}

function isLikelyJet(type: string, desc: string): boolean {
  return type.startsWith("F") || desc.includes("jet");
}

interface IconShape {
  paths: string[];
}

function createIconImage(shape: IconShape): {
  width: number;
  height: number;
  data: Uint8ClampedArray;
} {
  const mask = new Mask(ICON_SIZE, ICON_SIZE);
  for (const path of shape.paths) mask.path(path);
  return mask.toImage();
}

interface JetAirframeArgs {
  len: number;
  bodyW: number;
  span: number;
  wingY: number;
  wingSweep: number;
  wingChord: number;
  tailSpan: number;
  tailY: number;
  tailSweep: number;
  tailChord: number;
}

function jetAirframePath({
  len,
  bodyW,
  span,
  wingY,
  wingSweep,
  wingChord,
  tailSpan,
  tailY,
  tailSweep,
  tailChord,
}: JetAirframeArgs): string {
  const top = C - len / 2;
  const bottom = C + len / 2;
  const wingRootTop = top + wingY;
  const wingRootBottom = wingRootTop + wingChord;
  const wingTipTop = wingRootTop + wingSweep;
  const wingTipBottom = wingTipTop + wingChord * 0.55;
  const tailRootTop = top + tailY;
  const tailRootBottom = tailRootTop + tailChord;
  const tailTipTop = tailRootTop + tailSweep;
  const tailTipBottom = tailTipTop + tailChord * 0.55;

  return pathFromPoints([
    [C, top],
    [C + bodyW, top + bodyW * 1.2],
    [C + bodyW, wingRootTop],
    [C + span / 2, wingTipTop],
    [C + span / 2, wingTipBottom],
    [C + bodyW, wingRootBottom],
    [C + bodyW, tailRootTop],
    [C + tailSpan / 2, tailTipTop],
    [C + tailSpan / 2, tailTipBottom],
    [C + bodyW * 0.85, tailRootBottom],
    [C + bodyW * 0.6, bottom - 0.4],
    [C, bottom],
    [C - bodyW * 0.6, bottom - 0.4],
    [C - bodyW * 0.85, tailRootBottom],
    [C - tailSpan / 2, tailTipBottom],
    [C - tailSpan / 2, tailTipTop],
    [C - bodyW, tailRootTop],
    [C - bodyW, wingRootBottom],
    [C - span / 2, wingTipBottom],
    [C - span / 2, wingTipTop],
    [C - bodyW, wingRootTop],
    [C - bodyW, top + bodyW * 1.2],
  ]);
}

function capsuleBodyPath({
  cx,
  top,
  bottom,
  bodyW,
  noseClip = 0.9,
  tailClip = 0.7,
}: {
  cx: number;
  top: number;
  bottom: number;
  bodyW: number;
  noseClip?: number;
  tailClip?: number;
}): string {
  const halfWidth = bodyW / 2;
  const noseInset = Math.min(noseClip, halfWidth * 0.9);
  const tailInset = Math.min(tailClip, halfWidth * 0.9);
  return pathFromPoints([
    [cx - (halfWidth - noseInset), top],
    [cx + (halfWidth - noseInset), top],
    [cx + halfWidth, top + noseInset],
    [cx + halfWidth, bottom - tailInset],
    [cx + (halfWidth - tailInset), bottom],
    [cx - (halfWidth - tailInset), bottom],
    [cx - halfWidth, bottom - tailInset],
    [cx - halfWidth, top + noseInset],
  ]);
}

function rotorXPath({
  cx,
  cy,
  r,
  t,
}: {
  cx: number;
  cy: number;
  r: number;
  t: number;
}): string[] {
  const s = Math.SQRT1_2;
  const firstStartX = cx - r * s;
  const firstStartY = cy + r * s;
  const firstEndX = cx + r * s;
  const firstEndY = cy - r * s;
  const firstOffsetX = t * s;
  const firstOffsetY = t * s;
  const secondStartX = cx - r * s;
  const secondStartY = cy - r * s;
  const secondEndX = cx + r * s;
  const secondEndY = cy + r * s;
  const secondOffsetX = t * s;
  const secondOffsetY = -t * s;

  return [
    pathFromPoints([
      [firstStartX - firstOffsetX, firstStartY - firstOffsetY],
      [firstStartX + firstOffsetX, firstStartY + firstOffsetY],
      [firstEndX + firstOffsetX, firstEndY + firstOffsetY],
      [firstEndX - firstOffsetX, firstEndY - firstOffsetY],
    ]),
    pathFromPoints([
      [secondStartX - secondOffsetX, secondStartY - secondOffsetY],
      [secondStartX + secondOffsetX, secondStartY + secondOffsetY],
      [secondEndX + secondOffsetX, secondEndY + secondOffsetY],
      [secondEndX - secondOffsetX, secondEndY - secondOffsetY],
    ]),
  ];
}

function circlePath(cx: number, cy: number, r: number): string {
  return ellipsePath(cx, cy, r, r);
}

function ringSegmentPaths(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  count: number,
): string[] {
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const start = (i / count) * Math.PI * 2;
    const end = start + ((Math.PI * 2) / count) * 0.6;
    paths.push(
      pathFromPoints([
        [
          cx + innerRadius * Math.cos(start),
          cy + innerRadius * Math.sin(start),
        ],
        [
          cx + outerRadius * Math.cos(start),
          cy + outerRadius * Math.sin(start),
        ],
        [cx + outerRadius * Math.cos(end), cy + outerRadius * Math.sin(end)],
        [cx + innerRadius * Math.cos(end), cy + innerRadius * Math.sin(end)],
      ]),
    );
  }
  return paths;
}

function pathFromPoints(points: Array<[number, number]>): string {
  return `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${formatPathNumber(x)} ${formatPathNumber(y)}`).join(" ")} Z`;
}

function rectPath(x: number, y: number, width: number, height: number): string {
  return pathFromPoints([
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ]);
}

function roundedRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  const r = Math.min(radius, width / 2, height / 2);
  const points: Array<[number, number]> = [];
  addArcPoints(points, x + width - r, y + r, r, -90, 0);
  addArcPoints(points, x + width - r, y + height - r, r, 0, 90);
  addArcPoints(points, x + r, y + height - r, r, 90, 180);
  addArcPoints(points, x + r, y + r, r, 180, 270);
  return pathFromPoints(points);
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 28; i++) {
    const angle = (i / 28) * Math.PI * 2;
    points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
  }
  return pathFromPoints(points);
}

function rotatedRectPath(
  cx: number,
  cy: number,
  width: number,
  height: number,
  degrees: number,
): string {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners: Array<[number, number]> = [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ];
  return pathFromPoints(
    corners.map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]),
  );
}

function addArcPoints(
  points: Array<[number, number]>,
  cx: number,
  cy: number,
  radius: number,
  startDegrees: number,
  endDegrees: number,
): void {
  for (let i = 0; i <= 4; i++) {
    const angle =
      ((startDegrees + ((endDegrees - startDegrees) * i) / 4) * Math.PI) / 180;
    points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
}

function formatPathNumber(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, "");
}

class Mask {
  private readonly data: Uint8ClampedArray;

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height);
  }

  path(path: string): void {
    const points = parsePolygonPath(path);
    if (points.length < 3) return;
    this.fill((x, y) => pointInPolygon(x, y, points));
  }

  toImage(): { width: number; height: number; data: Uint8ClampedArray } {
    const rgba = new Uint8ClampedArray(this.width * this.height * 4);
    for (let i = 0; i < this.data.length; i++) {
      const v = this.data[i];
      if (v === 0) continue;
      const p = i * 4;
      rgba[p] = 255;
      rgba[p + 1] = 255;
      rgba[p + 2] = 255;
      rgba[p + 3] = v;
    }
    return { width: this.width, height: this.height, data: rgba };
  }

  private fill(predicate: (x: number, y: number) => boolean): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!predicate(x + 0.5, y + 0.5)) continue;
        this.data[y * this.width + x] = 255;
      }
    }
  }
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

function parsePolygonPath(path: string): Array<[number, number]> {
  const tokens = path.match(/[MLZ]|-?\d+(?:\.\d+)?/g) ?? [];
  const points: Array<[number, number]> = [];
  let command = "";
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index++];
    if (token === "Z") break;
    if (token === "M" || token === "L") {
      command = token;
      continue;
    }
    if (command !== "M" && command !== "L") continue;
    const next = tokens[index++];
    if (next === undefined) break;
    points.push([Number(token), Number(next)]);
  }

  return points;
}
