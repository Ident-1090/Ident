import { useMemo } from "react";
import { create } from "zustand";
import type { IdentDiagnostic } from "./types";

// Frontend-emitted diagnostics complement the backend's DiagnosticStore for
// failures the server can't observe — replay block decode failures, websocket
// drops, browser-side decode errors. The bell already aggregates backend
// diagnostics; merging in a frontend store gives those local conditions the
// same surface area (snooze, ignore, badge count) without a roundtrip to
// identd.
//
// Identity mirrors the backend: (channel, code, scope). Re-emission with the
// same identity replaces mutable fields and refreshes seenAtEpochMs, which
// drives both display ordering and TTL expiry. Frontend codes live under a
// dedicated `frontend.*` channel prefix so identity collisions with backend
// codes are impossible.
//
// In-memory only. A browser refresh drops the set; anything worth surviving
// a reload comes from the backend store.

export const DEFAULT_FRONTEND_DIAGNOSTIC_TTL_MS = 30_000;

// Cap exists to bound memory if an emission site loops on a failure. Frontend
// codes are few; under normal operation the store holds maybe a handful.
export const FRONTEND_DIAGNOSTIC_CAP = 50;

export type FrontendDiagnosticInput = {
  severity: IdentDiagnostic["severity"];
  channel: string;
  code: string;
  message: string;
  scope?: string;
  // Time in milliseconds before the entry fades from the snapshot. Defaults
  // to DEFAULT_FRONTEND_DIAGNOSTIC_TTL_MS. A value <= 0 means "never expire
  // until cleared explicitly or the tab reloads" — matches the backend's
  // WithTTL(0) convention; do not confuse with "expire immediately."
  ttlMs?: number;
};

type FrontendEntry = {
  severity: IdentDiagnostic["severity"];
  channel: string;
  code: string;
  scope: string;
  message: string;
  seenAtEpochMs: number;
  expiresAtEpochMs: number;
  // Monotonic per-process counter that tie-breaks display ordering when
  // two emits land in the same wall-clock millisecond (common in fast
  // failure loops). seenAtEpochMs is still the primary sort key so the
  // user-visible "X ago" stays meaningful; insertOrder only resolves
  // ties so the newest emit wins.
  insertOrder: number;
};

type FrontendDiagnosticsState = {
  entries: Map<string, FrontendEntry>;
};

const useFrontendDiagnosticsStore = create<FrontendDiagnosticsState>(() => ({
  entries: new Map(),
}));

let nextInsertOrder = 0;

