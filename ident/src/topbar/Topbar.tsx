import { Monitor, Moon, Plane, Settings2, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatSiteTag } from "../data/siteTag";
import type { LabelFields } from "../data/store";
import { useIdentStore } from "../data/store";
import type { ClockMode, LabelMode, ThemeMode } from "../data/types";
import { BASEMAPS, type BasemapId } from "../map/styles";
import {
  DesktopReplayTransport,
  replayDeltaLabel,
} from "../replay/ReplayControls";
import { SegButton, Segmented } from "../ui/Segmented";
import { Tooltip } from "../ui/Tooltip";

const THEME_CYCLE: ThemeMode[] = ["system", "light", "dark"];
const THEME_LABEL: Record<ThemeMode, string> = {
  system: "Theme · follow system",
  light: "Theme · light",
  dark: "Theme · dark",
};
const IDENT_GITHUB_URL = "https://github.com/Ident-1090/Ident";

const PRIMARY_BASEMAPS: Array<{
  id: BasemapId;
  label: string;
  tooltip: string;
}> = [
  { id: "ident", label: "MAP", tooltip: "Regular map" },
  { id: "esriSat", label: "SAT", tooltip: "Satellite map" },
  { id: "esriTerrain", label: "TER", tooltip: "Terrain map" },
];

const OTHERS_BASEMAPS: Array<{
  id: BasemapId;
  label: string;
  tooltip: string;
}> = (Object.values(BASEMAPS) as Array<(typeof BASEMAPS)[BasemapId]>)
  .filter((b) => b.group === "others")
  .map((b) => ({ id: b.id, label: b.label, tooltip: b.tooltip }));

const ICON_MODES: Array<{
  key: LabelMode;
  text: string;
  label: string;
}> = [
  { key: "arrow", text: "Arrow", label: "Arrow — directional" },
  { key: "icon", text: "Type", label: "Type — aircraft silhouette" },
];

const LABEL_FIELDS: Array<{
  key: keyof LabelFields;
  label: string;
  tooltip: string;
}> = [
  { key: "cs", label: "CS", tooltip: "Callsign label" },
  { key: "type", label: "Type", tooltip: "Aircraft type label" },
  { key: "alt", label: "Alt", tooltip: "Altitude label" },
  { key: "spd", label: "Spd", tooltip: "Ground speed label" },
  { key: "sqk", label: "Sqk", tooltip: "Squawk code label" },
  { key: "rt", label: "Rt", tooltip: "Route label" },
];

