// biome-ignore-all lint/style/noNonNullAssertion: test fixture — missing elements/mocks fail the test loudly via the test runner.
// React 18 act() requires this flag; set before importing React.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPreferencesStoreForTests } from "../data/preferences";
import { useIdentStore } from "../data/store";

import { UpdatePrompt } from "./UpdatePrompt";

describe("UpdatePrompt", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetPreferencesStoreForTests();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useIdentStore.setState({
      update: {
        enabled: true,
        status: "idle",
        current: null,
        latest: null,
        checkedAt: null,
        lastSuccessAt: null,
        error: null,
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    resetPreferencesStoreForTests();
    window.history.replaceState(null, "", "/");
  });

  it("renders nothing when no update needs attention", () => {
    act(() => {
      root.render(<UpdatePrompt />);
    });
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("shows release updates in the shared prompt", () => {
    useIdentStore.setState((st) => ({
      update: {
        ...st.update,
        status: "available",
        latest: {
          version: "v1.1.0",
          url: "https://github.com/Ident-1090/Ident/releases/tag/v1.1.0",
        },
      },
    }));

    act(() => {
      root.render(<UpdatePrompt />);
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Ident v1.1.0 is available.");
    expect(status?.className).toContain("top-");
    expect(status?.className).toContain("right-");
    expect(status?.className).not.toContain("bottom-");
    expect(
      container.querySelector(
        'a[aria-label="Release notes"][href*="/releases/tag/v1.1.0"]',
      ),
    ).toBeTruthy();
    expect(status?.textContent).not.toContain("Release notes");
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some(
        (button) => button.textContent === "Reload",
      ),
    ).toBe(false);
  });

  it("lets the user dismiss a release prompt for the current version", () => {
    useIdentStore.setState((st) => ({
      update: {
        ...st.update,
        status: "available",
        latest: { version: "v1.1.0" },
      },
    }));

    act(() => {
      root.render(<UpdatePrompt />);
    });

    const dismiss = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss update"]',
    );
    expect(dismiss).toBeTruthy();

    act(() => dismiss!.click());

    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("keeps a dismissed release hidden for seven days for the same version", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    useIdentStore.setState((st) => ({
      update: {
        ...st.update,
        status: "available",
        latest: { version: "v1.1.0" },
      },
    }));

    act(() => {
      root.render(<UpdatePrompt />);
    });

    const dismiss = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss update"]',
    );
    expect(dismiss).toBeTruthy();

    act(() => dismiss!.click());
    act(() => root.unmount());
    root = createRoot(container);

    act(() => {
      root.render(<UpdatePrompt />);
    });

    expect(container.querySelector('[role="status"]')).toBeNull();

    vi.setSystemTime(new Date("2026-01-08T00:00:01Z"));

    act(() => {
      root.render(<UpdatePrompt />);
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Ident v1.1.0 is available.");
  });
});
