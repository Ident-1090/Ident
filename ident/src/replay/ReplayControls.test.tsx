import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useIdentStore } from "../data/store";
import {
  DesktopReplayTransport,
  MobileReplayDock,
  MobileReplayFab,
  ReplayRuntime,
  ReplayScrubber,
  rewindRangeLabel,
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
      lastInteractionAt: null,
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

  it("desktop transport can enter replay behind the live edge and play", () => {
    act(() => root.render(<DesktopReplayTransport />));
    expect(host.textContent).not.toContain("Replay");
    click("Jump back 10 minutes");

    expect(useIdentStore.getState().replay.mode).toBe("replay");
    expect(host.querySelector('[aria-label="Play replay"]')).not.toBeNull();
    click("Play replay");
    expect(useIdentStore.getState().replay.playing).toBe(true);
  });

  it("labels the live transport as pause", () => {
    act(() =>
      root.render(
        <>
          <ReplayRuntime />
          <DesktopReplayTransport />
        </>,
      ),
    );

    expect(host.querySelector('[aria-label="Pause live feed"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Play replay"]')).toBeNull();
  });

  it("renders the desktop scrubber as a compact topbar row", () => {
    act(() => root.render(<ReplayScrubber />));

    expect(
      host.querySelector('[data-testid="replay-scrubber"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-testid="replay-scrubber-track"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[aria-label="Replay time"]')?.className,
    ).not.toContain("w-full");
  });

  it("returns to live when scrubbed to the replay live edge", () => {
    useIdentStore.getState().enterReplay(150_000);
    act(() => root.render(<ReplayScrubber />));

    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;
    act(() => {
      setInputValue(input, "180000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(useIdentStore.getState().replay.mode).toBe("live");
    expect(useIdentStore.getState().replay.playheadMs).toBeNull();
    expect(input.value).toBe("180000");
  });

  it("does not reset an in-progress desktop scrub when replay loading changes", () => {
    useIdentStore.getState().enterReplay(150_000);
    act(() => root.render(<ReplayScrubber />));

    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;
    act(() => {
      setInputValue(input, "149000");
      useIdentStore.getState().setReplayLoading(true);
    });

    expect(input.value).toBe("149000");
  });

  it("keeps the live scrubber attached to the moving live edge", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        mode: "live",
        playheadMs: 150_000,
      },
    }));
    act(() => root.render(<ReplayScrubber />));

    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;
    expect(input.value).toBe("180000");

    act(() => {
      useIdentStore.getState().setReplayManifest({
        enabled: true,
        from: 120_000,
        to: 210_000,
        block_sec: 60,
        blocks: [],
      });
    });

    expect(input.value).toBe("210000");
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
    expect(host.textContent).toContain("-1M");
  });

  it("formats replay range labels below hour precision", () => {
    expect(rewindRangeLabel(30_000)).toBe("-1M");
    expect(rewindRangeLabel(30 * 60_000)).toBe("-30M");
    expect(rewindRangeLabel(90 * 60_000)).toBe("-1.5H");
    expect(rewindRangeLabel(24 * 60 * 60_000)).toBe("-1D");
  });
});

function click(label: string): void {
  const button = host.querySelector(
    `[aria-label="${label}"]`,
  ) as HTMLButtonElement | null;
  if (!button) throw new Error(`missing button ${label}`);
  act(() => button.click());
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("missing input value setter");
  setter.call(input, value);
}
