#!/usr/bin/env node

import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { zstdDecompressSync } from "node:zlib";

const RECEIVER = {
  lat: 34.118434,
  lon: -118.300393,
};
const DEFAULT_OUT_DIR = "fixtures/receiver-sample";
const DEFAULT_SEED = "ident-fixture";
const DEFAULT_START = 1776945600;
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_AIRCRAFT_COUNT = 150;
const REMOTE_MIN_INTERVAL_MS = 1000;
const MAX_FIXTURE_RANGE_NM = 200;
const IDENTITY_ROTATION_INTERVAL_SEC = 30;
const GOLDEN_ANGLE_DEGREES = 137.507764;
const TRAIL_HISTORY_SEC = 300;
const TRAIL_CURRENT_SEC = 30;
const TRAIL_SAMPLE_INTERVAL_SEC = 1;
const TRAIL_REFRESH_FRAMES = 10;
const METERS_PER_NM = 1852;
const EARTH_RADIUS_NM = 3440.065;
const AIRCRAFT_TYPES = [
  "adsb_icao",
  "adsb_icao_nt",
  "adsr_icao",
  "tisb_icao",
  "adsc",
  "mlat",
  "other",
  "mode_s",
  "adsb_other",
  "adsr_other",
  "tisb_trackfile",
  "tisb_other",
  "mode_ac",
];

