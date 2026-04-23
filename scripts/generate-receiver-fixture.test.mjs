import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { zstdCompressSync } from "node:zlib";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts/generate-receiver-fixture.mjs");

test("generates deterministic receiver JSON frames", async () => {
  const firstDir = await mkdtemp(path.join(tmpdir(), "ident-fixture-first-"));
  const secondDir = await mkdtemp(path.join(tmpdir(), "ident-fixture-second-"));
  try {
    runGenerator(firstDir, "demo-seed");
    runGenerator(secondDir, "demo-seed");

    const firstAircraft = await readJson(path.join(firstDir, "aircraft.json"));
    const secondAircraft = await readJson(path.join(secondDir, "aircraft.json"));
    const receiver = await readJson(path.join(firstDir, "receiver.json"));
    const stats = await readJson(path.join(firstDir, "stats.json"));
    const outline = await readJson(path.join(firstDir, "outline.json"));

    assert.deepEqual(firstAircraft, secondAircraft);
    assert.equal(receiver.lat, 34.118434);
    assert.equal(receiver.lon, -118.300393);
    assert.equal(receiver.version, "Ident fixture receiver");
    assert.equal(firstAircraft.aircraft.length, 150);
    assert.equal(firstAircraft.aircraft.every((aircraft) => aircraft.r && aircraft.t), true);
    assert.equal(firstAircraft.aircraft.every((aircraft) => /^[0-9a-f]{6}$/.test(aircraft.hex)), true);
    assert.equal(firstAircraft.aircraft.every((aircraft) => Number.isFinite(aircraft.lat)), true);
    assert.equal(new Set(firstAircraft.aircraft.map((aircraft) => aircraft.hex)).size, 150);
    assert.equal(
      firstAircraft.aircraft.every((aircraft) =>
        haversineNm(receiver.lat, receiver.lon, aircraft.lat, aircraft.lon) <= 200,
      ),
      true,
    );
    assert.equal(stats.aircraft_with_pos, firstAircraft.aircraft.length);
    assert.equal(outline.actualRange.last24h.points.length, 360);
  } finally {
    await rm(firstDir, { recursive: true, force: true });
    await rm(secondDir, { recursive: true, force: true });
  }
});

