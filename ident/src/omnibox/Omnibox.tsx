import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { findIcaoCountry } from "../data/icaoCountry";
import { selectDisplayAircraftMap, useIdentStore } from "../data/store";
import type { Aircraft, LayerKey } from "../data/types";
import { BASEMAPS, type BasemapId } from "../map/styles";
import { Kbd } from "../ui/Kbd";
import {
  buildLiveFieldSuggestions,
  buildLiveSquawkSuggestions,
  completeFilterClause,
  currentQueryToken,
  deriveFilterFromQuery,
  isStructuredQuery,
  parseFieldFocusInQuery,
  VALUE_SUGGESTIONS,
  type ValueSuggestion,
} from "./grammar";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FilterSuggestion {
  token: string;
  desc: string;
  kIcon?: string;
  kMono?: boolean;
}

interface ControlSuggestion extends FilterSuggestion {
  value: string;
  tag: string;
  run: () => void;
}

const OPERATOR_SUGGESTIONS: FilterSuggestion[] = [
  {
    token: "alt:>20000",
    desc: "Altitude greater than 20,000 ft",
    kIcon: "▲",
    kMono: true,
  },
  {
    token: "alt:<5000",
    desc: "Altitude below 5,000 ft",
    kIcon: "▼",
    kMono: true,
  },
  {
    token: "alt:10000..20000",
    desc: "Altitude range",
    kIcon: "≈",
    kMono: true,
  },
  {
    token: "kt:>400",
    desc: "Ground speed greater than 400 kt",
    kIcon: "»",
    kMono: true,
  },
  {
    token: "nm:<50",
    desc: "Distance less than 50 nm from receiver",
    kIcon: "·",
    kMono: true,
  },
  {
    token: "vs:>1000",
    desc: "Climbing faster than 1,000 fpm",
    kIcon: "↗",
    kMono: true,
  },
  {
    token: "vs:<-1000",
    desc: "Descending faster than 1,000 fpm",
    kIcon: "↘",
    kMono: true,
  },
  {
    token: "hdg:180±60",
    desc: "Heading within ±60° of 180",
    kIcon: "hdg",
    kMono: true,
  },
];

const FIELD_SUGGESTIONS: FilterSuggestion[] = [
  {
    token: "any:",
    desc: "Persistent text search",
    kIcon: "txt",
    kMono: true,
  },
  {
    token: "cs:",
    desc: "Callsign starts with",
    kIcon: "cs",
    kMono: true,
  },
  {
    token: "op:",
    desc: "Operator name contains",
    kIcon: "op",
    kMono: true,
  },
  {
    token: "rt:",
    desc: "Origin or destination",
    kIcon: "rt",
    kMono: true,
  },
  {
    token: "country:",
    desc: "ICAO country allocation",
    kIcon: "co",
    kMono: true,
  },
  {
    token: "hex:",
    desc: "ICAO24 address",
    kIcon: "hex",
    kMono: true,
  },
  {
    token: "reg:",
    desc: "Registration starts with",
    kIcon: "reg",
    kMono: true,
  },
  { token: "sqk:", desc: "Squawk code", kIcon: "sqk", kMono: true },
  {
    token: "type:",
    desc: "Aircraft type starts with",
    kIcon: "typ",
    kMono: true,
  },
  { token: "cat:", desc: "ADS-B category", kIcon: "cat", kMono: true },
  { token: "src:", desc: "Data source", kIcon: "src", kMono: true },
];

const KEYWORD_SUGGESTIONS: FilterSuggestion[] = [
  {
    token: "emergency",
    desc: "Squawk 7500 / 7600 / 7700 or distress bit",
    kIcon: "⚠",
  },
  { token: "military", desc: "Military operator or ICAO range", kIcon: "⊝" },
  {
    token: "ground",
    desc: "On-ground state (use !ground to exclude)",
    kIcon: "⊝",
  },
  { token: "!ground", desc: "Exclude on-ground aircraft", kIcon: "⊝" },
  { token: "nopos", desc: "Positionless aircraft only", kIcon: "⊝" },
  { token: "haspos", desc: "Position-decoded aircraft only", kIcon: "⊝" },
  { token: "inview", desc: "Within current map viewport", kIcon: "⊝" },
];

