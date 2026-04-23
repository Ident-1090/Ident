// React 18 act() requires this flag; set before importing React.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useIdentStore } from "../data/store";
import { AltitudeSparkline } from "./Sparkline";

describe("AltitudeSparkline", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    const initial = useIdentStore.getInitialState();
    useIdentStore.setState({
      settings: {
        ...initial.settings,
        unitOverrides: { ...initial.settings.unitOverrides },
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("trims long stable altitude regions around a climb while keeping context", () => {
    act(() => {
      root.render(
        <AltitudeSparkline
          samples={[
            10_000, 10_000, 10_000, 10_000, 10_100, 10_400, 10_800, 10_800,
            10_800, 10_800,
          ]}
        />,
      );
    });

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("data-altitude-window")).toBe("active");
    expect(svg?.getAttribute("data-sample-count")).toBe("5");
    expect(
      container.querySelector('[data-altitude-bound="upper"]')?.textContent,
    ).toBe("10,800 ft");
    expect(
      container.querySelector('[data-altitude-bound="lower"]')?.textContent,
    ).toBe("10,000 ft");
  });

  it("shows a simple flat segment when there is no meaningful altitude change", () => {
    act(() => {
      root.render(
        <AltitudeSparkline samples={[12_000, 12_000, 12_000, 12_000]} />,
      );
    });

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("data-altitude-window")).toBe("level");
    expect(svg?.getAttribute("data-sample-count")).toBe("2");
    expect(
      container.querySelector('[data-altitude-bound="upper"]')?.textContent,
    ).toBe("12,250 ft");
    expect(
      container.querySelector('[data-altitude-bound="lower"]')?.textContent,
    ).toBe("11,750 ft");
    expect(
      container
        .querySelector('[data-altitude-trace="barometric"]')
        ?.getAttribute("d"),
    ).toContain("23.0");
  });

  it("centers matching altitude and selected-altitude lines in a level segment", () => {
    act(() => {
      root.render(
        <AltitudeSparkline
          samples={[12_000, 12_000, 12_000, 12_000]}
          selectedAltitudeFt={12_000}
        />,
      );
    });

    expect(
      container.querySelector('[data-altitude-bound="upper"]')?.textContent,
    ).toBe("12,250 ft");
    expect(
      container.querySelector('[data-altitude-bound="lower"]')?.textContent,
    ).toBe("11,750 ft");
    expect(
      container
        .querySelector('[data-altitude-trace="barometric"]')
        ?.getAttribute("d"),
    ).toContain("23.0");
    expect(
      container
        .querySelector('[data-altitude-reference="selected"] line')
        ?.getAttribute("y1"),
    ).toBe("23");
  });

  it("uses ALT SEL as the upper bound label when selected altitude is above the trace", () => {
    act(() => {
      root.render(
        <AltitudeSparkline
          samples={[10_000, 10_400, 10_800]}
          selectedAltitudeFt={13_000}
        />,
      );
    });

    const reference = container.querySelector(
      '[data-altitude-reference="selected"]',
    );
    expect(reference).not.toBeNull();
    expect(reference?.getAttribute("aria-label")).toContain("13,000 ft");
    expect(
      container.querySelector('[data-altitude-bound="upper"]')?.textContent,
    ).toBe("ALT SEL 13,000 ft");
    expect(reference?.textContent).not.toContain("ALT SEL");
    expect(reference?.textContent).not.toContain("MCP");
  });

  it("uses ALT SEL as the lower bound label when selected altitude is below the trace", () => {
    act(() => {
      root.render(
        <AltitudeSparkline
          samples={[10_000, 10_400, 10_800]}
          selectedAltitudeFt={9_000}
        />,
      );
    });

    expect(
      container.querySelector('[data-altitude-bound="upper"]')?.textContent,
    ).toBe("10,800 ft");
    expect(
      container.querySelector('[data-altitude-bound="lower"]')?.textContent,
    ).toBe("ALT SEL 9,000 ft");
  });

  it("keeps the plot edge-to-edge with larger overlay labels", () => {
    act(() => {
      root.render(
        <AltitudeSparkline
          samples={[10_000, 10_400, 10_800]}
          selectedAltitudeFt={13_000}
        />,
      );
    });

    const trace = container.querySelector('[data-altitude-trace="barometric"]');
    const referenceLine = container.querySelector(
      '[data-altitude-reference="selected"] line',
    );
    expect(trace).not.toBeNull();
    expect(referenceLine).not.toBeNull();
    expect(container.querySelector("svg")?.getAttribute("class")).toContain(
      "h-[42px]",
    );
    expect(trace?.getAttribute("d")).toMatch(/^M 2\.0/);
    expect(Number(referenceLine?.getAttribute("x1"))).toBe(2);
    expect(Number(referenceLine?.getAttribute("x2"))).toBe(318);
    expect(
      container
        .querySelector('[data-altitude-bound="upper"]')
        ?.getAttribute("font-size"),
    ).toBe("9.5");
    expect(
      container
        .querySelector('[data-altitude-bound="upper"]')
        ?.getAttribute("paint-order"),
    ).toBe("stroke fill");
    expect(container.querySelector("[data-altitude-label-bg]")).toBeNull();
    expect(referenceLine?.parentElement?.textContent).toBe("");
  });
});
