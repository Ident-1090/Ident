import { Bell, BellOff, Check, Copy, ExternalLink, X } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { match, P } from "ts-pattern";
import { useFrontendDiagnosticsSnapshot } from "../data/frontendDiagnostics";
import {
  diagnosticIdentity,
  type NotificationSuppression,
  usePreferencesStore,
} from "../data/preferences";
import { relativeTimeAgo } from "../data/recency";
import { useIdentStore } from "../data/store";
import type {
  IdentBuildInfo,
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
type SuppressionState = "ignored" | "snoozed" | null;

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
  const backendDiagnostics = useIdentStore((s) => s.diagnostics);
  const frontendDiagnostics = useFrontendDiagnosticsSnapshot();
  // Merge backend + frontend diagnostics into one list sorted newest-first.
  // Frontend codes live under a `frontend.*` channel namespace so identity
  // collisions with backend codes are impossible — straight concat is safe.
  const diagnostics = useMemo(
    () =>
      [...backendDiagnostics, ...frontendDiagnostics].sort(
        (a, b) => b.seenAtEpochMs - a.seenAtEpochMs,
      ),
    [backendDiagnostics, frontendDiagnostics],
  );

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

  const capabilitiesEnvelope = useIdentStore((s) => s.capabilities);
  const producerKind = capabilitiesEnvelope?.producer?.kind ?? "unknown";
  const producerVer = capabilitiesEnvelope?.producer?.version
    ?.trim()
    .split(/\s+/)[0];
  const producerLabel = producerVer
    ? `${producerKind} ${producerVer}`
    : producerKind;

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
  return { cells, producerLabel, diagnostics };
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

export function DiagnosticsCenter({
  producerLabel,
  diagnostics,
  variant = "status",
}: {
  producerLabel: string;
  diagnostics: IdentDiagnostic[];
  variant?: "status" | "mobile";
}) {
  const [open, setOpen] = useState(false);
  const [closedPopupKey, setClosedPopupKey] = useState<string | null>(null);
  const [selectedDiagnosticKey, setSelectedDiagnosticKey] = useState<
    string | null
  >(null);
  const [showSuppressed, setShowSuppressed] = useState(false);
  const [copied, setCopied] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const notificationSuppressions = usePreferencesStore(
    (s) => s.notificationSuppressions,
  );
  const suppressNotification = usePreferencesStore(
    (s) => s.suppressNotification,
  );
  const clearNotificationSuppression = usePreferencesStore(
    (s) => s.clearNotificationSuppression,
  );
  const clearExpiredNotificationSuppressions = usePreferencesStore(
    (s) => s.clearExpiredNotificationSuppressions,
  );
  const capabilitiesEnvelope = useIdentStore((s) => s.capabilities);
  const identStatus = useIdentStore((s) => s.identStatus);
  const receiver = useIdentStore((s) => s.receiver);
  const config = useIdentStore((s) => s.config);
  const connectionStatus = useIdentStore((s) => s.connectionStatus);
  const replay = useIdentStore((s) => s.replay);
  const rows = diagnostics.map((diagnostic) => {
    const keyHash = diagnosticIdentity(diagnostic);
    const suppression = notificationSuppressionState(
      keyHash,
      notificationSuppressions,
    );
    return { diagnostic, keyHash, suppression };
  });
  const notifications = rows.filter((row) => row.suppression == null);
  const panelRows = showSuppressed ? rows : notifications;
  const counts = diagnosticCounts(
    notifications.map((notification) => notification.diagnostic),
  );
  const hasDiagnostics = notifications.length > 0;
  const label = hasDiagnostics ? diagnosticSummary(counts) : "DIAGNOSTICS";
  const tone = diagnosticToneClass(counts);
  const chromeClass =
    variant === "mobile"
      ? "relative"
      : "ml-auto h-full border-l border-chrome-line";
  const buttonClass =
    variant === "mobile"
      ? `liquid-glass grid h-11 w-11 place-items-center rounded-[6px] font-mono text-[10.5px] ${tone} cursor-pointer`
      : `flex h-full items-center gap-2 px-3.5 font-mono text-[10.5px] ${tone} hover:bg-paper-2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-(--color-accent)`;
  const panelClass =
    variant === "mobile"
      ? "fixed right-14 top-3 z-[65] max-h-[calc(100dvh-24px)] w-[min(420px,calc(100vw-72px))] overflow-hidden border border-(--color-line-strong) bg-paper shadow-2 font-mono text-[11px] text-(--color-ink)"
      : "fixed right-2 bottom-10 z-[65] w-[min(420px,calc(100vw-16px))] border border-(--color-line-strong) bg-paper shadow-2 font-mono text-[11px] text-(--color-ink)";
  const popupClass =
    variant === "mobile"
      ? "fixed right-14 top-3 z-[64] w-[min(360px,calc(100vw-72px))] border border-(--color-line-strong) bg-paper shadow-2 font-mono text-[11px] text-(--color-ink)"
      : "fixed right-2 bottom-12 z-[64] w-[min(360px,calc(100vw-16px))] border border-(--color-line-strong) bg-paper shadow-2 font-mono text-[11px] text-(--color-ink)";
  const popupNotification =
    open || notifications.length === 0
      ? null
      : notifications.find((row) => row.keyHash !== closedPopupKey);

  function suppressDiagnostic(
    diagnostic: IdentDiagnostic,
    mode: "snooze" | "ignore",
  ) {
    suppressNotification(diagnosticIdentity(diagnostic), mode);
  }

  function openDiagnostic(keyHash: string) {
    setSelectedDiagnosticKey(keyHash);
    setClosedPopupKey(keyHash);
    setOpen(true);
    if (highlightTimerRef.current != null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setSelectedDiagnosticKey(null);
      highlightTimerRef.current = null;
    }, 3000);
  }

  async function copyDiagnosticReport() {
    const report = {
      schema: "ident.diagnosticReport.v1",
      copiedAtEpochMs: Date.now(),
      ident: config.ident,
      producer: capabilitiesEnvelope?.producer ?? null,
      capabilities: capabilitiesEnvelope?.capabilities ?? null,
      status: identStatus,
      diagnostics,
      receiver,
      connectionStatus,
      replay: {
        enabled: replay.enabled,
        mode: replay.mode,
        availableFrom: replay.availableFrom,
        availableTo: replay.availableTo,
        blockSec: replay.blockSec,
        blockCount: replay.blocks.length,
      },
    };
    await navigator.clipboard?.writeText(JSON.stringify(report, null, 2));
    setCopied(true);
  }

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);

  useEffect(() => {
    clearExpiredNotificationSuppressions();
    const now = Date.now();
    const nextExpiry = notificationSuppressions.reduce<number | null>(
      (next, suppression) => {
        if (suppression.ignored) return next;
        const snoozedUntil = suppression.snoozedUntil;
        if (typeof snoozedUntil !== "number" || snoozedUntil <= now) {
          return next;
        }
        return next == null ? snoozedUntil : Math.min(next, snoozedUntil);
      },
      null,
    );
    if (nextExpiry == null) return;
    const delay = Math.min(Math.max(nextExpiry - now + 1000, 0), 2_147_483_647);
    const id = window.setTimeout(clearExpiredNotificationSuppressions, delay);
    return () => window.clearTimeout(id);
  }, [clearExpiredNotificationSuppressions, notificationSuppressions]);

  useEffect(
    () => () => {
      if (highlightTimerRef.current != null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    },
    [],
  );

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
    <div className={chromeClass}>
      <button
        ref={buttonRef}
        type="button"
        data-testid="diagnostics-center-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Open diagnostics"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onButtonKeyDown}
        className={buttonClass}
      >
        <Bell className="h-3.5 w-3.5" aria-hidden="true" />
        {variant === "status" && <span>{label}</span>}
        {variant === "mobile" && hasDiagnostics && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full border border-(--color-paper) bg-(--color-warn) px-1 text-[9px] font-semibold leading-none text-[#1b1e22]">
            {notifications.length}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Diagnostics"
          className={panelClass}
        >
          <div className="flex items-center justify-between gap-3 border-b border-(--color-line) px-3 py-2">
            <div className="min-w-0">
              <div className="uppercase tracking-[0.08em] text-(--color-ink)">
                Diagnostics
              </div>
              <div className="truncate text-ink-faint">
                {producerLabel} · {identBuildLabel(config.ident)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Tooltip
                label={showSuppressed ? "Hide ignored" : "Show ignored"}
                side="top"
              >
                <button
                  type="button"
                  aria-label={showSuppressed ? "Hide ignored" : "Show ignored"}
                  onClick={() => setShowSuppressed((value) => !value)}
                  className="grid h-7 w-7 place-items-center text-ink-faint hover:bg-paper-2 hover:text-(--color-ink) focus-visible:outline focus-visible:outline-1 focus-visible:outline-(--color-accent)"
                >
                  {showSuppressed ? (
                    <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              </Tooltip>
              <Tooltip
                label={copied ? "Copied" : "Copy diagnostics"}
                side="top"
              >
                <button
                  type="button"
                  aria-label="Copy diagnostics"
                  onClick={copyDiagnosticReport}
                  className={`grid h-7 w-7 place-items-center hover:bg-paper-2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-(--color-accent) ${
                    copied
                      ? "text-(--color-live)"
                      : "text-ink-faint hover:text-(--color-ink)"
                  }`}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              </Tooltip>
            </div>
          </div>
          {panelRows.length === 0 ? (
            <div className="px-3 py-3 text-ink-soft">No active diagnostics</div>
          ) : (
            <div className="max-h-72 overflow-auto py-1">
              {panelRows.map(({ diagnostic, keyHash, suppression }) => (
                <DiagnosticRow
                  key={keyHash}
                  keyHash={keyHash}
                  diagnostic={diagnostic}
                  highlighted={keyHash === selectedDiagnosticKey}
                  suppression={suppression}
                  onSuppress={suppressDiagnostic}
                  onRestore={clearNotificationSuppression}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {popupNotification && (
        <DiagnosticPopup
          diagnostic={popupNotification.diagnostic}
          onOpen={() => openDiagnostic(popupNotification.keyHash)}
          onClose={() => setClosedPopupKey(popupNotification.keyHash)}
          className={popupClass}
        />
      )}
    </div>
  );
}

function DiagnosticRow({
  keyHash,
  diagnostic,
  highlighted,
  suppression,
  onSuppress,
  onRestore,
}: {
  keyHash: string;
  diagnostic: IdentDiagnostic;
  highlighted: boolean;
  suppression: SuppressionState;
  onSuppress: (diagnostic: IdentDiagnostic, mode: "snooze" | "ignore") => void;
  onRestore: (keyHash: string) => void;
}) {
  return (
    <div
      data-diagnostic-key={keyHash}
      data-highlighted={highlighted ? "true" : "false"}
      className={`grid grid-cols-[72px_1fr] gap-x-3 border-b border-(--color-line-soft) px-3 py-2 last:border-b-0 transition-colors ${
        highlighted
          ? "animate-[diagnostic-highlight-fade_3s_ease-out_forwards]"
          : ""
      }`}
    >
      <span className={diagnosticSeverityClass(diagnostic.severity)}>
        {diagnostic.severity.toUpperCase()}
      </span>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <div className="truncate text-(--color-ink)">{diagnostic.code}</div>
          <div className="shrink-0 text-ink-faint text-xs">
            {relativeTimeAgo(diagnostic.seenAtEpochMs)}
          </div>
        </div>
        <div className="truncate text-ink-faint">{diagnostic.channel}</div>
        <div className="mt-1 whitespace-normal text-ink-soft">
          {diagnostic.message}
        </div>
        {suppression && (
          <div className="mt-1 text-ink-faint">
            {suppression === "ignored"
              ? "Ignored on this device"
              : "Snoozed on this device"}
          </div>
        )}
        {suppression ? (
          <button
            type="button"
            className="mt-2 h-7 border border-(--color-line-strong) bg-paper px-2 text-ink-soft hover:bg-paper-2 hover:text-(--color-ink)"
            onClick={() => onRestore(keyHash)}
          >
            Restore notifications
          </button>
        ) : (
          <DiagnosticActions diagnostic={diagnostic} onSuppress={onSuppress} />
        )}
      </div>
    </div>
  );
}

function DiagnosticPopup({
  diagnostic,
  onOpen,
  onClose,
  className,
}: {
  diagnostic: IdentDiagnostic;
  onOpen: () => void;
  onClose: () => void;
  className: string;
}) {
  return (
    <div
      aria-live="polite"
      data-testid="notification-popup"
      className={className}
    >
      <div className="px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            aria-label="Open diagnostic details"
            onClick={onOpen}
            className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-(--color-accent)"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className={diagnosticSeverityClass(diagnostic.severity)}>
                {diagnostic.severity.toUpperCase()}
              </div>
              <div className="shrink-0 text-ink-faint text-xs">
                {relativeTimeAgo(diagnostic.seenAtEpochMs)}
              </div>
            </div>
            <div className="mt-1 text-(--color-ink)">{diagnostic.message}</div>
            <div className="mt-1 truncate text-ink-faint">
              {diagnostic.code}
            </div>
          </button>
          <button
            type="button"
            aria-label="Close notification"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className="grid h-6 w-6 shrink-0 place-items-center text-ink-faint hover:bg-paper-2 hover:text-(--color-ink)"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        {diagnostic.action && (
          <a
            href={diagnostic.action.url}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="mt-2 inline-flex h-7 items-center gap-1.5 border border-(--color-line-strong) px-2 text-(--color-ink) hover:bg-paper-2"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            {diagnostic.action.label.trim() || "Open"}
          </a>
        )}
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
      {diagnostic.action && (
        <a
          href={diagnostic.action.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-7 items-center gap-1.5 border border-(--color-line-strong) bg-paper px-2 text-(--color-ink) hover:bg-paper-2"
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          {diagnostic.action.label.trim() || "Open"}
        </a>
      )}
      <button
        type="button"
        className="h-7 border border-(--color-line-strong) bg-paper px-2 text-ink-soft hover:bg-paper-2 hover:text-(--color-ink)"
        onClick={() => onSuppress(diagnostic, "snooze")}
      >
        Snooze 7 days
      </button>
      <button
        type="button"
        className="h-7 border border-(--color-line-strong) bg-paper px-2 text-ink-soft hover:bg-paper-2 hover:text-(--color-ink)"
        onClick={() => onSuppress(diagnostic, "ignore")}
      >
        Ignore on this device
      </button>
    </div>
  );
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

function notificationSuppressionState(
  keyHash: string,
  suppressions: NotificationSuppression[],
  now = Date.now(),
): SuppressionState {
  const trimmed = keyHash.trim();
  if (!trimmed) return null;
  const suppression = suppressions.find((item) => item.keyHash === trimmed);
  if (!suppression) return null;
  if (suppression.ignored) return "ignored";
  return typeof suppression.snoozedUntil === "number" &&
    suppression.snoozedUntil > now
    ? "snoozed"
    : null;
}

function identBuildLabel(ident: IdentBuildInfo | null): string {
  const shortCommit = ident?.shortCommit?.trim();
  if (shortCommit) return `Ident ${shortCommit}`;
  const version = ident?.version?.trim();
  return version ? `Ident ${version}` : "Ident unknown";
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