const LAYER_COMMANDS: Array<{ key: LayerKey; token: string; desc: string }> = [
  {
    key: "rangeRings",
    token: "layer range rings",
    desc: "Toggle receiver range rings",
  },
  {
    key: "rxRange",
    token: "layer true max range",
    desc: "Toggle true max range outline",
  },
  {
    key: "losRings",
    token: "layer los rings",
    desc: "Toggle line-of-sight rings",
  },
  { key: "trails", token: "layer trails", desc: "Toggle aircraft trails" },
];

const BASEMAP_COMMANDS: Array<{ id: BasemapId; token: string; desc: string }> =
  (Object.values(BASEMAPS) as Array<(typeof BASEMAPS)[BasemapId]>).map(
    (basemap) => ({
      id: basemap.id,
      token: `map ${basemap.label.toLowerCase()}`,
      desc: `Switch map style to ${basemap.tooltip}`,
    }),
  );

function matchesAircraft(ac: Aircraft, q: string): boolean {
  if (!q) return true;
  // When the query is itself a filter token (op:foo, cs:foo, reg:foo, …),
  // match aircraft by the corresponding field instead of the generic
  // identifier haystack — so typing `op:sky` previews SkyWest etc. live.
  const opMatch = /^([a-z]+):([^\s]*)$/i.exec(q.trim());
  if (opMatch) {
    const field = opMatch[1].toLowerCase();
    const value = opMatch[2].toLowerCase();
    if (value.length === 0) return true;
    const stripStar = (s: string) => s.replace(/\*+$/, "").toLowerCase();
    switch (field) {
      case "op": {
        const hay = [ac.ownOp, ac.desc]
          .filter(Boolean)
          .map((s) => (s as string).toLowerCase());
        return hay.some((s) => s.includes(value));
      }
      case "cs": {
        const cs = (ac.flight ?? "").trim().toLowerCase();
        return cs.startsWith(stripStar(value));
      }
      case "reg": {
        const reg = (ac.r ?? "").toLowerCase();
        return reg.startsWith(stripStar(value));
      }
      case "hex":
        return ac.hex.toLowerCase().includes(value);
      case "sqk":
        return (ac.squawk ?? "").toLowerCase().includes(value);
      case "type":
        return (ac.t ?? "").toLowerCase().startsWith(stripStar(value));
      case "rt": {
        // Live preview via the global route cache: Omnibox doesn't subscribe
        // to it so we read from the store directly.
        const cs = (ac.flight ?? "").trim().toUpperCase();
        if (!cs) return false;
        const route = useIdentStore.getState().routeByCallsign[cs];
        if (!route) return false;
        return [route.origin, route.destination, route.route]
          .filter(Boolean)
          .some((s) => (s as string).toLowerCase().includes(value));
      }
      case "country": {
        const country = findIcaoCountry(ac.hex);
        return [country.country, country.countryCode]
          .filter(Boolean)
          .some((s) => (s as string).toLowerCase().includes(value));
      }
      default:
        return false;
    }
  }
  const needle = q.toLowerCase();
  const hay = [ac.hex, ac.flight, ac.r, ac.squawk, ac.ownOp]
    .filter(Boolean)
    .map((s) => (s as string).toLowerCase());
  return hay.some((s) => s.includes(needle));
}

