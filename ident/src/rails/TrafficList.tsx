import * as FlagIcons from "country-flag-icons/react/3x2";
import { useEffect, useMemo, useState } from "react";
import { haversineNm } from "../data/derive";
import { findIcaoCountry, type IcaoCountry } from "../data/icaoCountry";
import { matchesFilter } from "../data/predicates";
import { selectDisplayAircraftMap, useIdentStore } from "../data/store";
import type { Aircraft, RouteInfo } from "../data/types";
import { preloadRoutesForAircraft } from "../inspector/route";
import { queryTextFromOmnibox } from "../omnibox/grammar";
import {
  airDistanceLabelFromNm,
  altitudeLabelFromFeet,
  resolveUnitOverrides,
} from "../settings/format";
import { Tooltip } from "../ui/Tooltip";

// Columns that sort when their header is clicked. Clicking the active column
// header flips direction; clicking a different column jumps to that column's
// default direction (distance ascends, altitude/speed descend, callsign
// ascends — the natural-read default for each).
type SortField = "cs" | "alt" | "kt" | "dist";
type SortDir = "asc" | "desc";
const DEFAULT_DIR: Record<SortField, SortDir> = {
  cs: "asc",
  alt: "desc",
  kt: "desc",
  dist: "asc",
};
const SORT_TOOLTIP: Record<SortField, string> = {
  cs: "Sort by callsign",
  alt: "Sort by altitude",
  kt: "Sort by ground speed",
  dist: "Sort by receiver distance",
};

interface Row {
  ac: Aircraft;
  country: IcaoCountry;
  dist: number;
  distLabel: string;
  altNum: number | null; // null for unknown/ground
  altLabel: string;
  trend: "up" | "down" | null;
  isEmerg: boolean;
  isGround: boolean;
  route: RouteInfo | null;
}

function isEmergency(ac: Aircraft): boolean {
  const EMERG_SQUAWKS = new Set(["7500", "7600", "7700"]);
  if (ac.emergency && ac.emergency !== "none") return true;
  if (ac.squawk && EMERG_SQUAWKS.has(ac.squawk)) return true;
  return false;
}

function computeTrend(buf: number[] | undefined): "up" | "down" | null {
  if (!buf || buf.length < 2) return null;
  const recent = buf.slice(-5);
  const first = recent[0];
  const last = recent[recent.length - 1];
  const delta = last - first;
  if (delta > 100) return "up";
  if (delta < -100) return "down";
  return null;
}

interface TrafficListProps {
  onAircraftSelect?: () => void;
}

