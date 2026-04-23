import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { haversineNm } from "../data/derive";
import { useIdentStore } from "../data/store";
import type {
  OutlineJson,
  ReceiverJson,
  StatsJson,
  StatsWindowJson,
} from "../data/types";
import {
  mapDistanceLabelFromNm,
  resolveUnitOverrides,
} from "../settings/format";

const METERS_PER_NM = 1852;

type LiveTier =
  | "warming"
  | "listening"
  | "retuning"
  | "fresh"
  | "stale"
  | "dead"
  | "offline";
interface LiveStatus {
  tier: LiveTier;
  label: string;
  detail?: string;
  showRate: boolean;
}
const STALENESS_TICK_MS = 500;
const STALE_AFTER_MS = 2000;
const DISCONNECTED_AFTER_MS = 30_000;

function formatFeedAge(ageMs: number): string {
  return `${Math.max(0, Math.round(ageMs / 1000))}s old`;
}

export interface DiagnosticCell {
  k: string;
  v: string;
  warn?: boolean;
}

export interface ReceiverDiagnostics {
  cells: DiagnosticCell[];
  buildLabel: string;
}

export function useReceiverDiagnostics(): ReceiverDiagnostics {
  const receiver = useIdentStore((s) => s.receiver);
  const stats = useIdentStore((s) => s.stats);
  const outline = useIdentStore((s) => s.outline);
  const settings = useIdentStore((s) => s.settings);
  const units = resolveUnitOverrides(settings.unitMode, settings.unitOverrides);

  const last1min = stats?.last1min;

  const gainLabel =
    stats?.gain_db != null ? `${stats.gain_db.toFixed(1)} dB` : "—";

  const noiseDb =
    typeof last1min?.local?.noise === "number" ? last1min.local.noise : null;
  const noiseLabel = noiseDb != null ? `${noiseDb.toFixed(1)} dBFS` : "—";

  const strongPct = computeStrongPct(last1min?.local);
  const strongLabel = strongPct != null ? `${strongPct.toFixed(1)}%` : "—";
  const strongWarn = strongPct != null && strongPct > 6;

  const maxRangeNm = useMemo(
    () => computeMaxRangeNm(outline, receiver, last1min?.max_distance),
    [outline, receiver, last1min?.max_distance],
  );
  const maxRangeLabel =
    maxRangeNm != null
      ? mapDistanceLabelFromNm(maxRangeNm, units.distance)
      : "—";

  const uptimeSec = computeUptimeSec(stats);
  const uptimeLabel = uptimeSec != null ? formatUptime(uptimeSec) : "—";

  const cpuPct =
    computeCpuPct(last1min) ??
    (typeof stats?.cpu_load === "number" ? stats.cpu_load : null);
  const cpuLabel = cpuPct != null ? `${cpuPct.toFixed(0)}%` : "—";

  const ppmLabel =
    stats?.estimated_ppm != null ? formatSigned(stats.estimated_ppm) : null;

  const readsbVer = receiver?.version?.trim().split(/\s+/)[0];
  const buildLabel = readsbVer
    ? `readsb ${readsbVer} · 10 MHz ES`
    : "readsb · 1090 ES";

  const cells: DiagnosticCell[] = [
    { k: "Gain", v: gainLabel },
    { k: "Noise", v: noiseLabel },
    { k: "Strong", v: strongLabel, warn: strongWarn },
    { k: "Max range", v: maxRangeLabel },
    { k: "Uptime", v: uptimeLabel },
    { k: "CPU", v: cpuLabel },
  ];
  if (ppmLabel != null) cells.push({ k: "PPM", v: ppmLabel });
  return { cells, buildLabel };
}