// Shell for a filter-suggestion row.
function SuggestionItem({
  s,
  tag,
  onSelect,
  value,
}: {
  s: FilterSuggestion;
  tag: string;
  onSelect: () => void;
  value: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="px-4 py-1.75 grid grid-cols-[22px_1fr_auto] gap-2.5 items-center cursor-pointer text-[12.5px] data-[selected=true]:bg-paper-2"
    >
      <div
        className={
          "w-4 h-4 grid place-items-center text-ink-faint " +
          (s.kMono ? "font-mono text-[11px]" : "text-[12px]")
        }
      >
        {s.kIcon}
      </div>
      <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap flex items-baseline gap-1.5 text-(--color-ink)">
        <code className="font-mono text-[11px] text-(--color-accent) bg-[color-mix(in_oklch,var(--color-accent)_14%,transparent)] px-1.25 py-px rounded-xs">
          {s.token}
        </code>
        <span className="text-[11.5px] text-ink-soft">{s.desc}</span>
      </div>
      <span className="font-mono text-[9.5px] px-1.25 py-px rounded-xs uppercase tracking-[0.06em] bg-[color-mix(in_oklch,var(--color-accent)_22%,transparent)] text-(--color-accent) border border-[color-mix(in_oklch,var(--color-accent)_40%,transparent)]">
        {tag}
      </span>
    </Command.Item>
  );
}

// Case-insensitive substring match on token + desc. When query is empty
// every item passes. When the user is mid-clause in field-focus mode,
// these groups are hidden entirely — the component short-circuits with [].
function filterGroup<T extends { token: string; desc: string }>(
  items: readonly T[],
  q: string,
): T[] {
  const needle = q.trim().toLowerCase();
  if (needle.length === 0) return items.slice();
  return items.filter(
    (s) =>
      s.token.toLowerCase().includes(needle) ||
      s.desc.toLowerCase().includes(needle) ||
      ("kIcon" in s &&
        typeof s.kIcon === "string" &&
        s.kIcon.toLowerCase().includes(needle)),
  );
}