const ROSTER = [
  {
    hex: "c02e8f",
    flight: "JZA634",
    r: "C-FRQK",
    t: "E75S",
    type: "adsb_icao",
    category: "A3",
    alt_baro: 3950,
    gs: 277,
    track: 204.8,
    squawk: "6225",
    baro_rate: -64,
    distanceNm: 0.4,
    bearing: 231.7,
  },
  {
    hex: "ab6162",
    flight: "EDV5034",
    r: "N832SK",
    t: "CRJ9",
    type: "adsb_icao",
    category: "A3",
    alt_baro: 1400,
    gs: 122,
    track: 32.7,
    squawk: "6751",
    baro_rate: -704,
    distanceNm: 3.3,
    bearing: 131.9,
  },
  {
    hex: "a89d22",
    flight: "RPA4773",
    r: "N654RW",
    t: "E170",
    type: "adsb_icao",
    category: "A3",
    alt_baro: 450,
    gs: 127,
    track: 32.4,
    squawk: "0723",
    baro_rate: -768,
    distanceNm: 3.9,
    bearing: 88.4,
  },
  {
    hex: "ac5756",
    flight: "N89456",
    r: "N89456",
    t: "C152",
    type: "adsr_icao",
    category: "A1",
    alt_baro: 1100,
    gs: 81,
    track: 21.8,
    squawk: "1200",
    baro_rate: 64,
    distanceNm: 5.1,
    bearing: 14.7,
  },
  {
    hex: "a17c12",
    flight: "EDV4926",
    r: "N195PQ",
    t: "CRJ9",
    type: "adsb_icao",
    category: "A3",
    alt_baro: -25,
    gs: 152,
    track: 122.6,
    squawk: "1650",
    distanceNm: 5.7,
    bearing: 73.3,
  },
  {
    hex: "a5e02d",
    flight: "EDV5116",
    r: "N478PX",
    t: "CRJ9",
    type: "adsb_icao",
    category: "A3",
    alt_baro: 2975,
    gs: 181,
    track: 31,
    squawk: "3171",
    baro_rate: -832,
    distanceNm: 6,
    bearing: 179,
  },
  {
    hex: "a35dae",
    flight: "LXJ316",
    r: "N316FX",
    t: "E545",
    type: "adsb_icao",
    category: "A2",
    alt_baro: 550,
    gs: 111,
    track: 47.9,
    squawk: "7310",
    baro_rate: -576,
    distanceNm: 7,
    bearing: 312.3,
  },
  {
    hex: "a44588",
    flight: "UAL2631",
    r: "N37437",
    t: "B739",
    type: "adsb_icao",
    category: "A3",
    alt_baro: 1825,
    gs: 183,
    track: 43.9,
    squawk: "2773",
    baro_rate: 1408,
    distanceNm: 7.2,
    bearing: 258.4,
  },
  {
    hex: "a51633",
    flight: "LXJ427",
    r: "N427FX",
    t: "E545",
    type: "adsb_icao",
    category: "A2",
    alt_baro: 750,
    gs: 160,
    track: 9,
    squawk: "3332",
    baro_rate: 2560,
    distanceNm: 7.5,
    bearing: 334.2,
  },
  {
    hex: "a3a152",
    flight: "DAL878",
    r: "N333DU",
    t: "BCS3",
    type: "adsb_icao",
    category: "A3",
    alt_baro: 12175,
    gs: 301,
    track: 257.9,
    squawk: "7103",
    distanceNm: 7.7,
    bearing: 321.8,
  },
  {
    hex: "a48a8f",
    flight: "DAL2465",
    r: "N392DN",
    t: "A321",
    type: "adsb_icao",
    category: "A3",
    alt_baro: 4200,
    gs: 254,
    track: 292.7,
    squawk: "1665",
    baro_rate: 2496,
    distanceNm: 9.4,
    bearing: 65.8,
  },
  {
    hex: "a6d3f2",
    flight: "VJA539",
    r: "N539XJ",
    t: "CL30",
    type: "adsb_icao",
    category: "A2",
    alt_baro: 3650,
    gs: 221,
    track: 222.4,
    squawk: "7101",
    baro_rate: 3712,
    distanceNm: 10.5,
    bearing: 320,
  },
  {
    hex: "ac486a",
    flight: "SWA234",
    r: "N8905Q",
    t: "B38M",
    type: "adsb_icao",
    category: "A3",
    alt_baro: "ground",
    gs: 12,
    squawk: "3302",
    distanceNm: 5.1,
    bearing: 70.1,
  },
  {
    hex: "a3a8c0",
    flight: "DAL2917",
    r: "N335DU",
    t: "BCS3",
    type: "adsb_icao",
    category: "A3",
    alt_baro: "ground",
    gs: 17,
    squawk: "1536",
    distanceNm: 5.2,
    bearing: 70.8,
  },
  {
    hex: "a4f414",
    flight: "RPA4413",
    r: "N418YX",
    t: "E75L",
    type: "adsb_icao",
    category: "A3",
    alt_baro: "ground",
    gs: 2,
    squawk: "1153",
    distanceNm: 5.2,
    bearing: 68.9,
  },
  {
    hex: "adcdcc",
    flight: "AAL392",
    r: "N989NN",
    t: "B738",
    type: "adsb_icao",
    category: "A3",
    alt_baro: "ground",
    gs: 4,
    squawk: "3301",
    distanceNm: 5.2,
    bearing: 68.5,
  },
  {
    hex: "acb2c2",
    flight: "EDV5064",
    r: "N917XJ",
    t: "CRJ9",
    type: "adsb_icao",
    category: "A3",
    alt_baro: "ground",
    gs: 8,
    squawk: "2610",
    distanceNm: 5.2,
    bearing: 71.7,
  },
  {
    hex: "a6ce58",
    flight: "EDV5187",
    r: "N538CA",
    t: "CRJ9",
    type: "adsb_icao",
    category: "A3",
    alt_baro: "ground",
    gs: 4,
    squawk: "1750",
    distanceNm: 5.3,
    bearing: 67.7,
  },
  {
    hex: "a45915",
    flight: "N38BL",
    r: "N38BL",
    t: "B407",
    type: "adsb_icao",
    category: "A7",
    alt_baro: -100,
    gs: 1,
    track: 90,
    squawk: "1200",
    baro_rate: -640,
    distanceNm: 1,
    bearing: 291.1,
  },
  {
    hex: "a59eeb",
    flight: "OPT461",
    r: "N461SJ",
    t: "BE40",
    type: "adsb_icao",
    category: "A2",
    alt_baro: "ground",
    gs: 0,
    squawk: "4204",
    distanceNm: 6.6,
    bearing: 326.4,
  },
  {
    hex: "a34840",
    flight: "EJA310",
    r: "N310QS",
    t: "E55P",
    type: "adsb_icao",
    category: "A2",
    alt_baro: "ground",
    gs: 0,
    squawk: "3344",
    distanceNm: 6.8,
    bearing: 327.5,
  },
  {
    hex: "a06f71",
    flight: "GPD127",
    r: "N127TW",
    t: "PC12",
    type: "adsb_icao",
    category: "A1",
    alt_baro: "ground",
    gs: 0,
    squawk: "1200",
    distanceNm: 6.9,
    bearing: 327.5,
  },
  {
    hex: "a642cd",
    flight: "EJA502",
    r: "N502QS",
    t: "C68A",
    type: "adsb_icao",
    category: "A2",
    alt_baro: "ground",
    gs: 0,
    squawk: "3352",
    distanceNm: 6.9,
    bearing: 327.7,
  },
  {
    hex: "ab39b8",
    flight: "EJA822",
    r: "N822QS",
    t: "C700",
    type: "adsb_icao",
    category: "A2",
    alt_baro: "ground",
    gs: 0,
    squawk: "1571",
    distanceNm: 6.9,
    bearing: 327.8,
  },
  {
    hex: "a70b2f",
    flight: "GJS4419",
    r: "N553GJ",
    t: "CRJ7",
    type: "adsb_icao",
    category: "A2",
    alt_baro: 650,
    gs: 126,
    track: 26,
    squawk: "2067",
    baro_rate: -704,
    distanceNm: 11,
    bearing: 238,
  },
  {
    hex: "a12756",
    flight: "UAL1067",
    r: "N17347",
    t: "B38M",
    type: "adsb_icao",
    category: "A3",
    alt_baro: 8600,
    gs: 293,
    track: 195,
    squawk: "2747",
    baro_rate: 2624,
    distanceNm: 11.6,
    bearing: 251.1,
  },
  {
    hex: "a4da13",
    flight: "RPA4553",
    r: "N411YX",
    t: "E75L",
    type: "adsb_icao",
    category: "A3",
    alt_baro: 3725,
    gs: 253,
    track: 41.3,
    squawk: "0762",
    baro_rate: -1856,
    distanceNm: 12.3,
    bearing: 199.4,
  },
  {
    hex: "a486be",
    flight: "ABX552",
    r: "N391CM",
    t: "B763",
    type: "adsb_icao",
    category: "A5",
    alt_baro: 25,
    gs: 144,
    track: 30.8,
    squawk: "4034",
    baro_rate: -640,
    distanceNm: 12.3,
    bearing: 126.6,
  },
  {
    hex: "ace3ab",
    flight: "N93DR",
    r: "N93DR",
    t: "R44",
    type: "adsr_icao",
    category: "A7",
    alt_baro: 700,
    gs: 72,
    track: 72.3,
    squawk: "0315",
    baro_rate: -64,
    distanceNm: 12.7,
    bearing: 231.1,
  },
  {
    hex: "aa92c2",
    flight: "RPA3594",
    r: "N780YX",
    t: "E75L",
    type: "adsb_icao",
    category: "A3",
    alt_baro: 1550,
    gs: 127,
    track: 26.2,
    squawk: "6645",
    baro_rate: -576,
    distanceNm: 13.7,
    bearing: 231.2,
  },
  {
    hex: "c02fb4",
    flight: "ASP814",
    r: "C-FSBR",
    t: "E550",
    type: "adsb_icao",
    category: "A2",
    alt_baro: 6000,
    gs: 289,
    track: 177,
    squawk: "2730",
    baro_rate: 384,
    distanceNm: 14.1,
    bearing: 276.3,
  },
  {
    hex: "aa0cf4",
    flight: "N747EE",
    r: "N747EE",
    t: "B407",
    type: "adsb_icao",
    category: "A7",
    alt_baro: 725,
    gs: 90,
    track: 198.2,
    squawk: "1200",
    baro_rate: 1024,
    distanceNm: 15.3,
    bearing: 297.7,
  },
  {"hex":"adbdee","flight":"N985CE","r":"N985CE","t":"H25B","type":"adsb_icao","category":"A2"},
  {"hex":"c07778","flight":"CGTGH","r":"C-GTGH","t":"C152","type":"tisb_icao","category":"A1"},
  {"hex":"a41804","flight":"LXJ363","r":"N363FX","t":"E55P","type":"adsb_icao","category":"A2"},
  {"hex":"a5b3a7","flight":"AAL3279","r":"N467AL","t":"A21N","type":"adsb_icao","category":"A3"},
  {"hex":"ad721a","flight":"N9657V","r":"N9657V","t":"C172","type":"adsb_icao","category":"A1"},
  {"hex":"a25bb7","flight":"FDX1514","r":"N251FE","t":"B763","type":"adsb_icao","category":"A5"},
  {"hex":"ad36a8","flight":"SWA2654","r":"N950WN","t":"B737","type":"adsb_icao","category":"A3"},
  {"hex":"abe7c5","flight":"SWA2918","r":"N8662F","t":"B738","type":"adsb_icao","category":"A3"},
  {"hex":"a8d20c","flight":"N668BB","r":"N668BB","t":"GLEX","type":"adsb_icao","category":"A2"},
  {"hex":"c06fbd","flight":"CGQIE","r":"C-GQIE","t":"AA5","type":"adsb_icao","category":"A1"},
  {"hex":"c051da","flight":"TSC922","r":"C-GEZX","t":"A321","type":"adsb_icao","category":"A3"},
  {"hex":"ace108","flight":"EJA929","r":"N929QS","t":"C68A","type":"adsb_icao","category":"A2"},
  {"hex":"c04af3","flight":"CJT476","r":"C-GCJY","t":"B752","type":"adsb_icao","category":"A5"},
  {"hex":"a08057","flight":"N131QS","r":"N131QS","t":"GL5T","type":"adsb_icao","category":"A3"},
  {"hex":"c0636c","flight":"PTR2452","r":"C-GLQX","t":"DH8D","type":"adsb_icao","category":"A3"},
  {"hex":"a5d089","flight":"LXJ474","r":"N474FX","t":"LJ75","type":"adsb_icao","category":"A2"},
  {"hex":"a4ca66","flight":"AAL2315","r":"N408AN","t":"A21N","type":"adsb_icao","category":"A3"},
  {"hex":"a02c94","flight":"DAL342","r":"N110DX","t":"A321","type":"adsb_icao","category":"A3"},
  {"hex":"ab5cfc","flight":"N831KK","r":"N831KK","t":"GLF6","type":"adsb_icao","category":"A2"},
  {"hex":"040102","flight":"ETH574","r":"ET-ASH","t":"B788","type":"adsb_icao","category":"A5"},
  {"hex":"a93229","flight":"PDT5933","r":"N692AE","t":"E145","type":"adsb_icao","category":"A3"},
  {"hex":"ab87ab","flight":"N842E","r":"N842E","t":"B190","type":"adsb_icao","category":"A3"},
  {"hex":"c00668","flight":"CFCLB","r":"C-FCLB","t":"PC12","type":"adsb_icao","category":"A1"},
  {"hex":"a53114","flight":"N4333R","r":"N4333R","t":"C172","type":"adsr_icao","category":"A1"},
  {"hex":"c07534","flight":"JZA7952","r":"C-GSJZ","t":"DH8D","type":"adsb_icao","category":"A3"},
  {"hex":"a4ec3a","flight":"UPS5025","r":"N416UP","t":"B752","type":"adsb_icao","category":"A5"},
  {"hex":"ab23e1","flight":"N817FG","r":"N817FG","t":"C172","type":"adsb_icao","category":"A1"},
  {"hex":"a825e3","flight":"JBU1571","r":"N624JB","t":"A320","type":"adsb_icao","category":"A3"},
  {"hex":"c00dce","flight":"FLE602","r":"C-FFFX","t":"B38M","type":"adsb_icao","category":"A3"},
  {"hex":"a9a499","flight":"N720LU","r":"N720LU","t":"C172","type":"adsb_icao","category":"A1"},
  {"hex":"a9ac07","flight":"N722LU","r":"N722LU","t":"C172","type":"adsb_icao","category":"A1"},
  {"hex":"e8046f","flight":"TAM8180","r":"CC-BGT","t":"B789","type":"adsb_icao","category":"A5"},
  {"hex":"a70c4f","flight":"N553TX","r":"N553TX","t":"C56X","type":"adsb_icao","category":"A2"},
  {"hex":"ad1c7c","flight":"N944EV","r":"N944EV","t":"P28A","type":"adsb_icao","category":"A1"},
  {"hex":"a3cdfa","flight":"UPS5063","r":"N344UP","t":"B763","type":"adsb_icao","category":"A5"},
  {"hex":"ad50c9","flight":"AAL583","r":"N957XV","t":"A21N","type":"adsb_icao","category":"A3"},
  {"hex":"a43cce","flight":"N372SE","r":"N372SE","t":"DA40","type":"adsb_icao","category":"A1"},
  {"hex":"c03064","flight":"ACA314","r":"C-FSIL","t":"B38M","type":"adsb_icao","category":"A3"},
  {"hex":"ac82bc","flight":"N905LC","r":"N905LC","t":"C560","type":"adsb_icao","category":"A2"},
  {"hex":"acee86","flight":"EJA932","r":"N932QS","t":"C68A","type":"adsb_icao","category":"A2"},
  {"hex":"a41bb5","flight":"FFT2013","r":"N364FR","t":"A20N","type":"adsb_icao","category":"A3"},
  {"hex":"ad3035","flight":"N949SP","r":"N949SP","t":"C172","type":"adsb_icao","category":"A1"},
  {"hex":"a32f46","flight":"N304ME","r":"N304ME","t":"EC45","type":"adsb_icao","category":"A7"},
  {"hex":"ab56b1","flight":"N83HA","r":"N83HA","t":"C560","type":"adsb_icao","category":"A2"},
  {"hex":"ac3751","flight":"SWA3415","r":"N8866H","t":"B38M","type":"adsb_icao","category":"A3"},
  {"hex":"a553db","flight":"UPS2133","r":"N442UP","t":"B752","type":"adsb_icao","category":"A5"},
  {"hex":"acf69b","flight":"EDV5050","r":"N934XJ","t":"CRJ9","type":"adsb_icao","category":"A3"},
  {"hex":"c08537","flight":"ACA1039","r":"C-GYLQ","t":"BCS3","type":"adsb_icao","category":"A3"},
  {"hex":"a26e4a","flight":"FDX3806","r":"N256FE","t":"B763","type":"adsb_icao","category":"A5"},
  {"hex":"a8cfa9","flight":"EJA667","r":"N667QS","t":"C68A","type":"adsb_icao","category":"A2"},
  {"hex":"aaa339","flight":"N785BG","r":"N785BG","t":"C172","type":"adsb_icao","category":"A1"},
  {"hex":"a7e58d","flight":"CXK339","r":"N608G","t":"P28A","type":"adsb_icao","category":"A1"},
  {"hex":"a4cc29","flight":"UPS7818","r":"N408UP","t":"B752","type":"adsb_icao","category":"A5"},
  {"hex":"c05cb6","flight":"CGJCV","r":"C-GJCV","t":"C150","type":"adsb_icao","category":"A1"},
  {"hex":"ab5024","flight":"GPD828","r":"N828SA","t":"PC12","type":"adsb_icao","category":"A1"},
  {"hex":"a1fff2","flight":"ENY3807","r":"N228NN","t":"E75L","type":"adsb_icao","category":"A3"},
  {"hex":"a3db5e","flight":"DAL2933","r":"N348DN","t":"A321","type":"adsb_icao","category":"A3"},
  {"hex":"c010cd","flight":"CFGJK","r":"C-FGJK","t":"C152","type":"tisb_icao","category":"A1"},
  {"hex":"a63dc7","flight":"JIA5074","r":"N501BG","t":"CRJ7","type":"adsb_icao","category":"A3"},
  {"hex":"c047cf","flight":"CGBFA","r":"C-GBFA","t":"C172","type":"adsb_icao","category":"A1"},
  {"hex":"a22a73","flight":"N239FG","r":"N239FG","t":"C172","type":"adsb_icao","category":"A1"},
  {"hex":"a05827","flight":"RPA4379","r":"N121HQ","t":"E75L","type":"adsb_icao","category":"A3"},
  {"hex":"a34d98","flight":"JBU1173","r":"N3115J","t":"BCS3","type":"adsb_icao","category":"A3"},
  {"hex":"a7a0ea","flight":"N5908U","r":"N5908U","t":"P28A","type":"adsr_icao","category":"A1"},
  {"hex":"a866aa","flight":"N640QS","r":"N640QS","t":"C68A","type":"adsb_icao","category":"A2"},
  {"hex":"a19d03","flight":"N20289","r":"N20289","t":"C172","type":"adsb_icao","category":"A1"},
  {"hex":"c00da8","flight":"FLE106","r":"C-FFEL","t":"B38M","type":"adsb_icao","category":"A3"},
  {"hex":"c08418","flight":"CGYAP","r":"C-GYAP","t":"C152","type":"tisb_icao","category":"A1"},
  {"hex":"a4bdfe","flight":"N4041F","r":"N4041F","t":"R44","type":"adsb_icao","category":"A7"},
  {"hex":"a2d95e","flight":"CSB588","r":"N283CM","t":"B763","type":"adsb_icao","category":"A5"},
  {"hex":"c0101c","flight":"MBK860","r":"C-FGCP","t":"DH8A","type":"adsb_icao","category":"A3"},
  {"hex":"c06362","flight":"PTR2205","r":"C-GLQN","t":"DH8D","type":"adsb_icao","category":"A3"},
  {"hex":"abbb08","flight":"N855MK","r":"N855MK","t":"H160","type":"adsb_icao","category":"A3"},
  {"hex":"a0b5c1","flight":"N145FA","r":"N145FA","t":"E50P","type":"adsb_icao","category":"A2"},
  {"hex":"a6951f","flight":"N523LT","r":"N523LT","t":"DA40","type":"adsb_icao","category":"A1"},
  {"hex":"a123e0","flight":"UAL2094","r":"N17262","t":"B38M","type":"adsb_icao","category":"A3"},
  {"hex":"a13650","flight":"UAL451","r":"N17752","t":"B737","type":"adsb_icao","category":"A3"},
  {"hex":"040242","flight":"ETH500","r":"ET-BAY","t":"A35K","type":"adsb_icao","category":"A5"},
  {"hex":"a20e38","flight":"SWA1144","r":"N231WN","t":"B737","type":"adsb_icao","category":"A3"},
  {"hex":"c078b2","flight":"TSC538","r":"C-GTSJ","t":"A332","type":"adsb_icao","category":"A5"},
  {"hex":"ad23f3","flight":"FDX156","r":"N946FD","t":"B752","type":"adsb_icao","category":"A5"},
  {"hex":"a0f95c","flight":"CAP4541","r":"N162CP","t":"C172","type":"adsb_icao","category":"A1"},
  {"hex":"a57d8f","flight":"N453DC","r":"N453DC","t":"PC12","type":"adsb_icao","category":"A1"},
  {"hex":"a60ebd","flight":"N49LD","r":"N49LD","t":"C560","type":"adsb_icao","category":"A2"},
  {"hex":"a9b732","flight":"N725M","r":"N725M","t":"H500","type":"adsr_icao","category":"A3"},
  {"hex":"a80d40","flight":"JBU667","r":"N618JB","t":"A320","type":"adsb_icao","category":"A3"},
  {"hex":"a24591","flight":"UAL2605","r":"N24542","t":"A21N","type":"adsb_icao","category":"A3"},
  {"hex":"a12ac8","flight":"UAL1289","r":"N17428","t":"B39M","type":"adsb_icao","category":"A3"},
  {"hex":"aa9181","flight":"N780LA","r":"N780LA","t":"P28A","type":"adsb_icao","category":"A1"},
  {"hex":"a69b87","flight":"CNS1210","r":"N525AF","t":"PC24","type":"adsb_icao","category":"A2"},
  {"hex":"c0253f","flight":"CFOCS","r":"C-FOCS","t":"C560","type":"adsb_icao","category":"A2"},
  {"hex":"a3a9fb","flight":"UWD35","r":"N335SJ","t":"LJ60","type":"adsb_icao","category":"A2"},
  {"hex":"c07718","flight":"CGTCP","r":"C-GTCP","t":"B06","type":"adsb_icao","category":"A7"},
  {"hex":"c0061a","flight":"HRT881","r":"C-FCIB","t":"CL60","type":"adsb_icao","category":"A2"},
  {"hex":"a5cc11","flight":"UAL1115","r":"N47280","t":"B38M","type":"adsb_icao","category":"A3"},
  {"hex":"ac7317","flight":"N901CB","r":"N901CB","t":"C56X","type":"adsb_icao","category":"A2"},
  {"hex":"a9b408","flight":"N724SR","r":"N724SR","t":"SR22","type":"adsb_icao","category":"A1"},
  {"hex":"ac8d68","flight":"N908FG","r":"N908FG","t":"C172","type":"adsb_icao","category":"A1"},
  {"hex":"a63e3a","flight":"LXJ501","r":"N501FX","t":"CL35","type":"adsb_icao","category":"A2"},
  {"hex":"ac71dd","flight":"AAL3119","r":"N9002U","t":"A319","type":"adsb_icao","category":"A3"},
  {"hex":"a9ea1c","flight":"N738PV","r":"N738PV","t":"C172","type":"adsb_icao","category":"A1"},
  {"hex":"abdf22","flight":"N864QS","r":"N864QS","t":"C700","type":"adsb_icao","category":"A2"},
  {"hex":"a27197","flight":"ATN3451","r":"N257AZ","t":"B763","type":"adsb_icao","category":"A5"},
  {"hex":"a2b98d","flight":"N275FA","r":"N275FA","t":"P28A","type":"adsb_icao","category":"A1"},
  {"hex":"a83029","flight":"N6269Q","r":"N6269Q","t":"C172","type":"adsb_icao","category":"A1"},
  {"hex":"c07993","flight":"TSC398","r":"C-GUBA","t":"A332","type":"adsb_icao","category":"A5"},
  {"hex":"a28ab5","flight":"LXJ263","r":"N263FX","t":"E545","type":"adsb_icao","category":"A2"},
  {"hex":"a19dff","flight":"RPA5698","r":"N203JQ","t":"E75L","type":"adsb_icao","category":"A3"},
  {"hex":"a79821","flight":"JBU1510","r":"N589JB","t":"A320","type":"adsb_icao","category":"A3"},
  {"hex":"a9d63b","flight":"ASA42","r":"N733AL","t":"B39M","type":"adsb_icao","category":"A3"},
  {"hex":"a438c3","flight":"DAL2643","r":"N371NW","t":"A320","type":"adsb_icao","category":"A3"},
  {"hex":"c03997","flight":"CFVVA","r":"C-FVVA","t":"B06","type":"adsb_icao","category":"A7"},
  {"hex":"ada5ee","flight":"JBU2677","r":"N979JT","t":"A321","type":"adsb_icao","category":"A3"},
  {"hex":"a72ef7","flight":"GJS4482","r":"N562GJ","t":"CRJ7","type":"adsb_icao","category":"A3"},
  {"hex":"c0554e","flight":"CGGHX","r":"C-GGHX","t":"C172","type":"adsb_icao","category":"A1"},
  {"hex":"a49759","flight":"N395WJ","r":"N395WJ","t":"C56X","type":"adsb_icao","category":"A2"},
  {"hex":"c06722","flight":"CGNBL","r":"C-GNBL","t":"C150","type":"adsb_icao","category":"A1"},
  {"hex":"a76af3","flight":"N5771P","r":"N5771P","t":"PA24","type":"adsb_icao","category":"A3"},
  {"hex":"c05c2a","flight":"CGIXL","r":"C-GIXL","t":"DA40","type":"tisb_icao","category":"A1"},
  {"hex":"a14ad1","flight":"UAL211","r":"N18220","t":"B738","type":"adsb_icao","category":"A3"},
  {"hex":"a23699","flight":"N24139","r":"N24139","t":"P28A","type":"adsb_icao","category":"A1"},
  {"hex":"a88e8a","flight":"WUP650","r":"N650UP","t":"E55P","type":"adsb_icao","category":"A2"},
  {"hex":"8963ea","flight":"UAE8ER","r":"A6-EOM","t":"A388","type":"adsb_icao","category":"A5"},
  {"hex":"a1bbeb","flight":"AVL125","r":"N2100S","t":"C172","type":"adsr_icao","category":"A1"},
  {"hex":"a20a75","flight":"N230WA","r":"N230WA","t":"SR20","type":"adsb_icao","category":"A1"},
  {"hex":"a7d338","flight":"N603JM","r":"N603JM","t":"R44","type":"adsb_icao","category":"A7"},
  {"hex":"a23fb2","flight":"RPA5797","r":"N244JQ","t":"E75L","type":"adsb_icao","category":"A3"},
  {"hex":"ac15a8","flight":"N878SK","r":"N878SK","t":"S22T","type":"adsb_icao","category":"A3"},
  {"hex":"a5106e","flight":"RPA4475","r":"N425YX","t":"E75L","type":"adsb_icao","category":"A3"},
  {"hex":"c060c1","flight":"POE102","r":"C-GKQQ","t":"E295","type":"adsb_icao","category":"A3"},
  {"hex":"a81a81","flight":"FFT1601","r":"N621FR","t":"A21N","type":"adsb_icao","category":"A3"},
  {"hex":"896463","flight":"ETD7MF","r":"A6-APH","t":"A388","type":"adsb_icao","category":"A5"},
  {"hex":"c060c4","flight":"POE222","r":"C-GKQT","t":"E295","type":"adsb_icao","category":"A3"},
  {"hex":"a54beb","flight":"PJC40","r":"N440PJ","t":"C56X","type":"adsb_icao","category":"A2"},
  {"hex":"a40aa8","flight":"N36HF","r":"N36HF","t":"S76","type":"adsb_icao","category":"A7"},
  {"hex":"a84663","flight":"JIA5088","r":"N632NN","t":"CRJ9","type":"adsb_icao","category":"A3"},
  {"hex":"a9819b","flight":"AAL1573","r":"N711UW","t":"A319","type":"adsb_icao","category":"A3"},
  {"hex":"ada51e","flight":"ASA764","r":"N979AK","t":"B39M","type":"adsb_icao","category":"A3"},
  {"hex":"a1b2ee","flight":"JBU939","r":"N2086J","t":"A21N","type":"adsb_icao","category":"A3"},
  {"hex":"c062cc","flight":"CGLKT","r":"C-GLKT","t":"PA44","type":"adsb_icao","category":"A1"},
  {"hex":"a3f4ea","flight":"DAL330","r":"N354NW","t":"A320","type":"adsb_icao","category":"A3"},
  {"hex":"a04e00","flight":"DAL2412","r":"N119DU","t":"BCS1","type":"adsb_icao","category":"A3"},
  {"hex":"ac4f6f","flight":"SWA3346","r":"N8922Q","t":"B38M","type":"adsb_icao","category":"A3"},
  {"hex":"ad526c","flight":"AAL2303","r":"N958AN","t":"B738","type":"adsb_icao","category":"A3"},
  {"hex":"a1b448","flight":"N209JP","r":"N209JP","t":"C208","type":"adsb_icao","category":"A1"},
  {"hex":"a8fc0c","flight":"N67818","r":"N67818","t":"C152","type":"adsb_icao","category":"A1"},
  {"hex":"a304d8","flight":"FDX644","r":"N294FE","t":"B763","type":"adsb_icao","category":"A5"},
  {"hex":"a53ba4","flight":"RPA4647","r":"N436YX","t":"E75L","type":"adsb_icao","category":"A3"},
  {"hex":"a0b5f5","flight":"N145HC","r":"N145HC","t":"EC45","type":"adsb_icao","category":"A7"},
  {"hex":"c07a08","flight":"CGUFN","r":"C-GUFN","t":"C150","type":"adsb_icao","category":"A1"},
  {"hex":"ac2952","flight":"DAL2579","r":"N883DN","t":"B739","type":"adsb_icao","category":"A3"},
  {"hex":"a6e7ba","flight":"KSF44","r":"N544KS","t":"C172","type":"adsb_icao","category":"A1"},
  {"hex":"a67c5d","flight":"N517KM","r":"N517KM","t":"PC12","type":"adsb_icao","category":"A1"},
  {"hex":"c080db","flight":"ACA1263","r":"C-GWUS","t":"BCS3","type":"adsb_icao","category":"A3"},
  {"hex":"a3ad6d","flight":"EDV5079","r":"N336PQ","t":"CRJ9","type":"adsb_icao","category":"A3"},
  {"hex":"a37842","flight":"JBU109","r":"N3221J","t":"BCS3","type":"adsb_icao","category":"A3"},
  {"hex":"a1c82c","flight":"N2138W","r":"N2138W","t":"C172","type":"adsb_icao","category":"A1"},
  {"hex":"a0b5f8","flight":"N145HF","r":"N145HF","t":"C172","type":"other","category":"A1"},
  {"hex":"a3c68c","flight":"UPS2115","r":"N342UP","t":"B763","type":"adsb_icao","category":"A5"},
  {"hex":"aa3fc2","flight":"FXC22","r":"N76FX","t":"S76","type":"adsb_icao","category":"A7"},
  {"hex":"a8f646","flight":"FFT3085","r":"N677FR","t":"A21N","type":"adsb_icao","category":"A3"},
  {"hex":"c07a14","flight":"TSC326","r":"C-GUFZ","t":"A332","type":"adsb_icao","category":"A5"},
  {"hex":"a2b4ea","flight":"UAL2000","r":"N27366","t":"B38M","type":"adsb_icao","category":"A3"},
  {"hex":"a4f08d","flight":"N4170V","r":"N4170V","t":"P32R","type":"adsb_icao","category":"A3"},
  {"hex":"a67883","flight":"N516JB","r":"N516JB","t":"A320","type":"adsb_icao","category":"A3"},
  {"hex":"a6cb86","flight":"N537ME","r":"N537ME","t":"EC35","type":"adsb_icao","category":"A7"},
  {"hex":"a4771b","flight":"UPS5445","r":"N387UP","t":"B763","type":"adsb_icao","category":"A5"},
  {"hex":"c05514","flight":"CGGFR","r":"C-GGFR","t":"C152","type":"tisb_icao","category":"A1"},
  {"hex":"a3a8ef","flight":"FFT3210","r":"N335FR","t":"A20N","type":"adsb_icao","category":"A3"},
  {"hex":"a4f22e","flight":"UWD18","r":"N418DL","t":"LJ31","type":"adsb_icao","category":"A2"},
  {"hex":"adddd5","flight":"AAL1587","r":"N993AN","t":"A321","type":"adsb_icao","category":"A3"},
  {"hex":"c00cab","flight":"CFEUS","r":"C-FEUS","t":"C172","type":"tisb_icao","category":"A1"},
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  const receiverPosition = RECEIVER;
  const outline = buildOutline(options.seed, receiverPosition);
  const receiver = {
    ...receiverPosition,
    version: "Ident fixture receiver",
    refresh: options.intervalMs,
    history: 120,
    readsb: true,
    binCraft: false,
    zstd: false,
    outlineJson: true,
  };

  await writeJson(path.join(options.outDir, "receiver.json"), receiver);
  await writeJson(path.join(options.outDir, "outline.json"), outline);

  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  if (options.live) {
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }

  let retryDelayMs = options.intervalMs;
  for (let frameIndex = 0; frameIndex < options.frames && !stopped; frameIndex += 1) {
    let frame;
    try {
      frame =
        options.remoteUrl
          ? await fetchRemoteFrame(options)
          : buildAircraftFrame(options, frameIndex);
      retryDelayMs = options.intervalMs;
    } catch (error) {
      if (!options.live) throw error;
      console.error(
        `Remote fixture fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      await sleep(retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, 30000);
      frameIndex -= 1;
      continue;
    }

    const stats = buildStats(options, frame, outline, receiverPosition);

    await writeJson(path.join(options.outDir, "aircraft.json"), frame);
    await writeJson(path.join(options.outDir, "stats.json"), stats);
    if (
      !options.remoteUrl &&
      (frameIndex === 0 || (options.live && frameIndex % TRAIL_REFRESH_FRAMES === 0))
    ) {
      await writeTrailChunks(options, frameIndex);
    }

    if (options.record) {
      const fileName = `aircraft-${String(frameIndex + 1).padStart(6, "0")}.json`;
      await writeJson(path.join(options.outDir, "frames", fileName), frame);
    }

    const hasNextFrame = frameIndex + 1 < options.frames;
    if ((options.live || options.remoteUrl) && hasNextFrame && !stopped) {
      await sleep(options.intervalMs);
    }
  }

  if (!options.live) {
    console.log(`Generated ${formatFrameCount(options.frames)} in ${options.outDir}`);
  }
}

function parseArgs(argv) {
  const options = {
    outDir: DEFAULT_OUT_DIR,
    seed: DEFAULT_SEED,
    remoteUrl: undefined,
    frames: 1,
    aircraftCount: DEFAULT_AIRCRAFT_COUNT,
    intervalMs: DEFAULT_INTERVAL_MS,
    start: DEFAULT_START,
    live: false,
    record: false,
    help: false,
  };
  let framesProvided = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--out":
        options.outDir = requireValue(argv, (i += 1), arg);
        break;
      case "--seed":
        options.seed = requireValue(argv, (i += 1), arg);
        break;
      case "--source-url":
        options.remoteUrl = requireValue(argv, (i += 1), arg);
        break;
      case "--frames":
        options.frames = parseInteger(requireValue(argv, (i += 1), arg), arg, 1);
        framesProvided = true;
        break;
      case "--aircraft":
      case "--aircraft-count":
        options.aircraftCount = parseInteger(requireValue(argv, (i += 1), arg), arg, 1);
        break;
      case "--interval-ms":
        options.intervalMs = parseInteger(requireValue(argv, (i += 1), arg), arg, 100);
        break;
      case "--start":
        options.start = parseFiniteNumber(requireValue(argv, (i += 1), arg), arg);
        break;
      case "--live":
        options.live = true;
        break;
      case "--record":
        options.record = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.live && !framesProvided) {
    options.frames = Number.POSITIVE_INFINITY;
  }
  if (options.aircraftCount > ROSTER.length) {
    throw new Error(`--aircraft must be <= ${ROSTER.length}`);
  }
  if (options.remoteUrl && options.intervalMs < REMOTE_MIN_INTERVAL_MS) {
    throw new Error(`--interval-ms must be >= ${REMOTE_MIN_INTERVAL_MS} for remote source mode`);
  }

  return options;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parseInteger(value, option, min) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${option} must be an integer >= ${min}`);
  }
  return parsed;
}

function parseFiniteNumber(value, option) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${option} must be a finite number`);
  }
  return parsed;
}

function helpText() {
  return `Usage: node scripts/generate-receiver-fixture.mjs [options]

Options:
  --out <dir>           Directory for aircraft.json and related files
  --seed <value>        Deterministic movement seed
  --frames <count>      Number of frames to generate
  --aircraft <count>    Number of aircraft in each frame
  --interval-ms <ms>    Frame spacing for timestamps and live mode
  --start <seconds>     Starting Unix timestamp
  --record              Also write frames/aircraft-000001.json files
  --live                Keep updating aircraft.json until interrupted
  -h, --help            Show this help text`;
}

async function fetchRemoteFrame(options) {
  const response = await fetch(options.remoteUrl, {
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }
  const compressed = Buffer.from(await response.arrayBuffer());
  const decoded = zstdDecompressSync(compressed);
  return parseBinCraftFrame(decoded);
}

function parseBinCraftFrame(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length < 52) {
    throw new Error("binCraft payload is too short");
  }
  const header = viewFor(buffer);
  const stride = header.getUint32(8, true);
  if (!Number.isInteger(stride) || stride < 112 || stride > buffer.length) {
    throw new Error("binCraft payload has an invalid stride");
  }

  const now = header.getUint32(0, true) / 1000 + header.getUint32(4, true) * 4294967.296;
  const headerMessages = header.getUint32(28, true);
  const version = header.getUint32(40, true);
  const flags = header.getUint32(48, true);
  const useMessageRate = Boolean(flags & 1);
  const aircraft = [];

  for (let offset = stride; offset + stride <= buffer.length; offset += stride) {
    aircraft.push(parseBinCraftAircraft(buffer, offset, stride, version, useMessageRate));
  }

  const messages =
    headerMessages ||
    aircraft.reduce((sum, aircraftRow) => sum + (aircraftRow.messages ?? 0), 0);
  return {
    now: round(now, 3),
    messages,
    aircraft,
  };
}

function parseBinCraftAircraft(buffer, offset, stride, binCraftVersion, useMessageRate) {
  const view = viewFor(buffer, offset, stride);
  const bytes = buffer.subarray(offset, offset + stride);
  const rawHex = view.getInt32(0, true);
  const tagged = Boolean(rawHex & (1 << 24));
  const hex = (rawHex & ((1 << 24) - 1)).toString(16).padStart(6, "0");
  const validA = bytes[73] ?? 0;
  const validB = bytes[74] ?? 0;
  const validC = bytes[75] ?? 0;
  const validD = bytes[76] ?? 0;
  const validE = bytes[77] ?? 0;
  const aircraft = {
    hex: tagged ? `~${hex}` : hex,
  };

  const typeCode = (bytes[67] & 240) >> 4;
  aircraft.type = AIRCRAFT_TYPES[typeCode] ?? "unknown";
  const category = bytes[64] ? `A${bytes[64].toString(16).toUpperCase()}` : undefined;
  if (category) aircraft.category = category;

  const flight = readBinCraftString(bytes, 78, 86);
  if (validA & 8 && flight) aircraft.flight = flight;
  const airframe = readBinCraftString(bytes, 88, 92);
  if (airframe) aircraft.t = airframe;
  const registration = readBinCraftString(bytes, 92, 104);
  if (registration) aircraft.r = registration;

  if (binCraftVersion >= 20240218) {
    aircraft.seen = round(view.getInt32(4, true) / 10, 1);
    if (validA & 64) aircraft.seen_pos = round(view.getInt32(108, true) / 10, 1);
  } else {
    aircraft.seen = round(view.getUint16(6, true) / 10, 1);
    if (validA & 64) aircraft.seen_pos = round(view.getUint16(4, true) / 10, 1);
  }

  if (validA & 64) {
    aircraft.lon = round(view.getInt32(8, true) / 1e6, 6);
    aircraft.lat = round(view.getInt32(12, true) / 1e6, 6);
  }
  if (validA & 128) aircraft.gs = round(view.getInt16(34, true) / 10, 1);
  if (validB & 8) aircraft.track = round(view.getInt16(40, true) / 90, 1);
  if (validC & 1) aircraft.baro_rate = view.getInt16(16, true) * 8;
  if (validC & 2) aircraft.geom_rate = view.getInt16(18, true) * 8;
  if (validD & 4) aircraft.squawk = decodeSquawk(view.getUint16(32, true));

  const airground = bytes[68] & 15;
  if (airground === 1) {
    aircraft.alt_baro = "ground";
    aircraft.airground = "ground";
  } else {
    if (validA & 16) aircraft.alt_baro = view.getInt16(20, true) * 25;
    if (validA & 32) aircraft.alt_geom = view.getInt16(22, true) * 25;
    if (airground === 2) aircraft.airground = "airborne";
  }

  if (validD & 64) aircraft.nav_altitude_mcp = view.getUint16(24, true) * 4;
  if (validD & 128) aircraft.nav_altitude_fms = view.getUint16(26, true) * 4;
  if (validD & 32) aircraft.nav_qnh = round(view.getInt16(28, true) / 10, 1);
  if (validE & 2) aircraft.nav_heading = round(view.getInt16(30, true) / 90, 1);
  if (validB & 1) aircraft.ias = view.getUint16(58, true);
  if (validB & 2) aircraft.tas = view.getUint16(56, true);
  if (validB & 4) aircraft.mach = round(view.getInt16(36, true) / 1000, 3);

  aircraft.rc = view.getUint16(60, true);
  if (useMessageRate) {
    aircraft.messageRate = round(view.getUint16(62, true) / 10, 1);
  } else {
    aircraft.messages = view.getUint16(62, true);
  }
  aircraft.rssi = decodeRssi(bytes[105] ?? 0, binCraftVersion);

  const adsbVersion = (bytes[69] & 240) >> 4;
  const adsrVersion = bytes[70] & 15;
  const tisbVersion = (bytes[70] & 240) >> 4;
  if (aircraft.type.startsWith("adsb")) aircraft.version = adsbVersion;
  if (aircraft.type.startsWith("adsr")) aircraft.version = adsrVersion;
  if (aircraft.type.startsWith("tisb")) aircraft.version = tisbVersion;

  aircraft.nic_baro = validC & 16 ? bytes[73] & 1 : undefined;
  aircraft.nac_p = validC & 32 ? bytes[71] & 15 : undefined;
  aircraft.nac_v = validC & 64 ? (bytes[71] & 240) >> 4 : undefined;
  aircraft.sil = validC & 128 ? bytes[72] & 3 : undefined;
  aircraft.sil_type = bytes[69] & 15 ? "perhour" : undefined;

  return stripUndefined(aircraft);
}

function viewFor(buffer, offset = 0, length = buffer.length - offset) {
  return new DataView(buffer.buffer, buffer.byteOffset + offset, length);
}

function readBinCraftString(bytes, start, end) {
  let value = "";
  for (let index = start; index < end && bytes[index] !== 0; index += 1) {
    value += String.fromCharCode(bytes[index]);
  }
  return value.trim();
}

function decodeSquawk(value) {
  const hex = value.toString(16).padStart(4, "0");
  if (hex[0] > "9") return `${Number.parseInt(hex[0], 16)}${hex.slice(1)}`;
  return hex;
}

function decodeRssi(value, binCraftVersion) {
  if (binCraftVersion >= 20250403) return round(value * (50 / 255) - 50, 1);
  const level = (value * value) / 65025 + 1.125e-5;
  return round((10 * Math.log(level)) / Math.log(10), 1);
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));
}

function buildAircraftFrame(options, frameIndex) {
  const elapsedSec = (frameIndex * options.intervalMs) / 1000;
  const now = round(options.start + elapsedSec, 3);
  const sources = buildAircraftSources(options.seed, options.aircraftCount, elapsedSec);
  const aircraft = sources.map((source, index) =>
    buildAircraft(source, options.seed, index, elapsedSec, frameIndex),
  );
  const messages = aircraft.reduce((sum, aircraftRow) => sum + aircraftRow.messages, 0);

  return {
    now,
    messages,
    aircraft,
  };
}

async function writeTrailChunks(options, frameIndex) {
  const currentElapsedSec = (frameIndex * options.intervalMs) / 1000;
  const currentNowSec = options.start + currentElapsedSec;
  const sources = buildAircraftSources(options.seed, options.aircraftCount, currentElapsedSec);
  const slices = [];

  for (
    let offsetSec = -TRAIL_HISTORY_SEC + TRAIL_SAMPLE_INTERVAL_SEC;
    offsetSec <= 0;
    offsetSec += TRAIL_SAMPLE_INTERVAL_SEC
  ) {
    const elapsedSec = currentElapsedSec + offsetSec;
    const sliceFrameIndex = Math.round(
      frameIndex + (offsetSec * 1000) / options.intervalMs,
    );
    slices.push(
      buildChunkSlice(
        options,
        sources,
        elapsedSec,
        sliceFrameIndex,
        currentNowSec + offsetSec,
      ),
    );
  }

  const currentSliceCount = Math.ceil(TRAIL_CURRENT_SEC / TRAIL_SAMPLE_INTERVAL_SEC);
  const splitIndex = Math.max(0, slices.length - currentSliceCount);
  const historicalSlices = slices.slice(0, splitIndex);
  const currentSlices = slices.slice(splitIndex);
  const historicalName = `chunk_${Math.round(slices[0].now * 1000)}.gz`;
  const chunks = [historicalName, "current_large.gz", "current_small.gz"];
  const chunksDir = path.join(options.outDir, "chunks");

  await writeJson(path.join(chunksDir, "chunks.json"), {
    chunks,
    chunks_all: chunks,
  });
  await writeJson(path.join(chunksDir, historicalName), { files: historicalSlices });
  await writeJson(path.join(chunksDir, "current_large.gz"), { files: currentSlices });
  await writeJson(path.join(chunksDir, "current_small.gz"), { files: [] });
}

function buildChunkSlice(options, sources, elapsedSec, frameIndex, now) {
  const aircraft = sources.map((source, index) =>
    aircraftToChunkRow(buildAircraft(source, options.seed, index, elapsedSec, frameIndex)),
  );
  const messages = aircraft.reduce((sum, row) => sum + row[9], 0);
  return {
    now: round(now, 3),
    messages,
    aircraft,
  };
}

function aircraftToChunkRow(aircraft) {
  return [
    aircraft.hex,
    aircraft.alt_baro ?? "ground",
    aircraft.gs ?? 0,
    aircraft.airground === "ground" ? null : (aircraft.track ?? null),
    aircraft.lat,
    aircraft.lon,
    aircraft.seen_pos ?? 0,
    aircraft.type ?? "adsb_icao",
    aircraft.flight ?? null,
    aircraft.messages ?? 0,
  ];
}

function buildAircraftSources(seed, count, elapsedSec) {
  const sources = [];
  const nearCount = Math.max(1, Math.round(count * 0.52));
  const midCount = Math.max(1, Math.round(count * 0.32));
  const outerStart = Math.min(count, nearCount + midCount);
  const identityOffset = Math.floor(elapsedSec / IDENTITY_ROTATION_INTERVAL_SEC) % ROSTER.length;

  for (let index = 0; index < count; index += 1) {
    const base = ROSTER[(identityOffset + index) % ROSTER.length];
    const random = rngFor(`${seed}:source:${index}:${base.hex}`);
    const band = index < nearCount ? "near" : index < outerStart ? "mid" : "outer";
    const distanceNm = syntheticDistanceNm(
      random,
      index,
      count,
      nearCount,
      midCount,
      outerStart,
    );
    const bearing = normalDegrees(
      index * GOLDEN_ANGLE_DEGREES + random() * 45 + (identityOffset % 17) * 3,
    );
    const airborne = band !== "near" || index % 7 > 1;
    const altitude = syntheticAltitudeFt(random, distanceNm, band, airborne);
    const speed = syntheticGroundSpeedKt(random, band, airborne);
    const track = normalDegrees(bearing + 70 + (random() - 0.5) * 90);

    sources.push({
      ...base,
      alt_baro: altitude,
      gs: speed,
      track,
      baro_rate: syntheticVerticalRateFpm(random, band, airborne),
      distanceNm,
      bearing,
    });
  }

  return sources;
}

function syntheticDistanceNm(random, index, count, nearCount, midCount, outerStart) {
  if (index < nearCount) {
    const slot = (index + random()) / nearCount;
    return round(clamp(slot * 45, 0.4, 45), 1);
  }
  if (index < outerStart) {
    const slot = (index - nearCount + random()) / midCount;
    return round(45 + slot * 80, 1);
  }
  const outerCount = Math.max(1, count - outerStart);
  const slot = (index - outerStart + random()) / outerCount;
  return round(clamp(125 + slot * 73, 125, MAX_FIXTURE_RANGE_NM - 2), 1);
}

function syntheticAltitudeFt(random, distanceNm, band, airborne) {
  if (!airborne) return "ground";
  if (band === "near") {
    return Math.round(clamp(600 + distanceNm * 95 + random() * 1800, 500, 7000) / 25) * 25;
  }
  if (band === "mid") {
    return Math.round(clamp(6000 + (distanceNm - 45) * 190 + random() * 5000, 6000, 26000) / 25) * 25;
  }
  return Math.round(clamp(24000 + (distanceNm - 125) * 210 + random() * 4500, 24000, 43000) / 25) * 25;
}

function syntheticGroundSpeedKt(random, band, airborne) {
  if (!airborne) return round(clamp(6 + (random() - 0.5) * 8, 0, 22), 1);
  if (band === "near") return round(80 + random() * 150, 1);
  if (band === "mid") return round(180 + random() * 210, 1);
  return round(300 + random() * 190, 1);
}

function syntheticVerticalRateFpm(random, band, airborne) {
  if (!airborne) return 0;
  const scale = band === "near" ? 1400 : band === "mid" ? 2200 : 900;
  return Math.round(((random() - 0.5) * scale) / 64) * 64;
}

function buildAircraft(source, seed, index, elapsedSec, frameIndex) {
  const random = rngFor(`${seed}:aircraft:${source.hex}`);
  const motionRandom = rngFor(`${seed}:motion:${source.hex}`);
  const phase = motionRandom() * Math.PI * 2;
  const turnDirection = motionRandom() > 0.5 ? 1 : -1;
  const isGround =
    source.alt_baro === "ground" || (source.gs <= 25 && source.alt_baro <= 100);
  const speed = isGround
    ? round(clamp((source.gs ?? 4) + (random() - 0.5) * 3, 0, 18), 1)
    : round(clamp((source.gs ?? 180) + (random() - 0.5) * 18, 60, 520), 1);
  const turnRateDegPerSec = isGround
    ? 0.002 + motionRandom() * 0.006
    : clamp(
        speed / (Math.max(source.distanceNm, 8) * 96) + motionRandom() * 0.012,
        0.008,
        0.045,
      );
  const turnWigglePeriodSec = isGround
    ? 260 + motionRandom() * 240
    : 150 + motionRandom() * 210;
  const turnWiggleDeg = isGround
    ? 0.3 + motionRandom() * 0.7
    : 0.8 + motionRandom() * 2.2;
  const radialPeriodSec = isGround
    ? 320 + motionRandom() * 260
    : 180 + motionRandom() * 260;
  const radialRange = isGround
    ? Math.min(0.35, source.distanceNm * 0.01 + 0.05)
    : Math.min(3.5, source.distanceNm * (0.012 + motionRandom() * 0.02) + 0.4);
  const distanceNm = clamp(
    source.distanceNm +
      Math.sin((elapsedSec * Math.PI * 2) / radialPeriodSec + phase) * radialRange,
    0.2,
    MAX_FIXTURE_RANGE_NM - 1,
  );
  const bearing = normalDegrees(
    source.bearing +
      turnDirection * elapsedSec * turnRateDegPerSec +
      Math.sin((elapsedSec * Math.PI * 2) / turnWigglePeriodSec + phase) * turnWiggleDeg,
  );
  const track = normalDegrees(
    bearing +
      turnDirection * 90 +
      Math.sin((elapsedSec * Math.PI * 2) / turnWigglePeriodSec + phase) *
        (isGround ? 0.8 : 5),
  );
  const position = destinationPoint(RECEIVER.lat, RECEIVER.lon, bearing, distanceNm);
  const messageStep = Math.max(1, Math.round(4 + speed / 20));
  const messages = 800 + index * 173 + frameIndex * messageStep;
  const rssi = round(-3.5 - Math.min(distanceNm, MAX_FIXTURE_RANGE_NM) * 0.06 - random() * 4, 1);

  const aircraft = {
    hex: source.hex,
    type: source.type,
    flight: source.flight,
    r: source.r,
    t: source.t,
    category: source.category,
    lat: round(position.lat, 6),
    lon: round(position.lon, 6),
    gs: speed,
    track: round(track, 1),
    squawk: source.squawk,
    messages,
    seen: round((index % 4) * 0.2 + random() * 0.2, 1),
    seen_pos: round((index % 3) * 0.2 + random() * 0.2, 1),
    rssi,
    nic: isGround ? 8 : 9,
    rc: isGround ? 75 : 186,
    version: source.type.startsWith("adsb") ? 2 : undefined,
    nic_baro: 1,
    nac_p: isGround ? 8 : 10,
    nac_v: isGround ? 1 : 2,
    sil: 3,
    sil_type: "perhour",
  };

  if (isGround) {
    aircraft.alt_baro = "ground";
    aircraft.airground = "ground";
    return aircraft;
  }

  const baseAlt = clamp(typeof source.alt_baro === "number" ? source.alt_baro : 1000, 250, 43000);
  const verticalRate = clamp((source.baro_rate ?? 0) + (random() - 0.5) * 128, -3500, 3500);
  const altitudeSwing = clamp(Math.abs(verticalRate) * 1.2 + 250, 250, 1800);
  const altitude = clamp(baseAlt + Math.sin(elapsedSec / 45 + phase) * altitudeSwing, 100, 45000);
  const roundedAlt = Math.round(altitude / 25) * 25;

  aircraft.alt_baro = roundedAlt;
  aircraft.alt_geom = roundedAlt + Math.round((50 + random() * 100) / 25) * 25;
  aircraft.baro_rate = Math.round(verticalRate / 64) * 64;
  aircraft.geom_rate = aircraft.baro_rate;
  aircraft.nav_altitude_mcp = Math.ceil((roundedAlt + 1800) / 1000) * 1000;
  aircraft.nav_heading = round(track, 1);
  aircraft.airground = "airborne";

  return aircraft;
}

function buildStats(options, frame, outline, receiver) {
  const maxRangeNm = outline.actualRange.last24h.points.reduce(
    (max, [lat, lon]) => Math.max(max, haversineNm(receiver.lat, receiver.lon, lat, lon)),
    0,
  );
  const accepted = frame.messages + ROSTER.length * 12;
  const cpuWindowStart = frame.now - 60;

  return {
    now: frame.now,
    gain_db: 18.6,
    estimated_ppm: round(Math.sin(frame.now / 900) * 0.8, 2),
    cpu_load: 9.8,
    aircraft_with_pos: frame.aircraft.length,
    aircraft_without_pos: 2,
    messages: frame.messages,
    max_distance: Math.round(maxRangeNm * METERS_PER_NM),
    local: {
      accepted: [accepted],
      strong_signals: Math.round(accepted * 0.06),
    },
    last1min: {
      start: cpuWindowStart,
      end: frame.now,
      messages_valid: Math.round(accepted / 8),
      max_distance: Math.round(maxRangeNm * METERS_PER_NM),
      local: {
        accepted: [accepted],
        strong_signals: Math.round(accepted * 0.06),
      },
      cpu: {
        demod: 120,
        reader: 45,
        background: 60,
        aircraft_json: 18,
      },
    },
    total: {
      start: options.start - 3600,
      end: frame.now,
      messages_valid: frame.messages * 8,
      local: {
        accepted: [frame.messages * 8],
        strong_signals: Math.round(frame.messages * 0.5),
      },
    },
  };
}

function buildOutline(seed, receiver = RECEIVER) {
  const random = rngFor(`${seed}:outline`);
  const points = [];

  for (let bearing = 0; bearing < 360; bearing += 1) {
    const waveA = Math.sin((bearing * Math.PI) / 45);
    const waveB = Math.cos((bearing * Math.PI) / 73);
    const noise = (random() - 0.5) * 7;
    const rangeNm = clamp(120 + waveA * 45 + waveB * 28 + noise, 30, MAX_FIXTURE_RANGE_NM);
    const point = destinationPoint(receiver.lat, receiver.lon, bearing, rangeNm);
    const maxAltFt = Math.round(clamp(18000 + rangeNm * 210 + waveB * 1500, 8000, 45000) / 100) * 100;
    points.push([round(point.lat, 6), round(point.lon, 6), maxAltFt]);
  }

  return {
    points: points.map(([lat, lon]) => [lat, lon]),
    actualRange: {
      last24h: { points },
      alltime: { points },
    },
  };
}

async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmpPath, filePath);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatFrameCount(frames) {
  if (frames === 1) return "1 frame";
  return `${frames} frames`;
}

function rngFor(seed) {
  const [a, b, c, d] = hash128(seed);
  return sfc32(a, b, c, d);
}

function hash128(input) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  let h3 = 0x9e3779b9;
  let h4 = 0x85ebca6b;

  for (let i = 0; i < input.length; i += 1) {
    const k = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ k, 0x85ebca6b);
    h2 = Math.imul(h2 ^ k, 0xc2b2ae35);
    h3 = Math.imul(h3 ^ k, 0x27d4eb2f);
    h4 = Math.imul(h4 ^ k, 0x165667b1);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 0x85ebca6b);
  h2 = Math.imul(h2 ^ (h2 >>> 13), 0xc2b2ae35);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 0x27d4eb2f);
  h4 = Math.imul(h4 ^ (h4 >>> 13), 0x165667b1);

  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (a + b + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = ((c << 21) | (c >>> 11)) + t;
    return (t >>> 0) / 4294967296;
  };
}

function destinationPoint(lat, lon, bearingDeg, distanceNm) {
  const bearing = toRad(bearingDeg);
  const angularDistance = distanceNm / EARTH_RADIUS_NM;
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: toDeg(lat2),
    lon: normalizeLon(toDeg(lon2)),
  };
}

function haversineNm(lat1, lon1, lat2, lon2) {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lon2 - lon1);
  const h =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

function toDeg(radians) {
  return (radians * 180) / Math.PI;
}

function normalDegrees(degrees) {
  return ((degrees % 360) + 360) % 360;
}

function normalizeLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
