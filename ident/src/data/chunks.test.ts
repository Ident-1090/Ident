// biome-ignore-all lint/style/noNonNullAssertion: test fixture — missing elements/mocks fail the test loudly via the test runner.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChunkJson, groupChunkIntoTrails, parseChunkJson } from "./chunks";

describe("parseChunkJson", () => {
  it("accepts a well-formed chunk payload", () => {
    const raw: ChunkJson = {
      files: [
        {
          now: 1776630156,
          messages: 42,
          aircraft: [
            [
              "abc123",
              12000,
              450,
              90,
              37.5,
              -122.5,
              0.3,
              "adsb_icao",
              "UAL1  ",
              100,
            ],
          ],
        },
      ],
    };
    const parsed = parseChunkJson(JSON.stringify(raw));
    expect(parsed).not.toBeNull();
    expect(parsed!.files).toHaveLength(1);
  });

  it("returns null on malformed JSON", () => {
    expect(parseChunkJson("{not json")).toBeNull();
  });

  it("returns null when files is missing", () => {
    expect(parseChunkJson(JSON.stringify({}))).toBeNull();
  });
});

describe("groupChunkIntoTrails", () => {
  it("groups rows by hex across slices and sorts by reconstructed position timestamp", () => {
    const chunk: ChunkJson = {
      files: [
        {
          now: 1000,
          messages: 0,
          aircraft: [
            ["abc", 10000, 400, 90, 37.5, -122.0, 4, "adsb_icao", null, 10],
            ["def", 5000, 200, 180, 38.0, -121.0, 0.1, "adsb_icao", null, 5],
          ],
        },
        {
          now: 1004,
          messages: 0,
          aircraft: [
            ["abc", 10200, 410, 91, 37.51, -122.01, 0.2, "adsb_icao", null, 11],
          ],
        },
      ],
    };
    const trails = groupChunkIntoTrails([chunk]);
    expect(trails.size).toBe(2);
    const abc = trails.get("abc")!;
    expect(abc).toHaveLength(2);
    expect(abc[0].ts).toBe(996_000);
    expect(abc[0].lat).toBeCloseTo(37.5);
    expect(abc[1].ts).toBe(1003_800);
    expect(abc[1].alt).toBe(10200);
  });

  it("skips rows with missing lat/lon", () => {
    const chunk: ChunkJson = {
      files: [
        {
          now: 1000,
          messages: 0,
          aircraft: [
            // @ts-expect-error — exercising lat=null skip
            ["abc", 10000, 400, 90, null, null, 0.1, "adsb_icao", null, 10],
          ],
        },
      ],
    };
    const trails = groupChunkIntoTrails([chunk]);
    expect(trails.size).toBe(0);
  });

  it("maps 'ground' alt string to 'ground' TrailPoint alt", () => {
    const chunk: ChunkJson = {
      files: [
        {
          now: 1000,
          messages: 0,
          aircraft: [
            ["abc", "ground", 0, 0, 37.5, -122.0, 0.1, "adsb_icao", null, 10],
          ],
        },
      ],
    };
    const trails = groupChunkIntoTrails([chunk]);
    expect(trails.get("abc")![0].alt).toBe("ground");
  });

  it("preserves numeric alt_ft including 0", () => {
    const chunk: ChunkJson = {
      files: [
        {
          now: 1000,
          messages: 0,
          aircraft: [
            ["abc", 0, 51, 321, 37.5, -122.0, 0.1, "adsb_icao", null, 10],
          ],
        },
      ],
    };
    const trails = groupChunkIntoTrails([chunk]);
    expect(trails.get("abc")![0].alt).toBe(0);
  });

  it("skips stale position rows instead of treating them as fresh trail points", () => {
    const chunk: ChunkJson = {
      files: [
        {
          now: 1000,
          messages: 0,
          aircraft: [
            ["fresh", 8000, 180, 90, 37.5, -122.0, 14.9, "adsb_icao", null, 10],
            ["stale", 8000, 180, 90, 37.6, -122.1, 15.1, "adsb_icao", null, 10],
          ],
        },
      ],
    };
    const trails = groupChunkIntoTrails([chunk]);
    expect(trails.get("fresh")).toHaveLength(1);
    expect(trails.has("stale")).toBe(false);
  });

  it("allows longer seen_pos windows for adsc rows", () => {
    const chunk: ChunkJson = {
      files: [
        {
          now: 2000,
          messages: 0,
          aircraft: [
            ["adsc-ok", 34000, 430, 270, 36.5, -121.5, 600, "adsc", null, 10],
            [
              "adsc-stale",
              34000,
              430,
              270,
              36.6,
              -121.6,
              1201,
              "adsc",
              null,
              10,
            ],
          ],
        },
      ],
    };
    const trails = groupChunkIntoTrails([chunk]);
    expect(trails.get("adsc-ok")![0].ts).toBe(1_400_000);
    expect(trails.has("adsc-stale")).toBe(false);
  });
});

