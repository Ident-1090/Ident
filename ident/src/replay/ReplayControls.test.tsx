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
let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;

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
      playing: true,
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
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    resetStore();
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    vi.restoreAllMocks();
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

  it("advances replay playback from elapsed frame time at high speed", () => {
    let frame: ((timestamp: DOMHighResTimeStamp) => void) | null = null;
    window.requestAnimationFrame = vi.fn((callback) => {
      frame = callback;
      return 1;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn() as typeof window.cancelAnimationFrame;
    vi.spyOn(performance, "now").mockReturnValue(1_000);
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        mode: "replay",
        playheadMs: 150_000,
        playing: true,
        speed: 16,
        availableTo: 240_000,
      },
    }));

    act(() => root.render(<ReplayRuntime />));

    expect(frame).not.toBeNull();
    act(() => {
      frame?.(1_100);
    });

    expect(useIdentStore.getState().replay.playheadMs).toBe(151_600);
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

  it("freezes the desktop scrubber range while dragging", () => {
    useIdentStore.getState().enterReplay(150_000);
    act(() => root.render(<ReplayScrubber />));

    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      setInputValue(input, "149000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(input.value).toBe("149000");
    expect(input.max).toBe("180000");

    act(() => {
      useIdentStore.getState().setReplayManifest({
        enabled: true,
        from: 120_000,
        to: 240_000,
        block_sec: 60,
        blocks: [],
      });
      useIdentStore.getState().setReplayLoading(true);
    });

    expect(input.value).toBe("149000");
    expect(input.max).toBe("180000");

    act(() => {
      input.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });

    expect(input.value).toBe("149000");
    expect(input.max).toBe("240000");
  });

  it("resumes replay after dragging when it was playing before the drag", () => {
    useIdentStore.getState().enterReplay(150_000);
    useIdentStore.getState().setReplayPlaying(true);
    act(() => root.render(<ReplayScrubber />));

    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(useIdentStore.getState().replay.playing).toBe(false);

    act(() => {
      setInputValue(input, "149000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });

    expect(useIdentStore.getState().replay.playing).toBe(true);
  });

  it("starts replay after dragging from live into replay history", () => {
    act(() => root.render(<ReplayScrubber />));

    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      setInputValue(input, "149000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      useIdentStore.getState().setReplayLoading(true);
      input.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });

    expect(useIdentStore.getState().replay.mode).toBe("replay");
    expect(useIdentStore.getState().replay.playing).toBe(true);
  });

  it("does not start playback after dragging when it was paused before the drag", () => {
    useIdentStore.getState().enterReplay(150_000);
    act(() => root.render(<ReplayScrubber />));

    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      setInputValue(input, "149000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });

    expect(useIdentStore.getState().replay.playing).toBe(false);
  });

  it("keeps replay loading status in a fixed right-aligned replay slot", () => {
    useIdentStore.getState().enterReplay(150_000);
    act(() => root.render(<ReplayScrubber />));

    const status = host.querySelector(
      '[data-testid="replay-status"]',
    ) as HTMLSpanElement;
    const track = host.querySelector(
      '[data-testid="replay-scrubber-track"]',
    ) as HTMLDivElement;
    expect(status.textContent).toBe("NOW ->");
    expect(status.className).toContain("w-[7.75ch]");
    expect(status.className).toContain("text-right");
    expect(status.className).toContain("shrink-0");
    expect(status.className).not.toContain("overflow-hidden");
    expect(status.className).not.toContain("absolute");
    expect(track.className).not.toContain("mr-");

    act(() => {
      useIdentStore.getState().setReplayLoading(true);
    });

    expect(status.textContent).toBe("LOADING");
    expect(status.getAttribute("title")).toBe("Loading replay");
    expect(status.className).toContain("w-[7.75ch]");
    expect(status.className).toContain("text-right");
    expect(status.className).toContain("shrink-0");
    expect(status.className).not.toContain("overflow-hidden");
    expect(status.className).not.toContain("absolute");
    expect(track.className).not.toContain("mr-");
  });

  it("keeps the desktop status slot width stable while live", () => {
    act(() => root.render(<ReplayScrubber />));

    const status = host.querySelector(
      '[data-testid="replay-status"]',
    ) as HTMLSpanElement;
    expect(status.textContent).toBe("NOW ->");
    expect(status.className).toContain("w-[7.75ch]");
    expect(status.className).toContain("text-right");
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
