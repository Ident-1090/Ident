import { useCallback, useEffect, useRef, useState } from "react";
import { usePreferencesStore } from "../data/preferences";
import { useIdentStore } from "../data/store";

const SHOWCASE_HEX = "395d66"; // F-GXLG / BGA121G

interface Step {
  title: string;
  desc: string;
  // CSS selector for the element the halo rings. null = no halo (the dock text
  // stands alone — used for the bottom strip the dock itself would cover).
  target: string | null;
  // reveal runs when the step becomes active (expand a panel, open a modal,
  // select an aircraft). cleanup runs when the step is left, to undo it.
  reveal?: () => void;
  cleanup?: () => void;
  scrollTo?: boolean;
}

const expandRail = () =>
  usePreferencesStore.getState().setLayoutPreferences({ railCollapsed: false });
const selectShowcase = () => useIdentStore.getState().select(SHOWCASE_HEX);
const deselect = () => useIdentStore.getState().select(null);
const clickEl = (sel: string) =>
  (document.querySelector(sel) as HTMLElement | null)?.click();
const closeOmnibox = () => clickEl('[aria-label="Close command palette"]');
const openSearchFab = () =>
  clickEl('.mobile-fab-row [aria-label="Open search"]');
const toggleReplayFab = () =>
  clickEl('.mobile-fab-row [aria-label="Open replay"]');

const DESKTOP_STEPS: Step[] = [
  {
    title: "Traffic list",
    desc: "Every aircraft in range, sorted by distance — filter by category, or jump to any contact.",
    target: '[data-tour="rail"]',
    reveal: expandRail,
  },
  {
    title: "Search & commands",
    desc: "Find any callsign, hex, registration or squawk — and run filters or map actions — from the command palette (⌘K).",
    target: ".omnibox-dialog",
    reveal: () => {
      expandRail();
      clickEl('[data-tour="search"]');
    },
    cleanup: closeOmnibox,
  },
  {
    title: "Map",
    desc: "Altitude-coloured tracks, fading trails, and distance rings around the receiver.",
    target: ".map-engine",
  },
  {
    title: "Inspector",
    desc: "Photo, route, altitude and speed for the selected aircraft.",
    target: '[data-testid="floating-inspector"]',
    reveal: selectShowcase,
  },
  {
    title: "Replay",
    desc: "Opt-in history kept on disk — drag the scrubber to rewind the whole picture.",
    target: '[data-tour="replay"]',
  },
  {
    title: "Diagnostics",
    desc: "Message rate, gain, range and uptime — always live along the bottom strip.",
    target: '[data-tour="status"]',
  },
  {
    title: "On your phone",
    desc: "The same data and map, in a browser on your phone.",
    target: '[data-tour="phone"]',
    scrollTo: true,
  },
];

const MOBILE_STEPS: Step[] = [
  {
    title: "Menu",
    desc: "Traffic, filters, map style and day/night all live in the menu.",
    target: '.mobile-fab-row [aria-label="Open menu"]',
  },
  {
    title: "Search & commands",
    desc: "Find any callsign, hex, registration or squawk — or run filters from the command palette.",
    target: ".omnibox-dialog",
    reveal: openSearchFab,
    cleanup: closeOmnibox,
  },
  {
    title: "Tap an aircraft",
    desc: "Photo, route and telemetry slide up from the bottom for whatever you tap.",
    target: '[aria-label="Aircraft inspector sheet"]',
    reveal: selectShowcase,
    cleanup: deselect,
  },
  {
    title: "Replay",
    desc: "Recent history is kept on disk — open replay and scrub back through the whole picture.",
    target: '[data-testid="mobile-replay-dock"]',
    reveal: toggleReplayFab,
    cleanup: toggleReplayFab,
  },
  {
    title: "Run it yourself",
    desc: "Point Ident at the decoder you already have.",
    target: "#dl-pitch",
    scrollTo: true,
  },
];

interface HaloBox {
  top: number;
  left: number;
  width: number;
  height: number;
  // Glide to this box (step changes) vs. snap to it (following a live scroll).
  animate: boolean;
}

