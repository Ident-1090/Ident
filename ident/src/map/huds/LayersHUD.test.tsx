// biome-ignore-all lint/style/noNonNullAssertion: test fixture — missing elements/mocks fail the test loudly via the test runner.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPreferencesStoreForTests } from "../../data/preferences";
import { useIdentStore } from "../../data/store";
import { LayersHUD } from "./LayersHUD";

function renderWith(root: Root): void {
  act(() => {
    root.render(<LayersHUD />);
  });
}

describe("LayersHUD", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetPreferencesStoreForTests();
    useIdentStore.setState((st) => ({
      map: {
        ...st.map,
        layers: {
          rangeRings: true,
          rxRange: false,
          losRings: false,
          trails: false,
        },
      },
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("does not tooltip the collapsed layers toggle", () => {
    renderWith(root);
    const summary = container.querySelector<HTMLButtonElement>(
      'button[aria-expanded="false"]',
    );
    expect(summary).not.toBeNull();
    expect(summary!.getAttribute("title")).toBeNull();

    act(() => {
      summary!.focus();
    });

    expect(summary!.getAttribute("aria-describedby")).toBeNull();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("uses self-descriptive layer labels without extra tooltips", () => {
    renderWith(root);
    const summary = container.querySelector<HTMLButtonElement>(
      'button[aria-expanded="false"]',
    );
    expect(summary).not.toBeNull();

    act(() => {
      summary!.click();
    });

    const collapse = container.querySelector<HTMLButtonElement>(
      'button[aria-expanded="true"]',
    );
    expect(collapse).not.toBeNull();
    expect(collapse!.getAttribute("title")).toBeNull();

    act(() => {
      collapse!.focus();
    });
    expect(collapse!.getAttribute("aria-describedby")).toBeNull();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();

    act(() => {
      collapse!.blur();
    });

    const losToggle = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Line-of-sight rings"));
    expect(losToggle).not.toBeUndefined();
    expect(losToggle!.getAttribute("title")).toBeNull();

    act(() => {
      losToggle!.focus();
    });
    expect(losToggle!.getAttribute("aria-describedby")).toBeNull();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();

    act(() => {
      losToggle!.click();
    });
    expect(useIdentStore.getState().map.layers.losRings).toBe(true);
  });
});
