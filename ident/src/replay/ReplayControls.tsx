import { Pause, Play, Rewind, SkipBack, SkipForward } from "lucide-react";
import {
  type FormEvent,
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type ReplayRangeRecent,
  usePreferencesStore,
} from "../data/preferences";
import { ensureReplayRange } from "../data/replay";
import {
  getNow,
  type ReplayViewWindow,
  replayFollowsLiveEdge,
  useIdentStore,
} from "../data/store";
import type { ClockMode } from "../data/types";
import { Tooltip } from "../ui/Tooltip";

const PRELOAD_BEHIND_MS = 10 * 60 * 1000;
const PRELOAD_AHEAD_MS = 5 * 60 * 1000;
const PLAYBACK_PRELOAD_REALTIME_MS = 5 * 1000;
const JUMP_MS = 10 * 60 * 1000;
const DEFAULT_REPLAY_RANGE_MS = 8 * 60 * 60_000;
const DEFAULT_REPLAY_VIEW_WINDOW: ReplayViewWindow = {
  rangeId: "8h",
  rangeMs: DEFAULT_REPLAY_RANGE_MS,
  fromExpr: "now-8h",
  toExpr: "now",
  fixedEndMs: null,
};

const QUICK_RANGES = [
  { id: "6h", label: "Last 6 hours", expr: "now-6h", ms: 6 * 60 * 60_000 },
  { id: "8h", label: "Last 8 hours", expr: "now-8h", ms: 8 * 60 * 60_000 },
  {
    id: "24h",
    label: "Last 24 hours",
    expr: "now-24h",
    ms: 24 * 60 * 60_000,
  },
  {
    id: "7d",
    label: "Last 7 days",
    expr: "now-7d",
    ms: 7 * 24 * 60 * 60_000,
  },
  {
    id: "30d",
    label: "Last 30 days",
    expr: "now-30d",
    ms: 30 * 24 * 60 * 60_000,
  },
] as const;

type PickerQuickRange = {
  id: string;
  label: string;
  expr: string;
  ms: number;
  fromExpr?: string;
  toExpr?: string;
};

type ResolvedReplayWindow = {
  start: number;
  end: number;
  rangeMs: number;
  availableStart: number;
  availableEnd: number;
  isPastWindow: boolean;
  view: ReplayViewWindow;
};

