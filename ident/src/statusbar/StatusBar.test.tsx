// biome-ignore-all lint/style/noNonNullAssertion: test fixture — missing elements fail the test runner loudly.
// React 18 act() requires this flag; set before importing React.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetPreferencesStoreForTests,
  usePreferencesStore,
} from "../data/preferences";
import { useIdentStore } from "../data/store";
import type { IdentDiagnostic } from "../data/types";
import { FeedStatusCell, StatusBar } from "./StatusBar";

function expectTooltipOnPointer(target: HTMLElement, label: string) {
  expect(target.getAttribute("title")).toBeNull();
  act(() => {
    target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(label);
  act(() => {
    target.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
  });
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
}

describe("StatusBar", () => {
  let container: HTMLDivElement;
  let root: Root;
  const liveCell = () => container.querySelector("[data-feed-state]");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
    resetPreferencesStoreForTests();
    useIdentStore.setState({
      receiver: {
        lat: 37.4,
        lon: -122.1,
        version: "wiedehopf readsb v3.14.1676",
      },
      capabilities: {
        schema: "ident.capabilities.v1",
        producer: { kind: "readsb", version: "wiedehopf readsb v3.14.1676" },
        capabilities: {
          aircraft: "producer_provided",
          receiverPosition: "producer_provided",
          messageRate: "producer_provided",
          gain: "producer_provided",
          uptime: "producer_provided",
          maxRange: "producer_provided",
          rangeOutline: "producer_provided",
          signalDiagnostics: "producer_provided",
          meteorology: "unavailable",
          replay: "unavailable",
          trails: "ident_derived",
        },
      },
      identStatus: {
        schema: "ident.status.v1",
        producer: { kind: "readsb", version: "wiedehopf readsb v3.14.1676" },
        observedAt: {
          kind: "producer_provided",
          source: "stats_now",
          value: { epochSec: Date.now() / 1000 },
        },
        freshness: {
          aircraftAgeSec: 0,
          statsAgeSec: 0,
          receiverObservedAgeSec: 0,
        },
        receiverPosition: {
          kind: "producer_provided",
          source: "receiver_json",
          value: { lat: 37.4, lon: -122.1 },
        },
        messageRate: {
          kind: "producer_provided",
          source: "stats_last1min_messages_valid",
          value: { hz: 10, basisSec: 60 },
        },
        gain: {
          kind: "producer_provided",
          source: "top_level",
          value: { db: 18.6 },
        },
        uptime: {
          kind: "producer_provided",
          source: "stats_now_minus_total_start",
          value: { sec: 120, subject: "receiver" },
        },
        maxRange: {
          kind: "producer_provided",
          source: "outline_last24h_vertices",
          value: {
            nm: 119.8,
            scope: "last24h",
            computation: "max_receiver_to_outline_vertex",
          },
        },
        diagnostics: [],
      },
      rangeOutline: null,
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
    resetPreferencesStoreForTests();
  });

  it("renders normalized receiver diagnostics", () => {
    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.querySelector("footer")?.className).not.toContain(
      "border-t",
    );
    expect(container.textContent).toContain("Gain");
    expect(container.textContent).toContain("18.6 dB");
    expect(container.textContent).toContain("Uptime");
    expect(container.textContent).toContain("2m");
    expect(container.textContent).toContain("24h Range");
    expect(container.textContent).toContain("120 NM");
    expect(container.textContent).toContain("wiedehopf");
  });

  it("uses custom tooltips for unavailable status reasons", () => {
    useIdentStore.setState((state) => ({
      identStatus: {
        ...state.identStatus!,
        gain: { kind: "unavailable", reason: "awaiting_second_sample" },
        uptime: { kind: "unavailable", reason: "counter_reset" },
        maxRange: { kind: "unavailable", reason: "stale_sample" },
      },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Gain—");
    expect(container.textContent).toContain("Uptime—");
    expect(container.textContent).toContain("Max Range—");

    expect(container.querySelector("[title]")).toBeNull();
    expectTooltipOnPointer(
      container.querySelector<HTMLElement>('[data-status-cell="Gain"]')!,
      "Awaiting second counter sample",
    );
    expectTooltipOnPointer(
      container.querySelector<HTMLElement>('[data-status-cell="Uptime"]')!,
      "Counter reset",
    );
    expectTooltipOnPointer(
      container.querySelector<HTMLElement>('[data-status-cell="Max Range"]')!,
      "Counter sample is stale",
    );
  });

  it("omits status rows whose capability the producer cannot provide", () => {
    useIdentStore.setState((state) => ({
      capabilities: {
        ...state.capabilities!,
        capabilities: {
          ...state.capabilities!.capabilities,
          gain: "unavailable",
          uptime: "unavailable",
          maxRange: "unavailable",
        },
      },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.querySelector('[data-status-cell="Gain"]')).toBeNull();
    expect(container.querySelector('[data-status-cell="Uptime"]')).toBeNull();
    expect(
      container.querySelector('[data-status-cell="Max Range"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-status-cell="24h Range"]'),
    ).toBeNull();
  });

  it("renders capability-supported rows even when the live sample is transiently unavailable", () => {
    useIdentStore.setState((state) => ({
      identStatus: {
        ...state.identStatus!,
        gain: { kind: "unavailable", reason: "awaiting_second_sample" },
        uptime: { kind: "unavailable", reason: "awaiting_second_sample" },
        maxRange: { kind: "unavailable", reason: "awaiting_second_sample" },
      },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    const gainCell = container.querySelector<HTMLElement>(
      '[data-status-cell="Gain"]',
    );
    const uptimeCell = container.querySelector<HTMLElement>(
      '[data-status-cell="Uptime"]',
    );
    const rangeCell = container.querySelector<HTMLElement>(
      '[data-status-cell="Max Range"]',
    );
    expect(gainCell).not.toBeNull();
    expect(uptimeCell).not.toBeNull();
    expect(rangeCell).not.toBeNull();
    expect(gainCell!.textContent).toContain("—");
    expect(uptimeCell!.textContent).toContain("—");
    expect(rangeCell!.textContent).toContain("—");

    expectTooltipOnPointer(gainCell!, "Awaiting second counter sample");
    expectTooltipOnPointer(uptimeCell!, "Awaiting second counter sample");
    expectTooltipOnPointer(rangeCell!, "Awaiting second counter sample");
  });

  it("opens a diagnostics notification center from the right status slot", () => {
    useIdentStore.setState((state) => ({
      identStatus: {
        ...state.identStatus!,
        diagnostics: [
          {
            severity: "warning",
            channel: "aircraft",
            code: "aircraft.adapter.invalid_bool",
            message: "aircraft alert value must be boolean or 0/1",
          },
          {
            severity: "error",
            channel: "outline",
            code: "outline.adapter.malformed_outline",
            message: "outline.json did not contain a valid polygon",
          },
        ],
      },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="diagnostics-center-button"]',
    )!;
    expect(button.getAttribute("title")).toBeNull();
    expect(button.textContent).toContain("1 ERR");
    expect(button.textContent).toContain("1 WARN");
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    act(() => {
      button.click();
    });

    const panel = document.querySelector('[role="dialog"]')!;
    expect(panel.textContent).toContain("Diagnostics");
    expect(panel.textContent).toContain("aircraft.adapter.invalid_bool");
    expect(panel.textContent).toContain("aircraft alert value must be boolean");
    expect(panel.textContent).toContain("outline.adapter.malformed_outline");

    act(() => {
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the upstream identity in the notification center when clean", () => {
    act(() => {
      root.render(<StatusBar />);
    });

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="diagnostics-center-button"]',
    )!;
    expect(button.textContent).toContain("readsb wiedehopf");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("surfaces update diagnostics through the notification center with device-local suppression", () => {
    const updateDiagnostic = {
      severity: "info",
      channel: "update",
      code: "update.release.available",
      message: "Ident v1.1.0 is available.",
      actionLabel: "Release notes",
      actionUrl: "https://github.com/Ident-1090/Ident/releases/tag/v1.1.0",
    } as IdentDiagnostic;
    useIdentStore.setState((state) => ({
      identStatus: {
        ...state.identStatus!,
        diagnostics: [updateDiagnostic],
      },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    const popup = document.querySelector<HTMLElement>(
      '[data-testid="notification-popup"]',
    );
    expect(popup?.textContent).toContain("Ident v1.1.0 is available.");
    expect(popup?.textContent).toContain("Snooze 7 days");
    expect(popup?.textContent).toContain("Ignore on this device");
    expect(
      popup?.querySelector('a[href*="/releases/tag/v1.1.0"]'),
    ).toBeTruthy();

    const snooze = Array.from(
      popup!.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Snooze 7 days");
    expect(snooze).toBeTruthy();

    act(() => snooze!.click());

    expect(
      document.querySelector('[data-testid="notification-popup"]'),
    ).toBeNull();
    const persisted = localStorage.getItem("ident.preferences") ?? "";
    expect(persisted).not.toContain("v1.1.0");
    expect(persisted).not.toContain("Ident v1.1.0 is available.");
    expect(
      usePreferencesStore.getState().notificationSuppressions,
    ).toHaveLength(1);

    vi.setSystemTime(new Date("2026-04-30T12:00:01Z"));
    act(() => {
      root.render(<StatusBar />);
    });
    const returnedPopup = document.querySelector<HTMLElement>(
      '[data-testid="notification-popup"]',
    );
    expect(returnedPopup?.textContent).toContain("Ident v1.1.0 is available.");

    const ignore = Array.from(
      returnedPopup!.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Ignore on this device");
    expect(ignore).toBeTruthy();

    act(() => ignore!.click());
    vi.setSystemTime(new Date("2027-04-30T12:00:01Z"));
    act(() => {
      root.render(<StatusBar />);
    });

    expect(
      document.querySelector('[data-testid="notification-popup"]'),
    ).toBeNull();
  });

  it("renders the feed state as a compact HUD cell", () => {
    act(() => {
      root.render(<FeedStatusCell variant="hud" />);
    });

    const live = liveCell();
    expect(live?.getAttribute("data-feed-state")).toBe("fresh");
    expect(live?.getAttribute("title")).toBeNull();
    expect(live?.className).toContain("liquid-glass");
    expect(container.textContent).toContain("Live");
    expect(container.textContent).toContain("10 msg/s");
    expectTooltipOnPointer(live as HTMLElement, "Live · 10 msg/s");
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

  it("shows retuning state during websocket retry attempts", () => {
    useIdentStore.setState((state) => ({
      connectionStatus: { ws: "connecting" },
      connectionStatusInfo: { ws: { isRetry: true } },
      liveState: { ...state.liveState, lastMsgTs: 0, mpsBuffer: [] },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Retuning feed");
    expect(container.textContent).not.toContain("Listening for blips");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("retuning");
    expect(container.textContent).not.toContain("msg/s");
  });

  it("shows websocket retry timing when the next retry is more than one second away", () => {
    useIdentStore.setState((state) => ({
      connectionStatus: { ws: "connecting" },
      connectionStatusInfo: {
        ws: {
          isRetry: true,
          retryDelayMs: 1500,
          nextRetryAt: Date.now() + 1500,
        },
      },
      liveState: { ...state.liveState, lastMsgTs: 0, mpsBuffer: [] },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Retuning feed");
    expect(container.textContent).toContain("retrying in 2s");
  });

  it("hides websocket retry timing when the next retry is within one second", () => {
    useIdentStore.setState((state) => ({
      connectionStatus: { ws: "connecting" },
      connectionStatusInfo: {
        ws: { isRetry: true, retryDelayMs: 800, nextRetryAt: Date.now() + 800 },
      },
      liveState: { ...state.liveState, lastMsgTs: 0, mpsBuffer: [] },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Retuning feed");
    expect(container.textContent).not.toContain("retrying in");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("retuning");
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

  it("colors the pulse ring with the current feed status tone", () => {
    useIdentStore.setState((state) => ({
      connectionStatus: { ws: "connecting" },
      connectionStatusInfo: { ws: { isRetry: true } },
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
      connectionStatus: { ws: "closed" },
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
  });

  it("keeps disconnected data stable while websocket retries continue", () => {
    useIdentStore.setState((state) => ({
      connectionStatus: { ws: "closed" },
      liveState: { ...state.liveState, lastMsgTs: Date.now() - 31_000 },
    }));

    act(() => {
      root.render(<StatusBar />);
    });

    expect(container.textContent).toContain("Disconnected");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("dead");

    act(() => {
      useIdentStore.setState((state) => ({
        connectionStatus: { ...state.connectionStatus, ws: "connecting" },
        connectionStatusInfo: { ws: { isRetry: true } },
      }));
      vi.advanceTimersByTime(500);
    });

    expect(container.textContent).toContain("Disconnected");
    expect(liveCell()!.getAttribute("data-feed-state")).toBe("dead");
  });
});
