// biome-ignore-all lint/style/noNonNullAssertion: test fixture — missing elements fail the test runner loudly.
// React 18 act() requires this flag; set before importing React.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdentStore } from "../data/store";
import { FeedStatusCell, StatusBar } from "./StatusBar";

describe("StatusBar", () => {
  let container: HTMLDivElement;
  let root: Root;
  const liveCell = () => container.querySelector("[data-feed-state]");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
    useIdentStore.setState({
      receiver: {
        lat: 37.4,
        lon: -122.1,
        version: "wiedehopf readsb v3.14.1676",
      },
      stats: {
        now: 120,
        gain_db: 18.6,
        estimated_ppm: -0.7,
        last1min: {
          start: 60,
          end: 120,
          messages_valid: 600,
          local: {
            accepted: [1000],
            noise: -32.4,
            strong_signals: 50,
          },
          cpu: { demod: 1200, reader: 600 },
        },
        total: { start: 0 },
      },
      outline: null,
      connectionStatus: { ws: "open" },
      connectionStatusInfo: { ws: { isRetry: false } },
      liveState: {
        lastMsgTs: Date.now(),
        mpsBuffer: [10],
        routesViaWs: false,
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("labels receiver clock error as PPM", () => {
    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("PPM");
    expect(container.textContent).toContain("-0.7");
    expect(container.textContent).not.toContain("PPR");
  });

  it("renders the feed state as a compact HUD cell", () => {
    act(() => {
      root.render(<FeedStatusCell variant="hud" />);
    });

    const live = liveCell();
    expect(live?.getAttribute("data-feed-state")).toBe("fresh");
    expect(live?.className).toContain("liquid-glass");
    expect(container.textContent).toContain("Live");
    expect(container.textContent).toContain("10 msg/s");
  });

  it("shows warming state before transports report status", () => {
    useIdentStore.setState((state) => ({
      connectionStatus: {},
      liveState: { ...state.liveState, lastMsgTs: 0, mpsBuffer: [] },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Warming the scope");
    expect(container.textContent).not.toContain("Starting feed");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("warming");
    expect(container.textContent).not.toContain("Offline");
  });

  it("shows listening state during the initial websocket attempt", () => {
    useIdentStore.setState((state) => ({
      connectionStatus: { ws: "connecting" },
      connectionStatusInfo: { ws: { isRetry: false } },
      liveState: { ...state.liveState, lastMsgTs: 0, mpsBuffer: [] },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Listening for blips");
    expect(container.textContent).not.toContain("Waiting for first data");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("listening");
    expect(container.textContent).not.toContain("Offline");
    expect(container.textContent).not.toContain("msg/s");
  });

  it("does not show listening state during websocket retry attempts", () => {
    useIdentStore.setState((state) => ({
      connectionStatus: { ws: "connecting" },
      connectionStatusInfo: { ws: { isRetry: true } },
      liveState: { ...state.liveState, lastMsgTs: 0, mpsBuffer: [] },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Offline");
    expect(container.textContent).not.toContain("Listening for blips");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("offline");
    expect(container.textContent).not.toContain("msg/s");
  });

  it("shows listening state after websocket opens before the first feed snapshot", () => {
    useIdentStore.setState((state) => ({
      connectionStatus: { ws: "open" },
      liveState: { ...state.liveState, lastMsgTs: 0, mpsBuffer: [] },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Listening for blips");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("listening");
    expect(container.textContent).not.toContain("Offline");
    expect(container.textContent).not.toContain("msg/s");
  });

  it("shows retuning state during HTTP fallback", () => {
    useIdentStore.setState((state) => ({
      connectionStatus: { ws: "closed", http: "open" },
      liveState: { ...state.liveState, lastMsgTs: 0, mpsBuffer: [] },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Retuning feed");
    expect(container.textContent).toContain("Trying backup data source");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("retuning");
    expect(container.textContent).not.toContain("Offline");
  });

  it("shows retuning while the fallback poll is attempting", () => {
    useIdentStore.setState((state) => ({
      connectionStatus: { ws: "closed", http: "connecting" },
      liveState: { ...state.liveState, lastMsgTs: 0, mpsBuffer: [] },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Retuning feed");
    expect(container.textContent).toContain("Trying backup data source");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("retuning");
    expect(container.textContent).not.toContain("Offline");
  });

  it("does not keep listening once fallback polling starts", () => {
    useIdentStore.setState((state) => ({
      connectionStatus: { ws: "connecting", http: "connecting" },
      connectionStatusInfo: { ws: { isRetry: false } },
      liveState: { ...state.liveState, lastMsgTs: 0, mpsBuffer: [] },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Retuning feed");
    expect(container.textContent).not.toContain("Listening for blips");
    expect(container.textContent).not.toContain("Offline");
  });

  it("colors the pulse ring with the current feed status tone", () => {
    useIdentStore.setState((state) => ({
      connectionStatus: { ws: "closed", http: "open" },
      liveState: { ...state.liveState, lastMsgTs: 0, mpsBuffer: [] },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    const dot = liveCell()?.querySelector("span");
    expect(dot?.getAttribute("style")).toContain(
      "--feed-pulse-color: var(--color-warn)",
    );
  });

  it("shows degraded connection msg/s when HTTP fallback is delivering fresh snapshots", () => {
    useIdentStore.setState((state) => ({
      connectionStatus: { ws: "closed", http: "open" },
      liveState: { ...state.liveState, lastMsgTs: Date.now(), mpsBuffer: [7] },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Degraded connection");
    expect(container.textContent).toContain("7 msg/s");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("retuning");
  });

  it("does not show degraded connection for an in-flight fallback retry", () => {
    useIdentStore.setState((state) => ({
      connectionStatus: { ws: "closed", http: "connecting" },
      liveState: { ...state.liveState, lastMsgTs: Date.now(), mpsBuffer: [7] },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).not.toContain("Degraded connection");
    expect(container.textContent).toContain("Live");
  });

  it("labels stale snapshots explicitly instead of calling them live", () => {
    useIdentStore.setState((state) => ({
      liveState: { ...state.liveState, lastMsgTs: Date.now() - 3000 },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Stale data");
    expect(container.textContent).toContain("3s old");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("stale");
    expect(container.textContent).not.toContain("Live");
  });

  it("keeps stale data status during short message gaps while transport is open", () => {
    useIdentStore.setState((state) => ({
      liveState: { ...state.liveState, lastMsgTs: Date.now() - 6000 },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Stale data");
    expect(container.textContent).toContain("6s old");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("stale");
    expect(container.textContent).not.toContain("Disconnected");
    expect(container.textContent).not.toContain("msg/s");
  });

  it("shows disconnected when stale data ages past the disconnect threshold", () => {
    useIdentStore.setState((state) => ({
      liveState: { ...state.liveState, lastMsgTs: Date.now() - 31_000 },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Disconnected");
    expect(container.textContent).toContain("31s old");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("dead");
    expect(container.textContent).not.toContain("msg/s");
  });

  it("keeps stale data stable while reconnect attempts cycle transports", () => {
    useIdentStore.setState((state) => ({
      connectionStatus: { ws: "closed", http: "closed" },
      liveState: { ...state.liveState, lastMsgTs: Date.now() - 6000 },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Stale data");
    expect(container.textContent).toContain("6s old");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("stale");
    expect(container.textContent).not.toContain("msg/s");

    act(() => {
      useIdentStore.setState((state) => ({
        connectionStatus: { ...state.connectionStatus, ws: "connecting" },
      }));
      vi.advanceTimersByTime(500);
    });

    expect(container.textContent).toContain("Stale data");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("stale");

    act(() => {
      useIdentStore.setState((state) => ({
        connectionStatus: { ...state.connectionStatus, http: "open" },
      }));
      vi.advanceTimersByTime(500);
    });

    expect(container.textContent).toContain("Stale data");
    expect(container.textContent).not.toContain("Degraded connection");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("stale");
  });

  it("keeps disconnected data stable while fallback retries continue", () => {
    useIdentStore.setState((state) => ({
      connectionStatus: { ws: "closed", http: "closed" },
      liveState: { ...state.liveState, lastMsgTs: Date.now() - 31_000 },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Disconnected");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("dead");

    act(() => {
      useIdentStore.setState((state) => ({
        connectionStatus: { ...state.connectionStatus, http: "connecting" },
      }));
      vi.advanceTimersByTime(500);
    });

    expect(container.textContent).toContain("Disconnected");
    expect(container.textContent).not.toContain("Degraded connection");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("dead");

    act(() => {
      useIdentStore.setState((state) => ({
        connectionStatus: { ...state.connectionStatus, http: "open" },
      }));
      vi.advanceTimersByTime(500);
    });

    expect(container.textContent).toContain("Disconnected");
    expect(container.textContent).not.toContain("Degraded connection");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("dead");
  });
});
