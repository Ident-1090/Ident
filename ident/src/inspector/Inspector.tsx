import { X } from "lucide-react";
import type { ReactNode } from "react";
import { haversineNm } from "../data/derive";
import {
  selectDisplayAircraftMap,
  selectDisplayTrailsByHex,
  useIdentStore,
} from "../data/store";
import type {
  Aircraft,
  InspectorTab,
  RouteInfo,
  TrailPoint,
} from "../data/types";
import {
  airDistanceLabelFromNm,
  airSpeedFromKnots,
  altitudeFromFeet,
  quantityLabel,
  resolveUnitOverrides,
  verticalRateFromFpm,
} from "../settings/format";
import { TelCell, type TelTone } from "../ui/TelCell";
import { Tooltip } from "../ui/Tooltip";
import { formatAgeSecondsAgo } from "./age";
import { BADGE_PILL_CLASS, Badges } from "./Badges";
import { PhotoCard } from "./PhotoCard";
import { AltitudeSparkline, altitudeSparklineWindow } from "./Sparkline";
import { QualityTab } from "./tabs/QualityTab";
import { RawTab } from "./tabs/RawTab";
import { SignalTab } from "./tabs/SignalTab";
import { TelemetryTab } from "./tabs/TelemetryTab";

const TAB_ORDER: InspectorTab[] = ["telemetry", "quality", "signal", "raw"];
const TAB_LABEL: Record<InspectorTab, string> = {
  telemetry: "TELEMETRY",
  quality: "QUALITY",
  signal: "SIGNAL",
  raw: "RAW",
};
const TAB_TOOLTIP: Record<InspectorTab, string> = {
  telemetry: "Telemetry details",
  quality: "Position quality",
  signal: "Receiver signal",
  raw: "Raw aircraft JSON",
};

interface InspectorProps {
  variant?: "docked" | "floating";
}

export function Inspector({ variant = "docked" }: InspectorProps) {
  const aircraft = useIdentStore(selectDisplayAircraftMap);
  const receiver = useIdentStore((s) => s.receiver);
  const selectedHex = useIdentStore((s) => s.selectedHex);
  const select = useIdentStore((s) => s.select);
  const tab = useIdentStore((s) => s.inspector.tab);
  const setInspectorTab = useIdentStore((s) => s.setInspectorTab);
  const rssiBufs = useIdentStore((s) => s.rssiBufByHex);
  const replaying = useIdentStore((s) => s.replay.mode === "replay");
  const trails = useIdentStore(selectDisplayTrailsByHex);

  if (!selectedHex) return null;
  const ac = aircraft.get(selectedHex);
  if (!ac) return null;

  const shellClass =
    variant === "floating"
      ? "h-full bg-paper border border-line-strong rounded-[7px] shadow-2xl flex flex-col overflow-hidden min-w-0"
      : "[grid-area:right] bg-paper border-l border-line-strong flex flex-col overflow-hidden min-w-0";

  return (
    <aside className={shellClass}>
      <Header
        aircraft={ac}
        replaying={replaying}
        onClose={() => select(null)}
      />
      <PhotoCard hex={ac.hex} reg={ac.r} type={ac.t} />
      <TelemetryGrid aircraft={ac} />
      <TrendSection aircraft={ac} trace={altTraceFromTrail(trails[ac.hex])} />
      <Tabs tab={tab} onSelect={setInspectorTab} />
      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-2.5 font-mono text-[10.5px] text-ink-soft">
        {tab === "telemetry" && (
          <TelemetryTab aircraft={ac} receiver={receiver} />
        )}
        {tab === "quality" && <QualityTab aircraft={ac} />}
        {tab === "signal" && (
          <SignalTab
            aircraft={ac}
            rssiBuf={replaying ? [] : (rssiBufs[ac.hex] ?? [])}
            receiver={receiver}
          />
        )}
        {tab === "raw" && <RawTab aircraft={ac} />}
      </div>
    </aside>
  );
}

