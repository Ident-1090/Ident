import { X } from "lucide-react";
import { useMemo } from "react";
import { categoryKeyFor, matchesFilter } from "../data/predicates";
import { selectDisplayAircraftMap, useIdentStore } from "../data/store";
import type { CategoryKey } from "../data/types";
import {
  AIRCRAFT_GLYPH_COLORS_BY_TONE,
  type AircraftGlyphColors,
  altGlyphGradientCss,
} from "../map/alt";
import { resolveBasemapTone, resolveThemeIsDark } from "../map/mapTone";
import {
  extractFilterChips,
  queryTextFromOmnibox,
  removeFilterChipFromQuery,
  setCategoryFilterClause,
  upsertAltitudeClause,
} from "../omnibox/grammar";
import {
  altitudeLabelFromFeet,
  resolveUnitOverrides,
} from "../settings/format";
import { Chip, ChipDot } from "../ui/Chip";
import { SectionHead } from "../ui/SectionHead";

interface CategoryChip {
  key: CategoryKey;
  label: string;
  dotColor: string;
}

const ALT_MIN = 0;
const ALT_MAX = 45000;
const ALT_STEP = 500;

function fmtAltBound(v: number, unit: "m" | "ft"): string {
  if (v <= 0) return "GND";
  return altitudeLabelFromFeet(v, unit);
}

function categoryChipsFor(colors: AircraftGlyphColors): CategoryChip[] {
  return [
    { key: "airline", label: "Airline", dotColor: colors[4] },
    { key: "ga", label: "GA", dotColor: colors[2] },
    { key: "bizjet", label: "Bizjet", dotColor: colors[1] },
    { key: "mil", label: "Mil", dotColor: "var(--color-warn)" },
    { key: "rotor", label: "Helo", dotColor: "var(--color-ink-soft)" },
    { key: "unknown", label: "Unknown", dotColor: "var(--color-ink-faint)" },
  ];
}

export function FiltersPanel() {
  const aircraft = useIdentStore(selectDisplayAircraftMap);
  const filter = useIdentStore((s) => s.filter);
  const searchQuery = useIdentStore((s) => s.search.query);
  const routeByCallsign = useIdentStore((s) => s.routeByCallsign);
  const receiver = useIdentStore((s) => s.receiver);
  const viewportHexes = useIdentStore((s) => s.map.viewportHexes);
  const setSearchQuery = useIdentStore((s) => s.setSearchQuery);
  const resetFilter = useIdentStore((s) => s.resetFilter);
  const settings = useIdentStore((s) => s.settings);
  const basemapId = useIdentStore((s) => s.map.basemapId);
  const units = resolveUnitOverrides(settings.unitMode, settings.unitOverrides);
  const tone = resolveBasemapTone(
    basemapId,
    resolveThemeIsDark(settings.theme),
  );
  const aircraftGlyphColors = AIRCRAFT_GLYPH_COLORS_BY_TONE[tone];
  const categoryChips = useMemo(
    () => categoryChipsFor(aircraftGlyphColors),
    [aircraftGlyphColors],
  );
  const altGradient = useMemo(
    () => altGlyphGradientCss(aircraftGlyphColors),
    [aircraftGlyphColors],
  );
  const queryText = useMemo(
    () => queryTextFromOmnibox(searchQuery),
    [searchQuery],
  );
  const activeQueryChips = useMemo(
    () =>
      extractFilterChips(searchQuery).filter(
        (chip) => chip.kind === "logic" || !/^cat:/i.test(chip.label),
      ),
    [searchQuery],
  );
  const hasActiveQueryChip = activeQueryChips.some(
    (chip) => chip.kind === "clause",
  );

  const shownCount = useMemo(() => {
    let n = 0;
    for (const ac of aircraft.values()) {
      if (
        matchesFilter(ac, {
          ...filter,
          query: queryText,
          routeByCallsign,
          receiver: receiver
            ? { lat: receiver.lat, lon: receiver.lon }
            : undefined,
          viewportHexes,
        })
      )
        n++;
    }
    return n;
  }, [aircraft, filter, queryText, routeByCallsign, receiver, viewportHexes]);

  const [altLo, altHi] = filter.altRangeFt;
  const total = aircraft.size;
  const countsByKey = useMemo(() => {
    const counts: Record<CategoryKey, number> = {
      airline: 0,
      ga: 0,
      bizjet: 0,
      mil: 0,
      rotor: 0,
      unknown: 0,
    };
    for (const ac of aircraft.values()) {
      counts[categoryKeyFor(ac.category, ac.dbFlags)]++;
    }
    return counts;
  }, [aircraft]);

  return (
    <div className="flex-none px-3 pt-[10px] pb-3 border-b border-(--color-line)">
      <div className="flex items-baseline gap-2.5 mb-[10px]">
        <SectionHead>Filters</SectionHead>
        <span className="font-mono text-[13px] font-medium text-(--color-ink) tabular-nums">
          {shownCount}{" "}
          <span className="text-ink-faint font-normal">/ {total} shown</span>
        </span>
        <button
          type="button"
          onClick={resetFilter}
          className="ml-auto font-mono text-[10px] text-ink-faint hover:text-(--color-ink) cursor-pointer bg-transparent border-0 p-0"
        >
          reset
        </button>
      </div>

      <div
        data-testid="filter-chip-strip"
        className="flex max-h-[88px] min-w-0 flex-wrap gap-[4px] overflow-y-auto"
      >
        {categoryChips.map((c) => {
          const on = filter.categories[c.key];
          return (
            <Chip
              key={c.key}
              active={on}
              aria-pressed={on}
              aria-label={`Filter category: ${c.label}`}
              onClick={() =>
                setSearchQuery(setCategoryFilterClause(searchQuery, c.key, !on))
              }
              leading={<ChipDot color={c.dotColor} />}
              trailing={
                <span
                  className={`tabular-nums ${on ? "text-ink-soft" : "text-ink-faint"}`}
                >
                  {countsByKey[c.key]}
                </span>
              }
            >
              <span>{c.label}</span>
            </Chip>
          );
        })}
        {hasActiveQueryChip &&
          activeQueryChips.map((chip) =>
            chip.kind === "logic" ? (
              <span
                key={`${chip.start}:${chip.end}:${chip.label}`}
                className="px-0.5 py-[3px] font-mono text-[10.5px] text-ink-faint"
              >
                {chip.label}
              </span>
            ) : (
              <span
                key={`${chip.start}:${chip.end}:${chip.label}`}
                className="inline-flex h-[22px] max-w-full items-center overflow-hidden rounded-[3px] border border-[color-mix(in_oklch,var(--color-accent)_40%,var(--color-line-strong))] bg-[color-mix(in_oklch,var(--color-accent)_18%,var(--color-paper-2))] font-mono text-[10px] text-(--color-ink)"
              >
                <span
                  data-filter-query-chip={chip.label}
                  className="min-w-0 max-w-[8.5rem] truncate px-[5px]"
                >
                  {chip.label}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setSearchQuery(removeFilterChipFromQuery(searchQuery, chip))
                  }
                  aria-label={`Clear ${chip.label}`}
                  className="grid h-full w-[18px] flex-none cursor-pointer place-items-center border-0 border-l border-[color-mix(in_oklch,var(--color-accent)_34%,var(--color-line-strong))] bg-transparent p-0 text-ink-faint hover:text-(--color-ink)"
                >
                  <X size={11} strokeWidth={2} aria-hidden="true" />
                </button>
              </span>
            ),
          )}
      </div>

      <div className="mt-[10px]">
        <div className="flex justify-between items-baseline mb-1">
          <span className="font-mono text-[9.5px] text-ink-faint uppercase tracking-[0.08em]">
            Altitude
          </span>
          <span className="font-mono text-[10.5px] text-ink-soft tabular-nums">
            {fmtAltBound(altLo, units.altitude)} —{" "}
            {fmtAltBound(altHi, units.altitude)}
          </span>
        </div>
        <DualAltSlider
          value={[altLo, altHi]}
          gradient={altGradient}
          onChange={(next) =>
            setSearchQuery(upsertAltitudeClause(searchQuery, next))
          }
        />
      </div>
    </div>
  );
}

