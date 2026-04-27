// biome-ignore-all lint/style/noNonNullAssertion: test fixture — missing elements/mocks fail the test loudly via the test runner.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useIdentStore } from "../data/store";
import { formatTopbarClock, Topbar } from "./Topbar";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function findButton(root: HTMLElement, aria: string): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(`button[aria-label="${aria}"]`);
}

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

describe("Topbar basemap picker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useIdentStore.setState((st) => ({
      map: { ...st.map, basemapId: "ident" },
      update: { ...st.update, status: "current" },
    }));
    act(() => {
      root.render(<Topbar onOpenSettings={() => {}} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("regular, satellite, and terrain map clicks set the matching basemapId", () => {
    const sat = findButton(container, "Satellite map");
    expect(sat).not.toBeNull();
    expect(sat!.textContent).toBe("SAT");
    act(() => {
      sat!.click();
    });
    expect(useIdentStore.getState().map.basemapId).toBe("esriSat");

    const ter = findButton(container, "Terrain map");
    expect(ter!.textContent).toBe("TER");
    act(() => {
      ter!.click();
    });
    expect(useIdentStore.getState().map.basemapId).toBe("esriTerrain");

    const map = findButton(container, "Regular map");
    expect(map!.textContent).toBe("MAP");
    act(() => {
      map!.click();
    });
    expect(useIdentStore.getState().map.basemapId).toBe("ident");
  });

  it("active highlight follows the current basemapId", () => {
    act(() => {
      findButton(container, "Satellite map")!.click();
    });
    expect(
      findButton(container, "Satellite map")!.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      findButton(container, "Regular map")!.getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("More maps opens a menu and closes on click outside", () => {
    const others = findButton(container, "More maps")!;
    expect(container.querySelector('[role="menu"]')).toBeNull();
    act(() => {
      others.click();
    });
    expect(container.querySelector('[role="menu"]')).not.toBeNull();

    act(() => {
      document.body.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it("clicking a More maps entry dispatches setBasemap and closes the dropdown", () => {
    act(() => {
      findButton(container, "More maps")!.click();
    });
    const positron = findButton(container, "Positron map")!;
    expect(positron.textContent).toBe("POSITRON");
    act(() => {
      positron.click();
    });
    expect(useIdentStore.getState().map.basemapId).toBe("cartoPositron");
    expect(container.querySelector('[role="menu"]')).toBeNull();
    // More maps button now shows the active others label.
    expect(findButton(container, "More maps")!.textContent).toContain(
      "POSITRON",
    );
    expect(
      findButton(container, "More maps")!.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("uses custom tooltips for desktop topbar controls", () => {
    expect(container.querySelector("[title]")).toBeNull();

    expectTooltipOnFocus(
      findButton(container, "Arrow — directional")!,
      "Arrow — directional",
    );
    expectTooltipOnFocus(findButton(container, "Toggle Rt")!, "Route label");
    expectTooltipOnFocus(
      findButton(container, "Satellite map")!,
      "Satellite map",
    );
    expectTooltipOnFocus(
      findButton(container, "Theme · follow system")!,
      "Theme · follow system",
    );

    const settings = findButton(container, "Settings")!;
    act(() => {
      settings.focus();
    });
    expect(settings.getAttribute("aria-describedby")).toBeNull();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("does not expose an unwired share action", () => {
    expect(findButton(container, "Copy share link")).toBeNull();
  });

  it("keeps lower-priority display controls from crowding narrow desktop topbars", () => {
    const subtitle = container.querySelector(
      '[data-testid="topbar-clock-subtitle"]',
    ) as HTMLSpanElement;
    expect(subtitle.className).toContain("whitespace-nowrap");

    const iconLabel = [...container.querySelectorAll("span")].find(
      (span) => span.textContent === "Icon",
    ) as HTMLSpanElement;
    expect(iconLabel.className).toContain("hidden xl:inline");

    const labelsLabel = [...container.querySelectorAll("span")].find(
      (span) => span.textContent === "Labels",
    ) as HTMLSpanElement;
    expect(labelsLabel.className).toContain("hidden xl:inline");
    expect(labelsLabel.parentElement?.className).not.toContain("hidden");
  });

  it("links the title brand to the GitHub project", () => {
    const link = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="Open Ident on GitHub"]',
    );
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe("Ident");
    expect(link!.href).toBe("https://github.com/Ident-1090/Ident");
    expect(link!.target).toBe("_blank");
    expect(link!.rel).toContain("noopener");
  });

  it("marks settings when a release update is available", () => {
    act(() => {
      useIdentStore.setState((st) => ({
        update: { ...st.update, status: "available" },
      }));
    });

    const settings = findButton(container, "Settings")!;
    expect(settings.querySelector("span[aria-hidden='true']")).toBeTruthy();
  });

  it("shows UTC time with an explicit local companion time", () => {
    const clock = formatTopbarClock(new Date("2026-04-23T07:47:33Z"), "utc");

    expect(clock.primary).toBe("07:47:33Z");
    expect(clock.subtitle).toMatch(/^LOCAL \d{2}:\d{2} [A-Z]{2,5}$/);
    expect(clock.subtitle).not.toContain("−");
    expect(clock.subtitle).not.toContain("-07:00");
  });

  it("shows local time with an explicit Zulu companion time", () => {
    const clock = formatTopbarClock(new Date("2026-04-23T07:47:33Z"), "local");

    expect(clock.primary).toMatch(/^\d{2}:\d{2}:\d{2} [A-Z]{2,5}$/);
    expect(clock.subtitle).toBe("ZULU 07:47Z");
    expect(clock.primary).not.toContain("−");
    expect(clock.primary).not.toContain("-07:00");
  });
});
