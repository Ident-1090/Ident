import { Monitor, Moon, Plane, Settings2, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatSiteTag } from "../data/siteTag";
import type { LabelFields } from "../data/store";
import { useIdentStore } from "../data/store";
import type { LabelMode, ThemeMode } from "../data/types";
import { BASEMAPS, type BasemapId } from "../map/styles";
import { SegButton, Segmented } from "../ui/Segmented";
import { Tooltip } from "../ui/Tooltip";

const THEME_CYCLE: ThemeMode[] = ["system", "light", "dark"];
const THEME_LABEL: Record<ThemeMode, string> = {
  system: "Theme · follow system",
  light: "Theme · light",
  dark: "Theme · dark",
};

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

  const clock = formatTopbarClock(now, clockMode);
  const site = formatSiteTag(receiver, stationOverride);

  return (
    <header className="[grid-area:topbar] flex items-stretch overflow-hidden min-w-0 bg-paper border-b border-(--color-line) text-[13px]">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 border-r border-(--color-line) shrink-0">
        <div className="w-5.5 h-5.5 rounded-sm bg-(--color-ink) text-bg grid place-items-center">
          <Plane className="w-3.25 h-3.25" strokeWidth={2.25} />
        </div>
        <div className="font-semibold tracking-[-0.01em] text-[13.5px]">
          Ident
        </div>
        {site != null && (
          <div className="font-mono text-[11px] font-medium text-ink-soft border border-line-strong rounded-[3px] px-1.5 py-px">
            {site}
          </div>
        )}
      </div>

      {/* Health — clock + map-display controls. Hidden on phone; the drawer
          reprises the receiver/filters/theme controls. */}
      <div className="flex-1 hidden md:flex items-center gap-5.5 px-4.5 min-w-0 overflow-hidden">
        <div className="flex flex-col items-start leading-[1.1] tabular-nums mr-1.5">
          <b className="font-mono text-[14px] text-(--color-ink) font-medium tracking-[0.02em]">
            {clock.primary}
          </b>
          <span className="font-mono text-[9.5px] text-ink-faint uppercase tracking-widest mt-0.5">
            {clock.subtitle}
          </span>
        </div>

        <CtrlGroup label="Icon">
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

        <CtrlGroup label="Labels">
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

function CtrlGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-[9.5px] text-ink-faint uppercase tracking-widest">
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
