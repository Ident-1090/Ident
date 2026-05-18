import { Bell, ExternalLink } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { match, P } from "ts-pattern";
import {
  isNotificationSuppressed,
  notificationKeyHash,
  usePreferencesStore,
} from "../data/preferences";
import { useIdentStore } from "../data/store";
import type {
  IdentDiagnostic,
  IdentStatusValue,
  IdentUnavailableReason,
} from "../data/types";
import { Tooltip } from "../ui/Tooltip";

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
const LIVE_TONE: Record<LiveTier, string> = {
  warming: "var(--color-accent)",
  listening: "var(--color-accent)",
  retuning: "var(--color-warn)",
  fresh: "var(--color-live)",
  stale: "var(--color-warn)",
  dead: "var(--color-emerg)",
  offline: "var(--color-chrome-ink-faint)",
};
const PULSING_LIVE_TIERS = new Set<LiveTier>([
  "fresh",
  "stale",
  "listening",
  "retuning",
  "warming",
]);

function presentStatusValue<TValue, TSource extends string>(
  value: IdentStatusValue<TValue, TSource> | undefined,
): TValue | null {
  return match(value)
    .with(P.nullish, () => null)
    .with({ kind: "unavailable" }, () => null)
    .with({ kind: "producer_provided" }, (v) => v.value)
    .with({ kind: "ident_derived" }, (v) => v.value)
    .exhaustive();
}

function unavailableStatusReason<TValue, TSource extends string>(
  value: IdentStatusValue<TValue, TSource> | undefined,
): IdentUnavailableReason | null {
  return match(value)
    .with({ kind: "unavailable" }, (v) => v.reason)
    .otherwise(() => null);
}

const UNAVAILABLE_REASON_LABEL: Record<IdentUnavailableReason, string> = {
  awaiting_classification: "Awaiting upstream classification",
  awaiting_second_sample: "Awaiting second counter sample",
  clock_not_advanced: "Counter timestamp did not advance",
  counter_reset: "Counter reset",
  malformed_file: "Malformed upstream file",
  not_provided_by_producer: "Not provided by upstream",
  producer_changed: "Upstream producer changed",
  stale_sample: "Counter sample is stale",
};

function unavailableTitle(
  reason: IdentUnavailableReason | null,
): string | undefined {
  return reason == null ? undefined : UNAVAILABLE_REASON_LABEL[reason];
}

function formatFeedAge(ageMs: number): string {
  return `${Math.max(0, Math.round(ageMs / 1000))}s old`;
}

function formatRetryDelay(
  nextRetryAt: number | undefined,
  now: number,
): string | null {
  if (typeof nextRetryAt !== "number") return null;
  const remainingMs = nextRetryAt - now;
  if (remainingMs <= 1000) return null;
  return `retrying in ${Math.ceil(remainingMs / 1000)}s`;
}

export interface DiagnosticCell {
  k: string;
  v: string;
  title?: string;
  warn?: boolean;
}

export interface ReceiverDiagnostics {
  cells: DiagnosticCell[];
  producerLabel: string;
  diagnostics: IdentDiagnostic[];
}

export function useReceiverDiagnostics(): ReceiverDiagnostics {
  const identStatus = useIdentStore((s) => s.identStatus);
  const capabilities = useIdentStore((s) => s.capabilities?.capabilities);

  const normalizedGain = presentStatusValue(identStatus?.gain)?.db ?? null;
  const gainLabel =
    normalizedGain != null ? `${normalizedGain.toFixed(1)} dB` : "—";
  const gainTitle = unavailableTitle(
    unavailableStatusReason(identStatus?.gain),
  );

  const normalizedUptimeSec =
    presentStatusValue(identStatus?.uptime)?.sec ?? null;
  const uptimeLabel =
    normalizedUptimeSec != null ? formatUptime(normalizedUptimeSec) : "—";
  const uptimeTitle = unavailableTitle(
    unavailableStatusReason(identStatus?.uptime),
  );

  const normalizedMaxRange = presentStatusValue(identStatus?.maxRange);
  const rangeLabel =
    normalizedMaxRange?.scope === "last24h" ? "24h Range" : "Max Range";
  const rangeValue =
    normalizedMaxRange != null ? `${normalizedMaxRange.nm.toFixed(0)} NM` : "—";
  const rangeTitle = unavailableTitle(
    unavailableStatusReason(identStatus?.maxRange),
  );

  const producerKind = identStatus?.producer.kind ?? "unknown";
  const producerVer = identStatus?.producer.version?.trim().split(/\s+/)[0];
  const producerLabel = producerVer
    ? `${producerKind} ${producerVer} · 10 MHz ES`
    : `${producerKind} · 10 MHz ES`;

  const cells: DiagnosticCell[] = [];
  if (capabilities?.gain !== "unavailable") {
    cells.push({ k: "Gain", v: gainLabel, title: gainTitle });
  }
  if (capabilities?.uptime !== "unavailable") {
    cells.push({ k: "Uptime", v: uptimeLabel, title: uptimeTitle });
  }
  if (capabilities?.maxRange !== "unavailable") {
    cells.push({ k: rangeLabel, v: rangeValue, title: rangeTitle });
  }
  return { cells, producerLabel, diagnostics: identStatus?.diagnostics ?? [] };
}

