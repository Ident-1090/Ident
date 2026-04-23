// biome-ignore-all lint/style/noNonNullAssertion: test fixture — missing elements/mocks fail the test loudly via the test runner.
// React 18 act() requires this flag; set before importing React.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// cmdk uses ResizeObserver internally; jsdom doesn't provide one.
if (
  typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver ===
  "undefined"
) {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

// cmdk calls scrollIntoView on the active item; jsdom doesn't implement it.
if (
  typeof (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView !==
  "function"
) {
  (Element.prototype as { scrollIntoView: () => void }).scrollIntoView =
    () => {};
}

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdentStore } from "../data/store";
import type { Aircraft } from "../data/types";
import {
  applyToken,
  buildLiveFieldSuggestions,
  buildLiveSquawkSuggestions,
  completeFilterClause,
  deriveFilterFromQuery,
  parseFieldFocus,
  parseFieldFocusInQuery,
  parseOmniboxQuery,
  removeFilterChipFromQuery,
  setCategoryFilterClause,
  tokenize,
  upsertAltitudeClause,
  VALUE_SUGGESTIONS,
} from "./grammar";
import { Omnibox } from "./Omnibox";

const UAL: Aircraft = {
  hex: "abc123",
  flight: "UAL123",
  t: "B738",
  alt_baro: 34000,
  seen: 0,
  type: "adsb_icao",
};

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function resetOmniboxStore(aircraft = new Map([[UAL.hex, UAL]])): void {
  useIdentStore.setState((st) => ({
    aircraft,
    filter: useIdentStore.getInitialState().filter,
    search: { query: "" },
    selectedHex: null,
    routeByCallsign: {},
    map: {
      ...st.map,
      basemapId: "ident",
      recenterRequestId: 0,
      layers: { ...st.map.layers, trails: false },
    },
  }));
}

describe("Omnibox", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    resetOmniboxStore();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("returns null when closed", () => {
    act(() => {
      root.render(<Omnibox open={false} onClose={() => {}} />);
    });
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("renders input, groups, and footer when open", async () => {
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await act(async () => {
      await flush();
    });

    const dialog = document.querySelector("[role=dialog]");
    expect(dialog).not.toBeNull();

    const input = dialog!.querySelector("input");
    expect(input).not.toBeNull();

    // Headings rendered by cmdk surface the group labels.
    const text = dialog!.textContent ?? "";
    expect(text).toContain("Aircraft");
    expect(text).toContain("Operators");
    expect(text).toContain("Fields");
    expect(text).toContain("Keyword toggles");
    expect(text).toContain("Controls");
    expect(text.indexOf("Controls")).toBeGreaterThan(
      text.indexOf("Keyword toggles"),
    );
    expect(text).toContain("navigate");
    expect(text).toContain("close");
  });

  it("echoes typed input into the field", async () => {
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await act(async () => {
      await flush();
    });
    const input = document.querySelector(
      "[role=dialog] input",
    ) as HTMLInputElement;
    act(() => {
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "UAL");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await flush();
    });
    expect(input.value).toBe("UAL");
  });

  it("Esc key triggers onClose", async () => {
    const onClose = vi.fn();
    act(() => {
      root.render(<Omnibox open={true} onClose={onClose} />);
    });
    await act(async () => {
      await flush();
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("grammar", () => {
  it("tokenizes operator clauses", () => {
    expect(tokenize("alt:>20000")).toEqual({
      kind: "op",
      field: "alt",
      value: ">20000",
    });
  });

  it("tokenizes keywords", () => {
    expect(tokenize("emergency")).toEqual({ kind: "kw", word: "emergency" });
    expect(tokenize("!ground")).toEqual({ kind: "kw", word: "!ground" });
  });

  it("returns null on empty input", () => {
    expect(tokenize("")).toBeNull();
    expect(tokenize("   ")).toBeNull();
  });

  it("applies alt:>N to altRangeFt lower bound", () => {
    const base = useIdentStore.getState().filter;
    const tok = tokenize("alt:>20000")!;
    const { filter, applied } = applyToken(base, tok);
    expect(applied).toBe(true);
    expect(filter.altRangeFt[0]).toBe(20000);
  });

  it("rejects incomplete numeric comparison clauses", () => {
    const base = useIdentStore.getState().filter;
    expect(applyToken(base, tokenize("alt:>")!).applied).toBe(false);
    expect(applyToken(base, tokenize("alt:<")!).applied).toBe(false);
    expect(applyToken(base, tokenize("vs:>")!).applied).toBe(false);
    expect(applyToken(base, tokenize("kt:<")!).applied).toBe(false);
  });

  it("applies alt:A..B range", () => {
    const base = useIdentStore.getState().filter;
    const tok = tokenize("alt:10000..20000")!;
    const { filter, applied } = applyToken(base, tok);
    expect(applied).toBe(true);
    expect(filter.altRangeFt).toEqual([10000, 20000]);
  });

  it("applies emergency keyword", () => {
    const base = useIdentStore.getState().filter;
    const { filter, applied } = applyToken(base, tokenize("emergency")!);
    expect(applied).toBe(true);
    expect(filter.emergOnly).toBe(true);
  });

  it("maps cat:a5 to the airline category key", () => {
    const base = useIdentStore.getState().filter;
    const { filter, applied } = applyToken(base, tokenize("cat:a5")!);
    expect(applied).toBe(true);
    expect(filter.categories.airline).toBe(true);
  });

  it("applies cs: as a callsign prefix, stripping the trailing *", () => {
    const base = useIdentStore.getState().filter;
    const { filter, applied } = applyToken(base, tokenize("cs:UAL*")!);
    expect(applied).toBe(true);
    expect(filter.callsignPrefix).toBe("UAL");
  });

  it("applies op: as an operator substring", () => {
    const base = useIdentStore.getState().filter;
    const { filter, applied } = applyToken(base, tokenize("op:delta")!);
    expect(applied).toBe(true);
    expect(filter.operatorContains).toBe("delta");
  });

  it("applies country: as an ICAO country substring", () => {
    const base = useIdentStore.getState().filter;
    const { filter, applied } = applyToken(base, tokenize("country:US")!);
    expect(applied).toBe(true);
    expect(filter.countryContains).toBe("US");
  });

  it("applies hex: as a case-insensitive substring", () => {
    const base = useIdentStore.getState().filter;
    const { filter, applied } = applyToken(base, tokenize("hex:a1b2c3")!);
    expect(applied).toBe(true);
    expect(filter.hexContains).toBe("a1b2c3");
  });

  it("applies reg: as a prefix, stripping the trailing *", () => {
    const base = useIdentStore.getState().filter;
    const { filter, applied } = applyToken(base, tokenize("reg:N78*")!);
    expect(applied).toBe(true);
    expect(filter.regPrefix).toBe("N78");
  });

  it("applies sqk: as an exact match", () => {
    const base = useIdentStore.getState().filter;
    const { filter, applied } = applyToken(base, tokenize("sqk:1200")!);
    expect(applied).toBe(true);
    expect(filter.squawkEquals).toBe("1200");
  });

  it("applies type: as a prefix, stripping the trailing *", () => {
    const base = useIdentStore.getState().filter;
    const { filter, applied } = applyToken(base, tokenize("type:B77*")!);
    expect(applied).toBe(true);
    expect(filter.typePrefix).toBe("B77");
  });

  it("applies src: as a lower-cased source name", () => {
    const base = useIdentStore.getState().filter;
    const { filter, applied } = applyToken(base, tokenize("src:MLAT")!);
    expect(applied).toBe(true);
    expect(filter.sourceEquals).toBe("mlat");
  });

  it("applies kt:>N to a gs lower bound", () => {
    const base = useIdentStore.getState().filter;
    const { filter, applied } = applyToken(base, tokenize("kt:>400")!);
    expect(applied).toBe(true);
    expect(filter.gsRangeKt?.[0]).toBe(400);
  });

  it("applies nm:<N to a distance upper bound", () => {
    const base = useIdentStore.getState().filter;
    const { filter, applied } = applyToken(base, tokenize("nm:<50")!);
    expect(applied).toBe(true);
    expect(filter.distRangeNm?.[1]).toBe(50);
  });

  it("applies vs:A..B as a vertical speed range", () => {
    const base = useIdentStore.getState().filter;
    const { filter, applied } = applyToken(base, tokenize("vs:-500..500")!);
    expect(applied).toBe(true);
    expect(filter.vsRangeFpm).toEqual([-500, 500]);
  });

  it("applies hdg:A±B as a heading window", () => {
    const base = useIdentStore.getState().filter;
    const { filter, applied } = applyToken(base, tokenize("hdg:180±60")!);
    expect(applied).toBe(true);
    expect(filter.hdgCenter).toBe(180);
    expect(filter.hdgTolerance).toBe(60);
  });

  it("applies military keyword", () => {
    const base = useIdentStore.getState().filter;
    const { filter, applied } = applyToken(base, tokenize("military")!);
    expect(applied).toBe(true);
    expect(filter.militaryOnly).toBe(true);
  });

  it("applies inview keyword", () => {
    const base = useIdentStore.getState().filter;
    const { filter, applied } = applyToken(base, tokenize("inview")!);
    expect(applied).toBe(true);
    expect(filter.inViewOnly).toBe(true);
  });

  it("does not treat pinned as a supported keyword", () => {
    expect(tokenize("pinned")).toEqual({ kind: "unknown", raw: "pinned" });
  });

  it("parses direct clauses as structured filter mode", () => {
    expect(parseOmniboxQuery("UAL123")).toEqual({
      kind: "search",
      body: "UAL123",
      clauses: [],
      text: "",
      invalidClauses: [],
      expressionParts: [],
      usesLogicalSyntax: false,
    });
    expect(parseOmniboxQuery("any: fedex cs:FDX alt:>5000")).toEqual({
      kind: "filter",
      body: "any: fedex cs:FDX alt:>5000",
      clauses: ["cs:FDX", "alt:>5000"],
      text: "fedex",
      invalidClauses: [],
      expressionParts: ["cs:FDX", "alt:>5000"],
      usesLogicalSyntax: false,
    });
  });

  it("only treats any: as the free-text filter clause", () => {
    expect(parseOmniboxQuery("search: fedex cs:FDX")).toEqual({
      kind: "filter",
      body: "search: fedex cs:FDX",
      clauses: ["cs:FDX"],
      text: "",
      invalidClauses: ["search:", "fedex"],
      expressionParts: ["cs:FDX"],
      usesLogicalSyntax: false,
    });
    expect(parseOmniboxQuery("fuzz: fedex cs:FDX")).toEqual({
      kind: "filter",
      body: "fuzz: fedex cs:FDX",
      clauses: ["cs:FDX"],
      text: "",
      invalidClauses: ["fuzz:", "fedex"],
      expressionParts: ["cs:FDX"],
      usesLogicalSyntax: false,
    });
  });

  it("parses grouped OR filter expressions", () => {
    expect(parseOmniboxQuery("(cs:FDX|cs:UPS) alt:>5000")).toEqual({
      kind: "filter",
      body: "(cs:FDX|cs:UPS) alt:>5000",
      clauses: ["cs:FDX", "cs:UPS", "alt:>5000"],
      text: "",
      invalidClauses: [],
      expressionParts: ["(", "cs:FDX", "|", "cs:UPS", ")", "alt:>5000"],
      usesLogicalSyntax: true,
    });
  });

  it("derives a filter slice from a structured query", () => {
    const base = useIdentStore.getState().filter;
    const result = deriveFilterFromQuery(
      "any: fedex op:United alt:>30000 !ground cat:a2",
      base,
    );
    expect(result.kind).toBe("filter");
    expect(result.text).toBe("fedex");
    expect(result.invalidClauses).toEqual([]);
    expect(result.filter.operatorContains).toBe("United");
    expect(result.filter.altRangeFt).toEqual([30000, 45000]);
    expect(result.filter.hideGround).toBe(true);
    expect(result.filter.categories.airline).toBe(true);
  });

  it("derives expression branches for OR and grouping", () => {
    const base = useIdentStore.getState().filter;
    const result = deriveFilterFromQuery("cs:FDX | (cs:UPS alt:>5000)", base);
    expect(result.kind).toBe("filter");
    expect(result.expressionBranches).toHaveLength(2);
    expect(result.filter.expressionBranches).toHaveLength(2);
    expect(result.expressionBranches?.[0].callsignPrefix).toBe("FDX");
    expect(result.expressionBranches?.[0].altRangeFt).toEqual([0, 45000]);
    expect(result.expressionBranches?.[1].callsignPrefix).toBe("UPS");
    expect(result.expressionBranches?.[1].altRangeFt).toEqual([5000, 45000]);
  });

  it("derives route filters from the rt clause", () => {
    const base = useIdentStore.getState().filter;
    const result = deriveFilterFromQuery("rt:SFO", base);
    expect(result.kind).toBe("filter");
    expect(result.filter.routeContains).toBe("SFO");
  });

  it("keeps plain search from mutating the derived filter", () => {
    const base = useIdentStore.getState().filter;
    const result = deriveFilterFromQuery("UAL123", base);
    expect(result.kind).toBe("search");
    expect(result.filter).toBe(base);
  });

  it("completes filter clauses while preserving prior clauses", () => {
    expect(completeFilterClause("rt", "rt:")).toBe("rt:");
    expect(completeFilterClause("op:United alt:>", "alt:>20000")).toBe(
      "op:United alt:>20000",
    );
    expect(completeFilterClause("op:United ", "alt:>20000")).toBe(
      "op:United alt:>20000",
    );
    expect(completeFilterClause("cs:FDX|cs:", "cs:UPS")).toBe("cs:FDX|cs:UPS");
    expect(completeFilterClause("(cs:FDX|", "cs:UPS")).toBe("(cs:FDX|cs:UPS");
  });

  it("updates query text for sidebar-owned filter controls", () => {
    expect(upsertAltitudeClause("", [5000, 45000])).toBe("alt:>5000");
    expect(upsertAltitudeClause("op:United alt:>5000", [0, 45000])).toBe(
      "op:United",
    );
    expect(setCategoryFilterClause("op:United", "airline", true)).toBe(
      "op:United cat:a2",
    );
    expect(setCategoryFilterClause("op:United cat:a2", "airline", false)).toBe(
      "op:United",
    );
    expect(upsertAltitudeClause("any:fedex op:United", [5000, 45000])).toBe(
      "any:fedex op:United alt:>5000",
    );
    expect(upsertAltitudeClause("(cs:FDX | cs:UPS)", [5000, 45000])).toBe(
      "(cs:FDX | cs:UPS) alt:>5000",
    );
  });

  it("removes filter chips without leaving dangling logical operators", () => {
    expect(
      removeFilterChipFromQuery("(cs:FDX | cs:UPS)", {
        label: "cs:FDX",
        start: 1,
        end: 7,
        kind: "clause",
      }),
    ).toBe("(cs:UPS)");
    expect(
      removeFilterChipFromQuery("(cs:FDX | cs:UPS)", {
        label: "cs:UPS",
        start: 10,
        end: 16,
        kind: "clause",
      }),
    ).toBe("(cs:FDX)");
  });
});

describe("field-focus grammar", () => {
  it("parseFieldFocus recognizes partial operator tokens", () => {
    expect(parseFieldFocus("alt:>")).toEqual({ field: "alt", partial: ">" });
    expect(parseFieldFocus("cat:")).toEqual({ field: "cat", partial: "" });
    expect(parseFieldFocus("src:ml")).toEqual({ field: "src", partial: "ml" });
    expect(parseFieldFocus("country:u")).toEqual({
      field: "country",
      partial: "u",
    });
  });

  it("parseFieldFocus rejects unknown fields and whitespace", () => {
    expect(parseFieldFocus("bogus:x")).toBeNull();
    expect(parseFieldFocus("alt:>20000 cat:a5")).toBeNull();
    expect(parseFieldFocus("alt")).toBeNull();
  });

  it("parseFieldFocusInQuery reads the active clause inside structured mode", () => {
    expect(parseFieldFocusInQuery("op:United alt:>")).toEqual({
      field: "alt",
      partial: ">",
      filterMode: true,
    });
    expect(parseFieldFocusInQuery("op:United ")).toBeNull();
    expect(parseFieldFocusInQuery("cs:FDX|cs:")).toEqual({
      field: "cs",
      partial: "",
      filterMode: true,
    });
    expect(parseFieldFocusInQuery("alt:>")).toEqual({
      field: "alt",
      partial: ">",
      filterMode: true,
    });
  });

  it("VALUE_SUGGESTIONS covers all static field tables", () => {
    for (const k of ["alt", "kt", "nm", "vs", "hdg", "cat", "src", "sqk"]) {
      expect(VALUE_SUGGESTIONS[k].length).toBeGreaterThan(0);
    }
    expect(VALUE_SUGGESTIONS.cat.map((s) => s.value)).toEqual([
      "a1",
      "a2",
      "a3",
      "a4",
      "a5",
      "a6",
      "a7",
    ]);
  });

  it("buildLiveFieldSuggestions pulls operators from the aircraft map", () => {
    const map = new Map<string, Aircraft>([
      [
        "a",
        {
          hex: "a",
          seen: 0,
          type: "adsb_icao",
          flight: "UAL1",
          ownOp: "United Airlines",
        },
      ],
      [
        "b",
        {
          hex: "b",
          seen: 0,
          type: "adsb_icao",
          flight: "UAL2",
          ownOp: "United Airlines",
        },
      ],
      [
        "c",
        {
          hex: "c",
          seen: 0,
          type: "adsb_icao",
          flight: "DAL9",
          ownOp: "Delta",
        },
      ],
    ]);
    const ops = buildLiveFieldSuggestions("op", map, {});
    expect(ops.map((s) => s.value)).toContain("United");
    expect(ops.map((s) => s.value)).toContain("Delta");
    // Frequency: UAL appears twice, should rank ahead of Delta.
    expect(ops[0].value).toBe("United");
  });

  it("buildLiveFieldSuggestions extracts 3-letter callsign prefixes by frequency", () => {
    const map = new Map<string, Aircraft>([
      ["a", { hex: "a", seen: 0, type: "adsb_icao", flight: "UAL123" }],
      ["b", { hex: "b", seen: 0, type: "adsb_icao", flight: "UAL456" }],
      ["c", { hex: "c", seen: 0, type: "adsb_icao", flight: "DAL789" }],
    ]);
    const cs = buildLiveFieldSuggestions("cs", map, {});
    expect(cs[0].value).toBe("UAL");
    expect(cs.map((s) => s.value)).toContain("DAL");
  });

  it("buildLiveFieldSuggestions pulls route origins/destinations from the cache", () => {
    const map = new Map<string, Aircraft>([
      ["a", { hex: "a", seen: 0, type: "adsb_icao", flight: "UAL1" }],
      ["b", { hex: "b", seen: 0, type: "adsb_icao", flight: "DAL9" }],
    ]);
    const routes = {
      UAL1: { origin: "KSFO", destination: "KJFK" },
      DAL9: { origin: "KJFK", destination: "KLAX" },
      STALE1: { origin: "KPBI", destination: "KORD" },
    };
    const r = buildLiveFieldSuggestions("rt", map, routes);
    const vals = r.map((s) => s.value);
    expect(vals).toContain("KSFO");
    expect(vals).toContain("KJFK");
    expect(vals).toContain("KLAX");
    expect(vals).not.toContain("KPBI");
    expect(vals).not.toContain("KORD");
    // KJFK appears twice → ranks first.
    expect(r[0].value).toBe("KJFK");
  });

  it("buildLiveFieldSuggestions pulls ICAO countries from aircraft hexes", () => {
    const map = new Map<string, Aircraft>([
      ["a", { hex: "a8469e", seen: 0, type: "adsb_icao" }],
      ["b", { hex: "401abc", seen: 0, type: "adsb_icao" }],
    ]);
    const countries = buildLiveFieldSuggestions("country", map, {});
    const vals = countries.map((s) => s.value);
    expect(vals).toContain("US");
    expect(vals).toContain("GB");
    expect(vals).not.toContain("United States");
    expect(vals).not.toContain("United Kingdom");
    expect(countries.map((s) => s.desc)).toEqual(
      expect.arrayContaining([
        "ICAO country United States",
        "ICAO country United Kingdom",
      ]),
    );
  });

  it("buildLiveSquawkSuggestions prepends well-known squawks and appends live ones", () => {
    const map = new Map<string, Aircraft>([
      ["a", { hex: "a", seen: 0, type: "adsb_icao", squawk: "4321" }],
      ["b", { hex: "b", seen: 0, type: "adsb_icao", squawk: "4321" }],
      ["c", { hex: "c", seen: 0, type: "adsb_icao", squawk: "7700" }],
    ]);
    const sqks = buildLiveSquawkSuggestions(map);
    // Static block always present in order.
    expect(sqks.slice(0, 5).map((s) => s.value)).toEqual([
      "7500",
      "7600",
      "7700",
      "1200",
      "7000",
    ]);
    // Live tail dedupes against the static block (7700 not added twice).
    expect(sqks.filter((s) => s.value === "7700").length).toBe(1);
    // Non-well-known live squawk appears in the tail.
    expect(sqks.map((s) => s.value)).toContain("4321");
  });
});

describe("Omnibox field-focus mode", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    resetOmniboxStore();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function setInput(value: string): void {
    const input = document.querySelector(
      "[role=dialog] input",
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      input.focus();
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function flushAsync(): Promise<void> {
    await act(async () => {
      await flush();
    });
  }

  it("hides default groups and shows 'Complete alt' when typing alt:>", async () => {
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await flushAsync();
    setInput("alt:>");
    await flushAsync();

    const text = document.querySelector("[role=dialog]")!.textContent ?? "";
    expect(text).toContain("Complete alt");
    // Default-mode groups are suppressed in field-focus.
    expect(text).not.toContain("Aircraft ·");
    expect(text).not.toContain("Filter by · operator");
    expect(text).not.toContain("Keyword toggles");
    // Static suggestions appear as full tokens.
    expect(text).toContain("alt:>20000");
  });

  it("pre-filters alt value suggestions by the typed tail", async () => {
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await flushAsync();
    setInput("alt:>2");
    await flushAsync();

    const text = document.querySelector("[role=dialog]")!.textContent ?? "";
    expect(text).toContain("alt:>20000");
    // `>5000` doesn't start with `>2` — filtered out.
    expect(text).not.toContain("alt:>5000");
  });

  it("shows category enum suggestions for cat:", async () => {
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await flushAsync();
    setInput("cat:");
    await flushAsync();
    const text = document.querySelector("[role=dialog]")!.textContent ?? "";
    expect(text).toContain("cat:a1");
    expect(text).toContain("cat:a7");
    expect(text).toContain("Light / GA");
  });

  it("shows src: enum suggestions", async () => {
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await flushAsync();
    setInput("src:");
    await flushAsync();
    const text = document.querySelector("[role=dialog]")!.textContent ?? "";
    expect(text).toContain("src:mlat");
    expect(text).toContain("src:adsb");
  });

  it("pulls live operator suggestions for op: from the aircraft map", async () => {
    useIdentStore.setState({
      aircraft: new Map<string, Aircraft>([
        [
          "a",
          {
            hex: "a",
            seen: 0,
            type: "adsb_icao",
            flight: "UAL1",
            ownOp: "United Airlines",
          },
        ],
      ]),
    });
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await flushAsync();
    setInput("op:");
    await flushAsync();
    const text = document.querySelector("[role=dialog]")!.textContent ?? "";
    expect(text).toContain("op:United");
  });

  it("pulls live country suggestions for country: from aircraft ICAO ranges", async () => {
    useIdentStore.setState({
      aircraft: new Map<string, Aircraft>([
        ["a8469e", { hex: "a8469e", seen: 0, type: "adsb_icao" }],
      ]),
    });
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await flushAsync();
    setInput("country:");
    await flushAsync();
    const text = document.querySelector("[role=dialog]")!.textContent ?? "";
    expect(text).toContain("country:US");
    expect(text).toContain("ICAO country United States");
    expect(text).not.toContain("country:United States");
  });
});

describe("Omnibox default-mode filtering", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    resetOmniboxStore();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function setInput(value: string): void {
    const input = document.querySelector(
      "[role=dialog] input",
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      input.focus();
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("narrows suggestion groups by case-insensitive substring on the query", async () => {
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await act(async () => {
      await flush();
    });
    setInput("milit");
    await act(async () => {
      await flush();
    });
    const text = document.querySelector("[role=dialog]")!.textContent ?? "";
    // `military` keyword matches; others in Operators/Fields don't.
    expect(text).toContain("military");
    expect(text).not.toContain("Altitude greater than 20,000 ft");
  });

  it("replaces unmatched search text when completing a suggestion", async () => {
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await act(async () => {
      await flush();
    });
    setInput("cen");
    await act(async () => {
      await flush();
    });

    const palette = document.querySelector("[role=dialog]")!;
    const descendingRow = palette.querySelector<HTMLElement>(
      '[cmdk-item][data-value="op:vs:<-1000"]',
    );
    expect(descendingRow).not.toBeNull();
    act(() => descendingRow!.click());

    const input = palette.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("vs:<-1000");
  });

  it("runs control commands for filters, selection, recenter, map style, and layers", async () => {
    const onClose = vi.fn();
    useIdentStore.setState((st) => ({
      selectedHex: UAL.hex,
      filter: { ...st.filter, callsignPrefix: "UAL", inViewOnly: true },
      map: {
        ...st.map,
        basemapId: "ident",
        recenterRequestId: 0,
        layers: { ...st.map.layers, trails: false },
      },
    }));

    act(() => {
      root.render(<Omnibox open={true} onClose={onClose} />);
    });
    await act(async () => {
      await flush();
    });

    const palette = document.querySelector("[role=dialog]")!;

    const clearRow = palette.querySelector<HTMLElement>(
      '[cmdk-item][data-value="control:clear-filters"]',
    );
    expect(clearRow).not.toBeNull();
    act(() => clearRow!.click());
    expect(useIdentStore.getState().filter.callsignPrefix).toBe("");
    expect(useIdentStore.getState().filter.inViewOnly).toBe(false);

    const deselectRow = palette.querySelector<HTMLElement>(
      '[cmdk-item][data-value="control:deselect-aircraft"]',
    );
    expect(deselectRow).not.toBeNull();
    act(() => deselectRow!.click());
    expect(useIdentStore.getState().selectedHex).toBeNull();

    const recenterRow = palette.querySelector<HTMLElement>(
      '[cmdk-item][data-value="control:recenter-map"]',
    );
    expect(recenterRow).not.toBeNull();
    act(() => recenterRow!.click());
    expect(useIdentStore.getState().map.recenterRequestId).toBe(1);

    const satRow = palette.querySelector<HTMLElement>(
      '[cmdk-item][data-value="control:basemap:esriSat"]',
    );
    expect(satRow).not.toBeNull();
    act(() => satRow!.click());
    expect(useIdentStore.getState().map.basemapId).toBe("esriSat");

    const trailsRow = palette.querySelector<HTMLElement>(
      '[cmdk-item][data-value="control:layer:trails"]',
    );
    expect(trailsRow).not.toBeNull();
    act(() => trailsRow!.click());
    expect(useIdentStore.getState().map.layers.trails).toBe(true);
  });

  it("commits structured query text as the persistent filter state", async () => {
    const onClose = vi.fn();
    act(() => {
      root.render(<Omnibox open={true} onClose={onClose} />);
    });
    await act(async () => {
      await flush();
    });
    setInput("op:United alt:>30000 !ground");
    await act(async () => {
      await flush();
    });

    const palette = document.querySelector("[role=dialog]")!;
    const cmdkRoot = palette.querySelector("[cmdk-root]") as HTMLElement;
    act(() => {
      cmdkRoot.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const st = useIdentStore.getState();
    expect(st.search.query).toBe("op:United alt:>30000 !ground");
    expect(st.filter.operatorContains).toBe("United");
    expect(st.filter.altRangeFt).toEqual([30000, 45000]);
    expect(st.filter.hideGround).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it("clears active filters when submitting an empty query", async () => {
    const onClose = vi.fn();
    useIdentStore.getState().setSearchQuery("op:United alt:>30000");
    act(() => {
      root.render(<Omnibox open={true} onClose={onClose} />);
    });
    await act(async () => {
      await flush();
    });
    setInput("");
    await act(async () => {
      await flush();
    });

    const palette = document.querySelector("[role=dialog]")!;
    const cmdkRoot = palette.querySelector("[cmdk-root]") as HTMLElement;
    act(() => {
      cmdkRoot.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const st = useIdentStore.getState();
    expect(st.search.query).toBe("");
    expect(st.filter.altRangeFt).toEqual([0, 45000]);
    expect(st.filter.operatorContains).toBe("");
    expect(onClose).toHaveBeenCalled();
  });

  // Helper: force a specific row to be the sole data-selected row. cmdk
  // otherwise auto-selects the first item, and multiple data-selected=true
  // rows break our querySelector-based Tab handler.
  function forceSelect(row: HTMLElement): void {
    const palette = row.ownerDocument.querySelector("[role=dialog]")!;
    palette
      .querySelectorAll<HTMLElement>('[cmdk-item][data-selected="true"]')
      .forEach((r) => {
        if (r !== row) r.removeAttribute("data-selected");
      });
    row.setAttribute("data-selected", "true");
  }

  it("Tab on a field row replaces input with the field starter", async () => {
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await act(async () => {
      await flush();
    });
    // Default palette: first item cmdk selects is the aircraft row. Type a
    // keyword so aircraft group collapses and starters remain visible.
    setInput("Operator");
    await act(async () => {
      await flush();
    });

    const palette = document.querySelector("[role=dialog]")!;
    const fieldRow = palette.querySelector<HTMLElement>(
      '[cmdk-item][data-value="field:op:"]',
    );
    expect(fieldRow).not.toBeNull();
    act(() => forceSelect(fieldRow!));

    const cmdkRoot = palette.querySelector("[cmdk-root]") as HTMLElement;
    act(() => {
      cmdkRoot.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await act(async () => {
      await flush();
    });

    const input = palette.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("op:");
  });

  it("selecting a field suggestion replaces the partial token instead of appending", async () => {
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await act(async () => {
      await flush();
    });
    setInput("rt");
    await act(async () => {
      await flush();
    });

    const palette = document.querySelector("[role=dialog]")!;
    const routeRow = palette.querySelector<HTMLElement>(
      '[cmdk-item][data-value="field:rt:"]',
    );
    expect(routeRow).not.toBeNull();
    act(() => {
      routeRow!.click();
    });
    await act(async () => {
      await flush();
    });

    const input = palette.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("rt:");
  });

  it("Tab on an aircraft row does not rewrite the input", async () => {
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await act(async () => {
      await flush();
    });
    setInput("UAL");
    await act(async () => {
      await flush();
    });
    const palette = document.querySelector("[role=dialog]")!;
    const acRow = palette.querySelector<HTMLElement>(
      '[cmdk-item][data-value^="ac:"]',
    );
    expect(acRow).not.toBeNull();
    act(() => forceSelect(acRow!));
    const cmdkRoot = palette.querySelector("[cmdk-root]") as HTMLElement;
    act(() => {
      cmdkRoot.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await act(async () => {
      await flush();
    });
    const input = palette.querySelector("input") as HTMLInputElement;
    // Tab should NOT rewrite the input — user picked a plane, not a template.
    expect(input.value).toBe("UAL");
  });

  it("Tab on a field-value (fv) row in field-focus replaces input with the full token", async () => {
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await act(async () => {
      await flush();
    });
    setInput("alt:>");
    await act(async () => {
      await flush();
    });
    const palette = document.querySelector("[role=dialog]")!;
    const fvRow = palette.querySelector<HTMLElement>(
      '[cmdk-item][data-value="fv:>20000"]',
    );
    expect(fvRow).not.toBeNull();
    act(() => forceSelect(fvRow!));
    const cmdkRoot = palette.querySelector("[cmdk-root]") as HTMLElement;
    act(() => {
      cmdkRoot.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await act(async () => {
      await flush();
    });
    const input = palette.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("alt:>20000");
  });

  it("keeps suggestions available after a committed clause", async () => {
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await act(async () => {
      await flush();
    });
    setInput("cs:FDX ");
    await act(async () => {
      await flush();
    });

    const palette = document.querySelector("[role=dialog]")!;
    expect(
      palette.querySelector('[cmdk-item][data-value="op:alt:>20000"]'),
    ).not.toBeNull();
    expect(
      palette.querySelector('[cmdk-item][data-value="field:op:"]'),
    ).not.toBeNull();
    expect(palette.textContent).not.toContain("No matching filter templates");
  });

  it("does not duplicate field suggestions across categories", async () => {
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await act(async () => {
      await flush();
    });

    const palette = document.querySelector("[role=dialog]")!;
    expect(
      palette.querySelectorAll('[cmdk-item][data-value$="cs:"]').length,
    ).toBe(1);
  });

  it("matches control suggestions by compact key", async () => {
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await act(async () => {
      await flush();
    });
    setInput("clr");
    await act(async () => {
      await flush();
    });

    const palette = document.querySelector("[role=dialog]")!;
    expect(
      palette.querySelector('[cmdk-item][data-value="control:clear-filters"]'),
    ).not.toBeNull();
  });

  it("keeps uncommitted filter text in raw input mode", async () => {
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await act(async () => {
      await flush();
    });
    setInput("alt:>");
    await act(async () => {
      await flush();
    });

    const palette = document.querySelector("[role=dialog]")!;
    const input = palette.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("alt:>");
    expect(input.className).not.toContain("sr-only");
    expect(palette.querySelector("[data-filter-chip]")).toBeNull();
    expect(
      palette.querySelector('[cmdk-item][data-value="fv:>20000"]'),
    ).not.toBeNull();
  });

  it("opens persisted structured filters as plain query text", async () => {
    useIdentStore.getState().setSearchQuery("cs:FDX alt:>5000");
    act(() => {
      root.render(<Omnibox open={true} onClose={() => {}} />);
    });
    await act(async () => {
      await flush();
    });

    const palette = document.querySelector("[role=dialog]")!;
    const input = palette.querySelector("input") as HTMLInputElement;
    expect(input.className).not.toContain("sr-only");
    expect(input.value).toBe("cs:FDX alt:>5000");
    expect(document.activeElement).toBe(input);
    expect(palette.querySelector("[data-filter-chip]")).toBeNull();
    expect(
      palette.querySelector('button[aria-label="Edit filter text"]'),
    ).toBeNull();
  });

  it("Enter completes a highlighted field-value row before applying", async () => {
    const onClose = vi.fn();
    act(() => {
      root.render(<Omnibox open={true} onClose={onClose} />);
    });
    await act(async () => {
      await flush();
    });
    setInput("src:");
    await act(async () => {
      await flush();
    });

    const palette = document.querySelector("[role=dialog]")!;
    const srcRow = palette.querySelector<HTMLElement>(
      '[cmdk-item][data-value="fv:adsb"]',
    );
    expect(srcRow).not.toBeNull();
    act(() => forceSelect(srcRow!));

    const cmdkRoot = palette.querySelector("[cmdk-root]") as HTMLElement;
    act(() => {
      cmdkRoot.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await act(async () => {
      await flush();
    });

    const input = palette.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("src:adsb");
    expect(useIdentStore.getState().search.query).toBe("");
    expect(onClose).not.toHaveBeenCalled();

    const exactSrcRow = palette.querySelector<HTMLElement>(
      '[cmdk-item][data-value="fv:adsb"]',
    );
    expect(exactSrcRow).not.toBeNull();
    act(() => forceSelect(exactSrcRow!));
    act(() => {
      cmdkRoot.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(useIdentStore.getState().search.query).toBe("src:adsb");
    expect(onClose).toHaveBeenCalled();
  });

  it("Enter applies a complete typed field-value instead of the highlighted template", async () => {
    const onClose = vi.fn();
    act(() => {
      root.render(<Omnibox open={true} onClose={onClose} />);
    });
    await act(async () => {
      await flush();
    });
    setInput("alt:>200");
    await act(async () => {
      await flush();
    });

    const palette = document.querySelector("[role=dialog]")!;
    const templateRow = palette.querySelector<HTMLElement>(
      '[cmdk-item][data-value="fv:>20000"]',
    );
    expect(templateRow).not.toBeNull();
    act(() => forceSelect(templateRow!));

    const cmdkRoot = palette.querySelector("[cmdk-root]") as HTMLElement;
    act(() => {
      cmdkRoot.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const st = useIdentStore.getState();
    expect(st.search.query).toBe("alt:>200");
    expect(st.filter.altRangeFt).toEqual([200, 45000]);
    expect(onClose).toHaveBeenCalled();
  });
});
