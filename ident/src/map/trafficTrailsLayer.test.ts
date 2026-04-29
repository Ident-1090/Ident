import { describe, expect, it, vi } from "vitest";
import type { Aircraft, TrailPoint } from "../data/types";
import {
  buildTrafficTrailsSnapshot,
  lngLatToMercator,
  TRAFFIC_TRAILS_LAYER_ID,
  TrafficTrailsLayer,
  type TrafficTrailsSnapshot,
} from "./trafficTrailsLayer";

const UAL: Aircraft = {
  hex: "abc123",
  flight: "UAL123",
  alt_baro: 12000,
  lat: 37.5,
  lon: -122.3,
  type: "adsb_icao",
};

const SWA: Aircraft = {
  hex: "def456",
  flight: "SWA456",
  alt_baro: 24000,
  lat: 37.6,
  lon: -122.4,
  type: "adsb_icao",
};

function point(ts: number, alt: number | "ground" = 12000): TrailPoint {
  return {
    lat: 37 + ts / 100_000,
    lon: -122 - ts / 100_000,
    alt,
    ts,
    segment: 0,
  };
}

function snapshot(
  overrides: Partial<Parameters<typeof buildTrafficTrailsSnapshot>[0]> = {},
): TrafficTrailsSnapshot {
  return buildTrafficTrailsSnapshot({
    aircraft: [UAL, SWA],
    trailsByHex: {
      [UAL.hex]: [point(1_000), point(14_000), point(16_000), point(24_000)],
      [SWA.hex]: [point(10_000, 24000), point(20_000, 24000)],
    },
    selectedHex: null,
    trailFadeSec: 10,
    nowMs: 25_000,
    enabled: true,
    ...overrides,
  });
}

describe("buildTrafficTrailsSnapshot", () => {
  it("converts active trail segments into mercator vertex data", () => {
    const snap = snapshot({ aircraft: [UAL] });

    expect(snap.vertexCount).toBe(6);
    expect(snap.vertices).toHaveLength(66);
    const a = lngLatToMercator(point(16_000).lon, point(16_000).lat);
    const b = lngLatToMercator(point(24_000).lon, point(24_000).lat);
    expect(snap.vertices[0]).toBeCloseTo(a.x);
    expect(snap.vertices[1]).toBeCloseTo(a.y);
    expect(snap.vertices[2]).toBeCloseTo(b.x);
    expect(snap.vertices[3]).toBeCloseTo(b.y);
    expect(snap.vertices[6]).toBeGreaterThan(0);
    expect(snap.vertices[10]).toBeGreaterThan(0);
  });

  it("bounds unselected trail segment count", () => {
    const longTrail = Array.from({ length: 1_000 }, (_, i) => point(i * 1_000));
    const snap = snapshot({
      aircraft: [UAL],
      trailsByHex: { [UAL.hex]: longTrail },
      trailFadeSec: 1_000,
      nowMs: 1_000_000,
    });

    expect(snap.vertexCount / 6).toBeLessThanOrEqual(241);
  });

  it("keeps every selected trail segment", () => {
    const selectedTrail = Array.from({ length: 20 }, (_, i) =>
      point(i * 1_000),
    );
    const snap = snapshot({
      aircraft: [UAL],
      trailsByHex: { [UAL.hex]: selectedTrail },
      selectedHex: UAL.hex,
      trailFadeSec: 1,
      nowMs: 20_000,
    });

    expect(snap.vertexCount).toBe((selectedTrail.length - 1) * 6);
  });

  it("encodes selected trails wider than unselected trails", () => {
    const unselected = snapshot({ aircraft: [UAL] });
    const selected = snapshot({
      aircraft: [UAL],
      selectedHex: UAL.hex,
      trailFadeSec: 1,
      nowMs: 25_000,
    });

    expect(selected.vertices[6]).toBeGreaterThan(unselected.vertices[6]);
  });

  it("keeps the selected trail even when the aircraft row is filtered out", () => {
    const selectedTrail = [point(1_000), point(2_000), point(3_000)];
    const snap = snapshot({
      aircraft: [],
      trailsByHex: { [UAL.hex]: selectedTrail },
      selectedHex: UAL.hex,
    });

    expect(snap.vertexCount).toBe((selectedTrail.length - 1) * 6);
  });

  it("keeps only the selected trail when the trails layer is disabled", () => {
    const selectedTrail = [point(1_000), point(2_000), point(3_000)];
    const unselectedTrail = [point(1_000), point(2_000), point(3_000)];
    const snap = snapshot({
      trailsByHex: {
        [UAL.hex]: selectedTrail,
        [SWA.hex]: unselectedTrail,
      },
      selectedHex: UAL.hex,
      enabled: false,
    });

    expect(snap.vertexCount).toBe((selectedTrail.length - 1) * 6);
  });

  it("does not connect across stale points or segment changes", () => {
    const trail: TrailPoint[] = [
      point(1_000),
      point(2_000),
      { ...point(3_000), stale: true },
      { ...point(4_000), segment: 1 },
      { ...point(5_000), segment: 1 },
    ];
    const snap = snapshot({
      aircraft: [UAL],
      trailsByHex: { [UAL.hex]: trail },
      selectedHex: UAL.hex,
      trailFadeSec: 10,
      nowMs: 6_000,
    });

    expect(snap.vertexCount).toBe(12);
    const first = lngLatToMercator(point(1_000).lon, point(1_000).lat);
    const second = lngLatToMercator(point(2_000).lon, point(2_000).lat);
    const fourth = lngLatToMercator(point(4_000).lon, point(4_000).lat);
    const fifth = lngLatToMercator(point(5_000).lon, point(5_000).lat);
    expect(snap.vertices[0]).toBeCloseTo(first.x);
    expect(snap.vertices[2]).toBeCloseTo(second.x);
    expect(snap.vertices[66]).toBeCloseTo(fourth.x);
    expect(snap.vertices[68]).toBeCloseTo(fifth.x);
  });

  it("returns an empty snapshot when disabled", () => {
    const snap = snapshot({ enabled: false });

    expect(snap.vertexCount).toBe(0);
    expect(snap.vertices).toHaveLength(0);
  });
});