export function Omnibox({ open, onClose }: Props) {
  const aircraftMap = useIdentStore(selectDisplayAircraftMap);
  const select = useIdentStore((s) => s.select);
  const resetFilter = useIdentStore((s) => s.resetFilter);
  const persistedQuery = useIdentStore((s) => s.search.query);
  const setSearchQuery = useIdentStore((s) => s.setSearchQuery);
  const requestRecenter = useIdentStore((s) => s.requestRecenter);
  const setBasemap = useIdentStore((s) => s.setBasemap);
  const toggleLayer = useIdentStore((s) => s.toggleLayer);
  const selectedHex = useIdentStore((s) => s.selectedHex);
  const basemapId = useIdentStore((s) => s.map.basemapId);
  const layers = useIdentStore((s) => s.map.layers);

  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    setQuery(persistedQuery);
  }, [open, persistedQuery]);

  // cmdk's <Command.Input> auto-focuses on mount, but the palette is wrapped
  // in a Dialog that initially steals focus to the scrim (a11y reflex).
  // Explicitly focus on each open transition.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Field-focus: user has typed `field:partial`, so the palette switches into
  // value completions for that clause.
  const fieldFocus = useMemo(() => parseFieldFocusInQuery(query), [query]);
  const structuredMode = isStructuredQuery(query) || fieldFocus != null;
  const filterSuggestionQuery = currentQueryToken(query);

  // Live data for suggestions in field-focus mode comes straight from the
  // store; we read routeByCallsign imperatively since Omnibox doesn't
  // subscribe to it elsewhere.
  const routeByCallsign = useIdentStore((s) => s.routeByCallsign);

  const fieldSuggestions = useMemo<ValueSuggestion[]>(() => {
    if (!fieldFocus) return [];
    const { field, partial } = fieldFocus;
    let base: ValueSuggestion[];
    if (field === "sqk") {
      base = buildLiveSquawkSuggestions(aircraftMap);
    } else if (field in VALUE_SUGGESTIONS) {
      base = VALUE_SUGGESTIONS[field];
    } else {
      base = buildLiveFieldSuggestions(field, aircraftMap, routeByCallsign);
    }
    // Pre-filter by the already-typed value tail (case-insensitive prefix).
    // cmdk's fuzzy scoring doesn't DTRT here — it would rank `>5000` high
    // for a `2` partial because of score bleed. A simple startsWith on
    // the value tail matches user intent: "what I'm typing next".
    if (partial.length === 0) return base;
    const p = partial.toLowerCase();
    return base.filter((s) => s.value.toLowerCase().startsWith(p));
  }, [fieldFocus, aircraftMap, routeByCallsign]);

  const aircraftMatches = useMemo(() => {
    if (structuredMode) return [];
    const list: Aircraft[] = [];
    for (const ac of aircraftMap.values()) {
      if (matchesAircraft(ac, query)) list.push(ac);
      if (list.length >= 8) break;
    }
    return list;
  }, [aircraftMap, structuredMode, query]);

  const controlSuggestions: ControlSuggestion[] = [
    {
      value: "control:clear-filters",
      token: "clear filters",
      desc: "Reset every active traffic filter",
      kIcon: "clr",
      kMono: true,
      tag: "run",
      run: resetFilter,
    },
    {
      value: "control:recenter-map",
      token: "recenter map",
      desc: "Fit receiver and visible aircraft",
      kIcon: "ctr",
      kMono: true,
      tag: "run",
      run: requestRecenter,
    },
    {
      value: "control:deselect-aircraft",
      token: "deselect aircraft",
      desc: selectedHex
        ? "Clear the selected aircraft"
        : "No aircraft is selected",
      kIcon: "sel",
      kMono: true,
      tag: selectedHex ? "run" : "idle",
      run: () => select(null),
    },
    ...BASEMAP_COMMANDS.map((command) => ({
      value: `control:basemap:${command.id}`,
      token: command.token,
      desc: command.desc,
      kIcon: "map",
      kMono: true,
      tag: basemapId === command.id ? "active" : "style",
      run: () => setBasemap(command.id),
    })),
    ...LAYER_COMMANDS.map((command) => ({
      value: `control:layer:${command.key}`,
      token: command.token,
      desc: command.desc,
      kIcon: "lyr",
      kMono: true,
      tag: layers[command.key] ? "on" : "off",
      run: () => toggleLayer(command.key),
    })),
  ];

  // In field-focus mode every non-aircraft, non-field-focus group hides.
  // In default mode, groups shrink via substring match against the query.
  const filteredControls = structuredMode
    ? []
    : filterGroup(controlSuggestions, query);
  const filteredOperators = useMemo(
    () =>
      fieldFocus
        ? []
        : filterGroup(OPERATOR_SUGGESTIONS, filterSuggestionQuery),
    [fieldFocus, filterSuggestionQuery],
  );
  const filteredFields = useMemo(
    () =>
      fieldFocus ? [] : filterGroup(FIELD_SUGGESTIONS, filterSuggestionQuery),
    [fieldFocus, filterSuggestionQuery],
  );
  const filteredKeywords = useMemo(
    () =>
      fieldFocus ? [] : filterGroup(KEYWORD_SUGGESTIONS, filterSuggestionQuery),
    [fieldFocus, filterSuggestionQuery],
  );

  // Aircraft group stays visible in default mode (live preview) but hides
  // in field-focus mode: the user is clearly composing a filter, not
  // looking for a specific plane.
  const showAircraftGroup = !structuredMode;

  // When all default-mode groups collapse to zero, surface a hint rather
  // than an empty palette. Field-focus mode has its own empty state.
  const defaultModeEmpty =
    !fieldFocus &&
    !structuredMode &&
    aircraftMatches.length === 0 &&
    filteredControls.length === 0 &&
    filteredOperators.length === 0 &&
    filteredFields.length === 0 &&
    filteredKeywords.length === 0 &&
    query.trim().length > 0;
  const filterModeEmpty =
    structuredMode &&
    !fieldFocus &&
    filteredOperators.length === 0 &&
    filteredFields.length === 0 &&
    filteredKeywords.length === 0 &&
    query.trim().length > 0;

  function completeFilterToken(token: string) {
    setQuery((q) => {
      return completeFilterClause(q, token);
    });
  }

  function onJumpAircraft(hex: string) {
    select(hex);
    onClose();
  }

  function commandSelectionWouldChangeQuery(raw: string): boolean {
    if (raw.startsWith("ac:") || raw.startsWith("control:")) return true;
    const fvMatch = /^fv:(.+)$/.exec(raw);
    if (fvMatch && fieldFocus) {
      return (
        completeFilterClause(query, `${fieldFocus.field}:${fvMatch[1]}`) !==
        query.trim()
      );
    }
    const m = /^(?:op|field|kw):(.+)$/.exec(raw);
    if (m) return completeFilterClause(query, m[1]) !== query.trim();
    return false;
  }

  function isCompleteStructuredQuery(input: string): boolean {
    const derived = deriveFilterFromQuery(
      input,
      useIdentStore.getInitialState().filter,
    );
    return derived.kind === "filter" && derived.invalidClauses.length === 0;
  }

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close command palette"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default border-0 p-0"
        style={{ background: "color-mix(in oklab, #000 35%, transparent)" }}
      />
      <div
        role="dialog"
        aria-label="Command palette"
        className="omnibox-dialog fixed z-50 w-120 max-w-[calc(100vw-20px)] bg-paper border border-line-strong rounded-[7px] shadow-2xl overflow-hidden flex flex-col"
      >
        <Command
          label="Command palette"
          shouldFilter={false}
          loop
          className="flex flex-col min-h-0"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (query.trim().length === 0) {
                e.preventDefault();
                e.stopPropagation();
                resetFilter();
                onClose();
                return;
              }
              const active = (
                e.currentTarget as HTMLElement
              ).querySelector<HTMLElement>('[cmdk-item][data-selected="true"]');
              const raw = active?.getAttribute("data-value") ?? "";
              if (
                fieldFocus &&
                raw &&
                !isCompleteStructuredQuery(query) &&
                commandSelectionWouldChangeQuery(raw)
              ) {
                return;
              }
              if (isStructuredQuery(query)) {
                e.preventDefault();
                e.stopPropagation();
                setSearchQuery(query.trim());
                onClose();
                return;
              }
            }
            // Tab: semantics depend on the highlighted row's group.
            //   op/field: replace input with full token or field starter
            //   fv:       (field-focus value) replace with full
            //             `${field}:${value}` completion
            //   kw:       replace input with the keyword
            //   ac:       do nothing — user already picked a plane
            if (e.key === "Tab" && !e.shiftKey) {
              const active = (
                e.currentTarget as HTMLElement
              ).querySelector<HTMLElement>('[cmdk-item][data-selected="true"]');
              const raw = active?.getAttribute("data-value") ?? "";
              if (raw.startsWith("ac:")) {
                e.preventDefault();
                return;
              }
              const fvMatch = /^fv:(.+)$/.exec(raw);
              if (fvMatch && fieldFocus) {
                e.preventDefault();
                completeFilterToken(`${fieldFocus.field}:${fvMatch[1]}`);
                return;
              }
              const m = /^(?:op|field|kw):(.+)$/.exec(raw);
              if (m) {
                e.preventDefault();
                completeFilterToken(m[1]);
              }
            }
          }}
        >
          <div className="flex-none border-b border-(--color-line)">
            <div className="flex items-center gap-2.5 px-4 py-3.5">
              <Search
                className="w-4 h-4 text-(--color-accent) flex-none"
                strokeWidth={1.75}
              />
              <Command.Input
                ref={inputRef}
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Callsign, hex, reg, squawk, or filter"
                className="flex-1 min-w-0 bg-transparent outline-none border-0 font-mono text-[14px] text-(--color-ink) placeholder:text-ink-faint"
              />
              <span className="font-mono text-[10px] text-ink-faint border border-(--color-line) rounded-[3px] px-1.5 py-0.5 flex-none">
                esc
              </span>
            </div>
          </div>

          <Command.List className="flex-1 min-h-0 overflow-auto max-h-135">
            {fieldFocus ? (
              <Command.Group
                heading={
                  <GroupHeading
                    label={`Complete ${fieldFocus.field}`}
                    hint={`${fieldSuggestions.length} ${fieldSuggestions.length === 1 ? "suggestion" : "suggestions"}`}
                  />
                }
                className="border-b border-(--color-line)"
              >
                {fieldSuggestions.length === 0 ? (
                  <div className="px-4 py-1.75 text-[11.5px] text-ink-soft">
                    {fieldFocus.filterMode
                      ? "No completions. Press Enter to save this query."
                      : "No completions. Add a value to save this field."}
                  </div>
                ) : (
                  fieldSuggestions.map((s) => {
                    const fullToken = `${fieldFocus.field}:${s.value}`;
                    return (
                      <SuggestionItem
                        key={fullToken}
                        s={{
                          token: fullToken,
                          desc: s.desc,
                          kIcon: "»",
                          kMono: true,
                        }}
                        tag="complete"
                        value={`fv:${s.value}`}
                        onSelect={() => completeFilterToken(fullToken)}
                      />
                    );
                  })
                )}
              </Command.Group>
            ) : (
              <>
                {showAircraftGroup && (
                  <Command.Group
                    heading={
                      <GroupHeading
                        label={`Aircraft · ${aircraftMatches.length} matches`}
                        hint="enter = jump"
                      />
                    }
                    className="border-b border-(--color-line)"
                  >
                    {aircraftMatches.length === 0 ? (
                      <div className="px-4 py-1.75 text-[11.5px] text-ink-soft">
                        No aircraft match
                      </div>
                    ) : (
                      aircraftMatches.map((ac) => (
                        <Command.Item
                          key={ac.hex}
                          value={`ac:${ac.hex}`}
                          onSelect={() => onJumpAircraft(ac.hex)}
                          className="px-4 py-1.75 grid grid-cols-[22px_1fr_auto] gap-2.5 items-center cursor-pointer text-[12.5px] data-[selected=true]:bg-paper-2"
                        >
                          <div className="font-mono text-[11px] text-ink-faint">
                            {ac.hex.slice(0, 2)}
                          </div>
                          <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap flex items-baseline gap-1.5 text-(--color-ink)">
                            <code className="font-mono text-[12px] font-medium text-(--color-accent)">
                              {ac.flight?.trim() || ac.hex}
                            </code>
                            <span className="text-[11.5px] text-ink-soft">
                              {[ac.r, ac.t, ac.squawk]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </div>
                          <span className="font-mono text-[9.5px] px-1.25 py-px rounded-xs uppercase tracking-[0.06em] bg-[color-mix(in_oklch,var(--color-live)_22%,transparent)] text-(--color-live) border border-[color-mix(in_oklch,var(--color-live)_40%,transparent)]">
                            jump
                          </span>
                        </Command.Item>
                      ))
                    )}
                  </Command.Group>
                )}

                {filteredOperators.length > 0 && (
                  <Command.Group
                    heading={
                      <GroupHeading
                        label="Operators"
                        hint="numeric & comparison"
                      />
                    }
                    className="border-b border-(--color-line)"
                  >
                    {filteredOperators.map((s) => (
                      <SuggestionItem
                        key={s.token}
                        s={s}
                        tag="+ filter"
                        value={`op:${s.token}`}
                        onSelect={() => completeFilterToken(s.token)}
                      />
                    ))}
                  </Command.Group>
                )}

                {filteredFields.length > 0 && (
                  <Command.Group
                    heading={
                      <GroupHeading label="Fields" hint="string / enum" />
                    }
                    className="border-b border-(--color-line)"
                  >
                    {filteredFields.map((s) => (
                      <SuggestionItem
                        key={s.token}
                        s={s}
                        tag="+ filter"
                        value={`field:${s.token}`}
                        onSelect={() => completeFilterToken(s.token)}
                      />
                    ))}
                  </Command.Group>
                )}

                {filteredKeywords.length > 0 && (
                  <Command.Group
                    heading={
                      <GroupHeading label="Keyword toggles" hint="bare words" />
                    }
                    className="border-b border-(--color-line)"
                  >
                    {filteredKeywords.map((s) => (
                      <Command.Item
                        key={s.token}
                        value={`kw:${s.token}`}
                        onSelect={() => completeFilterToken(s.token)}
                        className="px-4 py-1.75 grid grid-cols-[22px_1fr_auto] gap-2.5 items-center cursor-pointer text-[12.5px] data-[selected=true]:bg-paper-2"
                      >
                        <div className="w-4 h-4 grid place-items-center text-ink-faint text-[12px]">
                          {s.kIcon}
                        </div>
                        <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap flex items-baseline gap-1.5 text-(--color-ink)">
                          <code className="font-mono text-[11px] text-(--color-accent) bg-[color-mix(in_oklch,var(--color-accent)_14%,transparent)] px-1.25 py-px rounded-xs">
                            {s.token}
                          </code>
                          <span className="text-[11.5px] text-ink-soft">
                            {s.desc}
                          </span>
                        </div>
                        <span className="font-mono text-[9.5px] px-1.25 py-px rounded-xs uppercase tracking-[0.06em] bg-[color-mix(in_oklch,var(--color-accent)_22%,transparent)] text-(--color-accent) border border-[color-mix(in_oklch,var(--color-accent)_40%,transparent)]">
                          + toggle
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {filteredControls.length > 0 && (
                  <Command.Group
                    heading={
                      <GroupHeading label="Controls" hint="map & app actions" />
                    }
                    className="border-b border-(--color-line)"
                  >
                    {filteredControls.map((s) => (
                      <SuggestionItem
                        key={s.value}
                        s={s}
                        tag={s.tag}
                        value={s.value}
                        onSelect={() => {
                          s.run();
                          onClose();
                        }}
                      />
                    ))}
                  </Command.Group>
                )}

                {defaultModeEmpty && (
                  <div className="px-4 py-2.5 text-[11.5px] text-ink-soft">
                    No match. Use any: to keep free text with filters.
                  </div>
                )}

                {filterModeEmpty && (
                  <div className="px-4 py-2.5 text-[11.5px] text-ink-soft">
                    No matching filter templates. Press Enter to save as typed.
                  </div>
                )}
              </>
            )}
          </Command.List>

          <div className="flex-none flex items-center gap-3.5 px-4 py-2 border-t border-(--color-line) bg-paper-2 font-mono text-[10px] text-ink-faint">
            <FootGroup k="↑↓" label="navigate" />
            <FootGroup k="⏎" label={structuredMode ? "save query" : "jump"} />
            <FootGroup k="tab" label="complete" />
            <div className="flex-1" />
            <FootGroup k="esc" label="close" />
          </div>
        </Command>
      </div>
    </>
  );
}

function GroupHeading({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex items-center justify-between px-4 pt-2 pb-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">
      <span>{label}</span>
      <span className="text-[9.5px] normal-case tracking-normal">{hint}</span>
    </div>
  );
}

function FootGroup({ k, label }: { k: string; label: string }) {
  return (
    <div className="flex items-center gap-1.25">
      <Kbd tone="ink" bg={false}>
        {k}
      </Kbd>
      <span>{label}</span>
    </div>
  );
}
