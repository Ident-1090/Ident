// React 18 act() requires this flag; set before importing React.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdentStore } from "../data/store";
import { App } from "./App";

const mapOverlayMockState = vi.hoisted(() => ({ shouldThrow: false }));
const mediaQueryMockState = vi.hoisted(() => ({ matches: false }));

vi.mock("../data/feed", () => ({
  startFeed: vi.fn(() => () => {}),
}));

vi.mock("../data/update", () => ({
  startUpdateStatusPolling: vi.fn(() => () => {}),
}));

vi.mock("../rails/Rail", () => ({ Rail: () => <div data-testid="rail" /> }));
vi.mock("../map/MapOverlay", () => ({
  MapOverlay: () => {
    if (mapOverlayMockState.shouldThrow) throw new Error("Map overlay failed");
    return <div data-testid="map-overlay" />;
  },
}));
vi.mock("../inspector/Inspector", () => ({
  Inspector: () => <div data-testid="inspector" />,
}));
vi.mock("../topbar/Topbar", () => ({
  Topbar: () => <div data-testid="topbar" />,
}));
vi.mock("../statusbar/StatusBar", () => ({
  StatusBar: () => <div data-testid="statusbar" />,
}));
vi.mock("../mobile/useMediaQuery", () => ({
  PHONE_QUERY: "(max-width: 767px)",
  useMediaQuery: () => mediaQueryMockState.matches,
}));
vi.mock("../mobile/MobileShell", () => ({
  MobileShell: ({
    onOpenSettings,
  }: {
    onOpenOmnibox: () => void;
    onOpenSettings?: () => void;
  }) => (
    <button type="button" onClick={onOpenSettings}>
      Open full settings
    </button>
  ),
}));
vi.mock("./UpdatePrompt", () => ({ UpdatePrompt: () => null }));

describe("App layout", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    container.id = "root";
    document.body.appendChild(container);
    root = createRoot(container);
    mapOverlayMockState.shouldThrow = false;
    mediaQueryMockState.matches = false;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.documentElement.removeAttribute("data-theme");
    useIdentStore.setState({
      aircraft: new Map(),
      selectedHex: null,
      settings: {
        ...useIdentStore.getState().settings,
        theme: "system",
      },
    });
  });

  it("keeps the map full-width and hides the floating inspector for a stale selected hex", () => {
    useIdentStore.setState({
      aircraft: new Map(),
      selectedHex: "abc123",
    });

    act(() => {
      root.render(<App />);
    });

    expect(container.firstElementChild?.className).toContain(
      "md:grid-cols-[340px_minmax(0,1fr)]",
    );
    expect(
      container.querySelector('[data-testid="floating-inspector"]'),
    ).toBeNull();
  });

  it("renders a floating inspector when the selected aircraft exists", () => {
    useIdentStore.setState({
      aircraft: new Map([["abc123", { hex: "abc123" }]]),
      selectedHex: "abc123",
    });

    act(() => {
      root.render(<App />);
    });

    expect(container.firstElementChild?.className).toContain(
      "md:grid-cols-[340px_minmax(0,1fr)]",
    );
    expect(
      container.querySelector('[data-testid="floating-inspector"]'),
    ).toBeTruthy();
    expect(container.querySelector('[data-testid="inspector"]')).toBeTruthy();
  });

  it("dismisses the floating inspector on Escape", () => {
    useIdentStore.setState({
      aircraft: new Map([["abc123", { hex: "abc123" }]]),
      selectedHex: "abc123",
    });

    act(() => {
      root.render(<App />);
    });

    expect(useIdentStore.getState().selectedHex).toBe("abc123");

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(useIdentStore.getState().selectedHex).toBeNull();
  });

  it("keeps the inspector selected when Escape is closing settings", () => {
    mediaQueryMockState.matches = true;
    useIdentStore.setState({
      aircraft: new Map([["abc123", { hex: "abc123" }]]),
      selectedHex: "abc123",
    });

    act(() => {
      root.render(<App />);
    });

    const openSettings = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Open full settings");
    expect(openSettings).toBeTruthy();
    act(() => openSettings?.click());

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(useIdentStore.getState().selectedHex).toBe("abc123");
  });

  it("shows an app error panel instead of blanking the page after render failures", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mapOverlayMockState.shouldThrow = true;

    act(() => {
      root.render(<App />);
    });

    expect(container.textContent).toContain("Ident hit a rendering error");
    expect(container.textContent).toContain("Map overlay failed");

    const retry = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Try again");
    expect(retry).toBeTruthy();
    expect(retry?.getAttribute("title")).toBeNull();

    act(() => {
      retry?.focus();
    });

    expect(retry?.getAttribute("aria-describedby")).toBeNull();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();

    errorSpy.mockRestore();
  });

  it("opens the full settings modal from the mobile shell", () => {
    mediaQueryMockState.matches = true;

    act(() => {
      root.render(<App />);
    });

    expect(container.querySelector('[aria-label="Settings"]')).toBeNull();

    const openSettings = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Open full settings");
    expect(openSettings).toBeTruthy();

    act(() => openSettings?.click());

    expect(container.querySelector('[aria-label="Settings"]')).toBeTruthy();
  });
});