describe("loadHistoricalTracks", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // default mock — individual tests override
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.history.replaceState(null, "", "/");
  });

  it("returns an empty map when chunks.json 404s", async () => {
    (
      globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      ok: false,
      status: 404,
    });
    const { loadHistoricalTracks } = await import("./chunks");
    const trails = await loadHistoricalTracks();
    expect(trails.size).toBe(0);
  });

  it("fetches chunks relative to the mounted document path", async () => {
    window.history.replaceState(null, "", "/ident/#/aircraft/abc123");
    const mock = vi.fn(async (_url: string) => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    }));
    globalThis.fetch = mock as unknown as typeof fetch;

    const { loadHistoricalTracks } = await import("./chunks");
    await loadHistoricalTracks();

    expect(mock.mock.calls[0]?.[0]).toBe("/ident/api/chunks/chunks.json");
  });

  it("skips current_large.gz and current_small.gz when selecting historical chunks", async () => {
    const chunk: ChunkJson = {
      files: [
        {
          now: 3000,
          messages: 0,
          aircraft: [
            ["xyz", 11000, 420, 95, 37.6, -122.1, 0.1, "adsb_icao", null, 10],
          ],
        },
      ],
    };
    // current_large would be empty (rolling slice); the loader must NOT pick it.
    const rollingEmpty: ChunkJson = { files: [] };
    const urls: string[] = [];
    const mock = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.endsWith("/chunks.json")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            chunks: ["chunk_1000.gz", "current_large.gz", "current_small.gz"],
          }),
        };
      }
      if (url.endsWith("/chunk_1000.gz")) {
        return { ok: true, status: 200, json: async () => chunk };
      }
      return { ok: true, status: 200, json: async () => rollingEmpty };
    });
    globalThis.fetch = mock as unknown as typeof fetch;
    const { loadHistoricalTracks } = await import("./chunks");
    const trails = await loadHistoricalTracks();
    // current_large.gz must never be fetched; current_small.gz may be fetched
    // as an optional empty tail.
    expect(urls.some((u) => u.endsWith("/current_large.gz"))).toBe(false);
    expect(trails.get("xyz")).toBeDefined();
    expect(trails.get("xyz")![0].ts).toBe(2_999_900);
  });

  it("fetches multiple historical chunks in parallel and groups rows by hex", async () => {
    const makeChunk = (hex: string, ts: number): ChunkJson => ({
      files: [
        {
          now: ts,
          messages: 0,
          aircraft: [
            [hex, 10000, 400, 90, 37.5, -122.0, 0.1, "adsb_icao", null, 10],
          ],
        },
      ],
    });
    let inFlight = 0;
    let maxInFlight = 0;
    const mock = vi.fn(async (url: string) => {
      if (url.endsWith("/chunks.json")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            chunks: ["chunk_1000.gz", "chunk_2000.gz", "chunk_3000.gz"],
          }),
        };
      }
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      // Yield so concurrent fetches can pile up before any resolves.
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (url.endsWith("/chunk_1000.gz"))
        return {
          ok: true,
          status: 200,
          json: async () => makeChunk("abc", 1000),
        };
      if (url.endsWith("/chunk_2000.gz"))
        return {
          ok: true,
          status: 200,
          json: async () => makeChunk("abc", 2000),
        };
      if (url.endsWith("/chunk_3000.gz"))
        return {
          ok: true,
          status: 200,
          json: async () => makeChunk("def", 3000),
        };
      return { ok: false, status: 404 };
    });
    globalThis.fetch = mock as unknown as typeof fetch;
    const { loadHistoricalTracks } = await import("./chunks");
    const trails = await loadHistoricalTracks();
    expect(maxInFlight).toBeGreaterThanOrEqual(2);
    expect(trails.get("abc")).toHaveLength(2);
    expect(trails.get("abc")![0].ts).toBe(999_900);
    expect(trails.get("abc")![1].ts).toBe(1_999_900);
    expect(trails.get("def")).toHaveLength(1);
  });
});