export function TrafficList({ onAircraftSelect }: TrafficListProps = {}) {
  const aircraft = useIdentStore(selectDisplayAircraftMap);
  const receiver = useIdentStore((s) => s.receiver);
  const filter = useIdentStore((s) => s.filter);
  const searchQuery = useIdentStore((s) => s.search.query);
  const routeByCallsign = useIdentStore((s) => s.routeByCallsign);
  const viewportHexes = useIdentStore((s) => s.map.viewportHexes);
  const altTrendsByHex = useIdentStore((s) => s.altTrendsByHex);
  const selectedHex = useIdentStore((s) => s.selectedHex);
  const select = useIdentStore((s) => s.select);
  const settings = useIdentStore((s) => s.settings);
  const hasFeedData = useIdentStore(
    (s) =>
      s.liveState.lastMsgTs > 0 ||
      s.receiver != null ||
      s.stats != null ||
      s.outline != null ||
      selectDisplayAircraftMap(s).size > 0,
  );
  const units = resolveUnitOverrides(settings.unitMode, settings.unitOverrides);
  const queryText = useMemo(
    () => queryTextFromOmnibox(searchQuery),
    [searchQuery],
  );

  const [sortField, setSortField] = useState<SortField>("dist");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function pickSort(next: SortField) {
    if (next === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(next);
      setSortDir(DEFAULT_DIR[next]);
    }
  }

  const { rows } = useMemo(() => {
    const list: Row[] = [];
    for (const ac of aircraft.values()) {
      if (
        !matchesFilter(ac, {
          ...filter,
          query: queryText,
          routeByCallsign,
          receiver: receiver
            ? { lat: receiver.lat, lon: receiver.lon }
            : undefined,
          viewportHexes,
        })
      )
        continue;
      let dist = Number.POSITIVE_INFINITY;
      if (receiver && ac.lat != null && ac.lon != null) {
        dist = haversineNm(receiver.lat, receiver.lon, ac.lat, ac.lon);
      }
      const isGround = ac.alt_baro === "ground" || ac.airground === 1;
      const altNum = typeof ac.alt_baro === "number" ? ac.alt_baro : null;
      const altLabel = isGround
        ? "GND"
        : altNum != null
          ? altitudeLabelFromFeet(altNum, units.altitude)
          : "—";
      const callsign = ac.flight?.trim().toUpperCase() ?? "";
      const route = callsign ? (routeByCallsign[callsign] ?? null) : null;
      const distLabel = Number.isFinite(dist)
        ? airDistanceLabelFromNm(dist, units.distance, 0)
        : "—";
      list.push({
        ac,
        country: findIcaoCountry(ac.hex),
        dist,
        distLabel,
        altNum,
        altLabel,
        trend: computeTrend(altTrendsByHex[ac.hex]),
        isEmerg: isEmergency(ac),
        isGround,
        route,
      });
    }

    list.sort((a, b) => {
      // Emergency always pinned to top, direction-independent.
      if (a.isEmerg !== b.isEmerg) return a.isEmerg ? -1 : 1;
      const sign = sortDir === "asc" ? 1 : -1;
      switch (sortField) {
        case "dist":
          return sign * (a.dist - b.dist);
        case "alt": {
          const av = a.altNum ?? -Infinity;
          const bv = b.altNum ?? -Infinity;
          return sign * (av - bv);
        }
        case "kt": {
          const av = typeof a.ac.gs === "number" ? a.ac.gs : -Infinity;
          const bv = typeof b.ac.gs === "number" ? b.ac.gs : -Infinity;
          return sign * (av - bv);
        }
        case "cs": {
          const av = (a.ac.flight?.trim() || a.ac.hex).toUpperCase();
          const bv = (b.ac.flight?.trim() || b.ac.hex).toUpperCase();
          return sign * av.localeCompare(bv);
        }
      }
      return 0;
    });

    return { rows: list };
  }, [
    aircraft,
    receiver,
    filter,
    queryText,
    routeByCallsign,
    viewportHexes,
    altTrendsByHex,
    sortField,
    sortDir,
    units.altitude,
    units.distance,
  ]);

  useEffect(() => {
    preloadRoutesForAircraft(aircraft.values());
  }, [aircraft]);

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-paper">
      <div className="grid grid-cols-[4px_18px_54px_1fr_52px_36px_40px] gap-1.75 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.08em] border-b border-(--color-line-soft) bg-paper tabular-nums flex-none">
        <div />
        <div aria-hidden="true" />
        <SortCol
          field="cs"
          sortField={sortField}
          sortDir={sortDir}
          onPick={pickSort}
        >
          Callsign
        </SortCol>
        <div className="min-w-0 truncate whitespace-nowrap text-ink-faint">
          Route
        </div>
        <SortCol
          field="alt"
          sortField={sortField}
          sortDir={sortDir}
          onPick={pickSort}
          align="right"
        >
          Alt
        </SortCol>
        <SortCol
          field="kt"
          sortField={sortField}
          sortDir={sortDir}
          onPick={pickSort}
          align="right"
        >
          Kt
        </SortCol>
        <SortCol
          field="dist"
          sortField={sortField}
          sortDir={sortDir}
          onPick={pickSort}
          align="right"
        >
          Dist
        </SortCol>
      </div>

      <div className="traffic-list-scroll flex-1 min-h-0 overflow-y-auto">
        {rows.map((row) => {
          const selected = row.ac.hex === selectedHex;
          return (
            <TrafficRow
              key={row.ac.hex}
              row={row}
              selected={selected}
              onClick={() => {
                const nextHex = selected ? null : row.ac.hex;
                select(nextHex);
                if (nextHex) onAircraftSelect?.();
              }}
            />
          );
        })}
        {rows.length === 0 && !hasFeedData && <TrafficSkeleton />}
        {rows.length === 0 && hasFeedData && (
          <div className="px-3 py-6 font-mono text-[11px] text-ink-faint">
            no traffic
          </div>
        )}
      </div>
    </div>
  );
}

function TrafficSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading traffic"
      className="px-3 py-2 space-y-1.5"
    >
      {Array.from({ length: 9 }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders — no item identity, fixed length
          key={i}
          className="grid grid-cols-[4px_18px_54px_1fr_52px_36px_40px] gap-1.75 items-center"
        >
          <div className="h-4.5 rounded-[1px] bg-(--color-line-soft)" />
          <div className="h-3 w-4.5 rounded-[1px] bg-(--color-line-soft)" />
          <SkeletonBar width={42} />
          <SkeletonBar width={i % 3 === 0 ? 92 : 70} />
          <SkeletonBar width={36} align="right" />
          <SkeletonBar width={24} align="right" />
          <SkeletonBar width={30} align="right" />
        </div>
      ))}
    </div>
  );
}

function SkeletonBar({ width, align }: { width: number; align?: "right" }) {
  return (
    <div className={align === "right" ? "flex justify-end" : ""}>
      <div
        className="h-2.5 rounded-xs bg-(--color-line-soft)"
        style={{ width }}
      />
    </div>
  );
}

function SortCol({
  field,
  sortField,
  sortDir,
  onPick,
  align,
  children,
}: {
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
  onPick: (f: SortField) => void;
  align?: "right";
  children: React.ReactNode;
}) {
  const active = sortField === field;
  const arrow = active ? (sortDir === "asc" ? "↑" : "↓") : "";
  return (
    <Tooltip label={SORT_TOOLTIP[field]} side="bottom">
      <button
        type="button"
        onClick={() => onPick(field)}
        className={
          "w-full bg-transparent border-0 p-0 font-mono text-[9px] uppercase tracking-[0.08em] cursor-pointer " +
          (align === "right" ? "text-right " : "text-left ") +
          (active
            ? "text-(--color-ink) font-semibold"
            : "text-ink-faint hover:text-(--color-ink)")
        }
      >
        {arrow && <span className="mr-0.5">{arrow}</span>}
        {children}
      </button>
    </Tooltip>
  );
}

