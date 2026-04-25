// React 18 act() requires this flag; set before importing React.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdentStore } from "../data/store";
import { SettingsModal } from "./SettingsModal";

describe("SettingsModal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    useIdentStore.setState({
      settings: {
        trailFadeSec: 180,
        unitMode: "aviation",
        unitOverrides: {
          altitude: "ft",
          horizontalSpeed: "kt",
          distance: "nm",
          verticalSpeed: "fpm",
          temperature: "C",
        },
        clock: "utc",
        theme: "system",
      },
      update: {
        enabled: true,
        status: "current",
        current: {
          version: "v1.0.0",
          commit: "abc123",
          date: "2026-04-22T00:00:00Z",
        },
        latest: { version: "v1.0.0" },
        checkedAt: "2026-04-23T00:00:00Z",
        lastSuccessAt: "2026-04-23T00:00:00Z",
        error: null,
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

  it("lists aviation first in the unit selector", () => {
    act(() => {
      root.render(<SettingsModal onClose={vi.fn()} />);
    });

    const unitLabels = new Set(["Aviation", "Metric", "Imperial", "Custom"]);
    const buttons = Array.from(container.querySelectorAll("button"))
      .map((button) => button.textContent?.trim() ?? "")
      .filter((label) => unitLabels.has(label));

    expect(buttons).toEqual(["Aviation", "Metric", "Imperial", "Custom"]);
  });

  it("keeps the modal focused on configurable settings", () => {
    act(() => {
      root.render(<SettingsModal onClose={vi.fn()} />);
    });

    expect(container.textContent).toContain("Units");
    expect(container.textContent).toContain("Clock");
    expect(container.textContent).toContain("Trails");

    for (const readonlyLabel of [
      "Theme",
      "Receiver",
      "Data source",
      "Aircraft feed",
      "Route lookup",
      "Transport",
      "Station",
      "Latitude",
      "Longitude",
      "Gain",
      "Software",
      "Shortcuts",
      "About",
      "Focus search",
      "Receiver-centric ADS-B console",
    ]) {
      expect(container.textContent).not.toContain(readonlyLabel);
    }
  });

  it("renders settings choices as interactive pressed buttons", () => {
    act(() => {
      root.render(<SettingsModal onClose={vi.fn()} />);
    });

    const pressedButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
    );
    const pressedLabels = pressedButtons.map(
      (button) => button.textContent?.trim() ?? "",
    );

    expect(pressedLabels).toEqual(
      expect.arrayContaining(["Aviation", "UTC", "180 s"]),
    );
    expect(pressedLabels).not.toContain("System");
    expect(
      pressedButtons.every((button) =>
        ["true", "false"].includes(button.getAttribute("aria-pressed") ?? ""),
      ),
    ).toBe(true);
  });

  it("can save clock changes from the full modal", () => {
    act(() => {
      root.render(<SettingsModal onClose={vi.fn()} />);
    });

    const localButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "Local");
    expect(localButton).toBeTruthy();

    act(() => localButton?.click());

    const saveButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "Save");
    expect(saveButton).toBeTruthy();

    act(() => saveButton?.click());

    expect(useIdentStore.getState().settings.clock).toBe("local");
  });

  it("shows GitHub release update details", () => {
    useIdentStore.setState((st) => ({
      update: {
        ...st.update,
        status: "available",
        current: {
          version: "v1.0.0",
          commit: "abc123",
          date: "2026-04-22T00:00:00Z",
        },
        latest: {
          version: "v1.1.0",
          url: "https://github.com/Ident-1090/Ident/releases/tag/v1.1.0",
        },
      },
    }));

    act(() => {
      root.render(<SettingsModal onClose={vi.fn()} />);
    });

    expect(container.textContent).toContain("Update available");
    expect(container.textContent).toContain("Installed");
    expect(container.textContent).toContain("v1.0.0");
    expect(container.textContent).toContain("Latest");
    expect(container.textContent).toContain("v1.1.0");
    expect(container.textContent).not.toContain("Checked");
    expect(container.textContent).not.toContain("Published");
    const statusDot = container.querySelector(
      '[data-testid="update-status-dot"]',
    );
    expect(statusDot).toBeTruthy();
    expect(
      container.querySelector('a[href*="/releases/tag/v1.1.0"]'),
    ).toBeTruthy();
  });

  it("shows an attention dot when updates cannot be checked", () => {
    useIdentStore.setState((st) => ({
      update: {
        ...st.update,
        status: "unavailable",
        current: null,
        latest: null,
        error: "Update check failed",
      },
    }));

    act(() => {
      root.render(<SettingsModal onClose={vi.fn()} />);
    });

    expect(container.textContent).toContain("Unable to check");
    expect(
      container.querySelector('[data-testid="update-status-dot"]'),
    ).toBeTruthy();
  });
});
