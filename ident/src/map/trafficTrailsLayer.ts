import type { Aircraft, TrailPoint } from "../data/types";
import { altTrailColor } from "./alt";
import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MlMap,
} from "./maplibre";

export const TRAFFIC_TRAILS_LAYER_ID = "ident-traffic-trails";
const TRAIL_OPACITY_MIN = 0.18;
const TRAIL_OPACITY_MAX_UNSEL = 0.42;
const TRAIL_OPACITY_MAX_SEL = 0.46;
const TRAIL_WIDTH_UNSEL = 1;
const TRAIL_WIDTH_SEL = 2;
const TRAIL_DOT_RADIUS_SEL = 1.65;
const TRAIL_DOT_OPACITY_SEL = 0.92;
const TRAIL_DOT_MIN_SCREEN_DISTANCE_PX = 6;
const TRAIL_DOT_DEFAULT_MERCATOR_DISTANCE = 0.00003;
const TRAIL_DOT_HOVER_COLOR = { r: 1, g: 1, b: 1 };
const TRAIL_BREAK_GAP_MS = 45_000;
const TRAIL_MAX_UNSELECTED_SEGMENTS = 240;
const WEB_MERCATOR_TILE_SIZE_PX = 512;
const WEB_MERCATOR_MAX_LAT = 85.05112878;
const FLOATS_PER_VERTEX = 11;
const BYTES_PER_FLOAT = 4;

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_start;
attribute vec2 a_end;
attribute float a_t;
attribute float a_side;
attribute float a_half_width;
attribute vec4 a_color;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
varying vec4 v_color;
varying vec2 v_dot_coord;
varying float v_is_dot;

