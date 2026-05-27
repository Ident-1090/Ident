import {
  Bell,
  BellOff,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  GripVertical,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  diagnosticIdentity,
  isStatusStatKey,
  type NotificationSuppression,
  type StatusStatKey,
  usePreferencesStore,
} from "../data/preferences";
import { relativeTimeAgo } from "../data/recency";
import { useIdentStore } from "../data/store";
import type { IdentBuildInfo, IdentDiagnostic } from "../data/types";
import { Tooltip } from "../ui/Tooltip";
import {
  type DiagnosticCell,
  useReceiverDiagnostics,
} from "./receiverDiagnostics";

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

export function StatusBar() {
  const { cells, hiddenCells, allCells, producerLabel, diagnostics } =
    useReceiverDiagnostics();
  const reorderStatusStat = usePreferencesStore((s) => s.reorderStatusStat);
  const valueWidths = useStickyStatusValueWidths(allCells);
  return (
    <footer
      data-tour="status"
      className="[grid-area:status] flex items-center gap-0 px-0 py-0 bg-(--color-chrome-bg) text-chrome-ink-soft font-mono text-[10.5px] whitespace-nowrap overflow-hidden"
    >
      <FeedStatusCell />
      {cells.map((c) => (
        <Cell
          key={c.id}
          cell={c}
          valueCh={valueWidths[c.id]}
          draggable
          onMove={reorderStatusStat}
        />
      ))}
      {allCells.length > 0 && (
        <StatusStatsMenu
          cells={allCells}
          visibleCells={cells}
          hiddenCells={hiddenCells}
        />
      )}
      <DiagnosticsCenter
        producerLabel={producerLabel}
        diagnostics={diagnostics}
      />
    </footer>
  );
}

function useStickyStatusValueWidths(
  cells: DiagnosticCell[],
): Partial<Record<StatusStatKey, number>> {
  const widthsRef = useRef<Partial<Record<StatusStatKey, number>>>({});
  return useMemo(() => {
    let changed = false;
    const next = { ...widthsRef.current };
    for (const cell of cells) {
      const width = cell.v.length;
      if ((next[cell.id] ?? 0) < width) {
        next[cell.id] = width;
        changed = true;
      }
    }
    if (changed) widthsRef.current = next;
    return widthsRef.current;
  }, [cells]);
}

export function FeedStatusCell({
  variant = "bar",
}: {
  variant?: "bar" | "hud";
}) {
  const live = useLiveStatus();
  const mpsBuffer = useIdentStore((s) => s.liveState.mpsBuffer);
  const mpsCurrent = mpsBuffer.length > 0 ? mpsBuffer[mpsBuffer.length - 1] : 0;
  const mpsValueCh = useStickyLiveMpsWidth(live.showRate ? mpsCurrent : null);
  return (
    <LiveCell
      status={live}
      mps={mpsCurrent}
      mpsValueCh={mpsValueCh}
      variant={variant}
    />
  );
}

