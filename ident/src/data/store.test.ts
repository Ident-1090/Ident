// biome-ignore-all lint/style/noNonNullAssertion: test fixture — missing elements/mocks fail the test loudly via the test runner.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetPreferencesStoreForTests,
  usePreferencesStore,
} from "./preferences";
import { sampleMpsOnce, useIdentStore } from "./store";
import type { AircraftFrame } from "./types";

function resetStore() {
  useIdentStore.setState({
    aircraft: new Map(),
    now: 0,
    altTrendsByHex: {},
    gsTrendsByHex: {},
    rssiBufByHex: {},
    selectedHex: null,
    connectionStatus: { ws: "connecting" },
    connectionStatusInfo: { ws: { isRetry: false } },
    filter: useIdentStore.getInitialState().filter,
    search: { query: "" },
    alerts: [],
    trailsByHex: {},
    liveState: { lastMsgTs: 0, mpsBuffer: [], routesViaWs: false },
    camera: {
      trackSelected: false,
      autoFitTraffic: false,
      lastUserInteraction: null,
    },
    settings: {
      trailFadeSec: 180,
      unitMode: "aviation",
      unitOverrides: {
        altitude: "ft",
        horizontalSpeed: "kt",
        distance: "nm",
        verticalSpeed: "fpm",
        temperature: "C",
      },
      clock: "utc",
      theme: "system",
    },
    stats: null,
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
}

function frame(
  hex: string,
  alt: number | "ground",
  rssi?: number,
): AircraftFrame {
  return {
    now: 0,
    aircraft: [{ hex, alt_baro: alt, ...(rssi != null ? { rssi } : {}) }],
  };
}

describe("initial connection status", () => {
  it("starts with the WebSocket transport connecting", () => {
    expect(useIdentStore.getInitialState().connectionStatus.ws).toBe(
      "connecting",
    );
  });
});

describe("ingestAircraft rolling buffers", () => {
  beforeEach(resetStore);

  it("appends alt_baro samples to altTrendsByHex and trims to 60", () => {
    const store = useIdentStore.getState();
    for (let i = 0; i < 70; i++)
      store.ingestAircraft(frame("abc123", 10000 + i));
    const buf = useIdentStore.getState().altTrendsByHex.abc123;
    expect(buf).toBeDefined();
    expect(buf.length).toBe(60);
    expect(buf[0]).toBe(10010);
    expect(buf[59]).toBe(10069);
  });

  it("skips alt_baro === 'ground' samples", () => {
    const store = useIdentStore.getState();
    store.ingestAircraft(frame("abc123", "ground"));
    expect(useIdentStore.getState().altTrendsByHex.abc123).toBeUndefined();
  });

  it("appends rssi samples to rssiBufByHex", () => {
    const store = useIdentStore.getState();
    store.ingestAircraft(frame("abc123", 10000, -12.3));
    store.ingestAircraft(frame("abc123", 10000, -11.1));
    expect(useIdentStore.getState().rssiBufByHex.abc123).toEqual([
      -12.3, -11.1,
    ]);
  });

  it("preserves selected aircraft when it disappears from the latest frame", () => {
    useIdentStore.setState({
      aircraft: new Map([
        ["abc123", { hex: "abc123", alt_baro: 12000, lat: 1, lon: 2, seen: 1 }],
      ]),
      now: 10,
      selectedHex: "abc123",
      camera: {
        ...useIdentStore.getState().camera,
        trackSelected: true,
      },
    });
    useIdentStore.getState().ingestAircraft({
      now: 16,
      aircraft: [{ hex: "def456", alt_baro: 10000 }],
    });

    const state = useIdentStore.getState();
    expect(state.selectedHex).toBe("abc123");
    expect(state.camera.trackSelected).toBe(true);
    expect(state.aircraft.get("abc123")).toMatchObject({
      hex: "abc123",
      lat: 1,
      lon: 2,
      seen: 7,
    });
    expect(state.aircraft.get("abc123")?.seen_pos).toBeUndefined();
  });

  it("preserves selectedHex when the selected aircraft is still present", () => {
    useIdentStore.setState({ selectedHex: "abc123" });
    useIdentStore.getState().ingestAircraft(frame("abc123", 10000));
    expect(useIdentStore.getState().selectedHex).toBe("abc123");
  });
});

describe("recordAircraftSample", () => {
  beforeEach(resetStore);

  it("appends to both buffers when values are numeric", () => {
    useIdentStore.getState().recordAircraftSample("abc123", {
      hex: "abc123",
      alt_baro: 12000,
      rssi: -9,
    });
    const st = useIdentStore.getState();
    expect(st.altTrendsByHex.abc123).toEqual([12000]);
    expect(st.rssiBufByHex.abc123).toEqual([-9]);
  });
});

describe("pushAlert", () => {
  beforeEach(resetStore);

  it("prepends and caps at 50 entries", () => {
    const store = useIdentStore.getState();
    for (let i = 0; i < 60; i++) {
      store.pushAlert({
        id: String(i),
        ts: 1_000_000 + i,
        kind: "weak-signal",
        title: `t${i}`,
      });
    }
    const alerts = useIdentStore.getState().alerts;
    expect(alerts.length).toBe(50);
    // Most recent first.
    expect(alerts[0].id).toBe("59");
  });

  it("drops entries older than the 30-minute window", () => {
    const store = useIdentStore.getState();
    const now = 10_000_000;
    store.pushAlert({
      id: "old",
      ts: now - 31 * 60_000,
      kind: "weak-signal",
      title: "old",
    });
    store.pushAlert({ id: "new", ts: now, kind: "weak-signal", title: "new" });
    const alerts = useIdentStore.getState().alerts;
    expect(alerts.map((a) => a.id)).toEqual(["new"]);
  });
});

describe("filter setters", () => {
  beforeEach(() => {
    useIdentStore.setState({
      filter: {
        categories: {
          airline: false,
          ga: false,
          bizjet: false,
          mil: false,
          rotor: false,
          unknown: false,
        },
        altRangeFt: [0, 45000],
        emergOnly: false,
        hideGround: false,
        hasPosOnly: false,
        operatorContains: "",
        callsignPrefix: "",
        routeContains: "",
        countryContains: "",
        hexContains: "",
        regPrefix: "",
        squawkEquals: "",
        typePrefix: "",
        sourceEquals: "",
        gsRangeKt: null,
        distRangeNm: null,
        vsRangeFpm: null,
        hdgCenter: null,
        hdgTolerance: null,
        militaryOnly: false,
        inViewOnly: false,
        expressionBranches: null,
      },
    });
  });

  it("toggleFilterCategory flips a single key", () => {
    useIdentStore.getState().toggleFilterCategory("airline");
    expect(useIdentStore.getState().filter.categories.airline).toBe(true);
    useIdentStore.getState().toggleFilterCategory("airline");
    expect(useIdentStore.getState().filter.categories.airline).toBe(false);
  });

  it("setFilterAltRange replaces the range tuple", () => {
    useIdentStore.getState().setFilterAltRange([5000, 30000]);
    expect(useIdentStore.getState().filter.altRangeFt).toEqual([5000, 30000]);
  });
});

describe("map setters", () => {
  beforeEach(() => {
    useIdentStore.setState((st) => ({
      map: {
        ...st.map,
        center: null,
        zoom: null,
        viewportHexes: null,
      },
    }));
  });

  it("toggleLayer flips a single layer key", () => {
    const start = useIdentStore.getState().map.layers.rangeRings;
    useIdentStore.getState().toggleLayer("rangeRings");
    expect(useIdentStore.getState().map.layers.rangeRings).toBe(!start);
  });

  it("setLabelMode updates in place", () => {
    useIdentStore.getState().setLabelMode("icon");
    expect(useIdentStore.getState().map.labelMode).toBe("icon");
  });

  it("toggleLayer handles losRings", () => {
    expect(useIdentStore.getState().map.layers.losRings).toBe(false);
    useIdentStore.getState().toggleLayer("losRings");
    expect(useIdentStore.getState().map.layers.losRings).toBe(true);
  });

  it("toggleLayer persists through preferences and a fresh store init restores it", async () => {
    resetPreferencesStoreForTests();
    const before = useIdentStore.getState().map.layers.rangeRings;
    useIdentStore.getState().toggleLayer("rangeRings");
    expect(usePreferencesStore.getState().map.layers.rangeRings).toBe(!before);

    vi.resetModules();
    const fresh = await import("./store");
    expect(fresh.useIdentStore.getState().map.layers.rangeRings).toBe(!before);
  });

  it("setMapViewportHexes is a no-op when the visible hex set is unchanged", () => {
    useIdentStore.getState().setMapViewportHexes(new Set(["abc123", "def456"]));
    const prevMap = useIdentStore.getState().map;

    useIdentStore.getState().setMapViewportHexes(new Set(["def456", "abc123"]));

    expect(useIdentStore.getState().map).toBe(prevMap);
    expect(useIdentStore.getState().map.viewportHexes).toBe(
      prevMap.viewportHexes,
    );
  });

  it("setMapView ignores equivalent camera jitter and skips persisting it", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    useIdentStore
      .getState()
      .setMapView({ center: { lng: -122.4, lat: 37.7 }, zoom: 8.25 });
    const prevMap = useIdentStore.getState().map;
    const persistedWrites = setItemSpy.mock.calls.length;

    useIdentStore.getState().setMapView({
      center: { lng: -122.3999997, lat: 37.7000002 },
      zoom: 8.2504,
    });

    expect(useIdentStore.getState().map).toBe(prevMap);
    expect(setItemSpy).toHaveBeenCalledTimes(persistedWrites);
    setItemSpy.mockRestore();
  });
});

describe("camera slice", () => {
  beforeEach(resetStore);

  it("selecting aircraft enables selected tracking and clearing selection disables it", () => {
    const store = useIdentStore.getState();

    store.select("abc123");
    expect(useIdentStore.getState().selectedHex).toBe("abc123");
    expect(useIdentStore.getState().camera.trackSelected).toBe(true);

    store.select(null);
    expect(useIdentStore.getState().selectedHex).toBeNull();
    expect(useIdentStore.getState().camera.trackSelected).toBe(false);
  });

  it("records map interactions as an ADT and only pan disables selected tracking", () => {
    useIdentStore.getState().select("abc123");

    useIdentStore.getState().recordMapInteraction({ kind: "zoom", at: 1_000 });
    expect(useIdentStore.getState().camera).toMatchObject({
      trackSelected: true,
      lastUserInteraction: { kind: "zoom", at: 1_000 },
    });

    useIdentStore.getState().recordMapInteraction({ kind: "pan", at: 2_000 });
    expect(useIdentStore.getState().camera).toMatchObject({
      trackSelected: false,
      lastUserInteraction: { kind: "pan", at: 2_000 },
    });
  });

  it("toggles auto-fit traffic independently from selected tracking", () => {
    useIdentStore.getState().select("abc123");
    useIdentStore.getState().setAutoFitTraffic(true);

    expect(useIdentStore.getState().camera).toMatchObject({
      trackSelected: true,
      autoFitTraffic: true,
    });
  });
});

describe("recordTrailPoint", () => {
  beforeEach(resetStore);

  it("retains points across a wide age range, capping at 1500 with the oldest dropped", () => {
    const store = useIdentStore.getState();
    const base = 2_000_000;
    // Span ~2 h of 4 s cadence: 1800 points, across which age-based trimming
    // used to drop the olds. The new buffer keeps them, bounded only by the
    // 1500-point cap.
    for (let i = 0; i < 2000; i++) {
      store.recordTrailPoint("abc123", {
        lat: 0,
        lon: 0,
        alt: "ground",
        ts: base + i * 4000,
      });
    }
    const buf = useIdentStore.getState().trailsByHex.abc123;
    expect(buf.length).toBe(1500);
    // Oldest kept point is i=500 because we rolled 500 off the front.
    expect(buf[0].ts).toBe(base + 500 * 4000);
    expect(buf[1499].ts).toBe(base + 1999 * 4000);
  });

  it("setTrailFadeSec clamps to 10..600", () => {
    const store = useIdentStore.getState();
    store.setTrailFadeSec(5);
    expect(useIdentStore.getState().settings.trailFadeSec).toBe(10);
    store.setTrailFadeSec(9999);
    expect(useIdentStore.getState().settings.trailFadeSec).toBe(600);
  });
});

describe("settings slice", () => {
  beforeEach(resetStore);

  it("defaults the unit system to aviation", async () => {
    resetPreferencesStoreForTests();
    vi.resetModules();

    const fresh = await import("./store");

    expect(fresh.useIdentStore.getState().settings.unitMode).toBe("aviation");
    expect(fresh.useIdentStore.getState().settings.unitOverrides).toEqual({
      altitude: "ft",
      horizontalSpeed: "kt",
      distance: "nm",
      verticalSpeed: "fpm",
      temperature: "C",
    });
  });

  it("stores custom unit selections without losing the chosen mode", () => {
    useIdentStore.getState().setSettings({
      unitMode: "custom",
      unitOverrides: {
        altitude: "ft",
        horizontalSpeed: "kt",
        distance: "nm",
        verticalSpeed: "fpm",
        temperature: "F",
      },
    });
    const settings = useIdentStore.getState().settings;
    expect(settings.unitMode).toBe("custom");
    expect(settings.unitOverrides.temperature).toBe("F");
    expect(settings.unitOverrides.distance).toBe("nm");
  });
});

describe("update dismissal persistence", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetPreferencesStoreForTests();
  });

  it("stores release dismissal and restores it on fresh preferences init", async () => {
    resetPreferencesStoreForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    usePreferencesStore.getState().dismissReleaseUpdate(" v1.1.0 ");

    expect(usePreferencesStore.getState().updateDismissal).toEqual({
      version: "v1.1.0",
      dismissedUntil: Date.parse("2026-01-08T00:00:00Z"),
    });

    vi.resetModules();
    const fresh = await import("./preferences");
    expect(fresh.usePreferencesStore.getState().updateDismissal).toEqual({
      version: "v1.1.0",
      dismissedUntil: Date.parse("2026-01-08T00:00:00Z"),
    });
  });

  it("drops expired release dismissal on fresh preferences init", async () => {
    resetPreferencesStoreForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    usePreferencesStore.getState().dismissReleaseUpdate("v1.1.0");
    vi.setSystemTime(new Date("2026-01-08T00:00:01Z"));

    vi.resetModules();
    const fresh = await import("./preferences");

    expect(fresh.usePreferencesStore.getState().updateDismissal).toBeNull();
  });
});

