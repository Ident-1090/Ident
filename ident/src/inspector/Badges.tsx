import type { Aircraft } from "../data/types";

export const BADGE_PILL_CLASS =
  "font-mono text-[10px] font-semibold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded-[3px]";

export function Badges({ aircraft }: { aircraft: Aircraft }) {
  const version = aircraft.version ?? 0;
  const adsbLabel = version >= 2 ? `ADS-B V${version}` : "ADS-B";
  const mlat = aircraft.type === "mlat";
  const ground =
    aircraft.alt_baro === "ground" || aircraft.airground === "ground";
  const emergency = aircraft.emergency && aircraft.emergency !== "none";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={`${BADGE_PILL_CLASS} bg-[color-mix(in_oklab,var(--color-blue)_16%,var(--color-paper))] text-(--color-blue-deep)`}
      >
        {adsbLabel}
      </span>
      {mlat && (
        <span
          className={`${BADGE_PILL_CLASS} bg-[color-mix(in_oklab,var(--color-orange)_16%,var(--color-paper))] text-(--color-orange)`}
        >
          MLAT
        </span>
      )}
      {ground && (
        <span
          className={`${BADGE_PILL_CLASS} bg-(--color-gray-1) text-ink-soft`}
        >
          GND
        </span>
      )}
      {emergency && (
        <span
          className={`${BADGE_PILL_CLASS} bg-(--color-red) text-(--color-paper)`}
        >
          {String(aircraft.emergency).toUpperCase()}
        </span>
      )}
    </div>
  );
}