function Header({
  aircraft,
  replaying,
  onClose,
}: {
  aircraft: Aircraft;
  replaying: boolean;
  onClose: () => void;
}) {
  const callsign = aircraft.flight?.trim() || aircraft.hex.toUpperCase();
  const registration = aircraft.r?.trim() || undefined;
  const headerMeta = registration ?? aircraft.hex.toUpperCase();
  const typeSeg = aircraft.desc || aircraft.t || "";
  const sub = [
    typeSeg,
    registration ? null : aircraft.r?.trim(),
    aircraft.ownOp,
  ]
    .filter(Boolean)
    .join(" · ")
    .toUpperCase();
  const recency = aircraftRecency(aircraft, replaying);
  return (
    <div className="px-4 pt-[14px] pb-[10px] border-b border-(--color-line) relative min-w-0">
      <div className="flex justify-between items-start gap-3 min-w-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5 min-w-0">
            <span className="font-mono text-[22px] font-semibold tracking-[-0.015em] text-(--color-ink) whitespace-nowrap leading-none">
              {callsign}
            </span>
            {registration ? (
              <a
                href={`https://flightaware.com/live/flight/${encodeURIComponent(registration)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[12px] text-ink-soft underline decoration-dotted decoration-[color:var(--color-line-strong)] underline-offset-2 whitespace-nowrap overflow-hidden text-ellipsis min-w-0 hover:text-(--color-ink)"
              >
                {headerMeta}
              </a>
            ) : (
              <span className="font-mono text-[12px] text-ink-soft whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
                {headerMeta}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1.25 items-center shrink-0">
          <Tooltip label={recency.tooltip} side="top-end">
            <span
              data-aircraft-recency={recency.tier}
              data-aircraft-recency-tooltip={recency.tooltip}
              className={`${BADGE_PILL_CLASS} ${recency.className}`}
            >
              {recency.label}
            </span>
          </Tooltip>
          <Badges aircraft={aircraft} />
          <button
            type="button"
            aria-label="Close inspector"
            onClick={onClose}
            className="inline-flex w-5.5 h-5.5 items-center justify-center text-ink-soft hover:text-(--color-ink) cursor-pointer bg-transparent border-0 ml-1"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="font-mono text-[11px] text-ink-soft mt-1 tracking-[0.04em] leading-snug break-words">
        {sub || "—"}
      </div>
    </div>
  );
}

function aircraftRecency(
  aircraft: Aircraft,
  replaying: boolean,
): {
  label: "LIVE" | "STALE" | "LOST" | "REPLAY";
  tier: "live" | "stale" | "lost" | "replay";
  tooltip: string;
  className: string;
} {
  const seenSec = aircraft.seen;
  if (replaying) {
    return {
      label: "REPLAY",
      tier: "replay",
      tooltip: "Replay frame",
      className:
        "text-(--color-warn) bg-[color-mix(in_oklch,var(--color-warn)_12%,var(--color-paper))]",
    };
  }
  if (seenSec != null && seenSec <= 2) {
    return {
      label: "LIVE",
      tier: "live",
      tooltip: lastMessageTooltip(seenSec),
      className:
        "text-(--color-live) bg-[color-mix(in_oklch,var(--color-live)_12%,var(--color-paper))]",
    };
  }
  if (seenSec != null && seenSec <= 30) {
    return {
      label: "STALE",
      tier: "stale",
      tooltip: lastMessageTooltip(seenSec),
      className:
        "text-(--color-warn) bg-[color-mix(in_oklch,var(--color-warn)_12%,var(--color-paper))]",
    };
  }
  return {
    label: "LOST",
    tier: "lost",
    tooltip: lastMessageTooltip(seenSec),
    className:
      "text-(--color-emerg) bg-[color-mix(in_oklch,var(--color-emerg)_12%,var(--color-paper))]",
  };
}

function lastMessageTooltip(seenSec: number | undefined): string {
  return `Last msg ${formatAgeSecondsAgo(seenSec)}`;
}

function TelemetryGrid({ aircraft }: { aircraft: Aircraft }) {
  const settings = useIdentStore((s) => s.settings);
  const receiver = useIdentStore((s) => s.receiver);
  const routeByCallsign = useIdentStore((s) => s.routeByCallsign);
  const gsTrend = useIdentStore((s) => s.gsTrendsByHex[aircraft.hex]);
  const units = resolveUnitOverrides(settings.unitMode, settings.unitOverrides);
  const callsign = aircraft.flight?.trim().toUpperCase() ?? "";
  const route = callsign ? (routeByCallsign[callsign] ?? null) : null;
  const ground = aircraft.alt_baro === "ground";
  const altBaro = ground
    ? "GND"
    : typeof aircraft.alt_baro === "number"
      ? altitudeFromFeet(aircraft.alt_baro, units.altitude).value
      : "—";
  const baroRate = aircraft.baro_rate ?? 0;
  const baroRateFmt = verticalRateFromFpm(baroRate, units.verticalSpeed);
  let baroDeltaText = "— level";
  let baroTone: TelTone = "muted";
  if (baroRate > 100) {
    baroDeltaText = `▲ ${baroRateFmt.value} ${baroRateFmt.unit}`;
    baroTone = "good";
  } else if (baroRate < -100) {
    baroDeltaText = `▼ ${baroRateFmt.value} ${baroRateFmt.unit}`;
    baroTone = "warn";
  }

  const gs =
    aircraft.gs != null
      ? airSpeedFromKnots(aircraft.gs, units.horizontalSpeed)
      : null;
  const tas =
    aircraft.tas != null
      ? airSpeedFromKnots(aircraft.tas, units.horizontalSpeed)
      : null;
  const mach = aircraft.mach != null ? `M${aircraft.mach.toFixed(2)}` : "—";

  // GS trend: the rolling buffer is 1 Hz, so the slope in kt per sample is
  // the slope in kt/s. Multiply by 60 to get a kt/min rate that mirrors the
  // Alt baro cell's fpm readout in shape and magnitude. Threshold 1 kt/min
  // keeps mesurement noise out of the indicator.
  const gsRateKtPerMin =
    gsTrend && gsTrend.length >= 2
      ? ((gsTrend[gsTrend.length - 1] - gsTrend[0]) * 60) / (gsTrend.length - 1)
      : null;
  const gsRateFmt =
    gsRateKtPerMin != null
      ? airSpeedFromKnots(Math.abs(gsRateKtPerMin), units.horizontalSpeed)
      : null;
  let gsDeltaText = "— steady";
  let gsTone: TelTone = "muted";
  if (gsRateKtPerMin != null && gsRateFmt != null) {
    if (gsRateKtPerMin > 1) {
      gsDeltaText = `▲ ${gsRateFmt.value} ${gsRateFmt.unit}/min`;
      gsTone = "good";
    } else if (gsRateKtPerMin < -1) {
      gsDeltaText = `▼ ${gsRateFmt.value} ${gsRateFmt.unit}/min`;
      gsTone = "warn";
    }
  }
  const tasHint = tas
    ? `${tas.value} ${tas.unit} · ${mach}`
    : mach !== "—"
      ? mach
      : null;

  const track = aircraft.track != null ? padHeading(aircraft.track) : "—";
  const trackHint = selectedHeadingHint(aircraft);

  const altGeomNum = aircraft.alt_geom;
  const altGeom =
    altGeomNum != null
      ? altitudeFromFeet(altGeomNum, units.altitude).value
      : "—";
  const altSelHint =
    aircraft.nav_altitude_mcp != null
      ? selectedFieldHint(
          "Selected altitude",
          `SEL ${quantityLabel(altitudeFromFeet(aircraft.nav_altitude_mcp, units.altitude))}`,
        )
      : selectedFieldHint("Selected altitude", "SEL -");
  const routeCell = routeGridCell(aircraft, route, receiver, units.distance);

  const squawk = aircraft.squawk ?? "—";
  const isEmerg = !!aircraft.emergency && aircraft.emergency !== "none";

  return (
    <div className="grid grid-cols-3 border-b border-(--color-line)">
      <TelCell
        label="Alt baro"
        value={altBaro}
        unit={
          ground || typeof aircraft.alt_baro !== "number"
            ? undefined
            : altitudeFromFeet(aircraft.alt_baro, units.altitude).unit
        }
        hint={baroDeltaText}
        tone={baroTone}
        borderR
        borderB
      />
      <TelCell
        label="GS / TAS"
        value={gs?.value ?? "—"}
        unit={gs ? gs.unit : undefined}
        hint={
          <>
            <span
              className={
                gsTone === "good"
                  ? "text-(--color-live)"
                  : gsTone === "warn"
                    ? "text-(--color-warn)"
                    : undefined
              }
            >
              {gsDeltaText}
            </span>
            {tasHint && (
              <span className="text-ink-faint ml-[6px]">· {tasHint}</span>
            )}
          </>
        }
        borderR
        borderB
      />
      <TelCell
        label="Track"
        value={track}
        unit={aircraft.track != null ? "°" : undefined}
        hint={trackHint}
        borderB
      />
      <TelCell
        label="Alt geom"
        value={altGeom}
        unit={
          altGeomNum != null
            ? altitudeFromFeet(altGeomNum, units.altitude).unit
            : undefined
        }
        hint={altSelHint}
        borderR
      />
      <TelCell
        label={routeCell.label}
        value={routeCell.value}
        hint={routeCell.hint}
        borderR
      />
      <TelCell label="Squawk" value={squawk} hint="Mode-S" emph={isEmerg} />
    </div>
  );
}

function padHeading(deg: number): string {
  return String(Math.round(deg)).padStart(3, "0");
}

function selectedHeadingHint(aircraft: Aircraft): ReactNode {
  if (aircraft.nav_heading != null) {
    return selectedFieldHint(
      "Selected heading",
      `SEL ${padHeading(aircraft.nav_heading)}°`,
    );
  }
  return selectedFieldHint("Selected heading", "SEL -°");
}

function selectedFieldHint(label: string, text: string): ReactNode {
  return (
    <Tooltip label={label} side="top">
      <span
        data-selected-field={label}
        className="inline-block max-w-full truncate"
      >
        {text}
      </span>
    </Tooltip>
  );
}

function routeGridCell(
  aircraft: Aircraft,
  route: RouteInfo | null,
  receiver: { lat: number; lon: number } | null,
  distanceUnit: Parameters<typeof airDistanceLabelFromNm>[1],
): { label: string; value: string; hint?: string } {
  if (route) {
    const airportPair = `${route.origin}-${route.destination}`;
    return {
      label: "Route",
      value: airportPair,
      hint: routeViaHint(route),
    };
  }
  if (receiver && aircraft.lat != null && aircraft.lon != null) {
    return {
      label: "Distance",
      value: airDistanceLabelFromNm(
        haversineNm(receiver.lat, receiver.lon, aircraft.lat, aircraft.lon),
        distanceUnit,
      ),
      hint: "from base",
    };
  }
  return { label: "Distance", value: "—", hint: "from base" };
}

function routeViaHint(route: RouteInfo): string | undefined {
  if (!route.route) return undefined;
  const parts = route.route
    .split("-")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
  if (parts.length < 3) return "direct";
  const via = parts.slice(1, -1);
  return via.length > 0 ? `via ${via.join(", ")}` : undefined;
}

/**
 * Altitude series for the inspector sparkline. Reads the same `trailsByHex`
 * buffer the map uses for its selected-aircraft trail line, keeping the two
 * views in lock-step. No fallback to altTrendsByHex because that ring buffer
 * has no timestamps, so it can't distinguish two sorties of the same hex.
 */
interface AltitudeTrace {
  samples: number[];
  ts: number[];
}

export function altTraceFromTrail(
  trail: TrailPoint[] | undefined,
): AltitudeTrace {
  if (!trail) return { samples: [], ts: [] };
  const samples: number[] = [];
  const ts: number[] = [];
  for (const p of trail) {
    if (typeof p.alt === "number") {
      samples.push(p.alt);
      ts.push(p.ts);
    }
  }
  return { samples, ts };
}

export function altSamplesFromTrail(trail: TrailPoint[] | undefined): number[] {
  return altTraceFromTrail(trail).samples;
}

function TrendSection({
  aircraft,
  trace,
}: {
  aircraft: Aircraft;
  trace: AltitudeTrace;
}) {
  const samples = trace.samples;
  const rate = aircraft.baro_rate ?? 0;
  const trendLabel =
    rate > 100 ? "▲ CLIMB" : rate < -100 ? "▼ DESC" : "— LEVEL";
  const trendColor =
    rate > 100
      ? "text-(--color-live)"
      : rate < -100
        ? "text-(--color-warn)"
        : "text-ink-faint";
  const altitudeWindowLabel = altitudeWindowTitle(trace);
  return (
    <div className="px-3 py-1.5 border-b border-(--color-line)">
      <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest text-ink-faint mb-[2px]">
        <span>{altitudeWindowLabel}</span>
        <b className={`ml-auto font-medium ${trendColor}`}>{trendLabel}</b>
      </div>
      <AltitudeSparkline
        samples={samples}
        selectedAltitudeFt={aircraft.nav_altitude_mcp}
      />
    </div>
  );
}

function altitudeWindowTitle(trace: AltitudeTrace): string {
  if (trace.samples.length < 2) return "Altitude · collecting";
  const window = altitudeSparklineWindow(trace.samples);
  const startTs = trace.ts[window.startIndex];
  if (typeof startTs !== "number") return "Altitude";
  return `Altitude · from ${relativeTimeFromNow(startTs)}`;
}

const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

function relativeTimeFromNow(ts: number, now = Date.now()): string {
  const deltaMs = ts - now;
  const absMs = Math.abs(deltaMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["second", 1000],
    ["minute", 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["day", 24 * 60 * 60 * 1000],
    ["month", 30 * 24 * 60 * 60 * 1000],
    ["year", 365 * 24 * 60 * 60 * 1000],
  ];
  const [unit, ms] =
    units.find(([, _unitMs], i) => {
      const next = units[i + 1]?.[1] ?? Number.POSITIVE_INFINITY;
      return absMs < next;
    }) ?? units[units.length - 1];
  return RELATIVE_TIME_FORMAT.format(Math.round(deltaMs / ms), unit);
}

function Tabs({
  tab,
  onSelect,
}: {
  tab: InspectorTab;
  onSelect: (t: InspectorTab) => void;
}) {
  return (
    <div className="flex border-b border-(--color-line) font-mono text-[9.5px] uppercase tracking-widest shrink-0">
      {TAB_ORDER.map((t) => {
        const active = tab === t;
        const cls = active
          ? "text-(--color-ink) border-(--color-ink)"
          : "text-ink-faint border-transparent hover:text-(--color-ink)";
        return (
          <Tooltip key={t} label={TAB_TOOLTIP[t]} side="bottom">
            <button
              type="button"
              onClick={() => onSelect(t)}
              className={`px-2.75 py-2 cursor-pointer bg-transparent border-0 border-b-2 ${cls}`}
            >
              {TAB_LABEL[t]}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
