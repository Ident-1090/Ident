import { Plane } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { App } from "../app/App";
import { usePreferencesStore } from "../data/preferences";
import { useIdentStore } from "../data/store";
import { DemoTour } from "./DemoTour";

const APP_VERSION =
  typeof __IDENT_VERSION__ !== "undefined" ? __IDENT_VERSION__ : "";
const DOCS_URL = "docs/";
const INSTALL_URL = "docs/getting-started/install";
const GH_URL = "https://github.com/Ident-1090/Ident";
const PHONE_QUERY = "(max-width: 767px)";

export function DemoLanding() {
  const [phone, setPhone] = useState(
    () => window.matchMedia(PHONE_QUERY).matches,
  );
  // Open from first paint so the tour dock reserves its space immediately (a
  // skeleton fills it until the tour is ready), avoiding a layout shift when
  // the guided tour appears.
  const [tourOpen, setTourOpen] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setPhone(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    // The app's global CSS pins the page to the viewport; the landing owns the
    // scroll instead. Relax it while mounted.
    const root = document.documentElement;
    const appRoot = document.getElementById("root");
    root.style.height = "auto";
    document.body.style.height = "auto";
    document.body.style.overflow = "hidden";
    if (appRoot) appRoot.style.height = "auto";
    return () => {
      root.style.height = "";
      document.body.style.height = "";
      document.body.style.overflow = "";
      if (appRoot) appRoot.style.height = "";
    };
  }, []);

  useEffect(() => {
    // Open on a clean map: the desktop tour reveals the sidebar and inspector
    // step by step, so start with the rail collapsed and nothing selected.
    if (phone) return;
    usePreferencesStore
      .getState()
      .setLayoutPreferences({ railCollapsed: true });
    useIdentStore.getState().select(null);
  }, [phone]);

  const scrollToShowcase = () =>
    document.getElementById("dl-showcase")?.scrollIntoView({
      behavior: "smooth",
    });

  return (
    <div className="dl-root flex h-[100dvh] flex-col overflow-hidden bg-bg text-ink">
      {/* The embedded app sizes to its hero section (not 100dvh) so the tour
          dock can claim a slice of the viewport without covering anything. */}
      <style>{".dl-hero .app-shell{height:100%}"}</style>

      <div className="dl-scroll flex-1 min-h-0 overflow-y-auto snap-y snap-mandatory scroll-smooth">
        <section className="dl-hero snap-start relative h-full [contain:paint]">
          <App />
          {!tourOpen && (
            <button
              type="button"
              onClick={scrollToShowcase}
              aria-label="Scroll to install"
              className="absolute left-1/2 bottom-9 z-30 -translate-x-1/2 flex flex-col items-center gap-0.5 rounded-full border border-(--color-line) bg-paper/80 px-3.5 pt-1.5 pb-1 text-[10.5px] uppercase tracking-wider text-ink-soft backdrop-blur-sm cursor-pointer hover:text-ink hover:border-(--color-line-strong)"
            >
              <span>Run it yourself</span>
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="w-3.5 h-3.5"
              >
                <path
                  d="m6 9 6 6 6-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </section>

        <section
          id="dl-showcase"
          className="snap-start relative grid min-h-full items-center justify-center gap-[clamp(48px,8vw,120px)] bg-bg px-6 py-16 md:grid-cols-[auto_auto] md:px-[clamp(40px,8vw,130px)]"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(176,180,184,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(176,180,184,0.10)_1px,transparent_1px)] [background-size:80px_80px] [mask-image:radial-gradient(ellipse_at_50%_50%,#000_0%,transparent_75%)]"
          />

          {!phone && <ShowcasePhone />}

          <div id="dl-pitch" className="relative w-[340px] max-w-full">
            <div className="mb-3.5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
              <span className="grid h-5 w-5 place-items-center rounded-[3px] bg-ink text-(--color-paper)">
                <Plane className="h-3 w-3" strokeWidth={2.25} aria-hidden />
              </span>
              <b className="font-sans text-[13px] font-semibold normal-case tracking-[-0.01em] text-ink">
                Ident
              </b>
              {APP_VERSION && (
                <span className="font-normal text-ink-soft">{APP_VERSION}</span>
              )}
            </div>

            <div className="flex flex-col overflow-hidden rounded-[5px] border border-(--color-line) bg-paper">
              <ActionRow
                href={INSTALL_URL}
                title="Install"
                sub="getting-started"
                primary
                icon={
                  <>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </>
                }
              />
              <ActionRow
                href={DOCS_URL}
                title="Documentation"
                sub="docs/"
                icon={
                  <>
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </>
                }
              />
              <ActionRow
                href={GH_URL}
                external
                title="GitHub"
                sub="Ident-1090/Ident"
                icon={
                  <path
                    fill="currentColor"
                    stroke="none"
                    d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11.05 11.05 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.05.78 2.12v3.14c0 .31.21.67.8.55C20.21 21.38 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z"
                  />
                }
              />
            </div>

            <div className="mt-3.5 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">
              <button
                type="button"
                onClick={() => setTourOpen(true)}
                className="border-b border-dotted border-(--color-line-strong) pb-px text-ink-soft hover:border-(--color-ink) hover:text-ink"
              >
                ↺ Replay the tour
              </button>
              <span>Synthetic data</span>
            </div>
          </div>
        </section>
      </div>

      <DemoTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        phone={phone}
      />
    </div>
  );
}

function ActionRow({
  href,
  title,
  sub,
  icon,
  primary,
  external,
}: {
  href: string;
  title: string;
  sub: string;
  icon: ReactNode;
  primary?: boolean;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="grid grid-cols-[34px_1fr_auto] items-center gap-3.5 border-b border-(--color-line-soft) px-4 py-3.5 last:border-b-0 hover:bg-paper-2"
    >
      <span
        className={`grid h-[30px] w-[30px] place-items-center rounded-[4px] border ${
          primary
            ? "border-(--color-accent) bg-(--color-accent) text-[#04181d]"
            : "border-(--color-line-soft) bg-bg text-ink-soft"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-[15px] w-[15px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icon}
        </svg>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[14px] font-medium tracking-[-0.005em] text-ink">
          {title}
        </span>
        <span className="truncate font-mono text-[11px] text-ink-faint">
          {sub}
        </span>
      </span>
      <span className="font-mono text-[12px] text-ink-faint">→</span>
    </a>
  );
}

// A generic phone running the real app at phone width — interactive, and a
// silent demonstration that Ident works on mobile.
function ShowcasePhone() {
  // The phone renders full size — a real-phone ~390px viewport so the app's
  // mobile layout looks right and the map attribution fits on one line — then
  // the whole frame is scaled down to a compact footprint. The iframe itself is
  // never transformed, so its 100vw/100dvh stay correct and it fills with no
  // black edges; only the wrapper around it is scaled.
  return (
    <div
      data-tour="phone"
      className="relative h-[699px] w-[330px] shrink-0 justify-self-center md:justify-self-end"
    >
      <div
        className="absolute left-0 top-0 h-[868px] w-[410px] origin-top-left"
        style={{ transform: "scale(0.805)" }}
      >
        <div className="absolute inset-0 rounded-[46px] bg-[#1a1c1f] p-2.5 shadow-[0_30px_70px_-25px_rgba(0,0,0,0.35),0_10px_30px_-15px_rgba(0,0,0,0.2)]">
          <iframe
            src="?app"
            title="Ident on mobile"
            loading="lazy"
            className="block h-full w-full rounded-[37px] border-0 bg-bg"
          />
        </div>
        <span className="absolute -left-px top-[160px] h-11 w-0.5 rounded-sm bg-[#15171a]" />
        <span className="absolute -left-px top-[225px] h-[70px] w-0.5 rounded-sm bg-[#15171a]" />
        <span className="absolute -right-px top-[200px] h-[92px] w-0.5 rounded-sm bg-[#15171a]" />
      </div>
    </div>
  );
}
