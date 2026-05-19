import { decompress as zstdDecompress } from "fzstd";

// Identd serves replay blocks as raw zstd bytes. The on-wire framing depends on
// what Accept-Encoding the client advertised:
//
//  * Client accepts zstd (HTTPS Chrome, curl --zstd, etc): server sets
//    `Content-Encoding: zstd` and the browser decompresses transparently — by
//    the time the body reaches JS it is raw JSON bytes starting with `{`/`[`.
//
//  * Client does not (plain-HTTP Chrome, which restricts zstd to HTTPS): server
//    omits `Content-Encoding` so the browser delivers raw zstd-framed bytes,
//    which begin with the zstd frame magic `28 B5 2F FD`. We decompress in JS.
//
// The decoder picks the path based on a 4-byte prefix check rather than reading
// any response headers — `force-cache` may surface either form for the same URL
// across page loads, and the browser strips standard Content-Encoding values
// from the visible headers anyway. The check is essentially free vs the fetch
// and JSON.parse costs that dominate the path.
//
// We never decompress on the server: that would be a CPU amplification vector
// against a public-by-default endpoint.

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd] as const;

// Cap as defense against a producer bug (or, theoretically, a compromised
// server) that emits a zstd-encoded bomb. The largest real block this
// project has produced is ~5 MB JSON; 32 MB is 6x headroom while still
// bounding the practical impact of a runaway expansion.
//
// Defense-in-depth note: the cap is checked AFTER decompression rather than
// before it, because fzstd's auto-allocation reads the frame header to size
// the output exactly. A truly hostile attacker who controls our server can
// already make the browser tab unhappy in many ways; this cap is for honest
// bugs, not adversaries.
export const MAX_REPLAY_BLOCK_DECOMPRESSED_BYTES = 32 * 1024 * 1024;

export class ReplayBlockBodyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ReplayBlockBodyError";
  }
}

export function decodeReplayBlockResponse(bytes: Uint8Array): unknown {
  if (bytes.length < ZSTD_MAGIC.length) {
    throw new ReplayBlockBodyError(
      `replay block body too short (${bytes.length} bytes)`,
    );
  }
  const isZstd =
    bytes[0] === ZSTD_MAGIC[0] &&
    bytes[1] === ZSTD_MAGIC[1] &&
    bytes[2] === ZSTD_MAGIC[2] &&
    bytes[3] === ZSTD_MAGIC[3];
  const jsonBytes = isZstd ? decompressBounded(bytes) : bytes;
  return parseJsonBytes(jsonBytes);
}

function decompressBounded(bytes: Uint8Array): Uint8Array {
  let written: Uint8Array;
  try {
    written = zstdDecompress(bytes);
  } catch (err) {
    throw new ReplayBlockBodyError("zstd decompression failed", { cause: err });
  }
  if (written.length > MAX_REPLAY_BLOCK_DECOMPRESSED_BYTES) {
    throw new ReplayBlockBodyError(
      `replay block decompressed payload exceeds cap (${written.length} > ${MAX_REPLAY_BLOCK_DECOMPRESSED_BYTES} bytes)`,
    );
  }
  return written;
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8").decode(bytes);
  } catch (err) {
    throw new ReplayBlockBodyError("replay block body is not valid UTF-8", {
      cause: err,
    });
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new ReplayBlockBodyError("replay block body is not valid JSON", {
      cause: err,
    });
  }
}
