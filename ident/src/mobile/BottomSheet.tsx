import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Tooltip } from "../ui/Tooltip";

export type SheetSnap = "collapsed" | "half" | "full";

interface Props {
  snap: SheetSnap;
  onSnapChange: (s: SheetSnap) => void;
  onDismiss?: () => void;
  children: React.ReactNode;
  label?: string;
  header?: React.ReactNode;
}

// Snap heights as viewport-height percentages. Collapsed uses a fixed px to
// keep the peek readable on short phones. "Half" lands the sheet top near
// the midpoint of the physical display so an opened aircraft card still
// leaves meaningful map visible above.
const COLLAPSED_PX = 92;
const HALF_VH = 0.4;
const FULL_VH = 0.92;
const SCROLL_END_PADDING_PX = 24;
const DISMISS_BELOW_COLLAPSED_PX = 44;

const SNAP_CYCLE: Record<SheetSnap, SheetSnap> = {
  collapsed: "half",
  half: "full",
  full: "collapsed",
};

function heightFor(snap: SheetSnap, vh: number): number {
  if (snap === "collapsed") return COLLAPSED_PX;
  if (snap === "half") return Math.round(vh * HALF_VH);
  return Math.round(vh * FULL_VH);
}

function nearestSnap(height: number, vh: number): SheetSnap {
  const c = COLLAPSED_PX;
  const h = Math.round(vh * HALF_VH);
  const f = Math.round(vh * FULL_VH);
  const d = [
    { s: "collapsed" as const, d: Math.abs(height - c) },
    { s: "half" as const, d: Math.abs(height - h) },
    { s: "full" as const, d: Math.abs(height - f) },
  ].sort((a, b) => a.d - b.d);
  return d[0].s;
}

export function BottomSheet({
  snap,
  onSnapChange,
  onDismiss,
  children,
  label = "Sheet",
  header,
}: Props) {
  const [vh, setVh] = useState<number>(() =>
    typeof window === "undefined" ? 800 : window.innerHeight,
  );
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragRef = useRef<{
    startY: number;
    startH: number;
    currentH: number;
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    function onResize(): void {
      setVh(window.innerHeight);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const height = dragHeight ?? heightFor(snap, vh);

  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
      "--mobile-sheet-height",
      `${height}px`,
    );
    return () => {
      document.documentElement.style.setProperty(
        "--mobile-sheet-height",
        "0px",
      );
    };
  }, [height]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const startH = heightFor(snap, vh);
      dragRef.current = { startY: e.clientY, startH, currentH: startH };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [snap, vh],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dy = d.startY - e.clientY;
      const next = Math.max(
        0,
        Math.min(Math.round(vh * FULL_VH), d.startH + dy),
      );
      d.currentH = next;
      setDragHeight(next);
    },
    [vh],
  );
  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      if (d == null) return;
      const finalH = d.currentH ?? dragHeight ?? heightFor(snap, vh);
      setDragHeight(null);
      if (onDismiss && finalH < COLLAPSED_PX - DISMISS_BELOW_COLLAPSED_PX) {
        onDismiss();
        return;
      }
      onSnapChange(nearestSnap(finalH, vh));
    },
    [dragHeight, onDismiss, onSnapChange, snap, vh],
  );

  const onHandleClick = useCallback(() => {
    if (dragRef.current) return;
    onSnapChange(SNAP_CYCLE[snap]);
  }, [onSnapChange, snap]);

  // Plain snap height. A box-shadow on .mobile-bottom-sheet in tokens.css
  // extends the paper bg indefinitely past the sheet's bottom so the sheet
  // color reaches the device edge without needing a JS-measured overshoot.
  const sheetHeight = `${height}px`;
  // Scroll-pad keeps the last content row clear of the safe-area inset and
  // leaves a small breathing gap above the sheet edge.
  const scrollPadBottom = `calc(var(--mobile-safe-bottom) + ${SCROLL_END_PADDING_PX}px)`;

  return (
    <div
      role="dialog"
      aria-label={label}
      data-snap={snap}
      className="mobile-bottom-sheet fixed inset-x-0 z-20 bg-paper border-t border-line-strong rounded-t-[12px] flex flex-col overflow-hidden"
      style={{
        height: sheetHeight,
        transition: dragHeight == null ? "height 180ms ease-out" : "none",
        touchAction: "none",
      }}
    >
      <Tooltip label={`Sheet position: ${snap}. Tap to cycle.`} side="top">
        <button
          type="button"
          aria-label={`Sheet position: ${snap}. Tap to cycle.`}
          onClick={onHandleClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="w-full h-[28px] grid place-items-center cursor-grab active:cursor-grabbing bg-transparent border-0 flex-none"
        >
          <span className="block w-[36px] h-[4px] rounded-full bg-(--color-line-strong)" />
        </button>
      </Tooltip>
      {header && <div className="flex-none">{header}</div>}
      <div className="mobile-bottom-sheet-content flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div
          className="mobile-bottom-sheet-content-inner min-h-full flex flex-col"
          style={{ paddingBottom: scrollPadBottom }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
