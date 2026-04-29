import {
  Menu,
  Monitor,
  Moon,
  Plane,
  Search,
  SlidersHorizontal,
  Sun,
  X,
} from "lucide-react";
import { useLayoutEffect, useMemo, useState } from "react";
import { formatSiteTag } from "../data/siteTag";
import type { LabelFields } from "../data/store";
import { selectDisplayAircraftMap, useIdentStore } from "../data/store";
import type { LabelMode, ThemeMode } from "../data/types";
import { Inspector } from "../inspector/Inspector";
import { BASEMAPS, type BasemapId } from "../map/styles";
import { FiltersPanel } from "../rails/FiltersPanel";
import { TrafficList } from "../rails/TrafficList";
import { MobileReplayDock, MobileReplayFab } from "../replay/ReplayControls";
import { useReceiverDiagnostics } from "../statusbar/StatusBar";
import { SectionHead } from "../ui/SectionHead";
import { SegButton, Segmented } from "../ui/Segmented";
import { Tooltip } from "../ui/Tooltip";
import { BottomSheet, type SheetSnap } from "./BottomSheet";
import { Drawer } from "./Drawer";

type DrawerTab = "traffic" | "filters" | "receiver" | "settings";

const PRIMARY_BASEMAPS: Array<{
  id: BasemapId;
  label: string;
  tooltip: string;
}> = [
  { id: "ident", label: "MAP", tooltip: "Regular map" },
  { id: "esriSat", label: "SAT", tooltip: "Satellite map" },
  { id: "esriTerrain", label: "TER", tooltip: "Terrain map" },
];
const IDENT_GITHUB_URL = "https://github.com/Ident-1090/Ident";
const OTHERS_BASEMAPS: Array<{
  id: BasemapId;
  label: string;
  tooltip: string;
}> = (Object.values(BASEMAPS) as Array<(typeof BASEMAPS)[BasemapId]>)
  .filter((basemap) => basemap.group === "others")
  .map((basemap) => ({
    id: basemap.id,
    label: basemap.label,
    tooltip: basemap.tooltip,
  }));