interface FakeGl {
  ARRAY_BUFFER: number;
  DYNAMIC_DRAW: number;
  FLOAT: number;
  LINES: number;
  TRIANGLES: number;
  VERTEX_SHADER: number;
  FRAGMENT_SHADER: number;
  COMPILE_STATUS: number;
  LINK_STATUS: number;
  BLEND: number;
  SRC_ALPHA: number;
  ONE_MINUS_SRC_ALPHA: number;
  ONE: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  canvas: { clientWidth: number; clientHeight: number };
  createShader: ReturnType<typeof vi.fn>;
  shaderSource: ReturnType<typeof vi.fn>;
  compileShader: ReturnType<typeof vi.fn>;
  getShaderParameter: ReturnType<typeof vi.fn>;
  getShaderInfoLog: ReturnType<typeof vi.fn>;
  createProgram: ReturnType<typeof vi.fn>;
  attachShader: ReturnType<typeof vi.fn>;
  linkProgram: ReturnType<typeof vi.fn>;
  getProgramParameter: ReturnType<typeof vi.fn>;
  getProgramInfoLog: ReturnType<typeof vi.fn>;
  deleteShader: ReturnType<typeof vi.fn>;
  createBuffer: ReturnType<typeof vi.fn>;
  deleteBuffer: ReturnType<typeof vi.fn>;
  deleteProgram: ReturnType<typeof vi.fn>;
  getAttribLocation: ReturnType<typeof vi.fn>;
  getUniformLocation: ReturnType<typeof vi.fn>;
  useProgram: ReturnType<typeof vi.fn>;
  uniformMatrix4fv: ReturnType<typeof vi.fn>;
  uniform2f: ReturnType<typeof vi.fn>;
  bindBuffer: ReturnType<typeof vi.fn>;
  bufferData: ReturnType<typeof vi.fn>;
  enableVertexAttribArray: ReturnType<typeof vi.fn>;
  vertexAttribPointer: ReturnType<typeof vi.fn>;
  enable: ReturnType<typeof vi.fn>;
  blendFuncSeparate: ReturnType<typeof vi.fn>;
  lineWidth: ReturnType<typeof vi.fn>;
  drawArrays: ReturnType<typeof vi.fn>;
}