export function StatusBar() {
  const { cells, buildLabel } = useReceiverDiagnostics();
  return (
    <footer className="[grid-area:status] flex items-center gap-0 px-0 py-0 bg-(--color-chrome-bg) border-t border-chrome-line text-chrome-ink-soft font-mono text-[10.5px] whitespace-nowrap overflow-hidden">
      <FeedStatusCell />
      {cells.map((c) => (
        <Cell key={c.k} k={c.k} v={c.v} warn={c.warn} />
      ))}
      <div className="ml-auto px-3.5 flex items-center h-full text-chrome-ink-faint border-l border-chrome-line">
        {buildLabel}
      </div>
    </footer>
  );
}

export function FeedStatusCell({
  variant = "bar",
}: {
  variant?: "bar" | "hud";
}) {
  const live = useLiveStatus();
  const mpsBuffer = useIdentStore((s) => s.liveState.mpsBuffer);
  const mpsCurrent = mpsBuffer.length > 0 ? mpsBuffer[mpsBuffer.length - 1] : 0;
  return <LiveCell status={live} mps={mpsCurrent} variant={variant} />;
}

function useLiveStatus(): LiveStatus {
  const status = useIdentStore((s) => s.connectionStatus);
  const statusInfo = useIdentStore((s) => s.connectionStatusInfo);
  const lastMsgTs = useIdentStore((s) => s.liveState.lastMsgTs);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), STALENESS_TICK_MS);
    return () => clearInterval(id);
  }, []);
  const wsStatus = status.ws;
  const wsRetry = statusInfo.ws?.isRetry === true;
  const httpStatus = status.http;
  const transportStatuses = Object.values(status);
  const hasTransportStatus = transportStatuses.length > 0;
  if (lastMsgTs === 0) {
    if (httpStatus === "connecting" || httpStatus === "open") {
      return {
        tier: "retuning",
        label: "Retuning feed",
        detail: "Trying backup data source",
        showRate: false,
      };
    }
    if (httpStatus === "closed") {
      return { tier: "offline", label: "Offline", showRate: false };
    }
    if (wsStatus === "open" || (wsStatus === "connecting" && !wsRetry)) {
      return {
        tier: "listening",
        label: "Listening for blips",
        showRate: false,
      };
    }
    if (!hasTransportStatus) {
      return {
        tier: "warming",
        label: "Warming the scope",
        showRate: false,
      };
    }
    return { tier: "offline", label: "Offline", showRate: false };
  }

  const age = now - lastMsgTs;
  if (age > DISCONNECTED_AFTER_MS) {
    return {
      tier: "dead",
      label: "Disconnected",
      detail: formatFeedAge(age),
      showRate: false,
    };
  }
  if (age > STALE_AFTER_MS) {
    return {
      tier: "stale",
      label: "Stale data",
      detail: formatFeedAge(age),
      showRate: false,
    };
  }
  if (httpStatus === "open" && wsStatus !== "open") {
    return { tier: "retuning", label: "Degraded connection", showRate: true };
  }
  return { tier: "fresh", label: "Live", showRate: true };
}