export function StatusBar() {
  const { cells, producerLabel, diagnostics } = useReceiverDiagnostics();
  return (
    <footer className="[grid-area:status] flex items-center gap-0 px-0 py-0 bg-(--color-chrome-bg) text-chrome-ink-soft font-mono text-[10.5px] whitespace-nowrap overflow-hidden">
      <FeedStatusCell />
      {cells.map((c) => (
        <Cell key={c.k} k={c.k} title={c.title} v={c.v} warn={c.warn} />
      ))}
      <DiagnosticsCenter
        producerLabel={producerLabel}
        diagnostics={diagnostics}
      />
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
  const wsInfo = statusInfo.ws;
  const wsRetry = wsInfo?.isRetry === true;
  const retryDetail = formatRetryDelay(wsInfo?.nextRetryAt, now);
  const transportStatuses = Object.values(status);
  const hasTransportStatus = transportStatuses.length > 0;
  if (lastMsgTs === 0) {
    if (wsStatus === "connecting" && wsRetry) {
      return {
        tier: "retuning",
        label: "Retuning feed",
        detail: retryDetail ?? undefined,
        showRate: false,
      };
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
    if (wsStatus === "closed") {
      return { tier: "offline", label: "Offline", showRate: false };
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
  const tone = LIVE_TONE[tier];
  const pulses = PULSING_LIVE_TIERS.has(tier);
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
  const node = (
    <div className={className} data-feed-state={tier} style={{ color: tone }}>
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
  return (
    <Tooltip label={title} side={variant === "hud" ? "top" : "top"}>
      {node}
    </Tooltip>
  );
}

function Cell({
  k,
  v,
  title,
  warn,
}: {
  k: string;
  v: string;
  title?: string;
  warn?: boolean;
}) {
  const node = (
    <div
      data-status-cell={k}
      className="px-3.5 flex items-center gap-1.5 h-full border-r border-chrome-line"
    >
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
  if (!title) return node;
  return (
    <Tooltip label={title} side="top">
      {node}
    </Tooltip>
  );
}

function DiagnosticsCenter({
  producerLabel,
  diagnostics,
}: {
  producerLabel: string;
  diagnostics: IdentDiagnostic[];
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const notificationSuppressions = usePreferencesStore(
    (s) => s.notificationSuppressions,
  );
  const suppressNotification = usePreferencesStore(
    (s) => s.suppressNotification,
  );
  const notifications = diagnostics.filter((diagnostic) => {
    const keyHash = notificationKeyHash(diagnosticIdentity(diagnostic));
    return !isNotificationSuppressed(keyHash, notificationSuppressions);
  });
  const counts = diagnosticCounts(notifications);
  const hasDiagnostics = notifications.length > 0;
  const label = hasDiagnostics ? diagnosticSummary(counts) : producerLabel;
  const tone = diagnosticToneClass(counts);
  const popupNotification = open ? null : notifications[0];

  function suppressDiagnostic(
    diagnostic: IdentDiagnostic,
    mode: "snooze" | "ignore",
  ) {
    suppressNotification(
      notificationKeyHash(diagnosticIdentity(diagnostic)),
      mode,
    );
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        buttonRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") setOpen(false);
  }

  return (
    <div className="ml-auto h-full border-l border-chrome-line">
      <button
        ref={buttonRef}
        type="button"
        data-testid="diagnostics-center-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onButtonKeyDown}
        className={`flex h-full items-center gap-2 px-3.5 font-mono text-[10.5px] ${tone} hover:bg-paper-2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-(--color-accent)`}
      >
        <Bell className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{label}</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Diagnostics"
          className="fixed right-2 bottom-8 z-[65] w-[min(420px,calc(100vw-16px))] border border-chrome-line bg-(--color-chrome-bg) shadow-lg font-mono text-[11px] text-chrome-ink"
        >
          <div className="flex items-center justify-between border-b border-chrome-line px-3 py-2">
            <span className="uppercase tracking-[0.08em] text-chrome-ink">
              Diagnostics
            </span>
            <span className="text-chrome-ink-faint">{producerLabel}</span>
          </div>
          {notifications.length === 0 ? (
            <div className="px-3 py-3 text-chrome-ink-soft">
              No active diagnostics
            </div>
          ) : (
            <div className="max-h-72 overflow-auto py-1">
              {notifications.map((diagnostic) => (
                <DiagnosticRow
                  key={diagnosticIdentity(diagnostic)}
                  diagnostic={diagnostic}
                  onSuppress={suppressDiagnostic}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {popupNotification && (
        <DiagnosticPopup
          diagnostic={popupNotification}
          onSuppress={suppressDiagnostic}
        />
      )}
    </div>
  );
}

function DiagnosticRow({
  diagnostic,
  onSuppress,
}: {
  diagnostic: IdentDiagnostic;
  onSuppress: (diagnostic: IdentDiagnostic, mode: "snooze" | "ignore") => void;
}) {
  return (
    <div className="grid grid-cols-[72px_1fr] gap-x-3 border-b border-chrome-line/60 px-3 py-2 last:border-b-0">
      <span className={diagnosticSeverityClass(diagnostic.severity)}>
        {diagnostic.severity.toUpperCase()}
      </span>
      <div className="min-w-0">
        <div className="truncate text-chrome-ink">{diagnostic.code}</div>
        <div className="truncate text-chrome-ink-faint">
          {diagnostic.channel}
        </div>
        <div className="mt-1 whitespace-normal text-chrome-ink-soft">
          {diagnostic.message}
        </div>
        <DiagnosticActions diagnostic={diagnostic} onSuppress={onSuppress} />
      </div>
    </div>
  );
}

function DiagnosticPopup({
  diagnostic,
  onSuppress,
}: {
  diagnostic: IdentDiagnostic;
  onSuppress: (diagnostic: IdentDiagnostic, mode: "snooze" | "ignore") => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="notification-popup"
      className="fixed right-2 bottom-10 z-[64] w-[min(360px,calc(100vw-16px))] border border-chrome-line bg-(--color-chrome-bg) shadow-lg font-mono text-[11px] text-chrome-ink"
    >
      <div className="border-b border-chrome-line px-3 py-2">
        <div className={diagnosticSeverityClass(diagnostic.severity)}>
          {diagnostic.severity.toUpperCase()}
        </div>
        <div className="mt-1 text-chrome-ink">{diagnostic.message}</div>
        <div className="mt-1 truncate text-chrome-ink-faint">
          {diagnostic.code}
        </div>
      </div>
      <div className="px-3 pb-3">
        <DiagnosticActions diagnostic={diagnostic} onSuppress={onSuppress} />
      </div>
    </div>
  );
}

function DiagnosticActions({
  diagnostic,
  onSuppress,
}: {
  diagnostic: IdentDiagnostic;
  onSuppress: (diagnostic: IdentDiagnostic, mode: "snooze" | "ignore") => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {diagnostic.actionUrl && (
        <a
          href={diagnostic.actionUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-7 items-center gap-1.5 border border-chrome-line px-2 text-chrome-ink hover:bg-paper-2"
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          {diagnostic.actionLabel?.trim() || "Open"}
        </a>
      )}
      <button
        type="button"
        className="h-7 border border-chrome-line px-2 text-chrome-ink-soft hover:bg-paper-2 hover:text-chrome-ink"
        onClick={() => onSuppress(diagnostic, "snooze")}
      >
        Snooze 7 days
      </button>
      <button
        type="button"
        className="h-7 border border-chrome-line px-2 text-chrome-ink-soft hover:bg-paper-2 hover:text-chrome-ink"
        onClick={() => onSuppress(diagnostic, "ignore")}
      >
        Ignore on this device
      </button>
    </div>
  );
}

function diagnosticIdentity(diagnostic: IdentDiagnostic): string {
  return [
    diagnostic.severity,
    diagnostic.channel,
    diagnostic.code,
    diagnostic.message,
    diagnostic.actionUrl ?? "",
  ].join("\u0000");
}

function diagnosticCounts(diagnostics: IdentDiagnostic[]): {
  error: number;
  warning: number;
  info: number;
} {
  let error = 0;
  let warning = 0;
  let info = 0;
  for (const { severity } of diagnostics) {
    if (severity === "error") error++;
    else if (severity === "warning") warning++;
    else info++;
  }
  return { error, warning, info };
}

function diagnosticSummary(counts: {
  error: number;
  warning: number;
  info: number;
}): string {
  const parts: string[] = [];
  if (counts.error > 0) parts.push(`${counts.error} ERR`);
  if (counts.warning > 0) parts.push(`${counts.warning} WARN`);
  if (counts.info > 0) parts.push(`${counts.info} INFO`);
  return parts.join(" · ");
}

function diagnosticToneClass(counts: {
  error: number;
  warning: number;
  info: number;
}): string {
  if (counts.error > 0) return "text-(--color-emerg)";
  if (counts.warning > 0) return "text-(--color-warn)";
  return "text-chrome-ink-faint";
}

function diagnosticSeverityClass(
  severity: IdentDiagnostic["severity"],
): string {
  if (severity === "error") return "text-(--color-emerg)";
  if (severity === "warning") return "text-(--color-warn)";
  return "text-chrome-ink-faint";
}

function formatUptime(totalSec: number): string {
  if (totalSec < 60) return `${Math.floor(totalSec)}s`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
