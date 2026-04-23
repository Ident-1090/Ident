import { useEffect, useLayoutEffect, useState } from "react";
import { startFeed } from "../data/feed";
import { useIdentStore } from "../data/store";
import { startUpdateStatusPolling } from "../data/update";
import { logMapTiming } from "../debug/mapTiming";
import { Inspector } from "../inspector/Inspector";
import { MapEngine } from "../map/MapEngine";
import { MapOverlay } from "../map/MapOverlay";
import { MobileShell } from "../mobile/MobileShell";
import { PHONE_QUERY, useMediaQuery } from "../mobile/useMediaQuery";
import { Omnibox } from "../omnibox/Omnibox";
import { Rail } from "../rails/Rail";
import { SettingsModal } from "../settings/SettingsModal";
import { StatusBar } from "../statusbar/StatusBar";
import { useAppliedTheme } from "../theme/useTheme";
import { Topbar } from "../topbar/Topbar";
import { ErrorBoundary } from "./ErrorBoundary";
import { PwaUpdatePrompt } from "./PwaUpdatePrompt";

export function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [omniboxOpen, setOmniboxOpen] = useState(false);
  useAppliedTheme();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const aircraft = useIdentStore((s) => s.aircraft);
  const selected = useIdentStore((s) => s.selectedHex);
  const select = useIdentStore((s) => s.select);
  const hasSelectedAircraft = selected != null && aircraft.has(selected);

  useEffect(() => {
    const stop = startFeed();
    return stop;
  }, []);

  useEffect(() => {
    const stop = startUpdateStatusPolling();
    return stop;
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOmniboxOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        if (settingsOpen || omniboxOpen || !hasSelectedAircraft) return;
        const mobileSidebar = document.querySelector(
          '[role="dialog"][aria-label="Mobile sidebar"][aria-hidden="false"]',
        );
        if (mobileSidebar) return;
        e.preventDefault();
        select(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasSelectedAircraft, omniboxOpen, select, settingsOpen]);

  useLayoutEffect(() => {
    logMapTiming("app layout commit", {
      selectedHex: selected ?? "none",
      inspector: hasSelectedAircraft,
    });
  }, [selected, hasSelectedAircraft]);

  // Phone: map fills the whole shell; brand + actions overlay as HUDs.
  // Desktop keeps the traffic rail at its full width; the map column absorbs
  // narrower windows instead of compressing the sidebar.
  const base =
    "app-shell grid w-screen relative grid-rows-[1fr] md:grid-rows-[48px_1fr_30px] " +
    "grid-cols-[1fr] " +
    "md:[grid-template-areas:'topbar_topbar''left_canvas''status_status'] " +
    "[grid-template-areas:'canvas']";
  const desktopCols = "md:grid-cols-[340px_minmax(0,1fr)]";

  return (
    <div className={`${base} ${desktopCols}`}>
      <div className="hidden md:contents">
        <Topbar onOpenSettings={() => setSettingsOpen(true)} />
      </div>
      <div className="hidden md:contents">
        <Rail onOpenOmnibox={() => setOmniboxOpen(true)} />
      </div>
      <MapEngine>
        <MapOverlay />
        {hasSelectedAircraft && (
          <div
            data-testid="floating-inspector"
            className="floating-inspector-panel hidden md:block absolute top-3 right-3 bottom-3 z-20 pointer-events-auto"
            style={{
              width: "var(--floating-inspector-width)",
              maxWidth: "calc(100% - 24px)",
            }}
          >
            <Inspector variant="floating" />
          </div>
        )}
      </MapEngine>
      <div className="hidden md:contents">
        <StatusBar />
      </div>
      {isPhone && (
        <MobileShell
          onOpenOmnibox={() => setOmniboxOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <Omnibox open={omniboxOpen} onClose={() => setOmniboxOpen(false)} />
      <PwaUpdatePrompt />
    </div>
  );
}
