// biome-ignore-all lint/style/noNonNullAssertion: test fixture — missing elements/mocks fail the test loudly via the test runner.
// React 18 act() requires this flag; set before importing React.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdentStore } from "../data/store";

// Hoisted mock state: driver flags and spies so individual tests can flip
// needRefresh before rendering and read updateServiceWorker / setter calls
// afterwards.
const mockState = vi.hoisted(() => ({
  needRefresh: false,
  updateServiceWorker: vi.fn(),
  setNeedRefresh: vi.fn(),
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    needRefresh: [mockState.needRefresh, mockState.setNeedRefresh],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: mockState.updateServiceWorker,
  }),
}));

import { PwaUpdatePrompt } from "./PwaUpdatePrompt";

describe("PwaUpdatePrompt", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockState.needRefresh = false;
    mockState.updateServiceWorker.mockReset();
    mockState.setNeedRefresh.mockReset();
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
  });

  it("renders nothing when no update needs attention", () => {
    act(() => {
      root.render(<PwaUpdatePrompt />);
    });
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("shows a reload prompt when a new SW is waiting and activates it on click", () => {
    mockState.needRefresh = true;

    act(() => {
      root.render(<PwaUpdatePrompt />);
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("New version ready.");
    expect(status?.className).toContain("top-");
    expect(status?.className).toContain("right-");
    expect(status?.className).not.toContain("bottom-");

    const reload = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.textContent === "Reload");
    expect(reload).toBeTruthy();
    expect(reload?.getAttribute("title")).toBeNull();
    expect(reload?.getAttribute("aria-describedby")).toBeNull();

    act(() => reload!.click());

    // The `true` arg tells workbox to skipWaiting AND reload the page —
    // calling updateServiceWorker() without it would only register the new
    // SW without applying it, silently stranding the user on stale code.
    expect(mockState.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it("lets the user dismiss the update without reloading", () => {
    mockState.needRefresh = true;

    act(() => {
      root.render(<PwaUpdatePrompt />);
    });

    const dismiss = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss update"]',
    );
    expect(dismiss).toBeTruthy();
    expect(dismiss?.getAttribute("title")).toBeNull();
    expect(dismiss?.getAttribute("aria-describedby")).toBeNull();

    act(() => dismiss!.click());

    expect(mockState.setNeedRefresh).toHaveBeenCalledWith(false);
    expect(mockState.updateServiceWorker).not.toHaveBeenCalled();
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
      root.render(<PwaUpdatePrompt />);
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Ident v1.1.0 is available.");
    expect(status?.className).toContain("top-");
    expect(status?.className).toContain("right-");
    expect(status?.className).not.toContain("bottom-");
    expect(
      container.querySelector('a[href*="/releases/tag/v1.1.0"]'),
    ).toBeTruthy();
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
      root.render(<PwaUpdatePrompt />);
    });

    const dismiss = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss update"]',
    );
    expect(dismiss).toBeTruthy();

    act(() => dismiss!.click());

    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("prioritizes the reload prompt over release metadata", () => {
    mockState.needRefresh = true;
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
      root.render(<PwaUpdatePrompt />);
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("New version ready.");
    expect(status?.textContent).not.toContain("v1.1.0");
    expect(container.querySelector("a")).toBeNull();
  });
});