export function DemoTour({
  open,
  onClose,
  phone,
}: {
  open: boolean;
  onClose: () => void;
  phone: boolean;
}) {
  const steps = phone ? MOBILE_STEPS : DESKTOP_STEPS;
  const [step, setStep] = useState(0);
  const [halo, setHalo] = useState<HaloBox | null>(null);
  // The dock reserves space from first paint but holds a skeleton until the
  // data has landed, so the first step reveals onto a populated map.
  const [ready, setReady] = useState(false);
  const stepRef = useRef(step);
  stepRef.current = step;
  // True only during a programmatic cross-screen scroll, when the halo is
  // hidden until the scroll settles; manual scrolling repositions normally.
  const suppressScroll = useRef(false);

  const position = useCallback(
    (animate = false) => {
      const s = steps[stepRef.current];
      if (!s?.target) {
        setHalo(null);
        return;
      }
      const el = document.querySelector(s.target);
      if (!el) {
        setHalo(null);
        return;
      }
      const r = el.getBoundingClientRect();
      const pad = 4;
      // A fixed element isn't clipped by overflow-hidden ancestors, so a
      // full-width target would push the halo (and its ring glow) off both edges.
      // Clamp the box to the viewport, leaving a margin for the ring.
      const m = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = r.left - pad;
      let top = r.top - pad;
      let width = r.width + pad * 2;
      let height = r.height + pad * 2;
      if (left < m) {
        width -= m - left;
        left = m;
      }
      if (top < m) {
        height -= m - top;
        top = m;
      }
      if (left + width > vw - m) width = vw - m - left;
      if (top + height > vh - m) height = vh - m - top;
      if (width <= 0 || height <= 0) {
        setHalo(null);
        return;
      }
      setHalo({ top, left, width, height, animate });
    },
    [steps],
  );

  // Reset to the first step whenever the tour (re)opens.
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  // Hold the skeleton until the feed has actually delivered aircraft, so the
  // first step reveals onto a populated map rather than after a guessed delay.
  const hasAircraft = useIdentStore((s) => s.aircraft.size > 0);
  useEffect(() => {
    if (hasAircraft) setReady(true);
  }, [hasAircraft]);

  // Per-step: run the reveal, then place the halo. If the target is on a
  // different screen, hide the halo, scroll there, and only re-show it once the
  // scroll settles — otherwise the halo would chase the moving target. If it's
  // already on screen, let it glide to the new spot.
  useEffect(() => {
    if (!open || !ready) {
      setHalo(null);
      return;
    }
    const s = steps[step];
    s.reveal?.();
    suppressScroll.current = false;
    const el = s.target ? document.querySelector(s.target) : null;
    const r = el?.getBoundingClientRect();
    const offScreen = !!r && (r.top < 0 || r.bottom > window.innerHeight);

    if (el && offScreen) {
      setHalo(null);
      suppressScroll.current = true;
      const scroller = el.closest(".dl-scroll");
      // Scroll by section so scroll-snap lands cleanly: showcase targets center
      // the showcase; hero targets go to the top of the scroller.
      const showcase = el.closest("#dl-showcase");
      if (showcase) {
        showcase.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        scroller?.scrollTo({ top: 0, behavior: "smooth" });
      }
      let done = false;
      const settle = () => {
        if (done) return;
        done = true;
        scroller?.removeEventListener("scrollend", settle);
        window.clearTimeout(fallback);
        suppressScroll.current = false;
        position(true);
      };
      const fallback = window.setTimeout(settle, 700);
      scroller?.addEventListener("scrollend", settle);
      return () => {
        done = true;
        scroller?.removeEventListener("scrollend", settle);
        window.clearTimeout(fallback);
        s.cleanup?.();
      };
    }

    const t = window.setTimeout(() => position(true), s.reveal ? 280 : 80);
    return () => {
      window.clearTimeout(t);
      s.cleanup?.();
    };
  }, [open, ready, step, steps, position]);

  // Keep the halo glued to its element as the user scrolls or resizes. During a
  // programmatic cross-screen scroll the halo is hidden (suppressScroll), so we
  // skip repositioning until it settles.
  useEffect(() => {
    if (!open) return;
    const track = () => {
      if (!suppressScroll.current) position();
    };
    const scroller = document.querySelector(".dl-scroll");
    window.addEventListener("resize", track);
    scroller?.addEventListener("scroll", track, { passive: true });
    return () => {
      window.removeEventListener("resize", track);
      scroller?.removeEventListener("scroll", track);
    };
  }, [open, position]);

  // Keyboard nav for the tour: → / Enter advance (Done on the last step), ←
  // goes back, Esc skips. Capture-phase + stopPropagation so it keeps working
  // while the command-palette step holds focus (the palette would otherwise eat
  // the arrows and Enter).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      let handled = true;
      if (e.key === "ArrowRight" || e.key === "Enter") {
        if (stepRef.current >= steps.length - 1) onClose();
        else setStep((s) => s + 1);
      } else if (e.key === "ArrowLeft") {
        setStep((s) => Math.max(0, s - 1));
      } else if (e.key === "Escape") {
        onClose();
      } else {
        handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, steps.length, onClose]);

  const total = steps.length;
  const atLast = step === total - 1;
  const finish = () => onClose();

  return (
    <>
      {open && ready && halo && (
        <div
          aria-hidden
          className={`fixed z-[60] rounded-lg border border-(--color-accent) ring-4 ring-(--color-accent)/20 pointer-events-none ${
            halo.animate ? "transition-all duration-300 ease-out" : ""
          }`}
          style={{
            top: halo.top,
            left: halo.left,
            width: halo.width,
            height: halo.height,
          }}
        >
          <span className="absolute -top-2.5 -left-2.5 grid h-5 w-5 place-items-center rounded-full bg-(--color-accent) font-mono text-[10px] font-semibold text-[#04181d]">
            {String(step + 1).padStart(2, "0")}
          </span>
        </div>
      )}

      <div
        className={`flex-none overflow-hidden bg-paper transition-[max-height] duration-300 ease-out ${
          open
            ? "max-h-[220px] border-t border-(--color-line-strong)"
            : "max-h-0"
        }`}
      >
        {ready ? (
          <div className="mx-auto grid max-w-[1440px] grid-cols-[auto_1fr_auto] items-center gap-6 px-6 py-3.5 max-md:grid-cols-1 max-md:gap-3">
            <div className="flex items-center gap-3.5 font-mono max-md:hidden">
              <span className="text-[11px] uppercase tracking-wider text-ink-faint">
                <b className="font-medium text-ink">
                  {String(step + 1).padStart(2, "0")}
                </b>{" "}
                / {String(total).padStart(2, "0")}
              </span>
              <span className="relative h-0.5 w-[120px] rounded-full bg-paper-3">
                <span
                  className="absolute left-0 top-0 h-full rounded-full bg-ink transition-[width] duration-300"
                  style={{ width: `${((step + 1) / total) * 100}%` }}
                />
              </span>
            </div>

            <div className="flex flex-col gap-0.5">
              <div className="text-[15px] font-semibold tracking-[-0.005em] text-ink">
                {steps[step].title}
              </div>
              <div className="max-w-[720px] text-[13px] leading-snug text-ink-soft text-pretty">
                {steps[step].desc}
              </div>
            </div>

            <div className="flex items-center gap-1 font-mono max-md:justify-end">
              <button
                type="button"
                onClick={finish}
                className="flex h-[30px] items-center gap-1.5 rounded-[3px] px-3 text-[11px] uppercase tracking-wider text-ink-faint hover:text-ink"
              >
                Skip
                <kbd className="rounded border border-(--color-line) px-1 py-px text-[9px] font-normal lowercase tracking-normal">
                  esc
                </kbd>
              </button>
              <span className="mx-1.5 h-[18px] w-px bg-(--color-line)" />
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
                className="flex h-[30px] items-center gap-1.5 rounded-[3px] border border-(--color-line) px-3 text-[11px] uppercase tracking-wider text-ink-soft hover:border-(--color-line-strong) hover:bg-paper-2 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <kbd className="rounded border border-(--color-line) px-1 py-px text-[10px] font-normal leading-none">
                  ←
                </kbd>
                Back
              </button>
              <button
                type="button"
                onClick={() => (atLast ? finish() : setStep((s) => s + 1))}
                className="flex h-[30px] items-center gap-1.5 rounded-[3px] border border-(--color-ink) bg-ink px-3.5 text-[11px] font-medium uppercase tracking-wider text-(--color-paper) hover:opacity-90"
              >
                {atLast ? "Done" : "Next"}
                <kbd className="rounded border border-(--color-paper)/40 px-1 py-px text-[10px] font-normal leading-none">
                  →
                </kbd>
              </button>
            </div>
          </div>
        ) : (
          <div
            aria-hidden
            className="mx-auto grid max-w-[1440px] grid-cols-[auto_1fr_auto] items-center gap-6 px-6 py-3.5 max-md:grid-cols-1 max-md:gap-3"
          >
            <div className="flex items-center gap-3.5 max-md:hidden">
              <span className="h-2.5 w-10 rounded bg-paper-3" />
              <span className="h-0.5 w-[120px] rounded-full bg-paper-3" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="h-3.5 w-36 rounded bg-paper-3" />
              <span className="h-2.5 w-[min(680px,90%)] rounded bg-paper-3" />
            </div>
            <div className="flex items-center gap-2 max-md:justify-end">
              <span className="h-[30px] w-12 rounded-[3px] bg-paper-3" />
              <span className="h-[30px] w-14 rounded-[3px] bg-paper-3" />
              <span className="h-[30px] w-20 rounded-[3px] bg-paper-3" />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
