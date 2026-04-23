import { afterEach, describe, expect, it, vi } from "vitest";
import { useIdentStore } from "./store";
import { startUpdateStatusPolling } from "./update";

describe("startUpdateStatusPolling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useIdentStore.setState({
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
  });

  it("reads the local identd update endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        enabled: true,
        status: "available",
        current: {
          version: "v1.0.0",
          commit: "abc123",
          date: "2026-04-22T00:00:00Z",
        },
        latest: {
          version: "v1.1.0",
          url: "https://github.com/Ident-1090/Ident/releases/tag/v1.1.0",
        },
        checkedAt: "2026-04-23T00:00:00Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const stop = startUpdateStatusPolling();
    await settlePromises();
    stop();

    expect(fetchMock).toHaveBeenCalledWith(
      "/update.json",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(useIdentStore.getState().update.status).toBe("available");
    expect(useIdentStore.getState().update.latest?.version).toBe("v1.1.0");
  });

  it("marks endpoint failures without contacting GitHub from the browser", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });
    vi.stubGlobal("fetch", fetchMock);

    const stop = startUpdateStatusPolling();
    await settlePromises();
    stop();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/update.json");
    expect(useIdentStore.getState().update.status).toBe("unavailable");
  });
});

async function settlePromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
