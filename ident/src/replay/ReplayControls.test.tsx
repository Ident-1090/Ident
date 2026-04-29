import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetPreferencesStoreForTests,
  usePreferencesStore,
} from "../data/preferences";
import * as storeModule from "../data/store";
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
const originalFetch = globalThis.fetch;

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
      followLiveEdge: false,
      lastInteractionAt: null,
      loading: false,
      resumeAfterLoading: false,
      error: null,
      errorUrl: null,
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
    resetPreferencesStoreForTests();
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    globalThis.fetch = originalFetch;
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

  it("uses a paper surface for inactive transport buttons", () => {
    act(() => root.render(<DesktopReplayTransport />));

    const group = host.querySelector(
      '[data-testid="desktop-replay-transport"]',
    ) as HTMLDivElement;
    expect(group.className).toContain("bg-paper");
    expect(group.className).not.toContain("bg-paper-2");
  });

  it("uses live transport presentation when replay is playing at now", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        mode: "replay",
        playheadMs: 180_000,
        playing: true,
      },
    }));
    act(() => root.render(<DesktopReplayTransport />));

    expect(host.querySelector('[aria-label="Pause live feed"]')).not.toBeNull();
    expect(host.textContent).not.toContain("1×");
  });

  it("advances replay playback from elapsed frame time at high speed", () => {
    const frames: Array<(timestamp: DOMHighResTimeStamp) => void> = [];
    window.requestAnimationFrame = vi.fn((callback) => {
      frames.push(callback);
      return frames.length;
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

    expect(frames).toHaveLength(1);
    act(() => {
      frames[0]?.(1_100);
    });
    act(() => {
      frames[1]?.(1_250);
    });

    expect(useIdentStore.getState().replay.playheadMs).toBe(154_000);
  });

  it("returns to live at the live edge during playback", () => {
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
        playheadMs: 179_900,
        playing: true,
        speed: 1,
        viewWindow: {
          rangeId: "custom",
          rangeMs: 60_000,
          fromExpr: "2026-04-28 00:01",
          toExpr: "2026-04-28 00:02",
          fixedEndMs: 150_000,
        },
      },
    }));

    act(() => root.render(<ReplayRuntime />));
    act(() => {
      frame?.(1_200);
    });

    expect(useIdentStore.getState().replay.mode).toBe("live");
    expect(useIdentStore.getState().replay.playing).toBe(true);
    expect(useIdentStore.getState().replay.playheadMs).toBeNull();
    expect(useIdentStore.getState().replay.viewWindow?.toExpr).toBe("now");
    expect(useIdentStore.getState().replay.viewWindow?.fixedEndMs).toBeNull();
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it("preloads only replay data reached within the next five seconds of playback", async () => {
    window.requestAnimationFrame = vi.fn(
      () => 1,
    ) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn() as typeof window.cancelAnimationFrame;
    globalThis.fetch = vi.fn(async (url: string) =>
      responseJson({
        version: 1,
        start: url.includes("65000-120000") ? 65_000 : 0,
        end: url.includes("65000-120000") ? 120_000 : 60_000,
        step_ms: 1000,
        frames: [],
      }),
    ) as never;
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        availableFrom: 0,
        availableTo: 120_000,
        blocks: [
          {
            start: 0,
            end: 60_000,
            url: "/api/replay/blocks/0-60000.json.zst",
            bytes: 1,
          },
          {
            start: 65_000,
            end: 120_000,
            url: "/api/replay/blocks/65000-120000.json.zst",
            bytes: 1,
          },
        ],
        cache: {
          "/api/replay/blocks/0-60000.json.zst": {
            version: 1,
            start: 0,
            end: 60_000,
            step_ms: 1000,
            frames: [],
          },
        },
        mode: "replay",
        playheadMs: 55_000,
        playing: true,
        speed: 1,
      },
    }));

    await act(async () => {
      root.render(<ReplayRuntime />);
      await Promise.resolve();
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps playback running while preload remains pending after the current block is ready", async () => {
    window.requestAnimationFrame = vi.fn(
      () => 1,
    ) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn() as typeof window.cancelAnimationFrame;
    const requests = new Map<string, PendingBlockRequest>();
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        throw new Error("block request missing abort signal");
      }
      return new Promise<Response>((resolve, reject) => {
        requests.set(url, { signal, resolve });
        signal.addEventListener("abort", () => reject(abortError()), {
          once: true,
        });
      });
    }) as never;
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        availableFrom: 0,
        availableTo: 120_000,
        blocks: [
          {
            start: 0,
            end: 60_000,
            url: "/api/replay/blocks/0-60000.json.zst",
            bytes: 1,
          },
          {
            start: 60_000,
            end: 120_000,
            url: "/api/replay/blocks/60000-120000.json.zst",
            bytes: 1,
          },
        ],
        cache: {
          "/api/replay/blocks/0-60000.json.zst": {
            version: 1,
            start: 0,
            end: 60_000,
            step_ms: 1000,
            frames: [],
          },
        },
        mode: "replay",
        playheadMs: 55_000,
        playing: true,
        speed: 16,
      },
    }));

    await act(async () => {
      root.render(<ReplayRuntime />);
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(requests.has("/api/replay/blocks/60000-120000.json.zst")).toBe(
        true,
      );
    });

    expect(useIdentStore.getState().replay.loading).toBe(false);
    expect(useIdentStore.getState().replay.playing).toBe(true);
    expect(
      requests.get("/api/replay/blocks/60000-120000.json.zst")?.signal.aborted,
    ).toBe(false);

    requests.get("/api/replay/blocks/60000-120000.json.zst")?.resolve(
      responseJson({
        version: 1,
        start: 60_000,
        end: 120_000,
        step_ms: 1000,
        frames: [],
      }),
    );
  });

  it("does not load replay blocks at the live edge", async () => {
    window.requestAnimationFrame = vi.fn(
      () => 1,
    ) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn() as typeof window.cancelAnimationFrame;
    globalThis.fetch = vi.fn(async () =>
      responseJson({
        version: 1,
        start: 60_000,
        end: 120_000,
        step_ms: 1000,
        frames: [],
      }),
    ) as never;
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        availableFrom: 0,
        availableTo: 120_000,
        blocks: [
          {
            start: 60_000,
            end: 120_000,
            url: "/api/replay/blocks/60000-120000.json.zst",
            bytes: 1,
          },
        ],
        cache: {},
        mode: "replay",
        playheadMs: 120_000,
        playing: true,
      },
    }));

    await act(async () => {
      root.render(<ReplayRuntime />);
      await Promise.resolve();
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(useIdentStore.getState().replay.loading).toBe(false);
    expect(useIdentStore.getState().replay.playing).toBe(true);
  });

  it("does not run the playback loop while presenting the live edge", () => {
    window.requestAnimationFrame = vi.fn(
      () => 1,
    ) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn() as typeof window.cancelAnimationFrame;
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        mode: "replay",
        playheadMs: 180_000,
        playing: true,
      },
    }));

    act(() => root.render(<ReplayRuntime />));

    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("clears stale loading without fetching when replay is following live", async () => {
    window.requestAnimationFrame = vi.fn(
      () => 1,
    ) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn() as typeof window.cancelAnimationFrame;
    globalThis.fetch = vi.fn(async () =>
      responseJson({ version: 1, start: 120_000, end: 180_000, frames: [] }),
    ) as never;
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        mode: "replay",
        playheadMs: 150_000,
        playing: false,
        loading: true,
        resumeAfterLoading: true,
        followLiveEdge: true,
        blocks: [
          {
            start: 120_000,
            end: 180_000,
            url: "/api/replay/blocks/120000-180000.json.zst",
            bytes: 1,
          },
        ],
      },
    }));

    await act(async () => {
      root.render(<ReplayRuntime />);
      await Promise.resolve();
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(useIdentStore.getState().replay.loading).toBe(false);
    expect(useIdentStore.getState().replay.playing).toBe(true);
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

  it("renders a replay row skeleton while replay availability is loading", () => {
    useIdentStore.setState((st) => ({
      connectionStatus: { ...st.connectionStatus, ws: "connecting" },
      replay: {
        ...st.replay,
        enabled: false,
        availableFrom: null,
        availableTo: null,
      },
    }));
    act(() => root.render(<ReplayScrubber />));

    expect(
      host.querySelector('[data-testid="replay-scrubber-skeleton"]'),
    ).toBeTruthy();
    expect(
      host.querySelector('[data-testid="replay-scrubber-skeleton"]')?.innerHTML,
    ).toContain("animate-pulse");
  });

  it("hides the replay row when replay is unavailable after loading", () => {
    useIdentStore.setState((st) => ({
      connectionStatus: { ...st.connectionStatus, ws: "open" },
      replay: {
        ...st.replay,
        enabled: false,
        availableFrom: null,
        availableTo: null,
      },
    }));
    act(() => root.render(<ReplayScrubber />));

    expect(host.querySelector('[data-testid="replay-scrubber"]')).toBeNull();
    expect(
      host.querySelector('[data-testid="replay-scrubber-skeleton"]'),
    ).toBeNull();
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

  it("keeps a fixed replay window when scrubbed to its right edge", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        mode: "replay",
        playheadMs: 130_000,
        playing: false,
        viewWindow: {
          rangeId: "custom",
          rangeMs: 40_000,
          fromExpr: "2026-04-28 00:02",
          toExpr: "2026-04-28 00:03",
          fixedEndMs: 160_000,
        },
      },
    }));
    act(() => root.render(<ReplayScrubber />));

    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;
    expect(input.max).toBe("160000");

    act(() => {
      setInputValue(input, "160000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(useIdentStore.getState().replay.mode).toBe("replay");
    expect(useIdentStore.getState().replay.playheadMs).toBe(160_000);
    expect(useIdentStore.getState().replay.viewWindow?.fixedEndMs).toBe(
      160_000,
    );
  });

  it.each([
    "Infinity",
    "-Infinity",
    "abc",
    "",
  ])("ignores invalid scrubber value %s", (value) => {
    useIdentStore.getState().enterReplay(150_000);
    act(() => root.render(<ReplayScrubber />));

    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;

    act(() => {
      setInputValue(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(useIdentStore.getState().replay.mode).toBe("replay");
    expect(useIdentStore.getState().replay.playheadMs).toBe(150_000);
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

  it("renders the V4.1 desktop scrubber anatomy", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        availableFrom: 0,
        availableTo: 8 * 60 * 60_000,
      },
    }));
    act(() => root.render(<ReplayScrubber />));

    expect(
      host.querySelector('[data-testid="replay-range-chip"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-testid="replay-start-label"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-testid="replay-end-affordance"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain("LAST 8H");
    expect(host.textContent).toContain("NOW ->");
    expect(host.textContent).not.toContain("LIVE");
    expect(host.querySelector('[data-testid="replay-status"]')).toBeNull();
    expect(
      host.querySelector('[data-testid="replay-scrubber-track"]')?.className,
    ).toContain("rounded-r-[2px]");
  });

  it("keeps the live-edge dragger visible in live mode", () => {
    act(() => root.render(<ReplayScrubber />));

    const liveHandle = host.querySelector(
      '[data-testid="replay-live-handle"]',
    ) as HTMLDivElement;
    expect(liveHandle).not.toBeNull();
    expect(liveHandle.className).toContain("bg-(--color-live)");
    expect(liveHandle.style.left).toBe("100%");
    expect(liveHandle.style.boxShadow).toContain("var(--color-live)");
  });

  it("does not render a track tick under the live-edge dragger", () => {
    act(() => root.render(<ReplayScrubber />));

    const track = host.querySelector(
      '[data-testid="replay-scrubber-track"]',
    ) as HTMLDivElement;
    const rightTick = [...track.querySelectorAll("span")].find(
      (tick) => tick.style.left === "100%",
    );
    expect(rightTick).toBeUndefined();
  });

  it("shows NOW arrow on the live edge while replaying", () => {
    useIdentStore.getState().enterReplay(150_000);
    act(() => root.render(<ReplayScrubber />));

    const affordance = host.querySelector(
      '[data-testid="replay-end-affordance"]',
    ) as HTMLButtonElement;
    expect(affordance.textContent).toBe("NOW ->");
    expect(affordance.className).toContain("w-[7.5ch]");
  });

  it("jumps to now when the live-edge NOW arrow is clicked", () => {
    useIdentStore.getState().enterReplay(150_000);
    act(() => root.render(<ReplayScrubber />));

    const affordance = host.querySelector(
      '[data-testid="replay-end-affordance"]',
    ) as HTMLButtonElement;
    act(() => affordance.click());

    expect(useIdentStore.getState().replay.mode).toBe("live");
    expect(useIdentStore.getState().replay.playheadMs).toBeNull();
  });

  it("uses a live playhead without traversed fill when replay is at now", () => {
    useIdentStore.getState().enterReplay(180_000);
    act(() => root.render(<ReplayScrubber />));

    const track = host.querySelector(
      '[data-testid="replay-scrubber-track"]',
    ) as HTMLDivElement;
    expect(track.innerHTML).not.toContain("var(--color-warn)_30%");
    expect(track.innerHTML).toContain("var(--color-live)");
  });

  it("reveals grid tick labels and cursor time while hovering the track", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        availableFrom: 0,
        availableTo: 8 * 60 * 60_000,
      },
    }));
    act(() => root.render(<ReplayScrubber />));

    const track = host.querySelector(
      '[data-testid="replay-scrubber-track"]',
    ) as HTMLDivElement;
    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 7,
      width: 200,
      height: 7,
      toJSON: () => ({}),
    });

    expect(
      host.querySelector('[data-testid="replay-cursor-label"]'),
    ).toBeNull();
    act(() => {
      input.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 100,
        }),
      );
    });

    expect(
      host.querySelector('[data-testid="replay-cursor-label"]'),
    ).not.toBeNull();
    expect(
      host.querySelectorAll('[data-testid="replay-tick-label"]').length,
    ).toBeGreaterThan(0);
  });

  it("formats replay scrubber labels with the user clock setting", () => {
    useIdentStore.setState((st) => ({
      settings: { ...st.settings, clock: "utc" },
      replay: {
        ...st.replay,
        availableFrom: Date.parse("2026-04-26T10:00:00Z"),
        availableTo: Date.parse("2026-04-26T18:00:00Z"),
      },
    }));
    act(() => root.render(<ReplayScrubber />));

    const track = host.querySelector(
      '[data-testid="replay-scrubber-track"]',
    ) as HTMLDivElement;
    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 7,
      width: 200,
      height: 7,
      toJSON: () => ({}),
    });

    expect(
      host.querySelector('[data-testid="replay-start-label"]')?.textContent,
    ).toBe("10:00");
    act(() => {
      input.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 100,
        }),
      );
    });

    expect(
      host.querySelector('[data-testid="replay-cursor-label"]')?.textContent,
    ).toContain("14:00");
  });

  it("applies a quick replay window from the range picker", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        availableFrom: 0,
        availableTo: 24 * 60 * 60_000,
      },
    }));
    act(() => root.render(<ReplayScrubber />));

    click("Change replay range");
    click("Last 6 hours");

    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;
    expect(host.textContent).toContain("LAST 6H");
    expect(input.min).toBe(String(18 * 60 * 60_000));
    expect(input.max).toBe(String(24 * 60 * 60_000));
  });

  it("limits quick ranges to replay availability and shows the current maximum", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        availableFrom: 0,
        availableTo: 12 * 60 * 60_000,
      },
    }));
    act(() => root.render(<ReplayScrubber />));

    click("Change replay range");

    expect(findButton("Last 15 minutes")).toBeNull();
    expect(findButton("Last 1 hour")).toBeNull();
    expect(findButton("Last 6 hours")).toBeTruthy();
    expect(findButton("Last 8 hours")).toBeTruthy();
    expect(findButton("Last 24 hours")).toBeNull();
    expect(findButton("Last 7 days")).toBeNull();
    expect(findButton("Full range")).toBeTruthy();
    expect(host.textContent).toContain(
      "12H · 1970-01-01 00:00 -> 1970-01-01 12:00",
    );
    click("Full range");

    const from = host.querySelector(
      '[aria-label="Range from"]',
    ) as HTMLInputElement;
    const to = host.querySelector(
      '[aria-label="Range to"]',
    ) as HTMLInputElement;
    expect(from.value).toBe("1970-01-01 00:00");
    expect(to.value).toBe("1970-01-01 12:00");
  });

  it("applies a past custom replay window and offers a quiet live snapback", () => {
    vi.spyOn(storeModule, "getNow").mockReturnValue(48 * 60 * 60_000);
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        availableFrom: 0,
        availableTo: 48 * 60 * 60_000,
      },
    }));
    act(() => root.render(<ReplayScrubber />));

    click("Change replay range");
    const from = host.querySelector(
      '[aria-label="Range from"]',
    ) as HTMLInputElement;
    const to = host.querySelector(
      '[aria-label="Range to"]',
    ) as HTMLInputElement;
    act(() => {
      setInputValue(from, "now-24h");
      from.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(to, "now-12h");
      to.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click("Apply");

    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;
    expect(host.textContent).toContain("12H");
    expect(
      host.querySelector('[data-testid="replay-end-affordance"]')?.textContent,
    ).toContain("NOW ->");
    expect(
      host.querySelector('[data-testid="replay-end-affordance"]')?.textContent,
    ).not.toContain("LIVE");
    expect(input.min).toBe(String(24 * 60 * 60_000));
    expect(input.max).toBe(String(36 * 60 * 60_000));
    expect(host.querySelector('[data-testid="replay-live-handle"]')).toBeNull();
  });

  it("keeps unavailable portions of a wall-clock range visually unfilled", () => {
    vi.spyOn(storeModule, "getNow").mockReturnValue(48 * 60 * 60_000);
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        availableFrom: 0,
        availableTo: 24 * 60 * 60_000,
      },
    }));
    act(() => root.render(<ReplayScrubber />));

    click("Change replay range");
    const from = host.querySelector(
      '[aria-label="Range from"]',
    ) as HTMLInputElement;
    const to = host.querySelector(
      '[aria-label="Range to"]',
    ) as HTMLInputElement;
    act(() => {
      setInputValue(from, "now-48h");
      from.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(to, "now");
      to.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click("Apply");
    act(() => {
      useIdentStore.getState().setReplayPlayhead(12 * 60 * 60_000);
    });

    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;
    const fill = host.querySelector(
      '[data-testid="replay-scrubber-track"] > div',
    ) as HTMLDivElement;
    expect(input.min).toBe("0");
    expect(input.max).toBe(String(48 * 60 * 60_000));
    expect(fill.style.width).toBe("25%");
  });

  it("resolves custom now ranges from wall clock when replay availability is slightly behind", () => {
    vi.spyOn(storeModule, "getNow").mockReturnValue(48 * 60 * 60_000 + 5_000);
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        availableFrom: 0,
        availableTo: 48 * 60 * 60_000,
      },
    }));
    act(() => root.render(<ReplayScrubber />));

    click("Change replay range");
    const from = host.querySelector(
      '[aria-label="Range from"]',
    ) as HTMLInputElement;
    const to = host.querySelector(
      '[aria-label="Range to"]',
    ) as HTMLInputElement;
    act(() => {
      setInputValue(from, "now-1h");
      from.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(to, "now");
      to.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click("Apply");

    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;
    expect(input.min).toBe(String(47 * 60 * 60_000 + 5_000));
    expect(input.max).toBe(String(48 * 60 * 60_000 + 5_000));
  });

  it("shows replay errors on the range chip", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        error: "Invalid replay block: /api/replay/blocks/a.json.zst",
      },
    }));
    act(() => root.render(<ReplayScrubber />));

    const chip = host.querySelector(
      '[data-testid="replay-range-chip"]',
    ) as HTMLButtonElement;
    expect(chip.textContent).toContain("ERROR");
    expect(chip.getAttribute("title")).toContain("Invalid replay block");
  });

  it("moves the replay cursor to the start of a newly applied past window", () => {
    vi.spyOn(storeModule, "getNow").mockReturnValue(48 * 60 * 60_000);
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        availableFrom: 0,
        availableTo: 48 * 60 * 60_000,
      },
    }));
    useIdentStore.getState().enterReplay(47 * 60 * 60_000);
    act(() => root.render(<ReplayScrubber />));

    click("Change replay range");
    const from = host.querySelector(
      '[aria-label="Range from"]',
    ) as HTMLInputElement;
    const to = host.querySelector(
      '[aria-label="Range to"]',
    ) as HTMLInputElement;
    act(() => {
      setInputValue(from, "now-24h");
      from.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(to, "now-12h");
      to.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click("Apply");

    expect(useIdentStore.getState().replay.playheadMs).toBe(24 * 60 * 60_000);
    expect(
      host.querySelector('[data-testid="replay-scrubber-track"]')?.innerHTML,
    ).toContain("var(--color-warn)");
  });

  it("keeps replay playing when applying a range while playback is active", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        availableFrom: 0,
        availableTo: 48 * 60 * 60_000,
      },
    }));
    useIdentStore.getState().enterReplay(47 * 60 * 60_000);
    useIdentStore.getState().setReplayPlaying(true);
    act(() => root.render(<ReplayScrubber />));

    click("Change replay range");
    click("Last 8 hours");

    expect(useIdentStore.getState().replay.playheadMs).toBe(40 * 60 * 60_000);
    expect(useIdentStore.getState().replay.playing).toBe(true);
  });

  it("applies a custom replay window when pressing enter in a range field", () => {
    vi.spyOn(storeModule, "getNow").mockReturnValue(48 * 60 * 60_000);
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        availableFrom: 0,
        availableTo: 48 * 60 * 60_000,
      },
    }));
    act(() => root.render(<ReplayScrubber />));

    click("Change replay range");
    const from = host.querySelector(
      '[aria-label="Range from"]',
    ) as HTMLInputElement;
    const to = host.querySelector(
      '[aria-label="Range to"]',
    ) as HTMLInputElement;
    act(() => {
      setInputValue(from, "now-24h");
      from.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(to, "now-12h");
      to.dispatchEvent(new Event("input", { bubbles: true }));
      to.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;
    expect(input.min).toBe(String(24 * 60 * 60_000));
    expect(input.max).toBe(String(36 * 60 * 60_000));
  });

  it("persists recently used replay ranges in local storage", () => {
    vi.spyOn(storeModule, "getNow").mockReturnValue(48 * 60 * 60_000);
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        availableFrom: 0,
        availableTo: 48 * 60 * 60_000,
      },
    }));
    act(() => root.render(<ReplayScrubber />));

    click("Change replay range");
    const from = host.querySelector(
      '[aria-label="Range from"]',
    ) as HTMLInputElement;
    const to = host.querySelector(
      '[aria-label="Range to"]',
    ) as HTMLInputElement;
    act(() => {
      setInputValue(from, "now-24h");
      from.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(to, "now-12h");
      to.dispatchEvent(new Event("input", { bubbles: true }));
      to.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(usePreferencesStore.getState().replayRangeRecents).toEqual([
      { label: "12H", from: "now-24h", to: "now-12h" },
    ]);
    expect(
      JSON.parse(localStorage.getItem("ident.preferences") ?? "{}").state
        .replayRangeRecents,
    ).toEqual([{ label: "12H", from: "now-24h", to: "now-12h" }]);
  });

  it("caps recently used replay ranges at three entries", () => {
    usePreferencesStore.getState().setReplayRangeRecents([
      { label: "1H", from: "now-1h", to: "now" },
      { label: "2H", from: "now-2h", to: "now" },
      { label: "3H", from: "now-3h", to: "now" },
      { label: "4H", from: "now-4h", to: "now" },
    ]);

    expect(usePreferencesStore.getState().replayRangeRecents).toEqual([
      { label: "1H", from: "now-1h", to: "now" },
      { label: "2H", from: "now-2h", to: "now" },
      { label: "3H", from: "now-3h", to: "now" },
    ]);
  });

  it("shows the full expression for recently used replay ranges", () => {
    usePreferencesStore
      .getState()
      .setReplayRangeRecents([{ label: "1D", from: "now-3d/d", to: "now-2d" }]);
    act(() => root.render(<ReplayScrubber />));

    click("Change replay range");

    expect(host.textContent).toContain("now-3d/d -> now-2d");
  });

  it("uses the settings modal primary style for the apply button", () => {
    act(() => root.render(<ReplayScrubber />));

    click("Change replay range");
    const apply = host.querySelector(
      'button[aria-label="Apply"]',
    ) as HTMLButtonElement;

    expect(apply.className).toContain("border-(--color-accent)");
    expect(apply.className).toContain("bg-(--color-accent)");
    expect(apply.className).toContain("text-bg");
    expect(apply.className).not.toContain("bg-(--color-warn)");
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

  it("renders the mobile replay dock at the live edge without entering replay", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        mode: "live",
        playheadMs: null,
        playing: true,
      },
    }));
    act(() => root.render(<MobileReplayDock open />));
    act(() => {
      useIdentStore.getState().setReplayManifest({
        enabled: true,
        from: 120_000,
        to: 210_000,
        block_sec: 60,
        blocks: [],
      });
    });

    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;
    const track = host.querySelector(
      '[data-testid="mobile-replay-scrubber-track"]',
    ) as HTMLDivElement;
    expect(input.value).toBe("210000");
    expect(useIdentStore.getState().replay.mode).toBe("live");
    expect(useIdentStore.getState().replay.playing).toBe(true);
    expect(track.innerHTML).not.toContain("var(--color-warn)_30%");
    expect(track.innerHTML).toContain("var(--color-live)");
  });

  it("mobile fab opens the dock without labeling live traffic as replay", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <MobileReplayFab open={open} onOpenChange={setOpen} />
          <MobileReplayDock open={open} />
        </>
      );
    }
    act(() => root.render(<Harness />));
    click("Open replay");

    expect(useIdentStore.getState().replay.mode).toBe("live");
    expect(host.textContent).toContain("LIVE");
    expect(
      host.querySelector('[data-testid="mobile-replay-speed"]'),
    ).toBeNull();
    expect(
      host.querySelector('[data-testid="replay-range-chip"]')?.className,
    ).not.toContain("border-(--color-warn)");
    expect(
      host.querySelector('[data-testid="replay-range-chip"]')?.className,
    ).toContain("bg-[rgb(from_var(--color-paper)_r_g_b_/_0.24)]");
    expect(
      host.querySelector('[data-testid="replay-range-chip"]')?.className,
    ).not.toContain("bg-paper-2");
    expect(
      host.querySelector('[aria-label="Pause live feed"]')?.className,
    ).not.toContain("border-(--color-warn)");
  });

  it("keeps the mobile dock live when jumping to now from a fixed window", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        mode: "replay",
        playheadMs: 150_000,
        playing: true,
        viewWindow: {
          rangeId: "custom",
          rangeMs: 60_000,
          fromExpr: "2026-04-28 00:01",
          toExpr: "2026-04-28 00:02",
          fixedEndMs: 150_000,
        },
      },
    }));
    act(() => root.render(<MobileReplayDock open />));

    click("Jump forward 10 minutes");

    const track = host.querySelector(
      '[data-testid="mobile-replay-scrubber-track"]',
    ) as HTMLDivElement;
    expect(useIdentStore.getState().replay.mode).toBe("live");
    expect(useIdentStore.getState().replay.viewWindow?.fixedEndMs).toBeNull();
    expect(track.innerHTML).not.toContain("var(--color-warn)_30%");
    expect(track.innerHTML).toContain("var(--color-live)");
  });

  it("mobile dock rewind starts replay without pausing playback", () => {
    act(() => root.render(<MobileReplayDock open />));

    click("Jump back 10 minutes");

    expect(useIdentStore.getState().replay.mode).toBe("replay");
    expect(useIdentStore.getState().replay.playing).toBe(true);
    expect(useIdentStore.getState().replay.playheadMs).toBe(120_000);
    const speed = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "4×",
    ) as HTMLButtonElement;
    act(() => speed.click());
    expect(useIdentStore.getState().replay.speed).toBe(4);
    expect(host.textContent).toContain("-1M");
  });

  it("mobile fab leaves live state untouched when opening replay controls", () => {
    act(() => root.render(<MobileReplayFab />));

    click("Open replay");

    expect(useIdentStore.getState().replay.mode).toBe("live");
    expect(useIdentStore.getState().replay.playheadMs).toBeNull();
    expect(useIdentStore.getState().replay.playing).toBe(true);
  });

  it("uses a compact icon gap for the mobile replay button", () => {
    act(() => root.render(<MobileReplayFab />));

    const iconStack = host
      .querySelector('[aria-label="Open replay"]')
      ?.querySelector("span");
    expect(iconStack?.className.split(/\s+/)).toContain("gap-1");
    expect(iconStack?.className.split(/\s+/)).not.toContain("gap-1.5");
  });

  it("adds breathing room between the mobile live dot and label", () => {
    useIdentStore.getState().enterReplay(150_000);
    act(() => root.render(<MobileReplayFab />));

    const iconStack = host
      .querySelector('[aria-label="Go live"]')
      ?.querySelector("span");
    expect(iconStack?.className.split(/\s+/)).toContain("gap-1.5");
  });

  it("uses the shared replay cursor label while dragging the mobile scrubber", () => {
    useIdentStore.getState().enterReplay(150_000);
    act(() => root.render(<MobileReplayDock />));

    const input = host.querySelector(
      '[aria-label="Replay time"]',
    ) as HTMLInputElement;
    expect(
      host.querySelector('[data-testid="replay-cursor-label"]'),
    ).toBeNull();

    act(() => {
      input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      setInputValue(input, "149000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(
      host.querySelector('[data-testid="replay-cursor-label"]'),
    ).not.toBeNull();
  });

  it("uses desktop-style active play button treatment on mobile", () => {
    useIdentStore.getState().enterReplay(150_000);
    act(() => root.render(<MobileReplayDock />));

    const play = host.querySelector('[aria-label="Play replay"]');
    expect(play?.className).not.toContain("bg-(--color-warn)");
    expect(play?.className).not.toContain("border-(--color-warn)");
    expect(play?.className).toContain("text-(--color-warn)");
  });

  it("does not show tooltips on mobile replay icon controls", () => {
    useIdentStore.getState().enterReplay(150_000);
    act(() => root.render(<MobileReplayDock />));

    const play = host.querySelector('[aria-label="Play replay"]') as Element;
    act(() => {
      play.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    });

    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("uses a live playhead without traversed fill on the mobile dock at now", () => {
    useIdentStore.getState().enterReplay(180_000);
    act(() => root.render(<MobileReplayDock open />));

    const track = host.querySelector(
      '[data-testid="mobile-replay-scrubber-track"]',
    ) as HTMLDivElement;
    expect(useIdentStore.getState().replay.mode).toBe("live");
    expect(track.innerHTML).not.toContain("var(--color-warn)_30%");
    expect(track.innerHTML).toContain("var(--color-live)");
  });

  it("uses live transport presentation on mobile at now", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        mode: "live",
        playheadMs: null,
        playing: true,
      },
    }));
    act(() => root.render(<MobileReplayDock open />));

    const pause = host.querySelector('[aria-label="Pause live feed"]');
    expect(pause).not.toBeNull();
    expect(pause?.className).not.toContain("border-(--color-warn)");
    expect(
      host.querySelector('[data-testid="mobile-replay-speed"]'),
    ).toBeNull();
  });

  it("shows loading state in the mobile replay dock", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        mode: "replay",
        playheadMs: 150_000,
        loading: true,
      },
    }));
    act(() => root.render(<MobileReplayDock />));

    expect(host.textContent).toContain("LOADING...");
    const loading = host.querySelector(
      '[aria-label="Loading replay"]',
    ) as HTMLButtonElement;
    expect(loading).not.toBeNull();
    expect(loading.disabled).toBe(true);
    expect(loading.className).not.toContain("border-(--color-warn)");
    expect(
      host.querySelector('[data-testid="replay-range-chip"]')?.className,
    ).not.toContain("border-(--color-warn)");
    expect(
      host.querySelector('[data-testid="mobile-replay-speed"]'),
    ).toBeNull();
  });

  it("renders the mobile replay dock as liquid glass", () => {
    useIdentStore.getState().enterReplay(150_000);
    act(() => root.render(<MobileReplayDock />));

    const dock = host.querySelector(
      '[data-testid="mobile-replay-dock"]',
    ) as HTMLDivElement;
    expect(dock.className).toContain("liquid-glass");
    expect(dock.className).toContain("fixed");
    expect(dock.className).toContain("bottom-[var(--mobile-control-bottom)]");
    expect(dock.className).toContain("z-30");
    expect(
      dock.querySelector('[data-testid="mobile-replay-speed"]')?.className,
    ).toContain("bg-[rgb(from_var(--color-paper)_r_g_b_/_0.24)]");
    expect(
      dock.querySelector('[data-testid="mobile-replay-scrubber-track"]')
        ?.className,
    ).toContain("bg-[rgb(from_var(--color-paper)_r_g_b_/_0.24)]");
  });

  it("opens the range picker from the mobile replay dock", () => {
    useIdentStore.setState((st) => ({
      replay: {
        ...st.replay,
        availableFrom: 0,
        availableTo: 24 * 60 * 60_000,
      },
    }));
    useIdentStore.getState().enterReplay(23 * 60 * 60_000);
    act(() => root.render(<MobileReplayDock />));

    click("Change replay range");
    expect(
      host.querySelector('[data-testid="replay-range-picker"]')?.className,
    ).not.toContain("fixed");
    expect(
      host.querySelector('[data-testid="replay-range-picker"]')?.className,
    ).toContain("bottom-[calc(100%_+_0.5rem)]");
    expect(
      host.querySelector('[data-testid="replay-range-picker"]')?.className,
    ).toContain(
      "max-h-[min(72dvh,calc(100dvh_-_var(--mobile-control-bottom)_-_10rem))]",
    );
    expect(host.textContent).not.toContain("Accepted formats");
    click("Last 6 hours");

    expect(host.textContent).toContain("-6H");
    expect(useIdentStore.getState().replay.playheadMs).toBe(18 * 60 * 60_000);
  });

  it("formats replay range labels below hour precision", () => {
    expect(rewindRangeLabel(30_000)).toBe("-1M");
    expect(rewindRangeLabel(30 * 60_000)).toBe("-30M");
    expect(rewindRangeLabel(90 * 60_000)).toBe("-1.5H");
    expect(rewindRangeLabel(24 * 60 * 60_000)).toBe("-1D");
  });
});

function click(label: string): void {
  const button = findButton(label);
  if (!button) throw new Error(`missing button ${label}`);
  act(() => button.click());
}

function findButton(label: string): HTMLButtonElement | null {
  return host.querySelector(
    `[aria-label="${label}"]`,
  ) as HTMLButtonElement | null;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("missing input value setter");
  setter.call(input, value);
}

function responseJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

type PendingBlockRequest = {
  signal: AbortSignal;
  resolve: (value: Response) => void;
};