describe("liveState msg-rate buffer", () => {
  beforeEach(resetStore);

  it("trims mpsBuffer to 60 samples", () => {
    useIdentStore.setState({
      stats: { now: 0, last1min: { messages_valid: 600 } },
    });
    for (let i = 0; i < 75; i++) sampleMpsOnce();
    const buf = useIdentStore.getState().liveState.mpsBuffer;
    expect(buf.length).toBe(60);
    // 600 msgs / 60 s = 10 msg/s in every slot.
    expect(buf.every((v) => v === 10)).toBe(true);
  });

  it("falls back to 0 when stats are missing", () => {
    sampleMpsOnce();
    expect(useIdentStore.getState().liveState.mpsBuffer).toEqual([0]);
  });
});

describe("labels slice setters", () => {
  beforeEach(() => {
    useIdentStore.setState({
      labels: {
        hoveredHex: null,
      },
    });
  });

  it("setHoveredHex round-trips", () => {
    useIdentStore.getState().setHoveredHex("abc123");
    expect(useIdentStore.getState().labels.hoveredHex).toBe("abc123");
    useIdentStore.getState().setHoveredHex(null);
    expect(useIdentStore.getState().labels.hoveredHex).toBeNull();
  });
});

describe("search slice setter", () => {
  beforeEach(() => {
    useIdentStore.setState({
      filter: useIdentStore.getInitialState().filter,
      search: { query: "" },
    });
  });

  it("setSearchQuery round-trips an empty string and a non-empty string", () => {
    useIdentStore.getState().setSearchQuery("UAL123");
    expect(useIdentStore.getState().search.query).toBe("UAL123");
    useIdentStore.getState().setSearchQuery("");
    expect(useIdentStore.getState().search.query).toBe("");
  });

  it("derives filter state from structured query text", () => {
    useIdentStore
      .getState()
      .setSearchQuery("op:United alt:>30000 !ground cat:a2");
    const st = useIdentStore.getState();
    expect(st.search.query).toBe("op:United alt:>30000 !ground cat:a2");
    expect(st.filter.operatorContains).toBe("United");
    expect(st.filter.altRangeFt).toEqual([30000, 45000]);
    expect(st.filter.hideGround).toBe(true);
    expect(st.filter.categories.airline).toBe(true);
  });

  it("plain search text clears structured filter derivation", () => {
    const store = useIdentStore.getState();
    store.setSearchQuery("op:United alt:>30000");
    expect(useIdentStore.getState().filter.operatorContains).toBe("United");

    useIdentStore.getState().setSearchQuery("UAL123");
    const st = useIdentStore.getState();
    expect(st.search.query).toBe("UAL123");
    expect(st.filter.operatorContains).toBe("");
    expect(st.filter.altRangeFt).toEqual([0, 45000]);
  });

  it("derives expression branches from grouped OR query text", () => {
    useIdentStore.getState().setSearchQuery("cs:FDX | (cs:UPS alt:>5000)");
    const st = useIdentStore.getState();
    expect(st.search.query).toBe("cs:FDX | (cs:UPS alt:>5000)");
    expect(st.filter.expressionBranches).toHaveLength(2);
    expect(st.filter.expressionBranches?.[0].callsignPrefix).toBe("FDX");
    expect(st.filter.expressionBranches?.[1].callsignPrefix).toBe("UPS");
    expect(st.filter.expressionBranches?.[1].altRangeFt).toEqual([5000, 45000]);
  });

  it("resetFilter clears both derived filter and query text", () => {
    useIdentStore.getState().setSearchQuery("op:United");
    useIdentStore.getState().resetFilter();
    const st = useIdentStore.getState();
    expect(st.search.query).toBe("");
    expect(st.filter.operatorContains).toBe("");
  });
});

describe("recordSnapshot / setLosData", () => {
  beforeEach(resetStore);

  it("recordSnapshot updates lastMsgTs to a current timestamp", () => {
    const before = useIdentStore.getState().liveState.lastMsgTs;
    useIdentStore.getState().recordSnapshot();
    const after = useIdentStore.getState().liveState.lastMsgTs;
    expect(after).toBeGreaterThan(before);
  });

  it("setLosData stores and clears the payload", () => {
    const data = {
      rings: [{ alt: 3048, points: [[37, -122] as [number, number]] }],
    };
    useIdentStore.getState().setLosData(data);
    expect(useIdentStore.getState().losData).toEqual(data);
    useIdentStore.getState().setLosData(null);
    expect(useIdentStore.getState().losData).toBeNull();
  });
});
