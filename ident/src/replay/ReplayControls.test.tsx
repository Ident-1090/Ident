import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useIdentStore } from "../data/store";
import {
  DesktopReplayTransport,
  MobileReplayDock,
  MobileReplayFab,
} from "./ReplayControls";

let host: HTMLDivElement;
let root: Root;

function resetStore() {
  useIdentStore.setState({
    replay: {
      enabled: true,
      availableFrom: 120_000,
      availableTo: 180_000,
      blockSec: 60,
      blocks: [],
      cache: {},
      mode: "live",
      playheadMs: null,
      playing: false,
      speed: 1,
      loading: false,
      error: null,
    },
  });
}

describe("replay controls", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    resetStore();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("desktop transport enters replay and exposes playback controls", () => {
    act(() => root.render(<DesktopReplayTransport />));
    click("Open replay");

    expect(useIdentStore.getState().replay.mode).toBe("replay");
    expect(host.querySelector('[aria-label="Play replay"]')).not.toBeNull();
    click("Play replay");
    expect(useIdentStore.getState().replay.playing).toBe(true);
  });

  it("mobile fab switches to live control and dock changes speed", () => {
    act(() =>
      root.render(
        <>
          <MobileReplayFab />
          <MobileReplayDock />
        </>,
      ),
    );
    click("Open replay");
    act(() =>
      root.render(
        <>
          <MobileReplayFab />
          <MobileReplayDock />
        </>,
      ),
    );

    expect(host.querySelector('[aria-label="Go live"]')).not.toBeNull();
    const speed = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "4×",
    ) as HTMLButtonElement;
    act(() => speed.click());
    expect(useIdentStore.getState().replay.speed).toBe(4);
  });
});

function click(label: string): void {
  const button = host.querySelector(
    `[aria-label="${label}"]`,
  ) as HTMLButtonElement | null;
  if (!button) throw new Error(`missing button ${label}`);
  act(() => button.click());
}