interface DualAltProps {
  value: [number, number];
  gradient: string;
  onChange: (next: [number, number]) => void;
}

// Dual-thumb range. Two stacked native <input type="range"> with default
// thumbs and tracks hidden; a shared 20px bordered track shows the altitude
// gradient and two 2px ink thumb bars.
function DualAltSlider({ value, gradient, onChange }: DualAltProps) {
  const [lo, hi] = value;
  const span = Math.max(1, ALT_MAX - ALT_MIN);
  const loPct = ((lo - ALT_MIN) / span) * 100;
  const hiPct = ((hi - ALT_MIN) / span) * 100;

  const inputCls =
    "absolute inset-0 w-full h-full appearance-none bg-transparent pointer-events-none " +
    "[&::-webkit-slider-runnable-track]:bg-transparent " +
    "[&::-moz-range-track]:bg-transparent " +
    "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none " +
    "[&::-webkit-slider-thumb]:h-[24px] [&::-webkit-slider-thumb]:w-[10px] " +
    "[&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:cursor-grab " +
    "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-[24px] [&::-moz-range-thumb]:w-[10px] " +
    "[&::-moz-range-thumb]:bg-transparent [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-grab";

  return (
    <div className="relative h-[20px] rounded-[3px] border border-(--color-line) bg-bg overflow-hidden">
      {/* Full gradient painted across the absolute altitude axis so each
          band's color sits at its own FL regardless of the user's window.
          Rendered near-opaque so the palette reads as a real chart on both
          light and dark backgrounds. */}
      <div
        data-testid="altitude-scale-gradient"
        className="absolute inset-0 opacity-[0.9]"
        style={{ background: gradient }}
      />
      {/* Heavily dim the regions outside the selected window — close to
          opaque so the window "clips" the palette rather than tinting it. */}
      <div
        className="absolute top-0 bottom-0 left-0 bg-bg opacity-[0.85]"
        style={{ width: `${loPct}%` }}
      />
      <div
        className="absolute top-0 bottom-0 right-0 bg-bg opacity-[0.85]"
        style={{ width: `${100 - hiPct}%` }}
      />
      <div
        className="absolute -top-[2px] -bottom-[2px] w-[2px] rounded-[1px] bg-(--color-ink) pointer-events-none"
        style={{ left: `calc(${loPct}% - 1px)` }}
      />
      <div
        className="absolute -top-[2px] -bottom-[2px] w-[2px] rounded-[1px] bg-(--color-ink) pointer-events-none"
        style={{ left: `calc(${hiPct}% - 1px)` }}
      />
      <input
        type="range"
        min={ALT_MIN}
        max={ALT_MAX}
        step={ALT_STEP}
        value={lo}
        onChange={(e) => {
          const v = Math.min(Number(e.target.value), hi);
          onChange([v, hi]);
        }}
        aria-label="Altitude minimum"
        className={inputCls}
      />
      <input
        type="range"
        min={ALT_MIN}
        max={ALT_MAX}
        step={ALT_STEP}
        value={hi}
        onChange={(e) => {
          const v = Math.max(Number(e.target.value), lo);
          onChange([lo, v]);
        }}
        aria-label="Altitude maximum"
        className={inputCls}
      />
    </div>
  );
}
