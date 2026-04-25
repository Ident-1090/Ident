import { ExternalLink, X } from "lucide-react";
import { useState } from "react";
import {
  isReleaseUpdateDismissed,
  usePreferencesStore,
} from "../data/preferences";
import { useIdentStore } from "../data/store";

export function UpdatePrompt() {
  const update = useIdentStore((s) => s.update);
  const updateDismissal = usePreferencesStore((s) => s.updateDismissal);
  const dismissReleaseUpdate = usePreferencesStore(
    (s) => s.dismissReleaseUpdate,
  );
  const [dismissedReleaseKey, setDismissedReleaseKey] = useState<string | null>(
    null,
  );
  const releaseVersion = update.latest?.version?.trim() || null;
  const releaseKey = releaseVersion ?? update.latest?.url ?? "available";
  const releaseDismissed =
    releaseKey === dismissedReleaseKey ||
    isReleaseUpdateDismissed(releaseVersion, updateDismissal);
  const releaseAvailable = update.status === "available" && !releaseDismissed;

  if (!releaseAvailable) return null;

  const latestVersion = update.latest?.version?.trim();
  const releaseLabel = latestVersion
    ? `Ident ${latestVersion} is available.`
    : "Ident update available.";

  return (
    <div
      role="status"
      aria-live="polite"
      className="update-prompt fixed top-[calc(var(--mobile-top-chrome)+104px)] right-[calc(12px+var(--safe-area-right))] md:top-[60px] md:right-3 z-40 max-w-[min(320px,calc(100vw-24px))] bg-paper border border-(--color-line) rounded-[6px] shadow-md p-3 flex items-center gap-2 text-[12px] text-(--color-ink)"
    >
      <span className="flex-1 min-w-0">{releaseLabel}</span>
      {update.latest?.url && (
        <a
          href={update.latest.url}
          target="_blank"
          rel="noreferrer"
          aria-label="Release notes"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-line-strong text-(--color-ink) hover:bg-paper-2 cursor-pointer"
        >
          <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
        </a>
      )}
      <button
        type="button"
        aria-label="Dismiss update"
        className="text-ink-soft hover:text-(--color-ink) cursor-pointer"
        onClick={() => {
          setDismissedReleaseKey(releaseKey);
          if (releaseVersion) dismissReleaseUpdate(releaseVersion);
        }}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
