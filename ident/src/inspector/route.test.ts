import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdentStore } from "../data/store";
import type { Aircraft } from "../data/types";
import { loadRouteForAircraft, resetRouteCacheForTests } from "./route";

const AIRCRAFT: Aircraft = {
  hex: "abc123",
  flight: "UAL123",
  lat: 37.5,
  lon: -122.2,
} as unknown as Aircraft;

describe("loadRouteForAircraft sidecar short-circuit", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetRouteCacheForTests();
    useIdentStore.setState((st) => ({
      liveState: { ...st.liveState, routesViaWs: false },
      connectionStatus: { ...st.connectionStatus, ws: "closed" },
      routeByCallsign: {},
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("does not call adsb.im while the WS is open (sidecar owns lookups)", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    useIdentStore.setState((st) => ({
      connectionStatus: { ...st.connectionStatus, ws: "open" },
    }));

    const result = await loadRouteForAircraft(AIRCRAFT);
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not call adsb.im while the WS is still connecting (no frame yet)", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    useIdentStore.setState((st) => ({
      connectionStatus: { ...st.connectionStatus, ws: "connecting" },
    }));

    const result = await loadRouteForAircraft(AIRCRAFT);
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls through to client-side fetch when WS is closed", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { callsign: "UAL123", _airport_codes_iata: "SFO-LAX" },
      ],
    }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.useFakeTimers();
    const p = loadRouteForAircraft(AIRCRAFT);
    await vi.advanceTimersByTimeAsync(300);
    const result = await p;
    vi.useRealTimers();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result?.origin).toBe("SFO");
    expect(result?.destination).toBe("LAX");
  });
});
