// React 18 act() requires this flag; set before importing React.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useIdentStore } from "../data/store";
import type { Aircraft } from "../data/types";
import { FiltersPanel } from "./FiltersPanel";

const AIRLINER: Aircraft = {
  hex: "aaa111",
  flight: "UAL123",
  category: "A3",
  seen: 0,
  type: "adsb_icao",
};

const ROTOR: Aircraft = {
  hex: "bbb222",
  flight: "N12345",
  category: "A7",
  seen: 0,
  type: "adsb_icao",
};

describe("FiltersPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useIdentStore.setState((st) => ({
      ...st,
      aircraft: new Map(),
      filter: useIdentStore.getInitialState().filter,
      receiver: null,
      search: { query: "" },
      routeByCallsign: {},
      map: {
        ...st.map,
        basemapId: "ident",
      },
      settings: {
        ...st.settings,
        theme: "light",
      },
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("uses the rendered aircraft palette for the altitude scale", () => {
    useIdentStore.setState((st) => ({
      map: {
        ...st.map,
        basemapId: "esriSat",
      },
    }));

    act(() => {
      root.render(<FiltersPanel />);
    });

    const gradient = container.querySelector<HTMLElement>(
      '[data-testid="altitude-scale-gradient"]',
    );
    const style = gradient?.getAttribute("style") ?? "";
    expect(style).toContain("#69AFCB");
    expect(style).not.toContain("#1F5673");
  });

  it("writes altitude slider changes into the filter query", () => {
    act(() => {
      root.render(<FiltersPanel />);
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Altitude minimum"]',
    );
    if (!input) throw new Error("expected altitude minimum input");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("expected input value setter");
    act(() => {
      setter.call(input, "5000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const st = useIdentStore.getState();
    expect(st.search.query).toBe("alt:>5000");
    expect(st.filter.altRangeFt).toEqual([5000, 45000]);
  });

  it("renders aircraft category chips with counts", () => {
    useIdentStore.setState((st) => ({
      ...st,
      aircraft: new Map([
        [AIRLINER.hex, AIRLINER],
        [ROTOR.hex, ROTOR],
      ]),
    }));

    act(() => {
      root.render(<FiltersPanel />);
    });

    expect(container.textContent).toContain("Airline");
    expect(container.textContent).toContain("Helo");
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Filter category: Airline"]',
      )?.textContent,
    ).toContain("1");
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Filter category: Helo"]',
      )?.textContent,
    ).toContain("1");
  });

  it("writes category chip changes into the filter query", () => {
    useIdentStore.setState((st) => ({
      ...st,
      aircraft: new Map([[AIRLINER.hex, AIRLINER]]),
    }));
    act(() => {
      root.render(<FiltersPanel />);
    });

    const airline = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Filter category: Airline"]',
    );
    if (!airline) throw new Error("expected airline category chip");
    act(() => {
      airline.click();
    });

    let st = useIdentStore.getState();
    expect(st.search.query).toBe("cat:a2");
    expect(st.filter.categories.airline).toBe(true);

    act(() => {
      airline.click();
    });

    st = useIdentStore.getState();
    expect(st.search.query).toBe("");
    expect(st.filter.categories.airline).toBe(false);
  });

  it("renders removable active filter chips from the omnibox query", () => {
    useIdentStore.getState().setSearchQuery("cat:a2 cs:UAL alt:>5000");
    act(() => {
      root.render(<FiltersPanel />);
    });

    const strip = container.querySelector<HTMLElement>(
      '[data-testid="filter-chip-strip"]',
    );
    if (!strip) throw new Error("expected filter chip strip");
    expect(strip.className).toContain("flex-wrap");
    expect(strip.className).toContain("overflow-y-auto");
    expect(strip.querySelector('[data-filter-query-chip="cat:a2"]')).toBeNull();
    expect(
      strip.querySelector('[data-filter-query-chip="cs:UAL"]'),
    ).not.toBeNull();
    expect(
      strip.querySelector('[data-filter-query-chip="alt:>5000"]'),
    ).not.toBeNull();
    const callsignChip = strip.querySelector<HTMLElement>(
      '[data-filter-query-chip="cs:UAL"]',
    )?.parentElement;
    expect(callsignChip?.className).toContain("h-[22px]");

    const clearCallsign = strip.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear cs:UAL"]',
    );
    if (!clearCallsign) throw new Error("expected callsign clear button");
    expect(clearCallsign.className).toContain("w-[18px]");
    expect(clearCallsign.querySelector("svg")).not.toBeNull();
    act(() => {
      clearCallsign.click();
    });

    const st = useIdentStore.getState();
    expect(st.search.query).not.toContain("cs:UAL");
    expect(st.search.query).toContain("cat:a2");
    expect(st.search.query).toContain("alt:>5000");
    expect(st.filter.callsignPrefix).toBe("");
    expect(st.filter.categories.airline).toBe(true);
    expect(st.filter.altRangeFt).toEqual([5000, 45000]);
  });
});