function createGl(): FakeGl {
  return {
    ARRAY_BUFFER: 0x8892,
    DYNAMIC_DRAW: 0x88e8,
    FLOAT: 0x1406,
    LINES: 0x0001,
    TRIANGLES: 0x0004,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    ONE: 1,
    drawingBufferWidth: 1600,
    drawingBufferHeight: 1200,
    canvas: { clientWidth: 800, clientHeight: 600 },
    createShader: vi.fn((type: number) => ({ type })),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ""),
    createProgram: vi.fn(() => ({ program: true })),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ""),
    deleteShader: vi.fn(),
    createBuffer: vi.fn(() => ({ buffer: true })),
    deleteBuffer: vi.fn(),
    deleteProgram: vi.fn(),
    getAttribLocation: vi.fn((_, name: string) => {
      const locations: Record<string, number> = {
        a_start: 0,
        a_end: 1,
        a_t: 2,
        a_side: 3,
        a_half_width: 4,
        a_color: 5,
      };
      return locations[name] ?? -1;
    }),
    getUniformLocation: vi.fn((_, name: string) => ({ name })),
    useProgram: vi.fn(),
    uniformMatrix4fv: vi.fn(),
    uniform2f: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    enable: vi.fn(),
    blendFuncSeparate: vi.fn(),
    lineWidth: vi.fn(),
    drawArrays: vi.fn(),
  };
}

describe("TrafficTrailsLayer", () => {
  it("exposes a MapLibre custom layer identity", () => {
    const layer = new TrafficTrailsLayer();

    expect(layer.id).toBe(TRAFFIC_TRAILS_LAYER_ID);
    expect(layer.type).toBe("custom");
    expect(layer.renderingMode).toBe("2d");
  });

  it("uploads trail vertices and draws them with MapLibre's projection matrix", () => {
    const gl = createGl();
    const repaint = vi.fn();
    const matrix = new Float32Array(16).fill(1);
    const snap: TrafficTrailsSnapshot = {
      vertices: new Float32Array([
        0.1, 0.2, 0.3, 0.4, 0, -1, 0.5, 1, 0, 0, 0.5, 0.1, 0.2, 0.3, 0.4, 0, 1,
        0.5, 1, 0, 0, 0.5, 0.1, 0.2, 0.3, 0.4, 1, -1, 0.5, 1, 0, 0, 0.5,
      ]),
      vertexCount: 3,
    };
    const layer = new TrafficTrailsLayer();

    layer.setSnapshot(snap);
    layer.onAdd(
      { triggerRepaint: repaint } as never,
      gl as unknown as WebGLRenderingContext,
    );
    layer.render(
      gl as unknown as WebGLRenderingContext,
      {
        defaultProjectionData: { mainMatrix: matrix },
      } as never,
    );

    expect(gl.bufferData).toHaveBeenCalledWith(
      gl.ARRAY_BUFFER,
      snap.vertices,
      gl.DYNAMIC_DRAW,
    );
    expect(gl.uniformMatrix4fv).toHaveBeenCalledWith(
      expect.anything(),
      false,
      matrix,
    );
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLES, 0, 3);
    expect(repaint).toHaveBeenCalled();
  });

  it("skips duplicate snapshot uploads and releases resources on removal", () => {
    const gl = createGl();
    const snap: TrafficTrailsSnapshot = {
      vertices: new Float32Array([
        0, 0, 1, 1, 0, -1, 0.5, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 0.5, 1, 1, 1, 1,
        0, 0, 1, 1, 1, -1, 0.5, 1, 1, 1, 1,
      ]),
      vertexCount: 3,
    };
    const layer = new TrafficTrailsLayer();

    layer.onAdd(
      { triggerRepaint: vi.fn() } as never,
      gl as unknown as WebGLRenderingContext,
    );
    layer.setSnapshot(snap);
    const uploads = gl.bufferData.mock.calls.length;
    layer.setSnapshot(snap);
    layer.onRemove({} as never, gl as unknown as WebGLRenderingContext);

    expect(gl.bufferData).toHaveBeenCalledTimes(uploads);
    expect(gl.deleteBuffer).toHaveBeenCalled();
    expect(gl.deleteProgram).toHaveBeenCalled();
  });
});
