// biome-ignore-all lint/style/noNonNullAssertion: test fixture — missing elements/mocks fail the test loudly via the test runner.
// React 18 act() requires this flag; set before importing React.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdentStore } from "../data/store";
import { MobileShell } from "./MobileShell";

vi.mock("../inspector/Inspector", () => ({
  Inspector: () => <div data-testid="inspector" />,
}));

function expectTooltipOnFocus(button: HTMLButtonElement, label: string) {
  expect(button.getAttribute("title")).toBeNull();
  act(() => {
    button.focus();
  });
  expect(button.getAttribute("aria-describedby")).toBeTruthy();
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(label);
  act(() => {
    button.blur();
  });
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
}

describe("MobileShell", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useIdentStore.setState({
      aircraft: new Map(),
      selectedHex: null,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderMobileShell({
    onOpenOmnibox = () => {},
    onOpenSettings = () => {},
  }: {
    onOpenOmnibox?: () => void;
    onOpenSettings?: () => void;
  } = {}) {
    root.render(
      <MobileShell
        onOpenOmnibox={onOpenOmnibox}
        onOpenSettings={onOpenSettings}
      />,
    );
  }

  it("exposes a mobile omnibox button", () => {
    const onOpenOmnibox = vi.fn();
    act(() => {
      renderMobileShell({ onOpenOmnibox });
    });

    const search = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open search"]',
    );
    expect(search).toBeTruthy();
    act(() => search!.click());

    expect(onOpenOmnibox).toHaveBeenCalledTimes(1);
  });

  it("stacks the search button below the menu button", () => {
    act(() => {
      renderMobileShell();
    });

    const row = container.querySelector<HTMLElement>(".mobile-fab-row");
    expect(row).toBeTruthy();
    expect(row!.className).toContain("flex-col");
    expect(row!.className).toContain("items-end");
    expect(
      Array.from(row!.querySelectorAll("button")).map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Open menu", "Open search"]);
  });

  it("renders mobile theme controls as icon-only buttons", () => {
    act(() => {
      renderMobileShell();
    });
    const settingsTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Settings");
    expect(settingsTab?.textContent).toBe("Settings");

    act(() => settingsTab!.click());

    for (const label of ["System", "Light", "Dark"]) {
      const button = container.querySelector<HTMLButtonElement>(
        `button[aria-label="${label}"]`,
      );
      expect(button).toBeTruthy();
      expect(button!.textContent).toBe("");
    }
  });

  it("uses custom tooltips for mobile domain controls", () => {
    act(() => {
      root.render(
        <MobileShell onOpenOmnibox={() => {}} onOpenSettings={() => {}} />,
      );
    });
    expect(container.querySelector("[title]")).toBeNull();

    const search = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open search"]',
    );
    const menu = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open menu"]',
    );
    expect(search?.getAttribute("title")).toBeNull();
    expect(menu?.getAttribute("title")).toBeNull();

    act(() => menu!.click());

    const closeDrawer = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close drawer"]',
    );
    act(() => {
      closeDrawer!.focus();
    });
    expect(closeDrawer!.getAttribute("aria-describedby")).toBeNull();

    const receiverTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Rx");
    expectTooltipOnFocus(receiverTab!, "Receiver");

    const settingsTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Settings");
    act(() => settingsTab!.click());

    expectTooltipOnFocus(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="System"]',
      )!,
      "System",
    );
    const regularMap = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Regular map"]',
    )!;
    expect(regularMap.textContent).toBe("MAP");
    expectTooltipOnFocus(regularMap, "Regular map");
    expectTooltipOnFocus(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Icon Dot"]',
      )!,
      "Icon Dot",
    );
    expectTooltipOnFocus(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Toggle Rt"]',
      )!,
      "Route label",
    );
  });

  it("opens the menu as a hamburger-anchored popup and closes on Escape", () => {
    act(() => {
      renderMobileShell();
    });

    const menu = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open menu"]',
    );
    const drawer = container.querySelector<HTMLElement>(
      '[aria-label="Mobile sidebar"]',
    );
    expect(menu).toBeTruthy();
    expect(drawer).toBeTruthy();
    expect(drawer!.dataset.open).toBe("false");

    act(() => menu!.click());
    expect(drawer!.dataset.open).toBe("true");

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(drawer!.dataset.open).toBe("false");
  });

  it("combines theme and the desktop-equivalent map control in the settings tab", () => {
    act(() => {
      renderMobileShell();
    });

    const settingsTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Settings");
    act(() => settingsTab!.click());

    expect(
      container.querySelector('button[aria-pressed][type="button"]')
        ?.textContent,
    ).toBe("Traffic");
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some(
        (button) => button.textContent === "MAP",
      ),
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some(
        (button) => button.textContent === "OTHERS ▾",
      ),
    ).toBe(true);
    expect(
      container.querySelector('button[role="checkbox"][aria-checked]'),
    ).toBeNull();
  });

  it("includes label display settings in the settings tab", () => {
    act(() => {
      renderMobileShell();
    });

    const settingsTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Settings");
    act(() => settingsTab!.click());

    expect(container.textContent).toContain("Labels");
    const dot = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Icon Dot"]',
    );
    const route = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle Rt"]',
    );
    expect(dot).toBeTruthy();
    expect(route).toBeTruthy();
    expect(dot!.parentElement?.parentElement?.className).toContain(
      "grid-cols-2",
    );

    act(() => dot!.click());
    expect(useIdentStore.getState().map.labelMode).toBe("dot");

    const before = useIdentStore.getState().map.labelFields.rt;
    act(() => route!.click());
    expect(useIdentStore.getState().map.labelFields.rt).toBe(!before);
  });

  it("opens full settings from the settings tab after closing the drawer", () => {
    const onOpenSettings = vi.fn();

    act(() => {
      renderMobileShell({ onOpenSettings });
    });

    const menu = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open menu"]',
    );
    const drawer = container.querySelector<HTMLElement>(
      '[aria-label="Mobile sidebar"]',
    );
    expect(menu).toBeTruthy();
    expect(drawer).toBeTruthy();

    act(() => menu!.click());
    expect(drawer!.dataset.open).toBe("true");

    const settingsTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Settings");
    expect(settingsTab).toBeTruthy();

    act(() => settingsTab!.click());

    const moreSettings = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "More settings");
    expect(moreSettings).toBeTruthy();

    act(() => moreSettings!.click());

    expect(drawer!.dataset.open).toBe("false");
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("renders selected aircraft with the inspector sheet already expanded", () => {
    useIdentStore.setState({
      aircraft: new Map([["abc123", { hex: "abc123", flight: "UAL123" }]]),
      selectedHex: "abc123",
    });

    act(() => {
      renderMobileShell();
    });

    const sheet = container.querySelector<HTMLElement>(
      '[aria-label="Aircraft inspector sheet"]',
    );
    expect(sheet?.dataset.snap).toBe("half");
    expect(container.querySelector('[data-testid="inspector"]')).toBeTruthy();
  });

  it("uses a custom tooltip for the sheet snap handle", () => {
    useIdentStore.setState({
      aircraft: new Map([["abc123", { hex: "abc123", flight: "UAL123" }]]),
      selectedHex: "abc123",
    });

    act(() => {
      root.render(
        <MobileShell onOpenOmnibox={() => {}} onOpenSettings={() => {}} />,
      );
    });

    const halfHandle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Sheet position: half. Tap to cycle."]',
    );
    expectTooltipOnFocus(halfHandle!, "Sheet position: half. Tap to cycle.");
  });

  it("keeps the traffic list in the drawer instead of a default bottom sheet", () => {
    act(() => {
      renderMobileShell();
    });

    expect(
      container.querySelector('[aria-label="Aircraft inspector sheet"]'),
    ).toBeNull();
    const trafficTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Traffic");
    expect(trafficTab?.getAttribute("aria-pressed")).toBe("true");
  });

  it("closes the traffic drawer after selecting an aircraft row", () => {
    useIdentStore.setState({
      aircraft: new Map([
        [
          "abc123",
          {
            hex: "abc123",
            flight: "UAL123",
            alt_baro: 34000,
            lat: 37.42,
            lon: -122.08,
            seen: 0,
            type: "adsb_icao",
          },
        ],
      ]),
      receiver: { lat: 37.4, lon: -122.1, version: "readsb" },
      selectedHex: null,
    });

    act(() => {
      renderMobileShell();
    });

    const menu = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open menu"]',
    );
    const drawer = container.querySelector<HTMLElement>(
      '[aria-label="Mobile sidebar"]',
    );
    expect(menu).toBeTruthy();
    expect(drawer).toBeTruthy();

    act(() => menu!.click());
    expect(drawer!.dataset.open).toBe("true");

    const row = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("UAL123"));
    expect(row).toBeTruthy();

    act(() => row!.click());

    expect(useIdentStore.getState().selectedHex).toBe("abc123");
    expect(drawer!.dataset.open).toBe("false");
    expect(
      container.querySelector('[aria-label="Aircraft inspector sheet"]'),
    ).toBeTruthy();
  });

  it("constrains the traffic tab so the list owns the scroll area", () => {
    act(() => {
      renderMobileShell();
    });

    const body = container.querySelector<HTMLElement>(".mobile-drawer-body");
    expect(body).toBeTruthy();
    expect(body!.className).toContain("flex");
    expect(body!.className).toContain("flex-col");

    const scrollRegion = body!.querySelector<HTMLElement>(
      ".traffic-list-scroll",
    );
    expect(scrollRegion).toBeTruthy();
    expect(scrollRegion!.className).toContain("flex-1");
    expect(scrollRegion!.className).toContain("min-h-0");
    expect(scrollRegion!.className).toContain("overflow-y-auto");
  });

  it("keeps the selected sheet mounted when it collapses", () => {
    useIdentStore.setState({
      aircraft: new Map([["abc123", { hex: "abc123", flight: "UAL123" }]]),
      selectedHex: "abc123",
    });

    act(() => {
      renderMobileShell();
    });

    const halfHandle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Sheet position: half. Tap to cycle."]',
    );
    expect(halfHandle).toBeTruthy();
    act(() => halfHandle!.click());

    const fullHandle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Sheet position: full. Tap to cycle."]',
    );
    expect(fullHandle).toBeTruthy();
    act(() => fullHandle!.click());

    expect(useIdentStore.getState().selectedHex).toBe("abc123");
    expect(
      container.querySelector<HTMLElement>(
        '[aria-label="Aircraft inspector sheet"]',
      )?.dataset.snap,
    ).toBe("collapsed");
  });
});