test("records numbered frames when requested", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "ident-fixture-frames-"));
  try {
    const result = spawnSync(
      process.execPath,
      [scriptPath, "--out", outDir, "--seed", "frames", "--frames", "3", "--record"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);

    const firstFrame = await readJson(path.join(outDir, "frames/aircraft-000001.json"));
    const lastFrame = await readJson(path.join(outDir, "frames/aircraft-000003.json"));

    assert.equal(lastFrame.now - firstFrame.now, 2);
    assert.notDeepEqual(lastFrame.aircraft[0].lat, firstFrame.aircraft[0].lat);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("rotates real aircraft identities over longer runs", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "ident-fixture-rotation-"));
  try {
    const result = spawnSync(
      process.execPath,
      [scriptPath, "--out", outDir, "--seed", "rotation", "--frames", "35", "--record"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);

    const firstFrame = await readJson(path.join(outDir, "frames/aircraft-000001.json"));
    const lastFrame = await readJson(path.join(outDir, "frames/aircraft-000035.json"));
    const firstHexes = firstFrame.aircraft.map((aircraft) => aircraft.hex);
    const lastHexes = lastFrame.aircraft.map((aircraft) => aircraft.hex);

    assert.equal(firstHexes.length, 150);
    assert.equal(new Set(firstHexes).size, 150);
    assert.equal(new Set(lastHexes).size, 150);
    assert.notDeepEqual(lastHexes, firstHexes);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("allows the aircraft count to be overridden", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "ident-fixture-count-"));
  try {
    const result = spawnSync(
      process.execPath,
      [scriptPath, "--out", outDir, "--seed", "count", "--frames", "1", "--aircraft", "24"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);

    const frame = await readJson(path.join(outDir, "aircraft.json"));

    assert.equal(frame.aircraft.length, 24);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("can mirror a binCraft zstd feed into local JSON", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "ident-fixture-remote-"));
  const payload = zstdCompressSync(buildBinCraftFixture());
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(payload);
  });

  try {
    await listen(server);
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/feed.binCraft.zst`;
    const result = await runGeneratorAsync([
      "--source-url",
      url,
      "--out",
      outDir,
      "--frames",
      "1",
    ]);
    assert.equal(result.status, 0, result.stderr);

    const frame = await readJson(path.join(outDir, "aircraft.json"));
    const receiver = await readJson(path.join(outDir, "receiver.json"));

    assert.equal(receiver.binCraft, false);
    assert.equal(receiver.zstd, false);
    assert.equal(frame.aircraft.length, 1);
    assert.deepEqual(
      {
        hex: frame.aircraft[0].hex,
        flight: frame.aircraft[0].flight,
        r: frame.aircraft[0].r,
        t: frame.aircraft[0].t,
      },
      {
        hex: "a1b2c3",
        flight: "TEST123",
        r: "N12345",
        t: "C172",
      },
    );
  } finally {
    await closeServer(server);
    await rm(outDir, { recursive: true, force: true });
  }
});

function runGenerator(outDir, seed) {
  const result = spawnSync(
    process.execPath,
    [scriptPath, "--out", outDir, "--seed", seed, "--frames", "1"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
}

function runGeneratorAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function buildBinCraftFixture() {
  const stride = 112;
  const buffer = Buffer.alloc(stride * 2);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const startedMs = 1776945600000;
  const aircraftOffset = stride;

  view.setUint32(0, startedMs >>> 0, true);
  view.setUint32(4, Math.floor(startedMs / 4294967296), true);
  view.setUint32(8, stride, true);
  view.setUint32(28, 42, true);
  view.setInt32(32, Math.round(34.118434 * 1e6), true);
  view.setInt32(36, Math.round(-118.300393 * 1e6), true);
  view.setUint32(40, 20240218, true);

  view.setInt32(aircraftOffset, 0xa1b2c3, true);
  view.setInt32(aircraftOffset + 4, 4, true);
  view.setInt32(aircraftOffset + 8, Math.round(-118.300393 * 1e6), true);
  view.setInt32(aircraftOffset + 12, Math.round(34.118434 * 1e6), true);
  view.setInt16(aircraftOffset + 16, 64, true);
  view.setInt16(aircraftOffset + 20, 120, true);
  view.setUint16(aircraftOffset + 32, 0x1200, true);
  view.setInt16(aircraftOffset + 34, 1100, true);
  view.setInt16(aircraftOffset + 40, 8100, true);
  view.setUint16(aircraftOffset + 60, 186, true);
  view.setUint16(aircraftOffset + 62, 42, true);
  buffer[aircraftOffset + 64] = 1;
  buffer[aircraftOffset + 67] = 0;
  buffer[aircraftOffset + 68] = 2;
  buffer[aircraftOffset + 69] = 0x20;
  buffer[aircraftOffset + 71] = 0x2a;
  buffer[aircraftOffset + 72] = 3;
  buffer[aircraftOffset + 73] = 8 | 16 | 64 | 128;
  buffer[aircraftOffset + 74] = 8;
  buffer[aircraftOffset + 75] = 1 | 32 | 64 | 128;
  buffer[aircraftOffset + 76] = 4;
  writeAscii(buffer, aircraftOffset + 78, "TEST123", 8);
  writeAscii(buffer, aircraftOffset + 88, "C172", 4);
  writeAscii(buffer, aircraftOffset + 92, "N12345", 12);
  buffer[aircraftOffset + 105] = 128;
  view.setInt32(aircraftOffset + 108, 3, true);

  return buffer;
}

function writeAscii(buffer, offset, value, length) {
  for (let index = 0; index < Math.min(value.length, length); index += 1) {
    buffer[offset + index] = value.charCodeAt(index);
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function haversineNm(lat1, lon1, lat2, lon2) {
  const radiusNm = 3440.065;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lon2 - lon1);
  const h =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * radiusNm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}
