import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetPreferencesStoreForTests,
  usePreferencesStore,
} from "./preferences";

describe("status stats preferences", () => {
  afterEach(() => {
    resetPreferencesStoreForTests();
    localStorage.clear();
    vi.resetModules();
  });

  it("normalizes persisted status stat order and hidden keys", async () => {
    localStorage.setItem(
      "ident.preferences",
      JSON.stringify({
        state: {
          statusStats: {
            order: ["noise", "bogus", "noise", "gain"],
            hidden: ["unknown", "cpu", "cpu"],
          },
        },
        version: 0,
      }),
    );

    vi.resetModules();
    const fresh = await import("./preferences");

    expect(fresh.usePreferencesStore.getState().statusStats).toEqual({
      order: [
        "noise",
        "gain",
        "uptime",
        "maxRange",
        "signal",
        "strong",
        "drops",
        "cpu",
        "ram",
      ],
      hidden: ["cpu"],
    });
  });

  it("normalizes status stat mutations before storing them", () => {
    usePreferencesStore.setState({
      statusStats: {
        order: ["gain", "gain", "unknown" as never],
        hidden: ["bogus" as never, "noise", "noise"],
      },
    });

    usePreferencesStore.getState().reorderStatusStat("ram", "gain");
    usePreferencesStore.getState().setStatusStatHidden("signal", true);

    expect(usePreferencesStore.getState().statusStats).toEqual({
      order: [
        "ram",
        "gain",
        "uptime",
        "maxRange",
        "signal",
        "noise",
        "strong",
        "drops",
        "cpu",
      ],
      hidden: ["noise", "signal"],
    });
  });
});
