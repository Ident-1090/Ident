// React 18 act() requires this flag; set before importing React.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdentStore } from "../data/store";
import type { Aircraft } from "../data/types";
import { resetRouteCacheForTests } from "../inspector/route";
import { TrafficList } from "./TrafficList";

const UAL: Aircraft = {
  hex: "abc123",
  flight: "UAL123",
  t: "B738",
  alt_baro: 34000,
  lat: 37.42,
  lon: -122.08,
  seen: 0,
  type: "adsb_icao",
};

const SWA: Aircraft = {
  hex: "def456",
  flight: "SWA456",
  t: "B737",
  alt_baro: 28000,
  lat: 37.7,
  lon: -122.3,
  seen: 0,
  type: "adsb_icao",
};

describe("TrafficList", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetRouteCacheForTests();
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    useIdentStore.setState((st) => ({
      ...st,
      aircraft: new Map([
        [UAL.hex, UAL],
        [SWA.hex, SWA],
      ]),
      receiver: { lat: 37.4, lon: -122.1, version: "readsb" },
      selectedHex: null,
      filter: {
        categories: {
          airline: false,
          ga: false,
          bizjet: false,
          mil: false,
          rotor: false,
          unknown: false,
        },
        altRangeFt: [0, 45000],
        emergOnly: false,
        hideGround: false,
        hasPosOnly: false,
        operatorContains: "",
        callsignPrefix: "",
        routeContains: "",
        countryContains: "",
        hexContains: "",
        regPrefix: "",
        squawkEquals: "",
        typePrefix: "",
        sourceEquals: "",
        gsRangeKt: null,
        distRangeNm: null,
        vsRangeFpm: null,
        hdgCenter: null,
        hdgTolerance: null,
        militaryOnly: false,
        inViewOnly: false,
        expressionBranches: null,
      },
      search: { query: "" },
      routeByCallsign: {
        UAL123: { origin: "SFO", destination: "LAX", route: "SFO-LAX" },
      },
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
  });

  it("shows cached route information in the traffic row", () => {
    act(() => {
      root.render(<TrafficList />);
    });

    expect(container.textContent).toContain("UAL123");
    expect(container.textContent).toContain("SFO");
    expect(container.textContent).toContain("LAX");
  });

  it("notifies when a traffic row selects aircraft", () => {
    const onAircraftSelect = vi.fn();
    act(() => {
      root.render(<TrafficList onAircraftSelect={onAircraftSelect} />);
    });

    const row = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("UAL123"));
    expect(row).toBeTruthy();

    act(() => row?.click());

    expect(useIdentStore.getState().selectedHex).toBe(UAL.hex);
    expect(onAircraftSelect).toHaveBeenCalledTimes(1);
  });

  it("filters by origin or destination text from cached route data", () => {
    useIdentStore.setState((st) => ({
      ...st,
      search: { query: "lax" },
    }));

    act(() => {
      root.render(<TrafficList />);
    });

    expect(container.textContent).toContain("UAL123");
    expect(container.textContent).not.toContain("SWA456");
  });

  it("shows an unlabeled country flag slot before the callsign", () => {
    act(() => {
      root.render(<TrafficList />);
    });

    expect(container.textContent).not.toContain("Flag");
    expect(
      container.querySelector('[aria-label="United States"] svg'),
    ).not.toBeNull();
  });

  it("uses custom tooltips for abbreviated sortable columns", () => {
    act(() => {
      root.render(<TrafficList />);
    });

    const ktHeader = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Kt");
    expect(ktHeader).toBeTruthy();
    expect(ktHeader?.getAttribute("title")).toBeNull();

    act(() => {
      ktHeader?.focus();
    });

    expect(ktHeader?.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Sort by ground speed",
    );
  });

  it("renders skeleton rows before any feed data has arrived", () => {
    useIdentStore.setState((st) => ({
      ...st,
      aircraft: new Map(),
      receiver: null,
      stats: null,
      outline: null,
      liveState: { ...st.liveState, lastMsgTs: 0 },
    }));

    act(() => {
      root.render(<TrafficList />);
    });

    expect(
      container.querySelector('[aria-label="Loading traffic"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("no traffic");
  });
});