void main() {
  if (a_t > 1.5) {
    vec4 center_clip = u_matrix * vec4(a_start, 0.0, 1.0);
    vec2 offset_ndc = vec2(a_side, a_half_width) * 2.0 / u_viewport;
    gl_Position = center_clip;
    gl_Position.xy += offset_ndc * center_clip.w;
    v_dot_coord = a_end;
    v_is_dot = 1.0;
  } else {
    vec4 start_clip = u_matrix * vec4(a_start, 0.0, 1.0);
    vec4 end_clip = u_matrix * vec4(a_end, 0.0, 1.0);
    vec4 clip = mix(start_clip, end_clip, a_t);
    vec2 start_ndc = start_clip.xy / start_clip.w;
    vec2 end_ndc = end_clip.xy / end_clip.w;
    vec2 dir_px = (end_ndc - start_ndc) * u_viewport;
    float len = length(dir_px);
    vec2 normal = len > 0.0 ? vec2(-dir_px.y, dir_px.x) / len : vec2(0.0);
    vec2 offset_ndc = normal * a_side * a_half_width * 2.0 / u_viewport;
    gl_Position = clip;
    gl_Position.xy += offset_ndc * clip.w;
    v_dot_coord = vec2(0.0);
    v_is_dot = 0.0;
  }
  v_color = a_color;
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision mediump float;
varying vec4 v_color;
varying vec2 v_dot_coord;
varying float v_is_dot;

void main() {
  if (v_is_dot > 0.5 && dot(v_dot_coord, v_dot_coord) > 1.0) {
    discard;
  }
  gl_FragColor = v_color;
}
`;

export interface TrafficTrailsSnapshot {
  vertices: Float32Array;
  vertexCount: number;
}

export interface BuildTrafficTrailsSnapshotArgs {
  aircraft: Aircraft[];
  trailsByHex: Record<string, TrailPoint[]>;
  selectedHex: string | null;
  hoveredTrailDotTs: number | null;
  selectedTrailDotMinMercatorDistance: number;
  trailFadeSec: number;
  nowMs: number;
  enabled: boolean;
}

let trafficTrailsSnapshotCache:
  | (BuildTrafficTrailsSnapshotArgs & { snapshot: TrafficTrailsSnapshot })
  | null = null;

export function lngLatToMercator(
  lng: number,
  lat: number,
): { x: number; y: number } {
  const clampedLat = Math.max(
    -WEB_MERCATOR_MAX_LAT,
    Math.min(WEB_MERCATOR_MAX_LAT, lat),
  );
  const phi = (clampedLat * Math.PI) / 180;
  return {
    x: (lng + 180) / 360,
    y: (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2,
  };
}

export function buildTrafficTrailsSnapshot(
  args: BuildTrafficTrailsSnapshotArgs,
): TrafficTrailsSnapshot {
  if (
    trafficTrailsSnapshotCache &&
    trafficTrailsSnapshotCache.aircraft === args.aircraft &&
    trafficTrailsSnapshotCache.trailsByHex === args.trailsByHex &&
    trafficTrailsSnapshotCache.selectedHex === args.selectedHex &&
    trafficTrailsSnapshotCache.hoveredTrailDotTs === args.hoveredTrailDotTs &&
    trafficTrailsSnapshotCache.selectedTrailDotMinMercatorDistance ===
      args.selectedTrailDotMinMercatorDistance &&
    trafficTrailsSnapshotCache.trailFadeSec === args.trailFadeSec &&
    trafficTrailsSnapshotCache.nowMs === args.nowMs &&
    trafficTrailsSnapshotCache.enabled === args.enabled
  ) {
    return trafficTrailsSnapshotCache.snapshot;
  }
  const floats: number[] = [];
  if (args.enabled) {
    for (const ac of args.aircraft) {
      if (ac.hex === args.selectedHex) continue;
      appendTrailVertices(floats, {
        trail: args.trailsByHex[ac.hex],
        isSelected: false,
        trailFadeSec: args.trailFadeSec,
        nowMs: args.nowMs,
      });
    }
  }
  if (args.selectedHex) {
    appendTrailVertices(floats, {
      trail: args.trailsByHex[args.selectedHex],
      isSelected: true,
      hoveredTrailDotTs: args.hoveredTrailDotTs,
      selectedTrailDotMinMercatorDistance:
        args.selectedTrailDotMinMercatorDistance,
      trailFadeSec: args.trailFadeSec,
      nowMs: args.nowMs,
    });
  }
  const snapshot = {
    vertices: new Float32Array(floats),
    vertexCount: floats.length / FLOATS_PER_VERTEX,
  };
  trafficTrailsSnapshotCache = { ...args, snapshot };
  return snapshot;
}

export class TrafficTrailsLayer implements CustomLayerInterface {
  readonly id = TRAFFIC_TRAILS_LAYER_ID;
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;

  private map: Pick<MlMap, "triggerRepaint"> | null = null;
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private startLocation = -1;
  private endLocation = -1;
  private tLocation = -1;
  private sideLocation = -1;
  private halfWidthLocation = -1;
  private colorLocation = -1;
  private matrixLocation: WebGLUniformLocation | null = null;
  private viewportLocation: WebGLUniformLocation | null = null;
  private snapshot: TrafficTrailsSnapshot = {
    vertices: new Float32Array(),
    vertexCount: 0,
  };
  private uploadedSnapshot: TrafficTrailsSnapshot | null = null;

  setSnapshot(snapshot: TrafficTrailsSnapshot): void {
    if (snapshot === this.snapshot && snapshot === this.uploadedSnapshot)
      return;
    this.snapshot = snapshot;
    this.uploadSnapshot();
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    this.gl = gl;
    this.program = createProgram(gl);
    this.buffer = gl.createBuffer();
    this.startLocation = gl.getAttribLocation(this.program, "a_start");
    this.endLocation = gl.getAttribLocation(this.program, "a_end");
    this.tLocation = gl.getAttribLocation(this.program, "a_t");
    this.sideLocation = gl.getAttribLocation(this.program, "a_side");
    this.halfWidthLocation = gl.getAttribLocation(this.program, "a_half_width");
    this.colorLocation = gl.getAttribLocation(this.program, "a_color");
    this.matrixLocation = gl.getUniformLocation(this.program, "u_matrix");
    this.viewportLocation = gl.getUniformLocation(this.program, "u_viewport");
    this.uploadedSnapshot = null;
    this.uploadSnapshot();
  }

  render(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    args: CustomRenderMethodInput,
  ): void {
    if (
      !this.program ||
      !this.buffer ||
      !this.matrixLocation ||
      !this.viewportLocation ||
      this.snapshot.vertexCount === 0
    )
      return;
    const matrix =
      args.defaultProjectionData?.mainMatrix ?? args.modelViewProjectionMatrix;
    if (!matrix) return;
    const viewport = viewportSize(gl);
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not a React hook — gl.useProgram() is the WebGL method for activating a program
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.matrixLocation, false, matrix);
    gl.uniform2f(this.viewportLocation, viewport.width, viewport.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    enableAttribute(gl, this.startLocation, 2, 0);
    enableAttribute(gl, this.endLocation, 2, 2);
    enableAttribute(gl, this.tLocation, 1, 4);
    enableAttribute(gl, this.sideLocation, 1, 5);
    enableAttribute(gl, this.halfWidthLocation, 1, 6);
    enableAttribute(gl, this.colorLocation, 4, 7);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    );
    gl.drawArrays(gl.TRIANGLES, 0, this.snapshot.vertexCount);
  }

  onRemove(
    _map: MlMap,
    gl: WebGLRenderingContext | WebGL2RenderingContext,
  ): void {
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.program) gl.deleteProgram(this.program);
    this.map = null;
    this.gl = null;
    this.program = null;
    this.buffer = null;
    this.matrixLocation = null;
    this.viewportLocation = null;
    this.uploadedSnapshot = null;
  }

  private uploadSnapshot(): void {
    if (!this.gl || !this.buffer || this.uploadedSnapshot === this.snapshot)
      return;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      this.snapshot.vertices,
      this.gl.DYNAMIC_DRAW,
    );
    this.uploadedSnapshot = this.snapshot;
    this.map?.triggerRepaint?.();
  }
}

function appendTrailVertices(
  floats: number[],
  {
    trail,
    isSelected,
    hoveredTrailDotTs = null,
    selectedTrailDotMinMercatorDistance = TRAIL_DOT_DEFAULT_MERCATOR_DISTANCE,
    trailFadeSec,
    nowMs,
  }: {
    trail: TrailPoint[] | undefined;
    isSelected: boolean;
    hoveredTrailDotTs?: number | null;
    selectedTrailDotMinMercatorDistance?: number;
    trailFadeSec: number;
    nowMs: number;
  },
): void {
  if (!trail || trail.length < 2) return;
  const points = trail;
  let start = isSelected
    ? 0
    : firstTrailIndexAtOrAfter(points, nowMs - trailFadeSec * 1000);
  if (!isSelected) {
    start = latestContinuousTrailStart(points, start);
  }
  const lastIndex = points.length - start - 1;
  if (lastIndex < 1) return;
  const stride = isSelected
    ? 1
    : Math.max(1, Math.ceil(lastIndex / TRAIL_MAX_UNSELECTED_SEGMENTS));
  let prev = points[start];
  let prevIndex = start;
  for (let i = start + stride; i < points.length; i += stride) {
    appendSegment(i);
  }
  if (prevIndex !== points.length - 1) {
    appendSegment(points.length - 1);
  }
  if (isSelected) {
    appendTrailDotVertices(
      floats,
      points,
      start,
      hoveredTrailDotTs,
      selectedTrailDotMinMercatorDistance,
    );
  }

  function appendSegment(nextIndex: number): void {
    const next = points[nextIndex];
    if (breaksTrail(prev, next, isSelected)) {
      prev = next;
      prevIndex = nextIndex;
      return;
    }
    const segmentIndex = nextIndex - start - 1;
    const opacity = isSelected
      ? TRAIL_OPACITY_MAX_SEL
      : TRAIL_OPACITY_MIN +
        (TRAIL_OPACITY_MAX_UNSEL - TRAIL_OPACITY_MIN) *
          ((segmentIndex + 1) / lastIndex);
    appendSegmentQuad(
      floats,
      prev,
      next,
      opacity,
      (isSelected ? TRAIL_WIDTH_SEL : TRAIL_WIDTH_UNSEL) / 2,
    );
    prev = next;
    prevIndex = nextIndex;
  }
}

function latestContinuousTrailStart(
  points: TrailPoint[],
  start: number,
): number {
  if (points.length < 2) return start;
  let nextIndex = points.length - 1;
  while (nextIndex > start) {
    const prev = points[nextIndex - 1];
    const next = points[nextIndex];
    if (breaksTrail(prev, next, false)) return nextIndex;
    nextIndex -= 1;
  }
  return start;
}

function breaksTrail(
  prev: TrailPoint,
  next: TrailPoint,
  connectsTimeGaps: boolean,
): boolean {
  return (
    (!connectsTimeGaps && next.ts - prev.ts > TRAIL_BREAK_GAP_MS) ||
    (prev.segment != null &&
      next.segment != null &&
      next.segment !== prev.segment)
  );
}

export interface TrailDotSample {
  point: TrailPoint;
  center: { x: number; y: number };
}

export function selectedTrailDotSamples(
  points: TrailPoint[] | undefined,
  start = 0,
  minMercatorDistance = TRAIL_DOT_DEFAULT_MERCATOR_DISTANCE,
): TrailDotSample[] {
  if (!points || points.length === 0) return [];
  const samples: TrailDotSample[] = [];
  let previousCenter: { x: number; y: number } | null = null;
  let distanceSinceDot = Infinity;
  let lastDotIndex = -1;
  for (let i = start; i < points.length; i += 1) {
    const center = lngLatToMercator(points[i].lon, points[i].lat);
    if (previousCenter) {
      distanceSinceDot += mercatorDistance(center, previousCenter);
    }
    if (
      i !== start &&
      i !== points.length - 1 &&
      distanceSinceDot < minMercatorDistance
    ) {
      previousCenter = center;
      continue;
    }
    samples.push({ point: points[i], center });
    distanceSinceDot = 0;
    previousCenter = center;
    lastDotIndex = i;
  }
  if (lastDotIndex !== points.length - 1) {
    samples.push({
      point: points[points.length - 1],
      center: lngLatToMercator(
        points[points.length - 1].lon,
        points[points.length - 1].lat,
      ),
    });
  }
  return samples;
}

export function selectedTrailDotSpacingForZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return TRAIL_DOT_DEFAULT_MERCATOR_DISTANCE;
  return (
    TRAIL_DOT_MIN_SCREEN_DISTANCE_PX / (WEB_MERCATOR_TILE_SIZE_PX * 2 ** zoom)
  );
}

function appendTrailDotVertices(
  floats: number[],
  points: TrailPoint[],
  start: number,
  hoveredTrailDotTs: number | null,
  minMercatorDistance: number,
): void {
  for (const { point, center } of selectedTrailDotSamples(
    points,
    start,
    minMercatorDistance,
  )) {
    appendTrailDot(floats, point, center, point.ts === hoveredTrailDotTs);
  }
}

function mercatorDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function appendTrailDot(
  floats: number[],
  point: TrailPoint,
  center = lngLatToMercator(point.lon, point.lat),
  highlighted = false,
): void {
  const color = highlighted
    ? TRAIL_DOT_HOVER_COLOR
    : rgbaFromHex(altTrailColor(point.alt, point.ground));
  const r = TRAIL_DOT_RADIUS_SEL;
  appendTrailDotVertex(floats, center, -1, -1, r, color);
  appendTrailDotVertex(floats, center, 1, -1, r, color);
  appendTrailDotVertex(floats, center, -1, 1, r, color);
  appendTrailDotVertex(floats, center, -1, 1, r, color);
  appendTrailDotVertex(floats, center, 1, -1, r, color);
  appendTrailDotVertex(floats, center, 1, 1, r, color);
}

function appendTrailDotVertex(
  floats: number[],
  center: { x: number; y: number },
  x: number,
  y: number,
  radius: number,
  color: { r: number; g: number; b: number },
): void {
  appendTrailVertex(
    floats,
    center,
    { x, y },
    2,
    x * radius,
    y * radius,
    color,
    TRAIL_DOT_OPACITY_SEL,
  );
}

function appendSegmentQuad(
  floats: number[],
  startPoint: TrailPoint,
  endPoint: TrailPoint,
  alpha: number,
  halfWidth: number,
): void {
  const start = lngLatToMercator(startPoint.lon, startPoint.lat);
  const end = lngLatToMercator(endPoint.lon, endPoint.lat);
  const color = rgbaFromHex(altTrailColor(startPoint.alt, startPoint.ground));
  appendTrailVertex(floats, start, end, 0, -1, halfWidth, color, alpha);
  appendTrailVertex(floats, start, end, 0, 1, halfWidth, color, alpha);
  appendTrailVertex(floats, start, end, 1, -1, halfWidth, color, alpha);
  appendTrailVertex(floats, start, end, 1, -1, halfWidth, color, alpha);
  appendTrailVertex(floats, start, end, 0, 1, halfWidth, color, alpha);
  appendTrailVertex(floats, start, end, 1, 1, halfWidth, color, alpha);
}

function appendTrailVertex(
  floats: number[],
  start: { x: number; y: number },
  end: { x: number; y: number },
  t: number,
  side: number,
  halfWidth: number,
  color: { r: number; g: number; b: number },
  alpha: number,
): void {
  floats.push(
    start.x,
    start.y,
    end.x,
    end.y,
    t,
    side,
    halfWidth,
    color.r,
    color.g,
    color.b,
    alpha,
  );
}

function firstTrailIndexAtOrAfter(trail: TrailPoint[], ts: number): number {
  let lo = 0;
  let hi = trail.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (trail[mid].ts < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function rgbaFromHex(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace("#", "");
  return {
    r: Number.parseInt(raw.slice(0, 2), 16) / 255,
    g: Number.parseInt(raw.slice(2, 4), 16) / 255,
    b: Number.parseInt(raw.slice(4, 6), 16) / 255,
  };
}

function enableAttribute(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  location: number,
  size: number,
  offsetFloats: number,
): void {
  if (location < 0) return;
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(
    location,
    size,
    gl.FLOAT,
    false,
    FLOATS_PER_VERTEX * BYTES_PER_FLOAT,
    offsetFloats * BYTES_PER_FLOAT,
  );
}

function viewportSize(gl: WebGLRenderingContext | WebGL2RenderingContext): {
  width: number;
  height: number;
} {
  const canvas = gl.canvas;
  const clientWidth = "clientWidth" in canvas ? canvas.clientWidth : 0;
  const clientHeight = "clientHeight" in canvas ? canvas.clientHeight : 0;
  const width = clientWidth > 0 ? clientWidth : gl.drawingBufferWidth;
  const height = clientHeight > 0 ? clientHeight : gl.drawingBufferHeight;
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

function createProgram(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragment = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    FRAGMENT_SHADER_SOURCE,
  );
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create traffic trails program");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? "unknown link error";
    gl.deleteProgram(program);
    throw new Error(`Failed to link traffic trails program: ${info}`);
  }
  return program;
}

function compileShader(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create traffic trails shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? "unknown compile error";
    gl.deleteShader(shader);
    throw new Error(`Failed to compile traffic trails shader: ${info}`);
  }
  return shader;
}