export function ReplayRuntime() {
  const replay = useIdentStore((s) => s.replay);
  const setPlayhead = useIdentStore((s) => s.setReplayPlayhead);
  const goLive = useIdentStore((s) => s.goLive);
  const followingLiveEdge = replayFollowsLiveEdge(replay);
  const playbackActive =
    replay.mode === "replay" &&
    replay.playing &&
    replay.playheadMs != null &&
    !followingLiveEdge;

  useEffect(() => {
    if (followingLiveEdge && replay.loading) {
      useIdentStore.getState().setReplayLoading(false);
    }
  }, [followingLiveEdge, replay.loading]);

  useEffect(() => {
    if (
      followingLiveEdge ||
      replay.mode !== "replay" ||
      replay.playheadMs == null
    ) {
      return;
    }
    const aheadMs = replay.playing
      ? replay.speed * PLAYBACK_PRELOAD_REALTIME_MS
      : PRELOAD_AHEAD_MS;
    void ensureReplayRange(replay.playheadMs, replay.playheadMs);
    void ensureReplayRange(
      replay.playheadMs - PRELOAD_BEHIND_MS,
      replay.playheadMs + aheadMs,
      { background: true },
    );
  }, [
    followingLiveEdge,
    replay.mode,
    replay.playheadMs,
    replay.playing,
    replay.speed,
  ]);

  useEffect(() => {
    if (!playbackActive) return;
    let frameId = 0;
    let lastFrame = performance.now();
    const tick = (timestamp: DOMHighResTimeStamp) => {
      const st = useIdentStore.getState();
      if (
        st.replay.mode !== "replay" ||
        !st.replay.playing ||
        st.replay.playheadMs == null
      ) {
        return;
      }
      const elapsedMs = Math.max(0, timestamp - lastFrame);
      lastFrame = timestamp;
      const next = st.replay.playheadMs + elapsedMs * st.replay.speed;
      if (st.replay.availableTo != null && next >= st.replay.availableTo) {
        goLive();
        return;
      }
      setPlayhead(next);
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [goLive, playbackActive, setPlayhead]);

  return null;
}

export function DesktopReplayTransport() {
  const replay = useIdentStore((s) => s.replay);
  const enterReplay = useIdentStore((s) => s.enterReplay);
  const setPlaying = useIdentStore((s) => s.setReplayPlaying);
  const setSpeed = useIdentStore((s) => s.setReplaySpeed);
  const setPlayhead = useIdentStore((s) => s.setReplayPlayhead);

  if (
    !replay.enabled ||
    replay.availableFrom == null ||
    replay.availableTo == null
  ) {
    return null;
  }
  const replayActive = replay.mode === "replay";
  const presentingLive = replayActive && replayFollowsLiveEdge(replay);
  const active = replayActive && !presentingLive;
  const playhead = replayActive
    ? presentingLive
      ? replay.availableTo
      : (replay.playheadMs ?? replay.availableTo)
    : replay.availableTo;
  const liveEdge = replay.availableTo;
  return (
    <div className="flex items-center gap-2 shrink-0">
      <div
        data-testid="desktop-replay-transport"
        className="flex h-[22px] border border-(--color-line) rounded-[4px] overflow-hidden bg-paper"
      >
        <TransportButton
          label="Jump back 10 minutes"
          onClick={() =>
            replayActive
              ? setPlayhead(playhead - JUMP_MS)
              : enterReplay(liveEdge - JUMP_MS)
          }
        >
          <SkipBack size={12} aria-hidden="true" />
        </TransportButton>
        <TransportButton
          label={
            active
              ? replay.playing
                ? "Pause replay"
                : "Play replay"
              : "Pause live feed"
          }
          active={active}
          onClick={() => {
            if (!active) {
              enterReplay(liveEdge);
              return;
            }
            setPlaying(!replay.playing);
          }}
        >
          {!active || replay.playing ? (
            <Pause size={12} aria-hidden="true" />
          ) : (
            <Play size={12} aria-hidden="true" />
          )}
        </TransportButton>
        <TransportButton
          label="Jump forward 10 minutes"
          onClick={() =>
            replayActive
              ? setPlayhead(playhead + JUMP_MS)
              : enterReplay(liveEdge)
          }
        >
          <SkipForward size={12} aria-hidden="true" />
        </TransportButton>
      </div>
      {active && (
        <div className="flex h-[22px] border border-(--color-line) rounded-[4px] overflow-hidden bg-paper">
          {[1, 4, 16].map((speed) => (
            <button
              key={speed}
              type="button"
              onClick={() => setSpeed(speed as 1 | 4 | 16)}
              className={
                "min-w-8 px-2 font-mono text-[10px] font-semibold cursor-pointer border-0 border-r last:border-r-0 border-(--color-line) " +
                (replay.speed === speed
                  ? "bg-(--color-warn) text-bg"
                  : "bg-transparent text-ink-soft hover:text-(--color-ink)")
              }
            >
              {speed}×
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const ReplayScrubber = memo(function ReplayScrubber() {
  const enabled = useIdentStore((s) => s.replay.enabled);
  const availableFrom = useIdentStore((s) => s.replay.availableFrom);
  const availableTo = useIdentStore((s) => s.replay.availableTo);
  const mode = useIdentStore((s) => s.replay.mode);
  const playheadMs = useIdentStore((s) => s.replay.playheadMs);
  const playing = useIdentStore((s) => s.replay.playing);
  const viewWindow = useIdentStore((s) => s.replay.viewWindow);
  const followLiveEdge = useIdentStore((s) => s.replay.followLiveEdge);
  const replayError = useIdentStore((s) => s.replay.error);
  const clockMode = useIdentStore((s) => s.settings.clock);
  const wsStatus = useIdentStore((s) => s.connectionStatus.ws);
  const enterReplay = useIdentStore((s) => s.enterReplay);
  const setPlayhead = useIdentStore((s) => s.setReplayPlayhead);
  const setPlaying = useIdentStore((s) => s.setReplayPlaying);
  const setViewWindow = useIdentStore((s) => s.setReplayViewWindow);
  const goLive = useIdentStore((s) => s.goLive);
  const recents = usePreferencesStore((s) => s.replayRangeRecents);
  const setRecents = usePreferencesStore((s) => s.setReplayRangeRecents);
  const [pickerOpen, setPickerOpen] = useState(false);
  const active = mode === "replay";
  const hasWindow = enabled && availableFrom != null && availableTo != null;
  const replayWindow = hasWindow
    ? resolveReplayWindow({
        availableFrom,
        availableTo,
        viewWindow,
      })
    : null;
  const rawPlayhead = active
    ? replayFollowsLiveEdge({
        mode,
        playheadMs,
        availableTo,
        viewWindow,
        followLiveEdge,
      })
      ? (replayWindow?.end ?? availableTo ?? 0)
      : (playheadMs ?? availableTo ?? 0)
    : (replayWindow?.end ?? 0);
  const playhead =
    replayWindow != null
      ? clampNumber(rawPlayhead, replayWindow.start, replayWindow.end)
      : 0;
  const scrubber = useReplayScrubber({
    availableFrom: replayWindow?.start ?? 0,
    availableTo: replayWindow?.end ?? 0,
    playhead,
    mode,
    playing,
    canGoLiveAtEnd:
      replayWindow != null && replayWindow.view.fixedEndMs == null,
    enterReplay,
    setPlayhead,
    setPlaying,
    goLive,
  });
  if (!hasWindow) {
    if (wsStatus === "connecting") return <ReplayScrubberSkeleton />;
    return null;
  }
  if (!replayWindow) return null;
  const playheadVisible =
    active &&
    rawPlayhead >= scrubber.availableFrom &&
    rawPlayhead <= scrubber.availableTo;
  const playheadAtLiveEdge =
    playheadVisible &&
    !replayWindow.isPastWindow &&
    (followLiveEdge || scrubber.playhead >= scrubber.availableTo - 1);
  const startLabel = formatEndpointLabel(
    replayWindow.start,
    replayWindow.rangeMs,
    replayWindow.isPastWindow,
    clockMode,
  );
  const endLabel = replayWindow.isPastWindow
    ? formatEndpointLabel(
        replayWindow.end,
        replayWindow.rangeMs,
        true,
        clockMode,
      )
    : "NOW";
  const currentView = replayWindow.view;
  const chipLabel = replayWindow.isPastWindow
    ? formatRangeWidth(replayWindow.rangeMs)
    : `LAST ${formatRangeWidth(replayWindow.rangeMs)}`;
  const rangeExpr =
    currentView.toExpr === "now"
      ? currentView.fromExpr
      : `${currentView.fromExpr} -> ${currentView.toExpr}`;
  const displayChipLabel = replayError ? "ERROR" : chipLabel;
  const displayRangeExpr = replayError ?? rangeExpr;

  function pickQuickRange(range: PickerQuickRange): void {
    const startMs = Math.max(
      scrubber.availableFrom,
      scrubber.availableTo - range.ms,
    );
    const resume = mode === "replay" && playing;
    setViewWindow({
      rangeId: range.id,
      rangeMs: range.ms,
      fromExpr: range.expr,
      toExpr: "now",
      fixedEndMs: null,
    });
    enterReplay(startMs);
    if (resume) setPlaying(true);
    setPickerOpen(false);
  }

  function applyCustomRange(fromExpr: string, toExpr: string): void {
    const nowMs = getNow();
    const fromMs = resolveRangeExpression(fromExpr, nowMs);
    const toMs = resolveRangeExpression(toExpr, nowMs);
    if (fromMs == null || toMs == null || fromMs >= toMs) return;
    const fixedEndMs = toExpr.trim() === "now" ? null : toMs;
    setViewWindow({
      rangeId: "custom",
      rangeMs: toMs - fromMs,
      fromExpr,
      toExpr,
      fixedEndMs,
      requestedEndMs: toMs,
    });
    const resume = mode === "replay" && playing;
    enterReplay(fromMs);
    if (resume) setPlaying(true);
    setRecents(
      upsertRangeRecent(recents, {
        label: formatRangeWidth(toMs - fromMs),
        from: fromExpr,
        to: toExpr,
      }),
    );
    setPickerOpen(false);
  }

  function snapLive(): void {
    setViewWindow({
      ...currentView,
      fixedEndMs: null,
      requestedEndMs: null,
      toExpr: "now",
    });
    goLive();
  }

  return (
    <div
      data-testid="replay-scrubber"
      className="[grid-area:replay] hidden md:flex items-center gap-3 px-4 bg-paper-2 border-b border-(--color-line) font-mono text-[10.5px] text-ink-soft min-w-0"
    >
      <div className="relative shrink-0">
        <RangeChip
          label={displayChipLabel}
          expr={displayRangeExpr}
          open={pickerOpen}
          accent={active && !playheadAtLiveEdge}
          onClick={() => setPickerOpen((open) => !open)}
        />
        {pickerOpen && (
          <RangePicker
            selectedId={currentView.rangeId}
            fromExpr={currentView.fromExpr}
            toExpr={currentView.toExpr}
            availableFrom={availableFrom}
            availableTo={availableTo}
            recents={recents}
            onPickQuick={pickQuickRange}
            onApply={applyCustomRange}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
      <span
        data-testid="replay-start-label"
        className="shrink-0 min-w-[5.5ch] text-right text-[10px] tracking-[0.04em] text-ink-faint"
      >
        {startLabel}
      </span>
      <ReplayTrack
        variant="desktop"
        trackTestId="replay-scrubber-track"
        replayWindow={replayWindow}
        scrubber={scrubber}
        clockMode={clockMode}
        playheadVisible={playheadVisible}
        playheadAtLiveEdge={playheadAtLiveEdge}
        showTraversedFill={active && !playheadAtLiveEdge}
        showInactiveLiveHandle={!active && !replayWindow.isPastWindow}
        showTickLabels
      />
      <ReplayEndAffordance
        active={active}
        isPastWindow={replayWindow.isPastWindow}
        endLabel={endLabel}
        onLive={snapLive}
      />
    </div>
  );
});

function ReplayScrubberSkeleton() {
  return (
    <div
      data-testid="replay-scrubber-skeleton"
      className="[grid-area:replay] hidden md:flex items-center gap-3 px-4 bg-paper-2 border-b border-(--color-line) font-mono min-w-0"
    >
      <div className="h-[22px] w-23 rounded-[3px] border border-(--color-line) bg-paper animate-pulse" />
      <div className="h-2.5 w-12 rounded-[2px] bg-paper-3 animate-pulse" />
      <div className="relative h-[7px] flex-1 rounded-l-full rounded-r-[2px] border border-(--color-line) bg-paper-3 animate-pulse">
        <div className="absolute left-[18%] top-[-3px] bottom-[-3px] w-px bg-(--color-line)" />
        <div className="absolute left-[42%] top-[-4px] bottom-[-4px] w-px bg-ink-faint" />
        <div className="absolute left-[66%] top-[-3px] bottom-[-3px] w-px bg-(--color-line)" />
        <div className="absolute left-[84%] top-[-4px] bottom-[-4px] w-px bg-ink-faint" />
      </div>
      <div className="h-2.5 w-[7.5ch] rounded-[2px] bg-paper-3 animate-pulse" />
    </div>
  );
}

function ReplayTrack({
  variant,
  trackTestId,
  replayWindow,
  scrubber,
  clockMode,
  playheadVisible,
  playheadAtLiveEdge,
  showTraversedFill,
  showInactiveLiveHandle = false,
  showTickLabels = false,
}: {
  variant: "desktop" | "mobile";
  trackTestId: string;
  replayWindow: ResolvedReplayWindow;
  scrubber: ReturnType<typeof useReplayScrubber>;
  clockMode: ClockMode;
  playheadVisible: boolean;
  playheadAtLiveEdge: boolean;
  showTraversedFill: boolean;
  showInactiveLiveHandle?: boolean;
  showTickLabels?: boolean;
}) {
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const pct =
    ((scrubber.playhead - scrubber.availableFrom) /
      Math.max(1, scrubber.availableTo - scrubber.availableFrom)) *
    100;
  const clampedPct = clampNumber(pct, 0, 100);
  const cursorPct = scrubber.dragging ? clampedPct : hoverPct;
  const playheadToken = playheadAtLiveEdge
    ? "var(--color-live)"
    : "var(--color-warn)";
  const availableStartPct =
    ((replayWindow.availableStart - replayWindow.start) /
      Math.max(1, replayWindow.rangeMs)) *
    100;
  const availableEndPct =
    ((replayWindow.availableEnd - replayWindow.start) /
      Math.max(1, replayWindow.rangeMs)) *
    100;
  const fillStartPct = clampNumber(availableStartPct, 0, 100);
  const fillEndPct = clampNumber(
    Math.min(clampedPct, availableEndPct),
    fillStartPct,
    100,
  );
  const fillWidthPct = Math.max(0, fillEndPct - fillStartPct);
  const strategy = tickStrategy(replayWindow.rangeMs);
  const ticks = Array.from({ length: strategy.count }, (_, i) => {
    const left = (i / Math.max(1, strategy.count - 1)) * 100;
    return { i, left, key: left.toFixed(3) };
  });
  const trackClass =
    variant === "desktop"
      ? "relative h-[7px] flex-1 rounded-l-full rounded-r-[2px] border border-(--color-line) bg-paper-3 cursor-pointer"
      : "relative h-[7px] rounded-full border border-(--color-line) bg-[rgb(from_var(--color-paper)_r_g_b_/_0.24)]";
  const fillClass =
    variant === "desktop"
      ? "absolute left-[-1px] top-[-1px] bottom-[-1px] rounded-l-full rounded-r-none bg-[color-mix(in_oklab,var(--color-warn)_30%,transparent)]"
      : "absolute left-[-1px] top-[-1px] bottom-[-1px] rounded-full bg-[color-mix(in_oklab,var(--color-warn)_30%,transparent)]";
  const playheadClass =
    variant === "desktop"
      ? "absolute top-[-6px] bottom-[-6px] w-0.5 rounded-full pointer-events-none "
      : "absolute top-[-6px] bottom-[-6px] w-1 rounded-full pointer-events-none ";
  const inputClass =
    variant === "desktop"
      ? "absolute inset-y-[-8px] left-0 right-0 opacity-0 cursor-pointer"
      : "absolute inset-y-[-8px] left-0 right-0 w-full opacity-0 cursor-pointer";

  function handleTrackMove(ev: React.MouseEvent<HTMLInputElement>): void {
    const rect =
      ev.currentTarget.parentElement?.getBoundingClientRect() ??
      ev.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const next = ((ev.clientX - rect.left) / rect.width) * 100;
    setHoverPct(clampNumber(next, 0, 100));
  }

  return (
    <div data-testid={trackTestId} className={trackClass}>
      {showTraversedFill && (
        <div
          className={fillClass}
          style={{ left: `${fillStartPct}%`, width: `${fillWidthPct}%` }}
        />
      )}
      {ticks.map(({ i, left, key }) => {
        if (i === strategy.count - 1) return null;
        const major = i % strategy.majorEvery === 0;
        return (
          <span
            key={`${variant}-tick-${key}`}
            className={
              "absolute w-px pointer-events-none " +
              (major
                ? "top-[-4px] bottom-[-4px] bg-ink-faint"
                : "top-[-2px] bottom-[-2px] bg-(--color-line)")
            }
            style={{ left: `${left}%` }}
          />
        );
      })}
      {showTickLabels &&
        cursorPct != null &&
        ticks.map(({ i, left }) => {
          if (
            i % strategy.majorEvery !== 0 ||
            i === 0 ||
            i === strategy.count - 1
          ) {
            return null;
          }
          if (Math.abs(left - cursorPct) < 6) return null;
          const t =
            replayWindow.start +
            (replayWindow.rangeMs * i) / Math.max(1, strategy.count - 1);
          return (
            <span
              key={`${variant}-tick-label-${t}`}
              data-testid="replay-tick-label"
              className="absolute bottom-3.5 rounded-[2px] bg-(--color-ink) px-1.25 py-0.5 text-[9px] font-medium tracking-[0.04em] text-paper whitespace-nowrap pointer-events-none opacity-85"
              style={{
                left: `${left}%`,
                transform: "translateX(-50%)",
              }}
            >
              {formatTick(t, strategy.fmt, clockMode)}
            </span>
          );
        })}
      {cursorPct != null && (
        <>
          <span
            className="absolute top-[-8px] bottom-[-8px] w-px bg-(--color-warn) opacity-55 pointer-events-none"
            style={{ left: `${cursorPct}%` }}
          />
          <div
            data-testid="replay-cursor-label"
            className="absolute bottom-3.5 rounded-[3px] bg-(--color-warn) px-1.75 py-0.75 text-[10px] font-semibold tracking-[0.04em] text-bg whitespace-nowrap shadow-sm pointer-events-none"
            style={{
              left: `${cursorPct}%`,
              transform: "translateX(-50%)",
            }}
          >
            {formatCursorTime(
              replayWindow.start + (replayWindow.rangeMs * cursorPct) / 100,
              replayWindow.rangeMs,
              replayWindow.isPastWindow,
              clockMode,
            )}
            <span className="absolute left-1/2 bottom-[-3px] h-1.5 w-1.5 -translate-x-1/2 rotate-45 bg-(--color-warn)" />
          </div>
        </>
      )}
      {playheadVisible && (
        <div
          className={
            playheadClass +
            (playheadAtLiveEdge ? "bg-(--color-live)" : "bg-(--color-warn)")
          }
          style={{
            left: `${clampedPct}%`,
            transform: variant === "desktop" ? "translateX(-1px)" : undefined,
            boxShadow: `0 0 0 3px color-mix(in oklab, ${playheadToken} 24%, transparent)`,
          }}
        />
      )}
      {showInactiveLiveHandle && (
        <div
          data-testid="replay-live-handle"
          className="absolute top-[-6px] bottom-[-6px] w-0.5 rounded-full bg-(--color-live) pointer-events-none"
          style={{
            left: "100%",
            transform: "translateX(-2px)",
            boxShadow:
              "0 0 0 3px color-mix(in oklab, var(--color-live) 24%, transparent)",
          }}
        />
      )}
      <input
        aria-label="Replay time"
        type="range"
        min={scrubber.availableFrom}
        max={scrubber.availableTo}
        step={1000}
        defaultValue={scrubber.playhead}
        ref={scrubber.inputRef}
        onPointerDown={scrubber.onPointerDown}
        onPointerUp={scrubber.onPointerEnd}
        onPointerCancel={scrubber.onPointerEnd}
        onBlur={scrubber.onPointerEnd}
        onMouseMove={handleTrackMove}
        onMouseLeave={() => setHoverPct(null)}
        onChange={scrubber.onChange}
        className={inputClass}
      />
    </div>
  );
}

function RangeChip({
  label,
  expr,
  open,
  accent,
  surface = "paper",
  onClick,
}: {
  label: string;
  expr: string;
  open: boolean;
  accent: boolean;
  surface?: "paper" | "glass";
  onClick: () => void;
}) {
  const inactiveSurface =
    surface === "glass"
      ? "border-(--color-line) bg-[rgb(from_var(--color-paper)_r_g_b_/_0.24)] text-ink-soft"
      : "border-(--color-line) bg-paper-2 text-ink-soft";

  return (
    <button
      type="button"
      data-testid="replay-range-chip"
      aria-label="Change replay range"
      aria-expanded={open}
      title={`Replay window · ${expr}`}
      onClick={onClick}
      className={
        "inline-flex h-[22px] items-center gap-1.5 rounded-[3px] border px-2.5 pr-2 font-mono text-[10.5px] tracking-[0.06em] whitespace-nowrap cursor-pointer " +
        (accent
          ? "border-(--color-warn) bg-[color-mix(in_oklab,var(--color-warn)_14%,var(--color-paper-2))] text-(--color-warn)"
          : inactiveSurface)
      }
    >
      <span>{label}</span>
      <span aria-hidden="true" className="text-[10px] leading-none">
        ▾
      </span>
    </button>
  );
}

function RangePicker({
  selectedId,
  fromExpr,
  toExpr,
  availableFrom,
  availableTo,
  recents,
  onPickQuick,
  onApply,
  onClose,
  placement = "desktop",
}: {
  selectedId: string;
  fromExpr: string;
  toExpr: string;
  availableFrom: number;
  availableTo: number;
  recents: ReplayRangeRecent[];
  onPickQuick: (range: PickerQuickRange) => void;
  onApply: (from: string, to: string) => void;
  onClose: () => void;
  placement?: "desktop" | "mobile";
}) {
  const [from, setFrom] = useState(fromExpr);
  const [to, setTo] = useState(toExpr);
  const quickRanges = pickerQuickRanges(availableFrom, availableTo);
  const submitRange = (ev: FormEvent<HTMLFormElement>): void => {
    ev.preventDefault();
    onApply(from, to);
  };

  return (
    <div
      data-testid="replay-range-picker"
      role="dialog"
      aria-label="Replay time range"
      className={
        "absolute z-50 overflow-hidden rounded-[4px] border border-(--color-line) bg-paper text-(--color-ink) shadow-2xl " +
        (placement === "mobile"
          ? "left-0 right-0 bottom-[calc(100%_+_0.5rem)] w-auto max-h-[min(72dvh,calc(100dvh_-_var(--mobile-control-bottom)_-_10rem))] overflow-y-auto"
          : "top-[calc(100%+6px)] left-0 w-120")
      }
      onMouseDown={(ev) => ev.stopPropagation()}
    >
      <div className={placement === "mobile" ? "grid" : "grid grid-cols-2"}>
        <div className="border-r border-(--color-line) py-2.5">
          <div className="border-b border-line-soft px-3 pb-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">
            Quick ranges
          </div>
          <div className="grid">
            {quickRanges.map((range) => (
              <button
                key={range.id}
                type="button"
                aria-label={range.label}
                onClick={() => {
                  if (range.fromExpr && range.toExpr) {
                    setFrom(range.fromExpr);
                    setTo(range.toExpr);
                    return;
                  }
                  onPickQuick(range);
                }}
                className={
                  "flex items-center justify-between gap-3 border-0 border-l-2 px-3 py-1.75 text-left text-[12.5px] cursor-pointer hover:bg-paper-2 " +
                  (range.id === selectedId
                    ? "border-l-(--color-warn) bg-paper-2 text-(--color-ink)"
                    : "border-l-transparent bg-transparent text-ink-soft")
                }
              >
                <span>{range.label}</span>
                <span className="font-mono text-[10px] tracking-[0.04em] text-ink-faint">
                  {range.expr}
                </span>
              </button>
            ))}
          </div>
          {recents.length > 0 && (
            <>
              <div className="mt-1 border-t border-line-soft px-3 pb-1.5 pt-2.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">
                Recently used
              </div>
              <div className="grid">
                {recents.map((recent) => (
                  <button
                    key={`${recent.from}-${recent.to}`}
                    type="button"
                    onClick={() => onApply(recent.from, recent.to)}
                    className="flex items-center justify-between gap-3 border-0 bg-transparent px-3 py-1.25 font-mono text-[11px] text-ink-soft cursor-pointer hover:bg-paper-2"
                  >
                    <span>{recent.label}</span>
                    <span className="text-[10px] text-ink-faint">
                      {recent.from} -&gt; {recent.to}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <form className="p-3.5" onSubmit={submitRange}>
          <div className="mb-2.5 border-b border-line-soft pb-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">
            Absolute time range
          </div>
          <RangeField
            label="From"
            ariaLabel="Range from"
            value={from}
            placeholder="now-8h"
            onChange={setFrom}
            onEnter={() => onApply(from, to)}
          />
          <div className="h-2.5" />
          <RangeField
            label="To"
            ariaLabel="Range to"
            value={to}
            placeholder="now"
            onChange={setTo}
            onEnter={() => onApply(from, to)}
          />
          {placement !== "mobile" && (
            <div className="mt-3 rounded-[3px] border border-line-soft bg-paper-2 px-2.5 py-2 font-mono text-[10px] leading-normal text-ink-faint">
              <div className="mb-1 text-ink-soft">Accepted formats</div>
              <div>
                <code className="text-(--color-accent)">now</code> · current
                moment
              </div>
              <div>
                <code className="text-(--color-accent)">now-6h</code> · 6 hours
                ago
              </div>
              <div>
                <code className="text-(--color-accent)">now-2d/d</code> · start
                of day
              </div>
              <div>
                <code className="text-(--color-accent)">2025-04-22 14:30</code>{" "}
                · absolute
              </div>
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-[26px] rounded-sm border border-(--color-line) bg-paper px-3 text-[12px] font-medium text-ink-soft cursor-pointer hover:border-(--color-line-strong) hover:text-(--color-ink)"
            >
              Cancel
            </button>
            <button
              type="submit"
              aria-label="Apply"
              className="h-[26px] rounded-sm border border-(--color-accent) bg-(--color-accent) px-3 text-[12px] font-semibold text-bg cursor-pointer hover:border-(--color-blue-deep) hover:bg-(--color-blue-deep)"
            >
              Apply
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RangeField({
  label,
  ariaLabel,
  value,
  placeholder,
  onChange,
  onEnter,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onEnter: () => void;
}) {
  function handleKeyDown(ev: ReactKeyboardEvent<HTMLInputElement>): void {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    onEnter();
  }

  return (
    <label className="grid gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
        {label}
      </span>
      <input
        aria-label={ariaLabel}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(ev) => onChange(ev.currentTarget.value)}
        onKeyDown={handleKeyDown}
        className="h-7 w-full rounded-[3px] border border-(--color-line) bg-paper-2 px-2.25 font-mono text-[12px] text-(--color-ink) outline-none"
      />
    </label>
  );
}

function pickerQuickRanges(
  availableFrom: number,
  availableTo: number,
): PickerQuickRange[] {
  const maxRangeMs = availableTo - availableFrom;
  const bounded = QUICK_RANGES.filter((range) => range.ms <= maxRangeMs);
  if (maxRangeMs <= 0) return bounded;
  return [
    ...bounded,
    {
      id: "available",
      label: "Full range",
      expr: `${formatRangeWidth(maxRangeMs)} · ${absoluteRangeExpr(availableFrom, availableTo)}`,
      ms: maxRangeMs,
      fromExpr: formatPickerAbsoluteTime(availableFrom),
      toExpr: formatPickerAbsoluteTime(availableTo),
    },
  ];
}

function upsertRangeRecent(
  current: ReplayRangeRecent[],
  next: ReplayRangeRecent,
): ReplayRangeRecent[] {
  return [
    next,
    ...current.filter(
      (recent) => recent.from !== next.from || recent.to !== next.to,
    ),
  ].slice(0, 3);
}

function absoluteRangeExpr(fromMs: number, toMs: number): string {
  return `${formatPickerAbsoluteTime(fromMs)} -> ${formatPickerAbsoluteTime(toMs)}`;
}

function formatPickerAbsoluteTime(timestampMs: number): string {
  const d = new Date(timestampMs);
  return `${d.getUTCFullYear()}-${twoDigit(d.getUTCMonth() + 1)}-${twoDigit(d.getUTCDate())} ${twoDigit(d.getUTCHours())}:${twoDigit(d.getUTCMinutes())}`;
}

function ReplayEndAffordance({
  active,
  isPastWindow,
  endLabel,
  onLive,
}: {
  active: boolean;
  isPastWindow: boolean;
  endLabel: string;
  onLive: () => void;
}) {
  if (isPastWindow) {
    return (
      <div
        data-testid="replay-end-affordance"
        className="shrink-0 inline-flex items-center gap-2.5 pl-1"
      >
        <span className="font-mono text-[10px] tracking-[0.04em] text-ink-faint">
          {endLabel}
        </span>
        <button
          type="button"
          aria-label="Jump to now"
          title="Jump to now"
          onClick={onLive}
          className="border-0 bg-transparent p-0 font-mono text-[10px] font-normal tracking-[0.08em] text-ink-faint underline decoration-(--color-line) underline-offset-2 cursor-pointer"
        >
          NOW -&gt;
        </button>
      </div>
    );
  }
  if (active) {
    return (
      <button
        type="button"
        aria-label="Jump to now"
        title="Jump to now"
        onClick={onLive}
        data-testid="replay-end-affordance"
        className="inline-flex w-[7.5ch] shrink-0 items-center justify-end gap-1.5 border-0 bg-transparent p-0 font-mono text-[10.5px] font-normal tracking-[0.04em] text-ink-soft cursor-pointer"
      >
        NOW -&gt;
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-label="Jump to now"
      title="Jump to now"
      onClick={onLive}
      data-testid="replay-end-affordance"
      className="inline-flex w-[7.5ch] shrink-0 items-center justify-end gap-1.5 border-0 bg-transparent p-0 font-mono text-[10.5px] font-normal tracking-[0.04em] text-ink-soft cursor-pointer"
    >
      NOW -&gt;
    </button>
  );
}

function resolveReplayWindow({
  availableFrom,
  availableTo,
  viewWindow,
}: {
  availableFrom: number;
  availableTo: number;
  viewWindow: ReplayViewWindow | undefined;
}): ResolvedReplayWindow {
  const view = viewWindow ?? DEFAULT_REPLAY_VIEW_WINDOW;
  const requestedEnd = view.requestedEndMs ?? view.fixedEndMs ?? availableTo;
  const end =
    view.requestedEndMs != null
      ? requestedEnd
      : clampNumber(requestedEnd, availableFrom, availableTo);
  const start =
    view.requestedEndMs != null
      ? end - view.rangeMs
      : clampNumber(end - view.rangeMs, availableFrom, end);
  const availableStart = clampNumber(availableFrom, start, end);
  const availableEnd = clampNumber(availableTo, start, end);
  return {
    start,
    end,
    rangeMs: Math.max(1, end - start),
    availableStart,
    availableEnd,
    isPastWindow: end < availableTo - 1000,
    view,
  };
}

function resolveRangeExpression(expr: string, nowMs: number): number | null {
  const trimmed = expr.trim();
  if (trimmed === "now") return nowMs;
  const relative = /^now-(\d+(?:\.\d+)?)(m|h|d)(?:\/([mhd]))?$/.exec(trimmed);
  if (relative) {
    const amount = Number(relative[1]);
    if (!Number.isFinite(amount)) return null;
    const unitMs =
      relative[2] === "d"
        ? 24 * 60 * 60_000
        : relative[2] === "h"
          ? 60 * 60_000
          : 60_000;
    let value = nowMs - amount * unitMs;
    const snap = relative[3];
    if (snap === "d") {
      const d = new Date(value);
      d.setHours(0, 0, 0, 0);
      value = d.getTime();
    } else if (snap === "h") {
      const d = new Date(value);
      d.setMinutes(0, 0, 0);
      value = d.getTime();
    } else if (snap === "m") {
      const d = new Date(value);
      d.setSeconds(0, 0);
      value = d.getTime();
    }
    return value;
  }
  const absolute =
    /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/.exec(trimmed);
  if (!absolute) return null;
  const time = absolute[2] ?? "00:00:00";
  const value = Date.parse(
    `${absolute[1]}T${time.length === 5 ? `${time}:00` : time}`,
  );
  return Number.isFinite(value) ? value : null;
}

function tickStrategy(rangeMs: number): {
  count: number;
  majorEvery: number;
  fmt: "minute" | "halfhour" | "hour" | "day" | "dayonly";
} {
  const minutes = rangeMs / 60_000;
  const hours = minutes / 60;
  const days = hours / 24;
  if (minutes <= 15) return { count: 16, majorEvery: 4, fmt: "minute" };
  if (minutes <= 60) return { count: 13, majorEvery: 4, fmt: "minute" };
  if (hours <= 8) return { count: 17, majorEvery: 2, fmt: "halfhour" };
  if (hours <= 24) return { count: 25, majorEvery: 6, fmt: "hour" };
  if (days <= 7) return { count: 29, majorEvery: 4, fmt: "day" };
  return { count: 31, majorEvery: 5, fmt: "dayonly" };
}

function formatTick(
  timestampMs: number,
  fmt: ReturnType<typeof tickStrategy>["fmt"],
  clockMode: ClockMode,
): string {
  const d = new Date(timestampMs);
  const hh = twoDigit(clockMode === "utc" ? d.getUTCHours() : d.getHours());
  const mm = twoDigit(clockMode === "utc" ? d.getUTCMinutes() : d.getMinutes());
  if (fmt === "minute" || fmt === "halfhour" || fmt === "hour") {
    return `${hh}:${mm}`;
  }
  if (fmt === "day") {
    return `${weekdayShort(d, clockMode)} ${hh}:00`;
  }
  return monthDay(d, clockMode);
}

function formatEndpointLabel(
  timestampMs: number,
  rangeMs: number,
  isPastWindow: boolean,
  clockMode: ClockMode,
): string {
  const d = new Date(timestampMs);
  const hh = twoDigit(clockMode === "utc" ? d.getUTCHours() : d.getHours());
  const mm = twoDigit(clockMode === "utc" ? d.getUTCMinutes() : d.getMinutes());
  if (isPastWindow) {
    return `${monthDay(d, clockMode)} ${hh}:${mm}`;
  }
  if (rangeMs > 24 * 60 * 60_000) return monthDay(d, clockMode);
  return `${hh}:${mm}`;
}

function formatCursorTime(
  timestampMs: number,
  rangeMs: number,
  isPastWindow: boolean,
  clockMode: ClockMode,
): string {
  const d = new Date(timestampMs);
  const hh = twoDigit(clockMode === "utc" ? d.getUTCHours() : d.getHours());
  const mm = twoDigit(clockMode === "utc" ? d.getUTCMinutes() : d.getMinutes());
  const ss = twoDigit(clockMode === "utc" ? d.getUTCSeconds() : d.getSeconds());
  if (rangeMs > 24 * 60 * 60_000 || isPastWindow) {
    return `${monthDay(d, clockMode)} ${hh}:${mm}`;
  }
  if (rangeMs <= 60 * 60_000) return `${hh}:${mm}:${ss}`;
  return `${hh}:${mm}`;
}

function twoDigit(value: number): string {
  return String(value).padStart(2, "0");
}

function weekdayShort(d: Date, clockMode: ClockMode): string {
  return d
    .toLocaleString("en", {
      weekday: "short",
      timeZone: clockMode === "utc" ? "UTC" : undefined,
    })
    .toUpperCase();
}

function monthDay(d: Date, clockMode: ClockMode): string {
  return d
    .toLocaleString("en", {
      month: "short",
      day: "numeric",
      timeZone: clockMode === "utc" ? "UTC" : undefined,
    })
    .toUpperCase();
}

function formatRangeWidth(rangeMs: number): string {
  const minutes = rangeMs / 60_000;
  const hours = minutes / 60;
  const days = hours / 24;
  if (days >= 1) {
    const rounded = Math.round(days * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}D`;
  }
  if (hours >= 1) {
    const rounded = Math.round(hours * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}H`;
  }
  return `${Math.max(1, Math.round(minutes))}M`;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function TransportButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={
          "h-full min-w-9 px-2 grid place-items-center border-0 border-r last:border-r-0 border-(--color-line) cursor-pointer " +
          (active
            ? "text-(--color-warn) bg-transparent"
            : "text-ink-soft hover:text-(--color-ink)")
        }
      >
        {children}
      </button>
    </Tooltip>
  );
}

function MiniScrubber({
  startLabel,
  endLabel,
}: {
  startLabel?: string;
  endLabel?: string;
} = {}) {
  const replay = useIdentStore((s) => s.replay);
  const clockMode = useIdentStore((s) => s.settings.clock);
  const enterReplay = useIdentStore((s) => s.enterReplay);
  const setPlayhead = useIdentStore((s) => s.setReplayPlayhead);
  const setPlaying = useIdentStore((s) => s.setReplayPlaying);
  const goLive = useIdentStore((s) => s.goLive);
  const hasWindow = replay.availableFrom != null && replay.availableTo != null;
  const replayWindow = hasWindow
    ? resolveReplayWindow({
        availableFrom: replay.availableFrom ?? 0,
        availableTo: replay.availableTo ?? 0,
        viewWindow: replay.viewWindow,
      })
    : null;
  const playhead = clampNumber(
    replay.mode === "replay" && replay.playheadMs != null
      ? replay.playheadMs
      : (replayWindow?.end ?? replay.availableTo ?? 0),
    replayWindow?.start ?? 0,
    replayWindow?.end ?? 0,
  );
  const scrubber = useReplayScrubber({
    availableFrom: replayWindow?.start ?? 0,
    availableTo: replayWindow?.end ?? 0,
    playhead,
    mode: replay.mode,
    playing: replay.playing,
    canGoLiveAtEnd:
      replayWindow != null && replayWindow.view.fixedEndMs == null,
    enterReplay,
    setPlayhead,
    setPlaying,
    goLive,
  });
  if (!hasWindow || !replayWindow) return null;
  const rangeLabel = rewindRangeLabel(
    scrubber.availableTo - scrubber.availableFrom,
  );
  const leftLabel = startLabel ?? rangeLabel;
  const rightLabel = endLabel ?? (replay.mode === "live" ? "LIVE" : "NOW");
  const playheadAtLiveEdge =
    !replayWindow.isPastWindow && scrubber.playhead >= scrubber.availableTo - 1;
  return (
    <div className="grid gap-1">
      <ReplayTrack
        variant="mobile"
        trackTestId="mobile-replay-scrubber-track"
        replayWindow={replayWindow}
        scrubber={scrubber}
        clockMode={clockMode}
        playheadVisible
        playheadAtLiveEdge={playheadAtLiveEdge}
        showTraversedFill={!playheadAtLiveEdge}
      />
      <div className="flex justify-between font-mono text-[10px] text-ink-faint">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}

type ReplayScrubberState = {
  availableFrom: number;
  availableTo: number;
  playhead: number;
};

function useReplayScrubber({
  availableFrom,
  availableTo,
  playhead,
  mode,
  playing,
  canGoLiveAtEnd,
  enterReplay,
  setPlayhead,
  setPlaying,
  goLive,
}: {
  availableFrom: number;
  availableTo: number;
  playhead: number;
  mode: "live" | "replay";
  playing: boolean;
  canGoLiveAtEnd: boolean;
  enterReplay?: (playheadMs?: number) => void;
  setPlayhead: (playheadMs: number) => void;
  setPlaying: (playing: boolean) => void;
  goLive: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resumeAfterDragRef = useRef(false);
  const [drag, setDrag] = useState<ReplayScrubberState | null>(null);
  const domain = drag ?? { availableFrom, availableTo, playhead };

  useLayoutEffect(() => {
    if (drag || !inputRef.current) return;
    inputRef.current.value = String(playhead);
  }, [drag, playhead]);

  const commit = useCallback(
    (next: number, limit: number) => {
      if (next >= limit && canGoLiveAtEnd) {
        goLive();
      } else if (mode !== "replay" && enterReplay) {
        enterReplay(next);
      } else {
        setPlayhead(next);
      }
    },
    [canGoLiveAtEnd, enterReplay, goLive, mode, setPlayhead],
  );

  const finishDrag = useCallback(() => {
    setDrag(null);
    if (!resumeAfterDragRef.current) return;
    resumeAfterDragRef.current = false;
    setPlaying(true);
  }, [setPlaying]);

  const onPointerDown = useCallback(
    (ev: React.PointerEvent<HTMLInputElement>) => {
      const raw = ev.currentTarget.value.trim();
      const next = raw === "" ? Number.NaN : Number(raw);
      if (Number.isFinite(ev.pointerId)) {
        ev.currentTarget.setPointerCapture?.(ev.pointerId);
      }
      resumeAfterDragRef.current = playing;
      if (resumeAfterDragRef.current) setPlaying(false);
      setDrag({
        availableFrom,
        availableTo,
        playhead: Number.isFinite(next) ? next : playhead,
      });
    },
    [availableFrom, availableTo, playhead, playing, setPlaying],
  );

  const onChange = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      const raw = ev.currentTarget.value.trim();
      if (raw === "") return;
      const next = Number(raw);
      if (!Number.isFinite(next)) return;
      const limit = drag?.availableTo ?? availableTo;
      setDrag((current) =>
        current ? { ...current, playhead: next } : current,
      );
      commit(next, limit);
    },
    [availableTo, commit, drag?.availableTo],
  );

  return {
    inputRef,
    availableFrom: domain.availableFrom,
    availableTo: domain.availableTo,
    playhead: domain.playhead,
    dragging: drag != null,
    onPointerDown,
    onPointerEnd: finishDrag,
    onChange,
  };
}

export function MobileReplayFab({
  open = false,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const replay = useIdentStore((s) => s.replay);
  const goLive = useIdentStore((s) => s.goLive);
  if (!replay.enabled || replay.availableTo == null) return null;
  const active = replay.mode === "replay";
  function handleClick(): void {
    if (active) {
      goLive();
      onOpenChange?.(false);
      return;
    }
    onOpenChange?.(!open);
  }
  return (
    <button
      type="button"
      aria-label={active ? "Go live" : "Open replay"}
      onClick={handleClick}
      className={
        "liquid-glass w-11 h-11 grid place-items-center rounded-[6px] cursor-pointer font-mono text-[8.5px] font-semibold tracking-[0.08em] " +
        (active
          ? "text-(--color-live) border-(--color-live)"
          : "text-(--color-ink)")
      }
    >
      <span
        className={`grid place-items-center ${active ? "gap-1.5" : "gap-1"}`}
      >
        {active ? (
          <span className="w-2 h-2 rounded-full bg-(--color-live) animate-livepulse" />
        ) : (
          <Rewind size={14} fill="currentColor" aria-hidden="true" />
        )}
        <span>{active ? "LIVE" : "REW"}</span>
      </span>
    </button>
  );
}

export function MobileReplayDock({ open = false }: { open?: boolean } = {}) {
  const replay = useIdentStore((s) => s.replay);
  const setViewWindow = useIdentStore((s) => s.setReplayViewWindow);
  const setPlaying = useIdentStore((s) => s.setReplayPlaying);
  const setPlayhead = useIdentStore((s) => s.setReplayPlayhead);
  const setSpeed = useIdentStore((s) => s.setReplaySpeed);
  const enterReplay = useIdentStore((s) => s.enterReplay);
  const goLive = useIdentStore((s) => s.goLive);
  const clockMode = useIdentStore((s) => s.settings.clock);
  const replayError = useIdentStore((s) => s.replay.error);
  const recents = usePreferencesStore((s) => s.replayRangeRecents);
  const setRecents = usePreferencesStore((s) => s.setReplayRangeRecents);
  const [pickerOpen, setPickerOpen] = useState(false);
  if (
    (!open && replay.mode !== "replay") ||
    replay.availableFrom == null ||
    replay.availableTo == null
  ) {
    return null;
  }
  const availableFrom = replay.availableFrom;
  const availableTo = replay.availableTo;
  const active = replay.mode === "replay" && replay.playheadMs != null;
  const replayWindow = resolveReplayWindow({
    availableFrom,
    availableTo,
    viewWindow: replay.viewWindow,
  });
  const playhead =
    replay.mode === "replay" && replay.playheadMs != null
      ? replay.playheadMs
      : replayWindow.end;
  const currentView = replayWindow.view;
  const startLabel = replayWindow.isPastWindow
    ? formatEndpointLabel(
        replayWindow.start,
        replayWindow.rangeMs,
        true,
        clockMode,
      )
    : rewindRangeLabel(replayWindow.rangeMs);
  const endLabel = replayWindow.isPastWindow
    ? formatEndpointLabel(
        replayWindow.end,
        replayWindow.rangeMs,
        true,
        clockMode,
      )
    : replay.mode === "live"
      ? "LIVE"
      : "NOW";
  const chipLabel = replayWindow.isPastWindow
    ? formatRangeWidth(replayWindow.rangeMs)
    : `LAST ${formatRangeWidth(replayWindow.rangeMs)}`;
  const rangeExpr =
    currentView.toExpr === "now"
      ? currentView.fromExpr
      : `${currentView.fromExpr} -> ${currentView.toExpr}`;
  const replayLoading = active && replay.loading;
  const replayActive = active && !replayLoading;
  const displayChipLabel = replayError
    ? "ERROR"
    : replayLoading
      ? "LOADING..."
      : chipLabel;
  const displayRangeExpr = replayError ?? rangeExpr;

  function pickQuickRange(range: PickerQuickRange): void {
    const startMs = Math.max(availableFrom, availableTo - range.ms);
    const resume = replay.mode === "replay" ? replay.playing : true;
    setViewWindow({
      rangeId: range.id,
      rangeMs: range.ms,
      fromExpr: range.expr,
      toExpr: "now",
      fixedEndMs: null,
    });
    enterReplay(startMs);
    if (resume) setPlaying(true);
    setPickerOpen(false);
  }

  function applyCustomRange(fromExpr: string, toExpr: string): void {
    const nowMs = getNow();
    const fromMs = resolveRangeExpression(fromExpr, nowMs);
    const toMs = resolveRangeExpression(toExpr, nowMs);
    if (fromMs == null || toMs == null || fromMs >= toMs) return;
    const fixedEndMs = toExpr.trim() === "now" ? null : toMs;
    const resume = replay.mode === "replay" ? replay.playing : true;
    setViewWindow({
      rangeId: "custom",
      rangeMs: toMs - fromMs,
      fromExpr,
      toExpr,
      fixedEndMs,
      requestedEndMs: toMs,
    });
    enterReplay(fromMs);
    if (resume) setPlaying(true);
    setRecents(
      upsertRangeRecent(recents, {
        label: formatRangeWidth(toMs - fromMs),
        from: fromExpr,
        to: toExpr,
      }),
    );
    setPickerOpen(false);
  }

  function jumpTo(next: number): void {
    if (next >= availableTo) {
      setViewWindow({
        ...currentView,
        fixedEndMs: null,
        requestedEndMs: null,
        toExpr: "now",
      });
      goLive();
      return;
    }
    if (active) {
      setPlayhead(next);
      return;
    }
    enterReplay(next);
    setPlaying(true);
  }

  return (
    <div
      data-testid="mobile-replay-dock"
      className="liquid-glass fixed left-2.5 right-16 bottom-[var(--mobile-control-bottom)] z-30 rounded-[10px] p-2 grid gap-2 pointer-events-auto"
    >
      <div className="flex items-center gap-1">
        <IconButton
          label="Jump back 10 minutes"
          onClick={() => jumpTo(playhead - JUMP_MS)}
        >
          <SkipBack size={14} aria-hidden="true" />
        </IconButton>
        <IconButton
          label={
            replayLoading
              ? "Loading replay"
              : replayActive
                ? replay.playing
                  ? "Pause replay"
                  : "Play replay"
                : "Pause live feed"
          }
          onClick={() => {
            if (replay.loading) return;
            if (!replayActive) {
              enterReplay(availableTo);
              return;
            }
            setPlaying(!replay.playing);
          }}
          active={replayActive}
          disabled={replayLoading}
        >
          {replay.playing ? (
            <Pause size={14} aria-hidden="true" />
          ) : (
            <Play size={14} aria-hidden="true" />
          )}
        </IconButton>
        <IconButton
          label="Jump forward 10 minutes"
          onClick={() => jumpTo(playhead + JUMP_MS)}
        >
          <SkipForward size={14} aria-hidden="true" />
        </IconButton>
        <div>
          <RangeChip
            label={displayChipLabel}
            expr={displayRangeExpr}
            open={pickerOpen}
            accent={replayActive}
            surface="glass"
            onClick={() => setPickerOpen((open) => !open)}
          />
        </div>
        <div className="flex-1" />
        {replayActive && (
          <div
            data-testid="mobile-replay-speed"
            className="flex h-[26px] border border-(--color-line) rounded-[5px] overflow-hidden bg-[rgb(from_var(--color-paper)_r_g_b_/_0.24)]"
          >
            {[1, 4, 16].map((speed) => (
              <button
                key={speed}
                type="button"
                onClick={() => setSpeed(speed as 1 | 4 | 16)}
                className={
                  "min-w-7 px-1.5 font-mono text-[10px] font-semibold cursor-pointer border-0 border-r last:border-r-0 border-(--color-line) " +
                  (replay.speed === speed
                    ? "bg-(--color-warn) text-bg"
                    : "bg-transparent text-ink-soft")
                }
              >
                {speed}×
              </button>
            ))}
          </div>
        )}
      </div>
      {pickerOpen && (
        <RangePicker
          selectedId={currentView.rangeId}
          fromExpr={currentView.fromExpr}
          toExpr={currentView.toExpr}
          availableFrom={availableFrom}
          availableTo={availableTo}
          recents={recents}
          placement="mobile"
          onPickQuick={pickQuickRange}
          onApply={applyCustomRange}
          onClose={() => setPickerOpen(false)}
        />
      )}
      <MiniScrubber startLabel={startLabel} endLabel={endLabel} />
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
  active,
  activeTone = "warn",
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  activeTone?: "warn" | "live";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={
        "h-7 min-w-7 px-1.5 grid place-items-center border border-(--color-line) rounded-[4px] cursor-pointer bg-[rgb(from_var(--color-paper)_r_g_b_/_0.24)] disabled:cursor-wait disabled:opacity-70 " +
        (active && activeTone === "live"
          ? "text-(--color-live) border-(--color-live)"
          : active
            ? "text-(--color-warn)"
            : "text-ink-soft hover:text-(--color-ink)")
      }
    >
      {children}
    </button>
  );
}

export function replayDeltaLabel(
  playheadMs: number,
  liveMs: number | null,
): string {
  if (liveMs == null || playheadMs >= liveMs) return "REPLAY";
  const minutes = Math.round((liveMs - playheadMs) / 60000);
  if (minutes < 60) return `REPLAY · T-${minutes}M`;
  return `REPLAY · T-${Math.round(minutes / 60)}H`;
}

export function rewindRangeLabel(rangeMs: number): string {
  const minutes = Math.max(1, Math.round(Math.max(0, rangeMs) / 60000));
  if (minutes < 60) return `-${minutes}M`;
  const hours = minutes / 60;
  if (hours < 24) {
    const rounded = Math.round(hours * 10) / 10;
    return `-${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}H`;
  }
  const days = Math.round((hours / 24) * 10) / 10;
  return `-${Number.isInteger(days) ? days.toFixed(0) : days}D`;
}