export function Topbar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const receiver = useIdentStore((s) => s.receiver);
  const stationOverride = useIdentStore((s) => s.config.station);
  const theme = useIdentStore((s) => s.settings.theme);
  const clockMode = useIdentStore((s) => s.settings.clock);
  const setSettings = useIdentStore((s) => s.setSettings);
  const labelMode = useIdentStore((s) => s.map.labelMode);
  const setLabelMode = useIdentStore((s) => s.setLabelMode);
  const labelFields = useIdentStore((s) => s.map.labelFields);
  const toggleLabelField = useIdentStore((s) => s.toggleLabelField);
  const basemapId = useIdentStore((s) => s.map.basemapId);
  const setBasemap = useIdentStore((s) => s.setBasemap);
  const updateAvailable = useIdentStore((s) => s.update.status === "available");
  const replay = useIdentStore((s) => s.replay);
  const wsStatus = useIdentStore((s) => s.connectionStatus.ws ?? "connecting");

  function cycleTheme() {
    const i = THEME_CYCLE.indexOf(theme);
    setSettings({ theme: THEME_CYCLE[(i + 1) % THEME_CYCLE.length] });
  }
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const [othersOpen, setOthersOpen] = useState(false);
  const othersRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!othersOpen) return;
    function onDocClick(ev: MouseEvent): void {
      const node = othersRef.current;
      if (node && ev.target instanceof Node && !node.contains(ev.target)) {
        setOthersOpen(false);
      }
    }
    function onKey(ev: KeyboardEvent): void {
      if (ev.key === "Escape") setOthersOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [othersOpen]);

  const othersActive = BASEMAPS[basemapId]?.group === "others";
  const othersLabel = othersActive ? BASEMAPS[basemapId].label : "OTHERS";

  const liveClock = formatTopbarClock(now, clockMode);
  const replayClock =
    replay.mode === "replay" && replay.playheadMs != null
      ? formatReplayClock(
          replay.playheadMs,
          clockMode,
          replay.viewWindow?.rangeMs ??
            Math.max(
              0,
              (replay.availableTo ?? 0) - (replay.availableFrom ?? 0),
            ),
          replay.viewWindow?.fixedEndMs != null &&
            replay.availableTo != null &&
            replay.viewWindow.fixedEndMs < replay.availableTo - 1000,
        )
      : null;
  const clock =
    replayClock != null && replay.playheadMs != null
      ? {
          primary: replay.loading ? "Loading..." : replayClock,
          subtitle: replayDeltaLabel(replay.playheadMs, replay.availableTo),
        }
      : liveClock;
  const site = formatSiteTag(receiver, stationOverride);
  const initialLoading =
    receiver == null && stationOverride == null && wsStatus === "connecting";

  if (initialLoading) {
    return (
      <header className="[grid-area:topbar] flex items-stretch overflow-hidden min-w-0 bg-paper border-b border-(--color-line) text-[13px]">
        <TopbarBrand site={site} />
        <TopbarSkeleton />
        <div className="flex items-stretch shrink-0">
          <Toggle label={THEME_LABEL[theme]} onClick={cycleTheme} tooltip>
            <ThemeIcon size={15} strokeWidth={1.75} aria-hidden="true" />
          </Toggle>
          <Toggle
            label="Settings"
            onClick={onOpenSettings}
            mdOnly
            indicator={updateAvailable}
          >
            <Settings2 size={15} strokeWidth={1.75} aria-hidden="true" />
          </Toggle>
        </div>
      </header>
    );
  }

  return (
    <header className="[grid-area:topbar] flex items-stretch overflow-hidden min-w-0 bg-paper border-b border-(--color-line) text-[13px]">
      <TopbarBrand site={site} />

      {/* Health — clock + map-display controls. Hidden on phone; the drawer
          reprises the receiver/filters/theme controls. */}
      <div className="flex-1 hidden md:flex items-center gap-2 xl:gap-5.5 px-2.5 xl:px-4.5 min-w-0 overflow-hidden">
        <div className="flex shrink-0 flex-col items-start leading-[1.1] tabular-nums mr-1 xl:mr-1.5">
          <b
            data-testid="topbar-clock-primary"
            className={
              "font-mono text-[14px] font-medium tracking-[0.02em] " +
              (replayClock != null
                ? "text-(--color-warn)"
                : "text-(--color-ink)")
            }
          >
            {clock.primary}
          </b>
          <span
            data-testid="topbar-clock-subtitle"
            className={
              "font-mono text-[9.5px] uppercase tracking-widest mt-0.5 whitespace-nowrap " +
              (replay.mode === "replay"
                ? "text-(--color-warn)"
                : "text-ink-faint")
            }
          >
            {clock.subtitle}
          </span>
        </div>

        <DesktopReplayTransport />

        <CtrlGroup label="Icon" compactLabel>
          <Segmented className="self-center">
            {ICON_MODES.map((m) => (
              <SegButton
                key={m.key}
                active={labelMode === m.key}
                onClick={() => setLabelMode(m.key)}
                aria-label={m.label}
                tooltip={m.label}
                tooltipSide="bottom"
              >
                {m.text}
              </SegButton>
            ))}
          </Segmented>
        </CtrlGroup>

        <CtrlGroup label="Labels" compactLabel>
          <Segmented className="self-center">
            {LABEL_FIELDS.map((f) => (
              <SegButton
                key={f.key}
                active={labelFields[f.key]}
                onClick={() => toggleLabelField(f.key)}
                aria-label={`Toggle ${f.label}`}
                tooltip={f.tooltip}
                tooltipSide="bottom"
              >
                {f.label}
              </SegButton>
            ))}
          </Segmented>
        </CtrlGroup>
      </div>

      {/* Spacer so brand hugs the left on phone while right actions hug the
          right edge (flex-1 region above is hidden). */}
      <div className="flex-1 md:hidden" />

      {/* Right actions — map style + theme/settings */}
      <div className="flex items-stretch shrink-0">
        <div
          ref={othersRef}
          className="hidden md:flex items-stretch border-l border-(--color-line) relative"
        >
          {PRIMARY_BASEMAPS.map((s) => {
            const active = basemapId === s.id;
            const base =
              "h-full px-2.75 grid place-items-center font-mono text-[11px] font-medium tracking-[0.04em] border-r border-(--color-line) cursor-pointer";
            const tone = active
              ? "bg-paper-2 text-(--color-ink)"
              : "text-ink-soft hover:text-(--color-ink)";
            return (
              <Tooltip key={s.id} label={s.tooltip} side="bottom">
                <button
                  type="button"
                  aria-label={s.tooltip}
                  aria-pressed={active}
                  className={`${base} ${tone}`}
                  onClick={() => setBasemap(s.id)}
                >
                  {s.label}
                </button>
              </Tooltip>
            );
          })}
          <Tooltip label="More maps" side="bottom">
            <button
              type="button"
              aria-label="More maps"
              aria-pressed={othersActive}
              aria-haspopup="menu"
              aria-expanded={othersOpen}
              className={
                "h-full px-2.75 grid place-items-center font-mono text-[11px] font-medium tracking-[0.04em] cursor-pointer whitespace-nowrap " +
                (othersActive
                  ? "bg-paper-2 text-(--color-ink)"
                  : "text-ink-faint hover:text-(--color-ink)")
              }
              onClick={() => setOthersOpen((v) => !v)}
            >
              {othersLabel} ▾
            </button>
          </Tooltip>
          {othersOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-0.5 z-50 min-w-30 bg-paper border border-(--color-line) rounded-[3px] shadow-md flex flex-col"
            >
              {OTHERS_BASEMAPS.map((s) => {
                const active = basemapId === s.id;
                return (
                  <Tooltip key={s.id} label={s.tooltip} side="left">
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-label={s.tooltip}
                      aria-checked={active}
                      className={
                        "w-full px-2.75 py-1.5 text-left font-mono text-[11px] font-medium tracking-[0.04em] cursor-pointer " +
                        (active
                          ? "bg-paper-2 text-(--color-ink)"
                          : "text-ink-soft hover:bg-paper-2 hover:text-(--color-ink)")
                      }
                      onClick={() => {
                        setBasemap(s.id);
                        setOthersOpen(false);
                      }}
                    >
                      {s.label}
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          )}
        </div>
        <Toggle label={THEME_LABEL[theme]} onClick={cycleTheme} tooltip>
          <ThemeIcon size={15} strokeWidth={1.75} aria-hidden="true" />
        </Toggle>
        <Toggle
          label="Settings"
          onClick={onOpenSettings}
          mdOnly
          indicator={updateAvailable}
        >
          <Settings2 size={15} strokeWidth={1.75} aria-hidden="true" />
        </Toggle>
      </div>
    </header>
  );
}

function TopbarBrand({ site }: { site: string | null }) {
  return (
    <div className="flex items-center gap-2.5 px-4 border-r border-(--color-line) shrink-0">
      <div className="w-5.5 h-5.5 rounded-sm bg-(--color-ink) text-bg grid place-items-center">
        <Plane className="w-3.25 h-3.25" strokeWidth={2.25} />
      </div>
      <a
        href={IDENT_GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open Ident on GitHub"
        className="font-semibold tracking-[-0.01em] text-[13.5px] text-(--color-ink) no-underline hover:text-(--color-accent)"
      >
        Ident
      </a>
      {site != null && (
        <div className="font-mono text-[11px] font-medium text-ink-soft border border-line-strong rounded-[3px] px-1.5 py-px">
          {site}
        </div>
      )}
    </div>
  );
}

function TopbarSkeleton() {
  return (
    <div
      data-testid="topbar-skeleton"
      className="flex-1 hidden md:flex items-center gap-5 px-4 min-w-0 overflow-hidden"
    >
      <div className="grid gap-1.25 shrink-0 animate-pulse">
        <div className="h-3.5 w-18 rounded-[2px] bg-paper-3" />
        <div className="h-2.5 w-22 rounded-[2px] bg-paper-2 border border-line-soft" />
      </div>
      <div className="flex h-[22px] w-28 rounded-[4px] border border-(--color-line) bg-paper overflow-hidden animate-pulse">
        <div className="flex-1 border-r border-(--color-line)" />
        <div className="flex-1 border-r border-(--color-line)" />
        <div className="flex-1" />
      </div>
      <div className="hidden lg:flex items-center gap-1.5">
        <div className="h-2.5 w-8 rounded-[2px] bg-paper-3 animate-pulse" />
        <div className="h-[22px] w-29 rounded-[3px] border border-(--color-line) bg-paper animate-pulse" />
      </div>
      <div className="hidden xl:flex items-center gap-1.5">
        <div className="h-2.5 w-10 rounded-[2px] bg-paper-3 animate-pulse" />
        <div className="h-[22px] w-36 rounded-[3px] border border-(--color-line) bg-paper animate-pulse" />
      </div>
      <div className="flex-1" />
    </div>
  );
}

function CtrlGroup({
  label,
  children,
  className = "flex",
  compactLabel = false,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  compactLabel?: boolean;
}) {
  return (
    <div className={`${className} items-center gap-1.5 shrink-0`}>
      <span
        className={
          "font-mono text-[9.5px] text-ink-faint uppercase tracking-widest " +
          (compactLabel ? "hidden xl:inline" : "")
        }
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function Toggle({
  label,
  onClick,
  children,
  mdOnly,
  tooltip = false,
  indicator = false,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  mdOnly?: boolean;
  tooltip?: boolean;
  indicator?: boolean;
}) {
  const visibility = mdOnly ? "hidden md:flex" : "flex";
  const button = (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`${visibility} relative h-full items-center px-3 border-l border-(--color-line) text-ink-soft cursor-pointer text-[13px] hover:bg-paper-2 hover:text-(--color-ink)`}
    >
      {children}
      {indicator && (
        <span
          aria-hidden="true"
          className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-(--color-warn)"
        />
      )}
    </button>
  );

  if (!tooltip) return button;
  return (
    <Tooltip label={label} side="bottom">
      {button}
    </Tooltip>
  );
}

export function formatTopbarClock(
  date: Date,
  mode: "utc" | "local",
): { primary: string; subtitle: string } {
  const utcHh = String(date.getUTCHours()).padStart(2, "0");
  const utcMm = String(date.getUTCMinutes()).padStart(2, "0");
  const utcSs = String(date.getUTCSeconds()).padStart(2, "0");
  const utcFull = `${utcHh}:${utcMm}:${utcSs}Z`;
  const utcShort = `${utcHh}:${utcMm}Z`;

  const localHh = String(date.getHours()).padStart(2, "0");
  const localMm = String(date.getMinutes()).padStart(2, "0");
  const localSs = String(date.getSeconds()).padStart(2, "0");
  const localFull = `${localHh}:${localMm}:${localSs}`;
  const localShort = `${localHh}:${localMm}`;

  const tz = localTzAbbrev(date);

  if (mode === "local") {
    return { primary: `${localFull} ${tz}`, subtitle: `ZULU ${utcShort}` };
  }
  return { primary: utcFull, subtitle: `LOCAL ${localShort} ${tz}` };
}

function formatReplayClock(
  playheadMs: number,
  clockMode: ClockMode,
  rangeMs: number,
  pastWindow: boolean,
): string {
  const d = new Date(playheadMs);
  const hh = twoDigit(clockMode === "utc" ? d.getUTCHours() : d.getHours());
  const mm = twoDigit(clockMode === "utc" ? d.getUTCMinutes() : d.getMinutes());
  const ss = twoDigit(clockMode === "utc" ? d.getUTCSeconds() : d.getSeconds());
  if (rangeMs > 24 * 60 * 60_000 || pastWindow) {
    const monthDay = d
      .toLocaleString("en", {
        month: "short",
        day: "numeric",
        timeZone: clockMode === "utc" ? "UTC" : undefined,
      })
      .toUpperCase();
    return `${monthDay} ${hh}:${mm}:${ss}${clockMode === "utc" ? "Z" : ` ${localTzAbbrev(d)}`}`;
  }
  return `${hh}:${mm}:${ss}${clockMode === "utc" ? "Z" : ` ${localTzAbbrev(d)}`}`;
}

function twoDigit(value: number): string {
  return String(value).padStart(2, "0");
}

function localTzAbbrev(date: Date): string {
  // Best-effort: Intl's "short" timeZoneName yields e.g. "PDT". Falls back to
  // "LT" (local time) when the platform returns a numeric offset instead.
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      timeZoneName: "short",
    }).formatToParts(date);
    const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    if (tz && !/^GMT/i.test(tz) && !/^UTC/i.test(tz)) return tz;
  } catch {
    // fall through
  }
  return "LT";
}