function LiveCell({
  status,
  mps,
  variant,
}: {
  status: LiveStatus;
  mps: number;
  variant: "bar" | "hud";
}) {
  const { tier } = status;
  const tone =
    tier === "fresh"
      ? "var(--color-live)"
      : tier === "stale" || tier === "retuning"
        ? "var(--color-warn)"
        : tier === "dead"
          ? "var(--color-emerg)"
          : tier === "listening" || tier === "warming"
            ? "var(--color-accent)"
            : "var(--color-chrome-ink-faint)";
  const pulses =
    tier === "fresh" ||
    tier === "stale" ||
    tier === "listening" ||
    tier === "retuning" ||
    tier === "warming";
  const detail = status.showRate
    ? `${mps.toFixed(0)} msg/s`
    : (status.detail ?? null);
  const title = detail ? `${status.label} · ${detail}` : status.label;
  const pulseStyle = {
    "--feed-pulse-color": tone,
    backgroundColor: tone,
  } as CSSProperties;
  const className =
    variant === "hud"
      ? "liquid-glass flex h-8 items-center gap-2 rounded-[6px] px-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] transition-colors duration-150"
      : "px-3.5 flex items-center gap-2 h-full border-r border-chrome-line uppercase tracking-[0.08em] text-[10px] font-medium transition-colors duration-150";
  return (
    <div
      className={className}
      data-feed-state={tier}
      style={{ color: tone }}
      title={title}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${pulses ? "animate-livepulse" : ""}`}
        style={pulseStyle}
      />
      <span>{status.label}</span>
      {detail && (
        <span className="text-chrome-ink-soft font-normal normal-case tracking-normal tabular-nums">
          · {detail}
        </span>
      )}
    </div>
  );
}

function Cell({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="px-3.5 flex items-center gap-1.5 h-full border-r border-chrome-line">
      <span className="uppercase tracking-[0.08em] text-[9.5px] text-chrome-ink-faint">
        {k}
      </span>
      <span
        className={`tabular-nums ${warn ? "text-(--color-warn)" : "text-chrome-ink"}`}
      >
        {v}
      </span>
    </div>
  );
}

function computeStrongPct(
  local: { accepted?: number[]; strong_signals?: number } | undefined | null,
): number | null {
  if (!local) return null;
  const accepted = Array.isArray(local.accepted)
    ? local.accepted[0]
    : undefined;
  const strong = local.strong_signals;
  if (
    typeof accepted !== "number" ||
    accepted <= 0 ||
    typeof strong !== "number"
  )
    return null;
  return (strong / accepted) * 100;
}

// readsb's outline.json wraps points under actualRange.last24h.points as
// [lat, lon, alt] triples; older shapes expose [lat, lon] pairs at the top
// level. Accept both and drop the altitude component.
function extractOutlinePoints(
  outline: OutlineJson | null,
): Array<[number, number]> {
  if (!outline) return [];
  const nested = outline.actualRange?.last24h?.points;
  const raw: ReadonlyArray<ReadonlyArray<number>> | undefined =
    nested ?? outline.points;
  if (!Array.isArray(raw)) return [];
  const out: Array<[number, number]> = [];
  for (const p of raw) {
    if (
      Array.isArray(p) &&
      typeof p[0] === "number" &&
      typeof p[1] === "number"
    ) {
      out.push([p[0], p[1]]);
    }
  }
  return out;
}

function computeMaxRangeNm(
  outline: OutlineJson | null,
  receiver: ReceiverJson | null,
  fallbackMeters: number | undefined,
): number | null {
  if (receiver) {
    const points = extractOutlinePoints(outline);
    let max = 0;
    for (const [lat, lon] of points) {
      const d = haversineNm(receiver.lat, receiver.lon, lat, lon);
      if (d > max) max = d;
    }
    if (max > 0) return max;
  }
  if (typeof fallbackMeters === "number" && fallbackMeters > 0) {
    return fallbackMeters / METERS_PER_NM;
  }
  return null;
}

function computeUptimeSec(stats: StatsJson | null): number | null {
  if (!stats) return null;
  const start = stats.total?.start;
  if (typeof start !== "number" || typeof stats.now !== "number") return null;
  const s = stats.now - start;
  return s > 0 ? s : null;
}

function formatUptime(totalSec: number): string {
  if (totalSec < 60) return `${Math.floor(totalSec)}s`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Sum per-subsystem CPU ms for the window and divide by window length.
function computeCpuPct(window: StatsWindowJson | undefined): number | null {
  if (
    !window?.cpu ||
    typeof window.start !== "number" ||
    typeof window.end !== "number"
  )
    return null;
  const windowMs = (window.end - window.start) * 1000;
  if (windowMs <= 0) return null;
  let totalMs = 0;
  for (const v of Object.values(window.cpu)) {
    if (typeof v === "number") totalMs += v;
  }
  return (totalMs / windowMs) * 100;
}

function formatSigned(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}${Math.abs(n).toFixed(1)}`;
}
