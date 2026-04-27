import { Pause, Play, Rewind, SkipBack, SkipForward } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ensureReplayRange } from "../data/replay";
import { useIdentStore } from "../data/store";
import { Tooltip } from "../ui/Tooltip";

const PRELOAD_BEHIND_MS = 10 * 60 * 1000;
const PRELOAD_AHEAD_MS = 5 * 60 * 1000;
const JUMP_MS = 10 * 60 * 1000;

export function ReplayRuntime() {
  const replay = useIdentStore((s) => s.replay);
  const setPlayhead = useIdentStore((s) => s.setReplayPlayhead);
  const setPlaying = useIdentStore((s) => s.setReplayPlaying);
  const goLive = useIdentStore((s) => s.goLive);
  const playbackActive =
    replay.mode === "replay" && replay.playing && replay.playheadMs != null;

  useEffect(() => {
    if (replay.mode !== "replay" || replay.playheadMs == null) return;
    void ensureReplayRange(
      replay.playheadMs - PRELOAD_BEHIND_MS,
      replay.playheadMs + PRELOAD_AHEAD_MS,
    );
  }, [replay.mode, replay.playheadMs]);

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

  useEffect(() => {
    if (replay.mode !== "replay" || replay.availableTo == null) return;
    if (replay.playheadMs != null && replay.playheadMs < replay.availableTo) {
      return;
    }
    if (replay.playing) setPlaying(false);
  }, [
    replay.availableTo,
    replay.mode,
    replay.playheadMs,
    replay.playing,
    setPlaying,
  ]);

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
  const active = replay.mode === "replay";
  const playhead = active
    ? (replay.playheadMs ?? replay.availableTo)
    : replay.availableTo;
  const liveEdge = replay.availableTo;
  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className="flex h-[22px] border border-(--color-line) rounded-[4px] overflow-hidden bg-paper-2">
        <TransportButton
          label="Jump back 10 minutes"
          onClick={() =>
            active
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
            active ? setPlayhead(playhead + JUMP_MS) : enterReplay(liveEdge)
          }
        >
          <SkipForward size={12} aria-hidden="true" />
        </TransportButton>
      </div>
      {active && (
        <div className="flex h-[22px] border border-(--color-line) rounded-[4px] overflow-hidden bg-paper-2">
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
  const enterReplay = useIdentStore((s) => s.enterReplay);
  const setPlayhead = useIdentStore((s) => s.setReplayPlayhead);
  const setPlaying = useIdentStore((s) => s.setReplayPlaying);
  const goLive = useIdentStore((s) => s.goLive);
  const active = mode === "replay";
  const hasWindow = enabled && availableFrom != null && availableTo != null;
  const playhead = hasWindow
    ? active
      ? (playheadMs ?? availableTo)
      : availableTo
    : 0;
  const scrubber = useReplayScrubber({
    availableFrom: availableFrom ?? 0,
    availableTo: availableTo ?? 0,
    playhead,
    mode,
    playing,
    enterReplay,
    setPlayhead,
    setPlaying,
    goLive,
  });
  if (!hasWindow) {
    return null;
  }
  const pct =
    ((scrubber.playhead - scrubber.availableFrom) /
      Math.max(1, scrubber.availableTo - scrubber.availableFrom)) *
    100;
  const tickCount = Math.min(
    24,
    Math.max(
      2,
      Math.round((scrubber.availableTo - scrubber.availableFrom) / 3600000),
    ),
  );
  const tickPositions = Array.from({ length: tickCount }, (_, i) =>
    ((i / Math.max(1, tickCount - 1)) * 100).toFixed(3),
  );
  const rangeLabel = rewindRangeLabel(
    scrubber.availableTo - scrubber.availableFrom,
  );
  return (
    <div
      data-testid="replay-scrubber"
      className="[grid-area:replay] hidden md:flex items-center gap-3 px-4 bg-paper-2 border-b border-(--color-line) font-mono text-[10.5px] text-ink-soft min-w-0"
    >
      <span className="shrink-0 text-ink-faint">{rangeLabel}</span>
      <div
        data-testid="replay-scrubber-track"
        className="relative h-[7px] flex-1 rounded-full border border-(--color-line) bg-paper-3"
      >
        {active && (
          <div
            className="absolute left-[-1px] top-[-1px] bottom-[-1px] rounded-full bg-[color-mix(in_oklab,var(--color-warn)_30%,transparent)]"
            style={{ width: `${pct}%` }}
          />
        )}
        {tickPositions.map((left, i) => (
          <span
            key={`desktop-tick-${left}`}
            className={
              "absolute top-[-4px] bottom-[-4px] w-px " +
              (i % 6 === 0 ? "bg-ink-faint" : "bg-(--color-line)")
            }
            style={{ left: `${left}%` }}
          />
        ))}
        <div
          className={
            "absolute top-[-6px] bottom-[-6px] w-0.5 rounded-full " +
            (active ? "bg-(--color-warn)" : "bg-(--color-live)")
          }
          style={{
            left: `${pct}%`,
            transform: active ? "none" : "translateX(-2px)",
            boxShadow: active
              ? "0 0 0 3px color-mix(in oklab, var(--color-warn) 24%, transparent)"
              : "0 0 0 3px color-mix(in oklab, var(--color-live) 24%, transparent)",
          }}
        />
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
          onChange={scrubber.onChange}
          className="absolute inset-y-[-8px] left-0 right-0 opacity-0 cursor-pointer"
        />
      </div>
      <ReplayStatusLabel active={active} />
    </div>
  );
});

function ReplayStatusLabel({ active }: { active: boolean }) {
  const loading = useIdentStore((s) => s.replay.loading);
  const error = useIdentStore((s) => s.replay.error);
  return (
    <span
      data-testid="replay-status"
      title={error ?? (loading ? "Loading replay" : undefined)}
      className={
        "shrink-0 w-[7.75ch] whitespace-nowrap text-right " +
        (active
          ? "font-semibold tracking-[0.08em] text-ink-soft"
          : "text-ink-faint")
      }
    >
      {active ? (loading ? "LOADING" : (error ?? "NOW ->")) : "NOW ->"}
    </span>
  );
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

function MiniScrubber() {
  const replay = useIdentStore((s) => s.replay);
  const setPlayhead = useIdentStore((s) => s.setReplayPlayhead);
  const setPlaying = useIdentStore((s) => s.setReplayPlaying);
  const goLive = useIdentStore((s) => s.goLive);
  const playhead = replay.playheadMs ?? replay.availableTo ?? 0;
  const scrubber = useReplayScrubber({
    availableFrom: replay.availableFrom ?? 0,
    availableTo: replay.availableTo ?? 0,
    playhead,
    mode: replay.mode,
    playing: replay.playing,
    setPlayhead,
    setPlaying,
    goLive,
  });
  if (
    replay.mode !== "replay" ||
    replay.playheadMs == null ||
    replay.availableFrom == null ||
    replay.availableTo == null
  ) {
    return null;
  }
  const pct =
    ((scrubber.playhead - scrubber.availableFrom) /
      Math.max(1, scrubber.availableTo - scrubber.availableFrom)) *
    100;
  const tickPositions = Array.from({ length: 12 }, (_, i) =>
    ((i / 11) * 100).toFixed(3),
  );
  const rangeLabel = rewindRangeLabel(
    scrubber.availableTo - scrubber.availableFrom,
  );
  return (
    <div className="grid gap-1">
      <div className="relative h-[7px] rounded-full border border-(--color-line) bg-paper-3">
        <div
          className="absolute left-[-1px] top-[-1px] bottom-[-1px] rounded-full bg-[color-mix(in_oklab,var(--color-warn)_30%,transparent)]"
          style={{ width: `${pct}%` }}
        />
        {tickPositions.map((left) => (
          <span
            key={`mobile-tick-${left}`}
            className="absolute top-[-4px] bottom-[-4px] w-px bg-(--color-line)"
            style={{ left: `${left}%` }}
          />
        ))}
        <div
          className="absolute top-[-6px] bottom-[-6px] w-1 rounded-full bg-(--color-warn)"
          style={{
            left: `${pct}%`,
            boxShadow:
              "0 0 0 3px color-mix(in oklab, var(--color-warn) 24%, transparent)",
          }}
        />
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
          onChange={scrubber.onChange}
          className="absolute inset-y-[-8px] left-0 right-0 w-full opacity-0 cursor-pointer"
        />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-ink-faint">
        <span>{rangeLabel}</span>
        <span>NOW</span>
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
      if (next >= limit) {
        goLive();
      } else if (mode !== "replay" && enterReplay) {
        enterReplay(next);
      } else {
        setPlayhead(next);
      }
    },
    [enterReplay, goLive, mode, setPlayhead],
  );

  const finishDrag = useCallback(() => {
    setDrag(null);
    if (!resumeAfterDragRef.current) return;
    resumeAfterDragRef.current = false;
    setPlaying(true);
  }, [setPlaying]);

  const onPointerDown = useCallback(
    (ev: React.PointerEvent<HTMLInputElement>) => {
      const next = Number(ev.currentTarget.value);
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
      const next = Number(ev.currentTarget.value);
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
    onPointerDown,
    onPointerEnd: finishDrag,
    onChange,
  };
}

export function MobileReplayFab() {
  const replay = useIdentStore((s) => s.replay);
  const enterReplay = useIdentStore((s) => s.enterReplay);
  const goLive = useIdentStore((s) => s.goLive);
  if (!replay.enabled || replay.availableTo == null) return null;
  const active = replay.mode === "replay";
  const liveEdge = replay.availableTo;
  return (
    <button
      type="button"
      aria-label={active ? "Go live" : "Open replay"}
      onClick={() => (active ? goLive() : enterReplay(liveEdge))}
      className={
        "liquid-glass w-11 h-11 grid place-items-center rounded-[6px] cursor-pointer font-mono text-[8.5px] font-semibold tracking-[0.08em] " +
        (active
          ? "text-(--color-live) border-(--color-live)"
          : "text-(--color-ink)")
      }
    >
      <span className="grid place-items-center gap-0.5">
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

export function MobileReplayDock() {
  const replay = useIdentStore((s) => s.replay);
  const setPlaying = useIdentStore((s) => s.setReplayPlaying);
  const setPlayhead = useIdentStore((s) => s.setReplayPlayhead);
  const setSpeed = useIdentStore((s) => s.setReplaySpeed);
  if (replay.mode !== "replay" || replay.playheadMs == null) return null;
  const playhead = replay.playheadMs;
  return (
    <div className="absolute left-2.5 right-16 bottom-3 z-20 rounded-[10px] border border-(--color-warn) bg-[color-mix(in_oklab,var(--color-paper)_90%,transparent)] p-2 grid gap-2 shadow-lg backdrop-blur-md pointer-events-auto">
      <div className="flex items-center gap-1">
        <IconButton
          label="Jump back 10 minutes"
          onClick={() => setPlayhead(playhead - JUMP_MS)}
        >
          <SkipBack size={14} aria-hidden="true" />
        </IconButton>
        <IconButton
          label={replay.playing ? "Pause replay" : "Play replay"}
          onClick={() => setPlaying(!replay.playing)}
          active
        >
          {replay.playing ? (
            <Pause size={14} aria-hidden="true" />
          ) : (
            <Play size={14} aria-hidden="true" />
          )}
        </IconButton>
        <IconButton
          label="Jump forward 10 minutes"
          onClick={() => setPlayhead(playhead + JUMP_MS)}
        >
          <SkipForward size={14} aria-hidden="true" />
        </IconButton>
        <div className="flex-1" />
        <div className="flex h-[26px] border border-(--color-line) rounded-[5px] overflow-hidden bg-paper-2">
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
      </div>
      <MiniScrubber />
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <Tooltip label={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={
          "h-7 min-w-7 px-1.5 grid place-items-center border border-(--color-line) rounded-[4px] cursor-pointer " +
          (active
            ? "bg-(--color-warn) text-bg border-(--color-warn)"
            : "bg-transparent text-ink-soft hover:text-(--color-ink)")
        }
      >
        {children}
      </button>
    </Tooltip>
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