const ICON_MODES: Array<{
  key: LabelMode;
  text: string;
  label: string;
}> = [
  { key: "arrow", text: "Arrow", label: "Arrow" },
  { key: "icon", text: "Type", label: "Type" },
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

/**
 * Phone-only overlay. Mount alongside the map controls when viewport is < md. Hosts:
 *  - Top-right hamburger FAB → slide-in tabbed Drawer with Traffic, Filters,
 *    Receiver, and Theme zones.
 *  - Selected aircraft opens an Inspector bottom sheet; dismissing it clears
 *    selection so no always-on bottom UI competes with Safari chrome.
 *
 * The map controls already render their own bottom-right ZoomHUD.
 */
export function MobileShell({
  onOpenOmnibox,
  onOpenSettings,
}: {
  onOpenOmnibox: () => void;
  onOpenSettings: () => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("traffic");
  const [snap, setSnap] = useState<SheetSnap>("half");
  const [replayDockOpen, setReplayDockOpen] = useState(false);
  const selectedHex = useIdentStore((s) => s.selectedHex);
  const aircraft = useIdentStore(selectDisplayAircraftMap);
  const select = useIdentStore((s) => s.select);
  const hasSelected = selectedHex != null && aircraft.has(selectedHex);

  useLayoutEffect(() => {
    if (hasSelected) setSnap("half");
  }, [hasSelected]);

  return (
    <>
      <div className="mobile-fab-row absolute z-10 flex flex-col items-end gap-2">
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => {
            setDrawerTab("traffic");
            setDrawerOpen(true);
          }}
          className="liquid-glass w-11 h-11 grid place-items-center rounded-[6px] text-(--color-ink) cursor-pointer"
        >
          <Menu size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Open search"
          onClick={onOpenOmnibox}
          className="liquid-glass w-11 h-11 grid place-items-center rounded-[6px] text-(--color-ink) cursor-pointer"
        >
          <Search size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <MobileReplayFab
          open={replayDockOpen}
          onOpenChange={setReplayDockOpen}
        />
      </div>

      <MobileReplayDock open={replayDockOpen} />

      {hasSelected && (
        <BottomSheet
          snap={snap}
          onSnapChange={setSnap}
          onDismiss={() => select(null)}
          label="Aircraft inspector sheet"
        >
          <Inspector />
        </BottomSheet>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        label="Mobile sidebar"
      >
        <DrawerContent
          activeTab={drawerTab}
          onSelectTab={setDrawerTab}
          onClose={() => setDrawerOpen(false)}
          onOpenSettings={() => {
            setDrawerOpen(false);
            onOpenSettings();
          }}
        />
      </Drawer>
    </>
  );
}

function DrawerContent({
  activeTab,
  onSelectTab,
  onClose,
  onOpenSettings,
}: {
  activeTab: DrawerTab;
  onSelectTab: (tab: DrawerTab) => void;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const { cells, buildLabel } = useReceiverDiagnostics();
  const updateAvailable = useIdentStore((s) => s.update.status === "available");
  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="grid grid-cols-[1fr_1fr_1fr_1fr_44px] border-b border-(--color-line) flex-none">
        <DrawerTabButton
          tab="traffic"
          activeTab={activeTab}
          onSelect={onSelectTab}
        >
          Traffic
        </DrawerTabButton>
        <DrawerTabButton
          tab="filters"
          activeTab={activeTab}
          onSelect={onSelectTab}
        >
          Filters
        </DrawerTabButton>
        <DrawerTabButton
          tab="receiver"
          activeTab={activeTab}
          onSelect={onSelectTab}
        >
          Rx
        </DrawerTabButton>
        <DrawerTabButton
          tab="settings"
          activeTab={activeTab}
          onSelect={onSelectTab}
          indicator={updateAvailable}
        >
          Settings
        </DrawerTabButton>
        <button
          type="button"
          aria-label="Close drawer"
          onClick={onClose}
          className="h-11 w-full grid place-items-center border-0 border-l border-(--color-line) bg-transparent text-ink-soft hover:text-(--color-ink) cursor-pointer"
        >
          <X size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="mobile-drawer-body flex-1 min-h-0 overflow-hidden flex flex-col">
        {activeTab === "traffic" && <TrafficList onAircraftSelect={onClose} />}
        {activeTab === "filters" && (
          <div className="h-full overflow-y-auto border-b border-(--color-line)">
            <FiltersPanel />
          </div>
        )}
        {activeTab === "receiver" && (
          <section className="h-full overflow-y-auto px-4 py-4">
            <SectionHeading>Receiver</SectionHeading>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-2">
              {cells.map((c) => (
                <div key={c.k} className="flex flex-col min-w-0">
                  <span className="font-mono text-[9.5px] uppercase tracking-widest text-ink-faint">
                    {c.k}
                  </span>
                  <span
                    className={
                      "font-mono text-[13px] tabular-nums " +
                      (c.warn ? "text-(--color-warn)" : "text-(--color-ink)")
                    }
                  >
                    {c.v}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 font-mono text-[10px] text-ink-faint">
              {buildLabel}
            </div>
          </section>
        )}
        {activeTab === "settings" && (
          <SettingsTab onOpenSettings={onOpenSettings} />
        )}
      </div>
    </div>
  );
}

function DrawerTabButton({
  tab,
  activeTab,
  onSelect,
  indicator = false,
  children,
}: {
  tab: DrawerTab;
  activeTab: DrawerTab;
  onSelect: (tab: DrawerTab) => void;
  indicator?: boolean;
  children: React.ReactNode;
}) {
  const active = tab === activeTab;
  const tooltip = tab === "receiver" ? "Receiver" : String(children);
  const button = (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(tab)}
      className={
        "relative h-11 w-full min-w-0 border-0 border-r border-(--color-line) bg-transparent px-1 font-mono text-[9px] uppercase tracking-widest cursor-pointer " +
        (active
          ? "text-(--color-ink) bg-paper-2"
          : "text-ink-faint hover:text-(--color-ink)")
      }
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

  if (tab !== "receiver") return button;
  return (
    <Tooltip label={tooltip} side="bottom">
      {button}
    </Tooltip>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <SectionHead as="h3" className="font-mono mb-2">
      {children}
    </SectionHead>
  );
}

function SettingsTab({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <section className="h-full overflow-y-auto px-4 py-4 space-y-5">
      <div>
        <SectionHeading>Theme</SectionHeading>
        <ThemeSegmented />
      </div>
      <div>
        <SectionHeading>Map</SectionHeading>
        <BasemapControl />
      </div>
      <div>
        <SectionHeading>Labels</SectionHeading>
        <LabelControl />
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-[6px] border border-(--color-line-strong) bg-(--color-paper-2) px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-(--color-ink) hover:bg-(--color-paper-3)"
      >
        <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden="true" />
        More settings
      </button>
    </section>
  );
}

function LabelControl() {
  const labelMode = useIdentStore((s) => s.map.labelMode);
  const setLabelMode = useIdentStore((s) => s.setLabelMode);
  const labelFields = useIdentStore((s) => s.map.labelFields);
  const toggleLabelField = useIdentStore((s) => s.toggleLabelField);

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
          Icon
        </div>
        <Segmented size="lg" className="grid grid-cols-2">
          {ICON_MODES.map((mode) => (
            <SegButton
              key={mode.key}
              size="lg"
              active={labelMode === mode.key}
              aria-pressed={labelMode === mode.key}
              aria-label={`Icon ${mode.label}`}
              tooltip={`Icon ${mode.label}`}
              onClick={() => setLabelMode(mode.key)}
            >
              {mode.text}
            </SegButton>
          ))}
        </Segmented>
      </div>
      <div>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
          Fields
        </div>
        <Segmented size="lg" className="grid grid-cols-3">
          {LABEL_FIELDS.map((field) => (
            <SegButton
              key={field.key}
              size="lg"
              active={labelFields[field.key]}
              aria-pressed={labelFields[field.key]}
              aria-label={`Toggle ${field.label}`}
              tooltip={field.tooltip}
              onClick={() => toggleLabelField(field.key)}
            >
              {field.label}
            </SegButton>
          ))}
        </Segmented>
      </div>
    </div>
  );
}

function BasemapControl() {
  const basemapId = useIdentStore((s) => s.map.basemapId);
  const setBasemap = useIdentStore((s) => s.setBasemap);
  const [othersOpen, setOthersOpen] = useState(false);
  const othersActive = BASEMAPS[basemapId]?.group === "others";
  const othersLabel = othersActive ? BASEMAPS[basemapId].label : "OTHERS";

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-4 border border-(--color-line) rounded-sm overflow-hidden">
        {PRIMARY_BASEMAPS.map((option) => {
          const active = basemapId === option.id;
          return (
            <Tooltip key={option.id} label={option.tooltip} side="top">
              <button
                type="button"
                aria-label={option.tooltip}
                aria-pressed={active}
                onClick={() => {
                  setBasemap(option.id);
                  setOthersOpen(false);
                }}
                className={
                  "h-9 w-full min-w-0 border-0 border-r border-(--color-line) bg-transparent px-1 font-mono text-[10px] uppercase tracking-[0.08em] cursor-pointer " +
                  (active
                    ? "bg-paper-2 text-(--color-ink)"
                    : "text-ink-soft hover:text-(--color-ink)")
                }
              >
                {option.label}
              </button>
            </Tooltip>
          );
        })}
        <Tooltip label="More maps" side="top">
          <button
            type="button"
            aria-label="More maps"
            aria-pressed={othersActive}
            aria-haspopup="menu"
            aria-expanded={othersOpen}
            onClick={() => setOthersOpen((open) => !open)}
            className={
              "h-9 w-full min-w-0 border-0 bg-transparent px-1 font-mono text-[10px] uppercase tracking-[0.08em] cursor-pointer truncate " +
              (othersActive
                ? "bg-paper-2 text-(--color-ink)"
                : "text-ink-faint hover:text-(--color-ink)")
            }
          >
            {othersLabel} ▾
          </button>
        </Tooltip>
      </div>
      {othersOpen && (
        <div
          role="menu"
          className="flex flex-col border border-(--color-line) rounded-sm overflow-hidden [&>*:last-child>button]:border-b-0"
        >
          {OTHERS_BASEMAPS.map((option) => {
            const active = basemapId === option.id;
            return (
              <Tooltip key={option.id} label={option.tooltip} side="left">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-label={option.tooltip}
                  aria-checked={active}
                  onClick={() => {
                    setBasemap(option.id);
                    setOthersOpen(false);
                  }}
                  className={
                    "h-9 w-full border-0 border-b border-(--color-line) bg-transparent px-3 text-left font-mono text-[10px] uppercase tracking-[0.08em] cursor-pointer " +
                    (active
                      ? "bg-paper-2 text-(--color-ink)"
                      : "text-ink-soft hover:text-(--color-ink)")
                  }
                >
                  {option.label}
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}

const THEME_OPTIONS: Array<{
  key: ThemeMode;
  label: string;
  Icon: typeof Monitor;
}> = [
  { key: "system", label: "System", Icon: Monitor },
  { key: "light", label: "Light", Icon: Sun },
  { key: "dark", label: "Dark", Icon: Moon },
];

function ThemeSegmented() {
  const theme = useIdentStore((s) => s.settings.theme);
  const setSettings = useIdentStore((s) => s.setSettings);
  const options = useMemo(() => THEME_OPTIONS, []);
  return (
    <Segmented size="lg">
      {options.map((o) => {
        const active = theme === o.key;
        return (
          <SegButton
            key={o.key}
            size="lg"
            active={active}
            aria-pressed={active}
            aria-label={o.label}
            tooltip={o.label}
            onClick={() => setSettings({ theme: o.key })}
          >
            <o.Icon size={14} strokeWidth={1.75} aria-hidden="true" />
          </SegButton>
        );
      })}
    </Segmented>
  );
}

export function MobileLogoHud() {
  const receiver = useIdentStore((s) => s.receiver);
  const stationOverride = useIdentStore((s) => s.config.station);
  const site = formatSiteTag(receiver, stationOverride);
  return (
    <div className="mobile-logo-hud liquid-glass flex items-center gap-2 h-11 px-2.5 rounded-[6px] text-(--color-ink)">
      <div className="w-5.5 h-5.5 rounded-sm bg-(--color-ink) text-bg grid place-items-center">
        <Plane
          className="w-3.25 h-3.25"
          strokeWidth={2.25}
          aria-hidden="true"
        />
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
