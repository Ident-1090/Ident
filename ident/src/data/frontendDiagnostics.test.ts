import { afterEach, describe, expect, it } from "vitest";
import {
  __resetFrontendDiagnosticsForTest,
  clearFrontendDiagnostic,
  DEFAULT_FRONTEND_DIAGNOSTIC_TTL_MS,
  emitFrontendDiagnostic,
  FRONTEND_DIAGNOSTIC_CAP,
  snapshotFrontendDiagnostics,
} from "./frontendDiagnostics";

afterEach(() => {
  __resetFrontendDiagnosticsForTest();
});

describe("frontendDiagnostics", () => {
  it("emit + snapshot returns the entry with seenAtEpochMs set", () => {
    const before = Date.now();
    emitFrontendDiagnostic({
      severity: "warning",
      channel: "frontend.replay",
      code: "replay.block_decode_failed",
      message: "Could not decode block /api/replay/blocks/1-2.json.zst",
    });
    const after = Date.now();

    const snap = snapshotFrontendDiagnostics();
    expect(snap).toHaveLength(1);
    const [entry] = snap;
    expect(entry).toMatchObject({
      severity: "warning",
      channel: "frontend.replay",
      code: "replay.block_decode_failed",
      message: "Could not decode block /api/replay/blocks/1-2.json.zst",
    });
    expect(entry.seenAtEpochMs).toBeGreaterThanOrEqual(before);
    expect(entry.seenAtEpochMs).toBeLessThanOrEqual(after);
  });

  it("re-emitting the same identity replaces mutable fields and refreshes seenAt", () => {
    emitFrontendDiagnostic({
      severity: "info",
      channel: "frontend.network",
      code: "network.websocket_dropped",
      message: "first",
    });
    const firstSeen = snapshotFrontendDiagnostics()[0].seenAtEpochMs;

    // Tiny delay so seenAt can move forward measurably.
    const later = firstSeen + 5;
    emitFrontendDiagnostic({
      severity: "error",
      channel: "frontend.network",
      code: "network.websocket_dropped",
      message: "second",
    });

    const snap = snapshotFrontendDiagnostics(later);
    expect(snap).toHaveLength(1);
    expect(snap[0].severity).toBe("error");
    expect(snap[0].message).toBe("second");
    expect(snap[0].seenAtEpochMs).toBeGreaterThanOrEqual(firstSeen);
  });

  it("treats different scopes as distinct identities", () => {
    emitFrontendDiagnostic({
      severity: "warning",
      channel: "frontend.replay",
      code: "replay.block_decode_failed",
      scope: "block-a",
      message: "a",
    });
    emitFrontendDiagnostic({
      severity: "warning",
      channel: "frontend.replay",
      code: "replay.block_decode_failed",
      scope: "block-b",
      message: "b",
    });

    const snap = snapshotFrontendDiagnostics();
    expect(snap).toHaveLength(2);
    expect(snap.map((d) => d.scope).sort()).toEqual(["block-a", "block-b"]);
  });

  it("snapshot omits entries whose TTL has elapsed", () => {
    emitFrontendDiagnostic({
      severity: "warning",
      channel: "frontend.replay",
      code: "code.a",
      message: "stale",
      ttlMs: 1000,
    });

    const seenAt = snapshotFrontendDiagnostics()[0].seenAtEpochMs;
    const expired = snapshotFrontendDiagnostics(seenAt + 1001);
    expect(expired).toHaveLength(0);
  });

  it("snapshot still returns entries before TTL elapses", () => {
    emitFrontendDiagnostic({
      severity: "warning",
      channel: "frontend.replay",
      code: "code.a",
      message: "fresh",
      ttlMs: 1000,
    });
    const seenAt = snapshotFrontendDiagnostics()[0].seenAtEpochMs;
    expect(snapshotFrontendDiagnostics(seenAt + 999)).toHaveLength(1);
  });

  it("defaults ttlMs to DEFAULT_FRONTEND_DIAGNOSTIC_TTL_MS when omitted", () => {
    emitFrontendDiagnostic({
      severity: "info",
      channel: "frontend.x",
      code: "code.a",
      message: "m",
    });
    const seenAt = snapshotFrontendDiagnostics()[0].seenAtEpochMs;
    // Just under the default cap → still present.
    expect(
      snapshotFrontendDiagnostics(
        seenAt + DEFAULT_FRONTEND_DIAGNOSTIC_TTL_MS - 1,
      ),
    ).toHaveLength(1);
    // Just over → expired.
    expect(
      snapshotFrontendDiagnostics(
        seenAt + DEFAULT_FRONTEND_DIAGNOSTIC_TTL_MS + 1,
      ),
    ).toHaveLength(0);
  });

  it("clear removes an entry by identity", () => {
    emitFrontendDiagnostic({
      severity: "warning",
      channel: "frontend.x",
      code: "code.a",
      message: "m",
    });
    clearFrontendDiagnostic("frontend.x", "code.a");
    expect(snapshotFrontendDiagnostics()).toHaveLength(0);
  });

  it("clear is a no-op when nothing matches the identity", () => {
    expect(() =>
      clearFrontendDiagnostic("frontend.nope", "code.absent"),
    ).not.toThrow();
    emitFrontendDiagnostic({
      severity: "warning",
      channel: "frontend.x",
      code: "code.a",
      message: "m",
    });
    clearFrontendDiagnostic("frontend.x", "code.a", "wrong-scope");
    expect(snapshotFrontendDiagnostics()).toHaveLength(1);
  });

  it("clear respects scope (matches only the identity with that scope)", () => {
    emitFrontendDiagnostic({
      severity: "warning",
      channel: "frontend.x",
      code: "code.a",
      scope: "s1",
      message: "m1",
    });
    emitFrontendDiagnostic({
      severity: "warning",
      channel: "frontend.x",
      code: "code.a",
      scope: "s2",
      message: "m2",
    });
    clearFrontendDiagnostic("frontend.x", "code.a", "s1");
    const snap = snapshotFrontendDiagnostics();
    expect(snap).toHaveLength(1);
    expect(snap[0].scope).toBe("s2");
  });

  it("evicts the oldest entry when exceeding FRONTEND_DIAGNOSTIC_CAP", () => {
    // Emit one over the cap; the very first entry must be gone.
    for (let i = 0; i <= FRONTEND_DIAGNOSTIC_CAP; i++) {
      emitFrontendDiagnostic({
        severity: "info",
        channel: "frontend.x",
        code: `code.${i}`,
        message: String(i),
      });
    }
    const snap = snapshotFrontendDiagnostics();
    expect(snap).toHaveLength(FRONTEND_DIAGNOSTIC_CAP);
    const codes = new Set(snap.map((d) => d.code));
    expect(codes.has("code.0")).toBe(false);
    expect(codes.has(`code.${FRONTEND_DIAGNOSTIC_CAP}`)).toBe(true);
  });

  it("snapshot returns entries sorted newest-first by seenAtEpochMs", () => {
    emitFrontendDiagnostic({
      severity: "info",
      channel: "frontend.x",
      code: "code.first",
      message: "first",
    });
    const firstSeen = snapshotFrontendDiagnostics()[0].seenAtEpochMs;
    emitFrontendDiagnostic({
      severity: "info",
      channel: "frontend.x",
      code: "code.second",
      message: "second",
    });
    const snap = snapshotFrontendDiagnostics(firstSeen + 10);
    expect(snap.map((d) => d.code)).toEqual(["code.second", "code.first"]);
  });

  it("omits scope from the snapshot when not provided", () => {
    emitFrontendDiagnostic({
      severity: "info",
      channel: "frontend.x",
      code: "code.a",
      message: "m",
    });
    const [entry] = snapshotFrontendDiagnostics();
    expect(entry.scope).toBeUndefined();
  });

  it("treats ttlMs <= 0 as never-expire (matches backend WithTTL(0) semantics)", () => {
    emitFrontendDiagnostic({
      severity: "warning",
      channel: "frontend.x",
      code: "code.persistent",
      message: "persistent",
      ttlMs: 0,
    });
    const seenAt = snapshotFrontendDiagnostics()[0].seenAtEpochMs;
    // Far in the future — entry should still be present.
    expect(
      snapshotFrontendDiagnostics(seenAt + 365 * 24 * 60 * 60 * 1000),
    ).toHaveLength(1);

    emitFrontendDiagnostic({
      severity: "warning",
      channel: "frontend.x",
      code: "code.negative",
      message: "negative ttl",
      ttlMs: -1,
    });
    expect(
      snapshotFrontendDiagnostics(seenAt + 365 * 24 * 60 * 60 * 1000),
    ).toHaveLength(2);
  });

  it("evictOverflowing tie-breaks by insertOrder when seenAt collides", () => {
    // Pin Date.now so every emit lands in the same millisecond — that forces
    // the eviction scan to resolve ties via insertOrder rather than wall clock.
    const fixed = 1_700_000_000_000;
    const realDateNow = Date.now;
    Date.now = () => fixed;
    try {
      for (let i = 0; i <= FRONTEND_DIAGNOSTIC_CAP; i++) {
        emitFrontendDiagnostic({
          severity: "info",
          channel: "frontend.x",
          code: `code.${i}`,
          message: String(i),
        });
      }
    } finally {
      Date.now = realDateNow;
    }
    const snap = snapshotFrontendDiagnostics(fixed + 1);
    expect(snap).toHaveLength(FRONTEND_DIAGNOSTIC_CAP);
    const codes = new Set(snap.map((d) => d.code));
    // First-inserted (oldest insertOrder) was evicted; last-inserted survived.
    expect(codes.has("code.0")).toBe(false);
    expect(codes.has(`code.${FRONTEND_DIAGNOSTIC_CAP}`)).toBe(true);
  });

  it("__resetFrontendDiagnosticsForTest also clears the insertOrder counter", () => {
    emitFrontendDiagnostic({
      severity: "info",
      channel: "frontend.x",
      code: "code.a",
      message: "m",
    });
    __resetFrontendDiagnosticsForTest();
    // After reset, the next emit must start with a fresh insertOrder so
    // ordering tests are deterministic regardless of prior cases.
    const fixed = 1_700_000_000_000;
    const realDateNow = Date.now;
    Date.now = () => fixed;
    try {
      emitFrontendDiagnostic({
        severity: "info",
        channel: "frontend.x",
        code: "code.b",
        message: "first after reset",
      });
      emitFrontendDiagnostic({
        severity: "info",
        channel: "frontend.x",
        code: "code.c",
        message: "second after reset",
      });
    } finally {
      Date.now = realDateNow;
    }
    const snap = snapshotFrontendDiagnostics(fixed + 1);
    // Newest insertOrder (code.c) first, then code.b. If insertOrder leaked
    // from before the reset, this order could not be guaranteed.
    expect(snap.map((d) => d.code)).toEqual(["code.c", "code.b"]);
  });
});