// A snapshot only re-filters when the entries Map changes, so a TTL alone never
// makes an entry disappear — nothing re-renders at expiry. Drive eviction with a
// timer set to the soonest expiry; firing it mutates the store, which both frees
// the entry and triggers the snapshot to drop it.
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleExpiry(): void {
  if (expiryTimer != null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  let soonest = Number.POSITIVE_INFINITY;
  for (const entry of useFrontendDiagnosticsStore.getState().entries.values()) {
    if (entry.expiresAtEpochMs < soonest) soonest = entry.expiresAtEpochMs;
  }
  if (!Number.isFinite(soonest)) return;
  const delay = Math.max(0, soonest - Date.now());
  expiryTimer = setTimeout(evictExpired, delay);
}

function evictExpired(): void {
  expiryTimer = null;
  const now = Date.now();
  useFrontendDiagnosticsStore.setState((state) => {
    let next: Map<string, FrontendEntry> | null = null;
    for (const [key, entry] of state.entries) {
      if (entry.expiresAtEpochMs <= now) {
        next ??= new Map(state.entries);
        next.delete(key);
      }
    }
    return next ? { entries: next } : state;
  });
  scheduleExpiry();
}

function identityKey(channel: string, code: string, scope: string): string {
  return JSON.stringify([channel, code, scope]);
}

export function emitFrontendDiagnostic(input: FrontendDiagnosticInput): void {
  const now = Date.now();
  const ttl = input.ttlMs ?? DEFAULT_FRONTEND_DIAGNOSTIC_TTL_MS;
  const scope = input.scope ?? "";
  const key = identityKey(input.channel, input.code, scope);
  nextInsertOrder += 1;
  // ttl <= 0 means "never expire" — same convention as the backend store.
  // Encoded as Infinity so the snapshot's `<= nowMs` check never matches.
  const expiresAtEpochMs = ttl > 0 ? now + ttl : Number.POSITIVE_INFINITY;
  const entry: FrontendEntry = {
    severity: input.severity,
    channel: input.channel,
    code: input.code,
    scope,
    message: input.message,
    seenAtEpochMs: now,
    expiresAtEpochMs,
    insertOrder: nextInsertOrder,
  };
  useFrontendDiagnosticsStore.setState((state) => {
    const next = new Map(state.entries);
    next.set(key, entry);
    evictOverflowing(next);
    return { entries: next };
  });
  scheduleExpiry();
}

export function snapshotFrontendDiagnostics(
  nowMs: number = Date.now(),
): IdentDiagnostic[] {
  return snapshotEntries(useFrontendDiagnosticsStore.getState().entries, nowMs);
}

// Reactive snapshot for React consumers. Subscribes to the entries Map
// reference (replaced on every mutation) so React re-renders the moment a
// diagnostic is emitted or cleared. useMemo caches the array between
// renders so the reference is stable when nothing changed.
export function useFrontendDiagnosticsSnapshot(): IdentDiagnostic[] {
  const entries = useFrontendDiagnosticsStore((s) => s.entries);
  return useMemo(() => snapshotEntries(entries), [entries]);
}

function snapshotEntries(
  entries: Map<string, FrontendEntry>,
  nowMs: number = Date.now(),
): IdentDiagnostic[] {
  const rows: Array<{ diag: IdentDiagnostic; insertOrder: number }> = [];
  for (const entry of entries.values()) {
    if (entry.expiresAtEpochMs <= nowMs) continue;
    const diag: IdentDiagnostic = {
      severity: entry.severity,
      channel: entry.channel,
      code: entry.code,
      message: entry.message,
      seenAtEpochMs: entry.seenAtEpochMs,
    };
    if (entry.scope !== "") {
      diag.scope = entry.scope;
    }
    rows.push({ diag, insertOrder: entry.insertOrder });
  }
  rows.sort((a, b) => {
    if (a.diag.seenAtEpochMs !== b.diag.seenAtEpochMs) {
      return b.diag.seenAtEpochMs - a.diag.seenAtEpochMs;
    }
    return b.insertOrder - a.insertOrder;
  });
  return rows.map((row) => row.diag);
}

export function __resetFrontendDiagnosticsForTest(): void {
  if (expiryTimer != null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  useFrontendDiagnosticsStore.setState({ entries: new Map() });
  // Reset the monotonic counter too so tie-break tests start from a clean
  // baseline regardless of how many emits ran in prior cases.
  nextInsertOrder = 0;
}

function evictOverflowing(entries: Map<string, FrontendEntry>): void {
  while (entries.size > FRONTEND_DIAGNOSTIC_CAP) {
    let oldestKey: string | undefined;
    let oldestSeen = Number.POSITIVE_INFINITY;
    let oldestInsertOrder = Number.POSITIVE_INFINITY;
    // Match snapshot's display ordering: seenAt is primary, insertOrder
    // breaks ms-resolution ties so we don't evict a newer entry that
    // happens to share a wall-clock tick with an older one.
    for (const [k, v] of entries) {
      if (
        v.seenAtEpochMs < oldestSeen ||
        (v.seenAtEpochMs === oldestSeen && v.insertOrder < oldestInsertOrder)
      ) {
        oldestSeen = v.seenAtEpochMs;
        oldestInsertOrder = v.insertOrder;
        oldestKey = k;
      }
    }
    if (oldestKey === undefined) return;
    entries.delete(oldestKey);
  }
}