function TrafficRow({
  row,
  selected,
  onClick,
}: {
  row: Row;
  selected: boolean;
  onClick: () => void;
}) {
  const { ac, country, route, trend, altLabel, distLabel, isEmerg, isGround } =
    row;
  const cs = ac.flight?.trim() || ac.hex;
  const gs = typeof ac.gs === "number" ? Math.round(ac.gs).toString() : "—";

  // Strip color: emergency > selected > transparent.
  const stripBg = isEmerg
    ? "var(--color-emerg)"
    : selected
      ? "var(--color-accent)"
      : "transparent";
  const stripShadow = isEmerg
    ? "0 0 6px color-mix(in oklab, var(--color-emerg) 60%, transparent)"
    : undefined;

  // Row background.
  let rowBg: string | undefined;
  if (isEmerg) {
    rowBg = "color-mix(in oklab, var(--color-emerg) 8%, var(--color-paper))";
  } else if (selected) {
    rowBg = "color-mix(in oklab, var(--color-accent) 18%, var(--color-paper))";
  }

  const hoverCls = !isEmerg && !selected ? "hover:bg-paper-2" : "";

  // Text colors by state.
  const csColor = isEmerg
    ? "var(--color-emerg)"
    : isGround
      ? "var(--color-ink-soft)"
      : "var(--color-ink)";
  const csWeight = isEmerg ? 600 : 500;
  const rtColor = isGround ? "var(--color-ink-faint)" : "var(--color-ink-soft)";
  const altColor = isGround ? "var(--color-ink-faint)" : "var(--color-ink)";
  const spdColor = isGround
    ? "var(--color-ink-faint)"
    : "var(--color-ink-soft)";
  const dstColor = isGround
    ? "var(--color-ink-faint)"
    : "var(--color-ink-soft)";

  // Route / info column content.
  const routeContent = renderRoute(ac, route);

  const trendGlyph =
    trend === "up" ? (
      <span className="text-[9px] mr-0.5 text-(--color-live)">▲</span>
    ) : trend === "down" ? (
      <span className="text-[9px] mr-0.5 text-(--color-warn)">▼</span>
    ) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "grid w-full grid-cols-[4px_18px_54px_1fr_52px_36px_40px] gap-1.75 px-3 py-1.25 " +
        "font-mono text-[11px] border-0 border-b border-(--color-line-soft) items-center cursor-pointer tabular-nums text-left " +
        hoverCls
      }
      style={{ background: rowBg }}
    >
      <div
        className="h-4.5 rounded-[1px]"
        style={{ background: stripBg, boxShadow: stripShadow }}
      />
      <div className="flex items-center justify-center">
        <CountryFlag country={country} />
      </div>
      <div
        className="truncate whitespace-nowrap"
        style={{ color: csColor, fontWeight: csWeight }}
      >
        {cs}
      </div>
      <div
        className="min-w-0 truncate whitespace-nowrap text-[10.5px]"
        style={{ color: rtColor }}
      >
        {routeContent}
      </div>
      <div className="text-right whitespace-nowrap" style={{ color: altColor }}>
        {trendGlyph}
        {altLabel}
      </div>
      <div className="text-right whitespace-nowrap" style={{ color: spdColor }}>
        {gs}
      </div>
      <div className="text-right whitespace-nowrap" style={{ color: dstColor }}>
        {distLabel}
      </div>
    </button>
  );
}

function CountryFlag({ country }: { country: IcaoCountry }) {
  if (!country.countryCode) return null;

  const FlagIcon =
    // biome-ignore lint/performance/noDynamicNamespaceImportAccess: country-code → flag-component lookup across ~250 flags; per-flag imports would defeat the purpose.
    FlagIcons[country.countryCode.toUpperCase() as keyof typeof FlagIcons];
  if (typeof FlagIcon !== "function") return null;

  return (
    <Tooltip label={country.country} side="right">
      <span
        role="img"
        className="block overflow-hidden rounded-[1px]"
        style={{ boxShadow: "inset 0 0 0 1px var(--color-line-soft)" }}
        aria-label={country.country}
      >
        <FlagIcon className="block h-3 w-4.5" />
      </span>
    </Tooltip>
  );
}

function renderRoute(ac: Aircraft, route: RouteInfo | null): React.ReactNode {
  if (route) {
    const label = route.origin && route.destination ? null : route.route;
    if (label) return label;
    return (
      <>
        {route.origin}
        <span className="text-ink-faint mx-0.75">→</span>
        {route.destination}
      </>
    );
  }
  if (
    ac.squawk &&
    (ac.squawk === "7500" || ac.squawk === "7600" || ac.squawk === "7700")
  ) {
    return <span className="text-ink-faint">SQK {ac.squawk}</span>;
  }
  if (ac.alt_baro === "ground" || ac.airground === 1) {
    return <span className="text-ink-faint">on ground</span>;
  }
  const info = ac.t || ac.desc || ac.type || "";
  if (info) return <span className="text-ink-faint">{info}</span>;
  return <span className="text-ink-faint">—</span>;
}
