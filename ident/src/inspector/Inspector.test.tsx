// biome-ignore-all lint/style/noNonNullAssertion: test fixture — missing elements/mocks fail the test loudly via the test runner.
// React 18 act() requires this flag; set before importing React.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetPreferencesStoreForTests,
  usePreferencesStore,
} from "../data/preferences";
import { useIdentStore } from "../data/store";
import type { Aircraft } from "../data/types";
import { Inspector } from "./Inspector";
import { resetRouteCacheForTests } from "./route";

const FAKE: Aircraft = {
  hex: "abc123",
  flight: "UAL123",
  r: "N12345",
  t: "B738",
  category: "A3",
  type: "adsb_icao",
  version: 2,
  alt_baro: 34000,
  alt_geom: 34100,
  baro_rate: 128,
  gs: 420,
  tas: 440,
  mach: 0.78,
  track: 91,
  true_heading: 89,
  squawk: "2200",
  emergency: "none",
  nav_altitude_mcp: 36000,
  nic: 8,
  nac_p: 9,
  sil: 3,
  messages: 1234,
  seen: 0.5,
  seen_pos: 1.2,
  rssi: -18.4,
  lat: 37.42,
  lon: -122.08,
};

describe("Inspector", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetPreferencesStoreForTests();
    resetRouteCacheForTests();
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [
        {
          callsign: "UAL123",
          _airport_codes_iata: "SFO-LAX",
          _airports: [
            { iata: "SFO", icao: "KSFO", location: "San Francisco, CA" },
            { iata: "LAX", icao: "KLAX", location: "Los Angeles, CA" },
          ],
        },
      ],
    })) as unknown as typeof fetch;
    const initial = useIdentStore.getInitialState();
    useIdentStore.setState({
      aircraft: new Map([[FAKE.hex, FAKE]]),
      selectedHex: FAKE.hex,
      receiver: {
        lat: 37.4,
        lon: -122.1,
        version: "wiedehopf readsb v3.14.1676",
      },
      inspector: { tab: "telemetry" },
      altTrendsByHex: { [FAKE.hex]: [33000, 33500, 34000] },
      rssiBufByHex: { [FAKE.hex]: [-20, -18, -18.4] },
      settings: {
        ...initial.settings,
        unitOverrides: { ...initial.settings.unitOverrides },
      },
      // Force the WS-closed fallback so the mocked adsb.im fetch actually fires.
      connectionStatus: { ws: "closed" },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  const rowValue = (label: string): string => {
    const key = Array.from(container.querySelectorAll("dt")).find(
      (d) => d.textContent === label,
    );
    return key?.nextElementSibling?.textContent ?? "";
  };
  const telCellText = (label: string): string => {
    const key = Array.from(container.querySelectorAll("div")).find(
      (d) => d.textContent === label,
    );
    return key?.parentElement?.textContent ?? "";
  };

  it("renders header and telemetry for the selected aircraft, switches to Raw tab on click", async () => {
    await act(async () => {
      root.render(<Inspector />);
    });
    // Header contents.
    expect(container.textContent).toContain("ABC123");
    expect(container.textContent).toContain("UAL123");
    expect(container.textContent).toContain("B738");
    const header = container.querySelector("aside > div:first-child");
    expect(header).toBeTruthy();
    const regLink = header?.querySelector(
      'a[href="https://flightaware.com/live/flight/N12345"]',
    );
    expect(regLink).toBeTruthy();
    expect(regLink?.textContent).toBe("N12345");
    expect(regLink?.className).toContain("underline");
    expect(header?.lastElementChild?.textContent).toBe("B738");
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 350));
    });
    expect(container.textContent).toContain("SFO");
    expect(container.textContent).toContain("LAX");
    expect(container.textContent).toContain("SFO-LAX");
    // Default telemetry tab: shows ICAO 24 row label + hex upper.
    expect(container.textContent).toContain("ICAO 24");
    expect(container.textContent).toContain("ABC123");
    // Click RAW tab.
    const buttons = Array.from(container.querySelectorAll("button"));
    const rawBtn = buttons.find((b) => b.textContent === "RAW");
    expect(rawBtn).toBeTruthy();
    act(() => {
      rawBtn!.click();
    });
    // Store tab updated and persisted.
    expect(useIdentStore.getState().inspector.tab).toBe("raw");
    expect(usePreferencesStore.getState().inspectorTab).toBe("raw");
    // Raw tab pre block shows a JSON field.
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('"hex": "abc123"');
  });

  it("reflects live gs / tas updates into the telemetry grid without a remount", () => {
    act(() => {
      root.render(<Inspector />);
    });
    const gsCellValue = () => {
      const gsLabel = Array.from(container.querySelectorAll("div")).find(
        (d) => d.textContent === "GS / TAS",
      );
      // Sibling value div lives next to the label inside the same TelCell.
      const cell = gsLabel?.parentElement;
      const value = cell?.children[1];
      return value?.textContent ?? "";
    };
    // Initial render keeps 420 kt in the default aviation preset.
    expect(gsCellValue()).toContain("420");
    // Ingest a fresh frame — new Map, new Aircraft object — and verify the
    // cell re-renders with the updated value. Regression guard for the
    // "GS / TAS is static" complaint.
    act(() => {
      useIdentStore.getState().ingestAircraft({
        now: 0,
        aircraft: [{ ...FAKE, gs: 502, tas: 520 }],
      });
    });
    expect(gsCellValue()).toContain("502");
    // Drop to ground speed: cell flips to "—".
    act(() => {
      useIdentStore.getState().ingestAircraft({
        now: 0,
        aircraft: [{ ...FAKE, gs: undefined, tas: undefined }],
      });
    });
    expect(gsCellValue()).toBe("—");
  });

  it("does not derive wind and OAT when readsb does not provide them", () => {
    act(() => {
      root.render(<Inspector />);
    });

    expect(rowValue("Wind")).toBe("—");
    expect(rowValue("OAT")).toBe("—");
  });

  it("renders direct readsb wind and OAT fields when present", () => {
    act(() => {
      useIdentStore.setState({
        aircraft: new Map([
          [
            FAKE.hex,
            {
              ...FAKE,
              wd: 297,
              ws: 40,
              oat: -30,
            },
          ],
        ]),
      });
      root.render(<Inspector />);
    });

    expect(rowValue("Wind")).toContain("297°");
    expect(rowValue("Wind")).toContain("40 kt");
    expect(rowValue("OAT")).toBe("-30 °C");
  });

  it("labels selected-aircraft recency in the header", () => {
    act(() => {
      root.render(<Inspector />);
    });
    const recency = () =>
      container.querySelector("[data-aircraft-recency]")?.textContent;
    const recencyTooltip = () =>
      container
        .querySelector("[data-aircraft-recency]")
        ?.getAttribute("data-aircraft-recency-tooltip");
    const recencyClass = () =>
      container.querySelector("[data-aircraft-recency]")?.className ?? "";

    expect(recency()).toBe("LIVE");
    expect(recencyTooltip()).toBe("Last msg 0.5 s ago");
    expect(recencyClass()).toContain("px-1.5");
    expect(recencyClass()).toContain("py-0.5");
    expect(recencyClass()).not.toContain("border");
    expect(
      container.querySelector("aside > div:first-child")?.textContent,
    ).not.toContain("A3");

    act(() => {
      useIdentStore.setState({
        aircraft: new Map([[FAKE.hex, { ...FAKE, seen: 3 }]]),
      });
    });
    expect(recency()).toBe("STALE");
    expect(recencyTooltip()).toBe("Last msg 3.0 s ago");

    act(() => {
      useIdentStore.setState({
        aircraft: new Map([[FAKE.hex, { ...FAKE, seen: 31 }]]),
      });
    });
    expect(recency()).toBe("LOST");
    expect(recencyTooltip()).toBe("Last msg 31.0 s ago");
  });

  it("surfaces a GS rate hint (kt/min) driven by the rolling gsTrendsByHex buffer", () => {
    // 4-sample 1 Hz buffer spans 3 s. Δ = 40 kt over 3 s → 40 × 60 / 3 =
    // 800 kt/min in the default aviation preset.
    useIdentStore.setState({
      aircraft: new Map([[FAKE.hex, { ...FAKE, gs: 460 }]]),
      gsTrendsByHex: { [FAKE.hex]: [420, 430, 445, 460] },
    });
    act(() => {
      root.render(<Inspector />);
    });
    const gsCellHint = () => {
      const gsLabel = Array.from(container.querySelectorAll("div")).find(
        (d) => d.textContent === "GS / TAS",
      );
      const cell = gsLabel?.parentElement;
      return cell?.children[2]?.textContent ?? "";
    };
    expect(gsCellHint()).toContain("▲");
    expect(gsCellHint()).toContain("/min");
    expect(gsCellHint()).toContain("800");

    // Decelerating trace.
    act(() => {
      useIdentStore.setState({
        gsTrendsByHex: { [FAKE.hex]: [460, 420, 380, 340] },
      });
    });
    expect(gsCellHint()).toContain("▼");

    // Flat within the ±1 kt/min threshold → "— steady".
    act(() => {
      useIdentStore.setState({
        gsTrendsByHex: { [FAKE.hex]: [400, 400, 400, 400] },
      });
    });
    expect(gsCellHint()).toContain("steady");
  });

  it("shows selected altitude under geometric altitude", () => {
    useIdentStore.setState((state) => ({
      settings: { ...state.settings, unitMode: "metric" },
      aircraft: new Map([[FAKE.hex, { ...FAKE, nav_altitude_mcp: 36000 }]]),
    }));
    act(() => {
      root.render(<Inspector />);
    });

    const altGeom = telCellText("Alt geom");
    expect(altGeom).toContain("SEL 10,973 m");
    expect(altGeom).not.toContain("ALT SEL");
    expect(altGeom).not.toContain("baro");
    expect(altGeom).not.toContain("Δ");
  });

  it("shows selected heading under track and keeps the field label when unavailable", () => {
    useIdentStore.setState({
      aircraft: new Map([
        [FAKE.hex, { ...FAKE, true_heading: undefined, nav_heading: 122.7 }],
      ]),
    });
    act(() => {
      root.render(<Inspector />);
    });

    const track = telCellText("Track");
    expect(track).toContain("SEL 123°");
    expect(track).not.toContain("HDG SEL");
    expect(track).not.toContain("heading unavailable");
    expect(track).not.toContain("HDG —°");

    act(() => {
      useIdentStore.setState({
        aircraft: new Map([
          [
            FAKE.hex,
            { ...FAKE, true_heading: undefined, nav_heading: undefined },
          ],
        ]),
      });
    });
    const trackWithoutSelectedHeading = telCellText("Track");
    expect(trackWithoutSelectedHeading).toContain("SEL -°");
    expect(trackWithoutSelectedHeading).not.toContain("HDG SEL");
    expect(trackWithoutSelectedHeading).not.toContain("heading unavailable");
  });

  it("shows route endpoints with via airports, or receiver distance when route is unavailable", () => {
    useIdentStore.setState({
      routeByCallsign: {
        UAL123: { origin: "SFO", destination: "LAX", route: "SFO-OAK-LAX" },
      },
    });
    act(() => {
      root.render(<Inspector />);
    });

    expect(telCellText("Route")).toContain("SFO-LAX");
    expect(telCellText("Route")).toContain("via OAK");
    expect(telCellText("Route")).not.toContain("SFO-OAK-LAX");
    expect(telCellText("Route")).not.toContain("airport pair");
    expect(telCellText("Route")).not.toContain("route");

    act(() => {
      useIdentStore.setState({
        routeByCallsign: {
          UAL123: {
            origin: "SFO",
            destination: "JFK",
            route: "SFO-OAK-DEN-JFK",
          },
        },
      });
    });

    expect(telCellText("Route")).toContain("SFO-JFK");
    expect(telCellText("Route")).toContain("via OAK, DEN");
    expect(telCellText("Route")).not.toContain("SFO-OAK-DEN-JFK");

    act(() => {
      useIdentStore.setState({
        routeByCallsign: {
          UAL123: {
            origin: "LAX",
            destination: "SMF",
            route: "LAX-SMF",
          },
        },
      });
    });

    expect(telCellText("Route")).toContain("LAX-SMF");
    expect(telCellText("Route")).toContain("direct");

    act(() => {
      useIdentStore.setState({
        routeByCallsign: { UAL123: null },
      });
    });

    expect(telCellText("Route")).toBe("");
    const distanceCell = telCellText("Distance");
    expect(distanceCell).toContain("nm");
    expect(distanceCell).toContain("from base");
    expect(distanceCell).not.toContain("via");
  });

  it("renders a selected-heading placeholder when selected heading is unavailable", () => {
    useIdentStore.setState({
      aircraft: new Map([
        [
          FAKE.hex,
          { ...FAKE, true_heading: undefined, nav_heading: undefined },
        ],
      ]),
    });
    act(() => {
      root.render(<Inspector />);
    });

    const track = telCellText("Track");
    expect(track).toContain("SEL -°");
    expect(track).not.toContain("HDG SEL");
    expect(track).not.toContain("heading unavailable");
    expect(track).not.toContain("HDG —°");
  });

  it("adds selected-field tooltips to compact SEL hints", () => {
    useIdentStore.setState({
      aircraft: new Map([[FAKE.hex, { ...FAKE, nav_heading: 89 }]]),
    });
    act(() => {
      root.render(<Inspector />);
    });

    expect(container.textContent).toContain("SEL 089°");
    expect(container.textContent).toContain("SEL 36,000 ft");
    expect(
      container.querySelector('[data-selected-field="Selected heading"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-selected-field="Selected altitude"]'),
    ).not.toBeNull();
  });

  it("marks selected altitude on the altitude history graph", () => {
    const now = new Date("2026-04-23T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    useIdentStore.setState({
      aircraft: new Map([[FAKE.hex, { ...FAKE, nav_altitude_mcp: 36000 }]]),
      trailsByHex: {
        [FAKE.hex]: [
          { lat: 0, lon: 0, alt: 34000, ts: now.getTime() - 5 * 60_000 },
          { lat: 0, lon: 0, alt: 34200, ts: now.getTime() - 3 * 60_000 },
          { lat: 0, lon: 0, alt: 34500, ts: now.getTime() },
        ],
      },
    });
    act(() => {
      root.render(<Inspector />);
    });

    const reference = container.querySelector(
      '[data-altitude-reference="selected"]',
    );
    expect(reference).not.toBeNull();
    expect(reference?.getAttribute("aria-label")).toContain("36,000 ft");
    expect(container.textContent).toContain("ALT SEL");
    expect(container.textContent).toContain("Altitude · from 5 minutes ago");
  });

  it("falls back to hex in the header when registration is missing", () => {
    act(() => {
      useIdentStore.setState({
        aircraft: new Map([[FAKE.hex, { ...FAKE, r: undefined }]]),
      });
      root.render(<Inspector />);
    });

    expect(
      container.querySelector(
        'a[href^="https://flightaware.com/live/flight/"]',
      ),
    ).toBeNull();
    expect(container.textContent).toContain("ABC123");
    expect(container.textContent).toContain("B738");
  });

  it("uses custom tooltips for abbreviated tab controls", () => {
    act(() => {
      root.render(<Inspector />);
    });

    const close = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close inspector"]',
    );
    expect(close).toBeTruthy();
    expect(close?.getAttribute("title")).toBeNull();

    act(() => {
      close?.focus();
    });

    expect(close?.getAttribute("aria-describedby")).toBeNull();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();

    act(() => {
      close?.blur();
    });

    const rawTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "RAW");
    expect(rawTab).toBeTruthy();
    expect(rawTab?.getAttribute("title")).toBeNull();

    act(() => {
      rawTab?.focus();
    });

    expect(rawTab?.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Raw aircraft JSON",
    );
  });

  it("does not derive a per-aircraft message rate from total messages and data age", () => {
    act(() => {
      useIdentStore.setState({
        inspector: { tab: "signal" },
        aircraft: new Map([[FAKE.hex, { ...FAKE, messages: 1234, seen: 0.5 }]]),
      });
      root.render(<Inspector />);
    });

    expect(container.textContent).toContain("Messages");
    expect(container.textContent).toContain("1,234");
    expect(container.textContent).toContain("Last msg");
    expect(container.textContent).not.toContain("Msg rate");
    expect(container.textContent).not.toContain("1,234/s");
  });
});