function useStickyLiveMpsWidth(mps: number | null): number | undefined {
  const widthRef = useRef(0);
  return useMemo(() => {
    if (mps == null) return widthRef.current || undefined;
    widthRef.current = Math.max(widthRef.current, mps.toFixed(0).length);
    return widthRef.current || undefined;
  }, [mps]);
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
  mpsValueCh,
  variant,
}: {
  status: LiveStatus;
  mps: number;
  mpsValueCh?: number;
  variant: "bar" | "hud";
}) {
  const { tier } = status;
  const tone = LIVE_TONE[tier];
  const pulses = PULSING_LIVE_TIERS.has(tier);
  const mpsLabel = mps.toFixed(0);
  const detail = status.showRate
    ? `${mpsLabel} msg/s`
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
          ·{" "}
          {status.showRate ? (
            <>
              <span
                data-live-mps-value
                style={mpsValueCh ? { minWidth: `${mpsValueCh}ch` } : undefined}
                className="inline-block text-right"
              >
                {mpsLabel}
              </span>{" "}
              msg/s
            </>
          ) : (
            detail
          )}
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
  cell,
  valueCh,
  draggable = false,
  onMove,
}: {
  cell: DiagnosticCell;
  valueCh?: number;
  draggable?: boolean;
  onMove?: (source: StatusStatKey, target: StatusStatKey) => void;
}) {
  const { id, k, v, title, warn } = cell;
  function onDragStart(event: DragEvent<HTMLElement>) {
    if (!draggable) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }
  function onDragOver(event: DragEvent<HTMLElement>) {
    if (!draggable) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }
  function onDrop(event: DragEvent<HTMLElement>) {
    if (!draggable) return;
    event.preventDefault();
    const source = event.dataTransfer.getData("text/plain");
    if (isStatusStatKey(source)) onMove?.(source, id);
  }
  const node = (
    <button
      type="button"
      data-status-cell={k}
      data-status-stat={id}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      aria-label={draggable ? `Move ${k}` : undefined}
      className={`px-3.5 flex items-center gap-1.5 h-full border-r border-chrome-line bg-transparent ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      <span className="uppercase tracking-[0.08em] text-[9.5px] text-chrome-ink-faint">
        {k}
      </span>
      <span
        data-status-stat-value={id}
        style={valueCh ? { minWidth: `${valueCh}ch` } : undefined}
        className={`tabular-nums ${warn ? "text-(--color-warn)" : "text-chrome-ink"}`}
      >
        {v}
      </span>
    </button>
  );
  if (!title) return node;
  return (
    <Tooltip label={title} side="top">
      {node}
    </Tooltip>
  );
}

function StatusStatsMenu({
  cells,
  visibleCells,
  hiddenCells,
}: {
  cells: DiagnosticCell[];
  visibleCells: DiagnosticCell[];
  hiddenCells: DiagnosticCell[];
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelStyle = useStatusPopoverPosition(open, buttonRef, 280);
  const reorderStatusStat = usePreferencesStore((s) => s.reorderStatusStat);
  const setStatusStatHidden = usePreferencesStore((s) => s.setStatusStatHidden);
  const hiddenCount = hiddenCells.length;

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

  const button = (
    <button
      ref={buttonRef}
      type="button"
      data-testid="status-stats-menu-button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label="Stats"
      onClick={() => setOpen((value) => !value)}
      className="flex h-full items-center gap-1.5 px-2.5 text-chrome-ink-soft hover:bg-paper-2 hover:text-(--color-ink) focus-visible:outline focus-visible:outline-1 focus-visible:outline-(--color-accent)"
    >
      <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
      {hiddenCount > 0 && (
        <span className="tabular-nums text-[9.5px] text-current">
          +{hiddenCount}
        </span>
      )}
    </button>
  );

  return (
    <div className="relative h-full border-r border-chrome-line">
      {open ? (
        button
      ) : (
        <Tooltip
          label="Stats"
          side="top"
          className="relative inline-grid h-full"
        >
          {button}
        </Tooltip>
      )}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Stats"
          data-testid="status-stats-panel"
          style={panelStyle}
          className="fixed z-[62] w-[min(280px,calc(100vw-24px))] border border-(--color-line-strong) bg-paper shadow-2 font-mono text-[11px] text-(--color-ink)"
        >
          <div className="border-b border-(--color-line) px-3 py-2 uppercase tracking-[0.08em]">
            Stats
          </div>
          <ul className="max-h-[260px] overflow-y-auto">
            {cells.map((cell) => (
              <StatusStatsMenuRow
                key={cell.id}
                cell={cell}
                hidden={hiddenCells.some((hidden) => hidden.id === cell.id)}
                canHide={visibleCells.length > 1}
                onMove={reorderStatusStat}
                onHiddenChange={setStatusStatHidden}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatusStatsMenuRow({
  cell,
  hidden,
  canHide,
  onMove,
  onHiddenChange,
}: {
  cell: DiagnosticCell;
  hidden: boolean;
  canHide: boolean;
  onMove: (source: StatusStatKey, target: StatusStatKey) => void;
  onHiddenChange: (key: StatusStatKey, hidden: boolean) => void;
}) {
  function onDragStart(event: DragEvent<HTMLElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", cell.id);
  }
  function onDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }
  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const source = event.dataTransfer.getData("text/plain");
    if (isStatusStatKey(source)) onMove(source, cell.id);
  }
  return (
    <li
      draggable
      data-status-stat-row={cell.id}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`flex h-9 items-center gap-2 border-b border-(--color-line) px-2 last:border-b-0 ${
        hidden ? "text-ink-faint" : "text-(--color-ink)"
      }`}
    >
      <GripVertical className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
      <div className="min-w-0 flex-1">
        <div className="truncate uppercase tracking-[0.08em]">{cell.k}</div>
        <div className="truncate text-ink-faint">{cell.v}</div>
      </div>
      <Tooltip label={hidden ? "Show stat" : "Hide stat"} side="top">
        <button
          type="button"
          aria-label={hidden ? `Show ${cell.k}` : `Hide ${cell.k}`}
          disabled={!hidden && !canHide}
          onClick={() => onHiddenChange(cell.id, !hidden)}
          className="grid h-7 w-7 place-items-center text-ink-faint hover:bg-paper-2 hover:text-(--color-ink) disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-ink-faint"
        >
          {hidden ? (
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </Tooltip>
    </li>
  );
}

function useStatusPopoverPosition(
  open: boolean,
  buttonRef: RefObject<HTMLButtonElement | null>,
  widthPx: number,
): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useEffect(() => {
    if (!open) return;
    function place() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const gap = 14;
      const left = Math.min(
        Math.max(margin, rect.left),
        Math.max(margin, window.innerWidth - widthPx - margin),
      );
      setStyle({
        left,
        top: rect.top - gap,
        transform: "translateY(-100%)",
      });
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [buttonRef, open, widthPx]);
  return style;
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
      ? "fixed right-14 top-3 z-[64] w-[min(360px,calc(100vw-72px))] whitespace-normal border border-(--color-line-strong) bg-paper shadow-2 font-mono text-[11px] text-(--color-ink)"
      : "fixed right-2 bottom-12 z-[64] w-[min(360px,calc(100vw-16px))] whitespace-normal border border-(--color-line-strong) bg-paper shadow-2 font-mono text-[11px] text-(--color-ink)";
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
