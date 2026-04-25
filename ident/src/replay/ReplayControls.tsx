import { History, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect } from "react";
import { ensureReplayRange } from "../data/replay";
import { useIdentStore } from "../data/store";
import { Tooltip } from "../ui/Tooltip";

const PRELOAD_BEHIND_MS = 10 * 60 * 1000;
const PRELOAD_AHEAD_MS = 5 * 60 * 1000;
const JUMP_MS = 10 * 60 * 1000;
const TICK_MS = 250;

export function ReplayRuntime() {
  const replay = useIdentStore((s) => s.replay);
  const setPlayhead = useIdentStore((s) => s.setReplayPlayhead);
  const setPlaying = useIdentStore((s) => s.setReplayPlaying);
  const goLive = useIdentStore((s) => s.goLive);

  useEffect(() => {
    if (replay.mode !== "replay" || replay.playheadMs == null) return;
    void ensureReplayRange(
      replay.playheadMs - PRELOAD_BEHIND_MS,
      replay.playheadMs + PRELOAD_AHEAD_MS,
    );
  }, [replay.mode, replay.playheadMs]);

  useEffect(() => {
    if (
      replay.mode !== "replay" ||
      !replay.playing ||
      replay.playheadMs == null
    ) {
      return;
    }
    const id = setInterval(() => {
      const st = useIdentStore.getState();
      const next = (st.replay.playheadMs ?? 0) + TICK_MS * st.replay.speed;
      if (st.replay.availableTo != null && next >= st.replay.availableTo) {
        goLive();
        return;
      }
      setPlayhead(next);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [goLive, replay.mode, replay.playheadMs, replay.playing, setPlayhead]);

  useEffect(() => {
    if (replay.mode !== "replay" || replay.availableTo == null) return;
    if (replay.playheadMs != null && replay.playheadMs < replay.availableTo) {
      return;
    }
    setPlaying(false);
  }, [replay.availableTo, replay.mode, replay.playheadMs, setPlaying]);

  return null;
}

export function DesktopReplayTransport() {
  const replay = useIdentStore((s) => s.replay);
  const enterReplay = useIdentStore((s) => s.enterReplay);
  const goLive = useIdentStore((s) => s.goLive);
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
  const playhead = replay.playheadMs ?? replay.availableTo;
  const liveEdge = replay.availableTo;
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <IconButton
        label={active ? "Go live" : "Open replay"}
        onClick={() => (active ? goLive() : enterReplay(liveEdge))}
      >
        {active ? (
          <span className="font-mono text-[10px] text-(--color-live)">
            LIVE
          </span>
        ) : (
          <History size={14} aria-hidden="true" />
        )}
      </IconButton>
      {active && (
        <>
          <IconButton
            label="Jump back 10 minutes"
            onClick={() => setPlayhead(playhead - JUMP_MS)}
          >
            <SkipBack size={14} aria-hidden="true" />
          </IconButton>
          <IconButton
            label={replay.playing ? "Pause replay" : "Play replay"}
            onClick={() => setPlaying(!replay.playing)}
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
          <div className="flex border border-(--color-line) rounded-[4px] overflow-hidden">
            {[1, 4, 16].map((speed) => (
              <button
                key={speed}
                type="button"
                onClick={() => setSpeed(speed as 1 | 4 | 16)}
                className={
                  "h-7 px-2 font-mono text-[10px] cursor-pointer border-0 border-r last:border-r-0 border-(--color-line) " +
                  (replay.speed === speed
                    ? "bg-(--color-warn) text-bg"
                    : "bg-transparent text-ink-soft hover:text-(--color-ink)")
                }
              >
                {speed}×
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ReplayScrubber() {
  const replay = useIdentStore((s) => s.replay);
  const enterReplay = useIdentStore((s) => s.enterReplay);
  const setPlayhead = useIdentStore((s) => s.setReplayPlayhead);
  if (
    !replay.enabled ||
    replay.availableFrom == null ||
    replay.availableTo == null
  ) {
    return null;
  }
  const playhead = replay.playheadMs ?? replay.availableTo;
  const pct =
    ((playhead - replay.availableFrom) /
      Math.max(1, replay.availableTo - replay.availableFrom)) *
    100;
  return (
    <div className="hidden md:block absolute left-3 right-3 top-3 z-10 pointer-events-auto">
      <input
        aria-label="Replay time"
        type="range"
        min={replay.availableFrom}
        max={replay.availableTo}
        step={1000}
        value={playhead}
        onChange={(ev) => {
          if (replay.mode !== "replay")
            enterReplay(Number(ev.currentTarget.value));
          else setPlayhead(Number(ev.currentTarget.value));
        }}
        className="w-full accent-(--color-warn)"
        style={{
          background: `linear-gradient(to right, var(--color-warn) ${pct}%, var(--color-line) ${pct}%)`,
        }}
      />
      {replay.mode === "replay" && (
        <div className="flex justify-between mt-0.5 font-mono text-[10px] text-ink-soft">
          <span>
            -{Math.round((replay.availableTo - replay.availableFrom) / 3600000)}
            H
          </span>
          <span>{replay.loading ? "loading" : (replay.error ?? "NOW")}</span>
        </div>
      )}
    </div>
  );
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
        "liquid-glass w-11 h-11 grid place-items-center rounded-[6px] cursor-pointer " +
        (active ? "text-(--color-live)" : "text-(--color-ink)")
      }
    >
      {active ? (
        <span className="font-mono text-[10px]">LIVE</span>
      ) : (
        <History size={18} strokeWidth={1.75} aria-hidden="true" />
      )}
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
    <div className="absolute left-3 bottom-16 z-20 liquid-glass rounded-[6px] p-2 flex items-center gap-1.5 pointer-events-auto">
      <IconButton
        label="Jump back 10 minutes"
        onClick={() => setPlayhead(playhead - JUMP_MS)}
      >
        <SkipBack size={14} aria-hidden="true" />
      </IconButton>
      <IconButton
        label={replay.playing ? "Pause replay" : "Play replay"}
        onClick={() => setPlaying(!replay.playing)}
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
      {[1, 4, 16].map((speed) => (
        <button
          key={speed}
          type="button"
          onClick={() => setSpeed(speed as 1 | 4 | 16)}
          className={
            "h-7 px-2 rounded-[4px] font-mono text-[10px] cursor-pointer " +
            (replay.speed === speed
              ? "bg-(--color-warn) text-bg"
              : "text-ink-soft")
          }
        >
          {speed}×
        </button>
      ))}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="h-7 min-w-7 px-1.5 grid place-items-center border border-(--color-line) bg-transparent rounded-[4px] text-ink-soft hover:text-(--color-ink) cursor-pointer"
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
