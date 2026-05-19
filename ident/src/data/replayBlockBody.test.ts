/// <reference types="node" />
import { zstdCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  decodeReplayBlockResponse,
  MAX_REPLAY_BLOCK_DECOMPRESSED_BYTES,
  ReplayBlockBodyError,
} from "./replayBlockBody";

// fzstd is decompress-only by design (smaller bundle). Tests compress via
// node:zlib (Node 22+) to produce valid zstd payloads, then feed them
// through the production decoder to verify the round-trip.

const encoder = new TextEncoder();

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function zstdCompress(bytes: Uint8Array): Uint8Array {
  const out = zstdCompressSync(bytes);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

function zstdJsonBytes(value: unknown): Uint8Array {
  return zstdCompress(jsonBytes(value));
}

describe("decodeReplayBlockResponse", () => {
  it("parses raw JSON bytes (browser-decoded HTTPS path or cached decoded response)", () => {
    const payload = { version: 2, frames: [{ ts: 1 }] };
    const out = decodeReplayBlockResponse(jsonBytes(payload));
    expect(out).toEqual(payload);
  });

  it("decompresses zstd-magic-prefixed bytes then parses JSON (HTTP fallback path)", () => {
    const payload = { version: 2, frames: [{ ts: 7, aircraft: [] }] };
    const out = decodeReplayBlockResponse(zstdJsonBytes(payload));
    expect(out).toEqual(payload);
  });

  it("strips UTF-8 BOM when present on raw JSON bytes", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const body = jsonBytes({ version: 2 });
    const combined = new Uint8Array(bom.length + body.length);
    combined.set(bom, 0);
    combined.set(body, bom.length);
    const out = decodeReplayBlockResponse(combined);
    expect(out).toEqual({ version: 2 });
  });

  it("throws ReplayBlockBodyError on an empty buffer", () => {
    expect(() => decodeReplayBlockResponse(new Uint8Array(0))).toThrow(
      ReplayBlockBodyError,
    );
  });

  it("throws ReplayBlockBodyError on a body shorter than the zstd magic length", () => {
    expect(() =>
      decodeReplayBlockResponse(new Uint8Array([0x28, 0xb5])),
    ).toThrow(ReplayBlockBodyError);
  });

  it("wraps fzstd errors on magic-prefixed but truncated payloads", () => {
    const truncated = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x00]);
    expect(() => decodeReplayBlockResponse(truncated)).toThrow(
      ReplayBlockBodyError,
    );
  });

  it("wraps JSON.parse errors on corrupted non-zstd bodies", () => {
    // Begins with `{` (looks JSON-ish) then garbage — no zstd magic, parse fails.
    const corrupted = encoder.encode(`{"version": 2, "frames":`);
    expect(() => decodeReplayBlockResponse(corrupted)).toThrow(
      ReplayBlockBodyError,
    );
  });

  it("rejects bodies that look like gzip (a proxy re-encoded the response)", () => {
    // gzip magic = 0x1f 0x8b — not zstd, not JSON. Must surface as a body
    // error, not crash with a raw TypeError from JSON.parse.
    const gzipLike = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00]);
    expect(() => decodeReplayBlockResponse(gzipLike)).toThrow(
      ReplayBlockBodyError,
    );
  });

  it("rejects an HTML error page returned in place of a block", () => {
    const html = encoder.encode("<!DOCTYPE html><html>504</html>");
    expect(() => decodeReplayBlockResponse(html)).toThrow(ReplayBlockBodyError);
  });

  it("refuses decompressed output larger than the safety cap (bomb defense)", () => {
    // Construct a zstd payload whose decompressed size exceeds the cap.
    // The cap exists so a malicious or buggy producer can't expand a tiny
    // request into gigabytes of allocation.
    const huge = new Uint8Array(MAX_REPLAY_BLOCK_DECOMPRESSED_BYTES + 1);
    huge.fill(0x20); // benign whitespace; doesn't matter, never parsed
    const compressed = zstdCompress(huge);
    expect(() => decodeReplayBlockResponse(compressed)).toThrow(
      ReplayBlockBodyError,
    );
  });
});
