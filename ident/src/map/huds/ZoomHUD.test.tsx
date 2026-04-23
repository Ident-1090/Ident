// biome-ignore-all lint/style/noNonNullAssertion: test fixture — missing elements/mocks fail the test loudly via the test runner.
import type { Map as MlMap } from "maplibre-gl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapEngineContext } from "../MapEngine";
import { ZoomHUD } from "./ZoomHUD";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface StubMap {
  zoomIn: ReturnType<typeof vi.fn>;
  zoomOut: ReturnType<typeof vi.fn>;
}

function makeStub(): StubMap {
  return { zoomIn: vi.fn(), zoomOut: vi.fn() };
}

function renderWith(root: Root, map: StubMap | null, isReady: boolean): void {
  act(() => {
    root.render(
      <MapEngineContext.Provider
        value={{ map: map as unknown as MlMap | null, isReady }}
      >
        <ZoomHUD />
      </MapEngineContext.Provider>,
    );
  });
}

describe("ZoomHUD", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders nothing until the map is ready", () => {
    renderWith(root, makeStub(), false);
    expect(container.querySelector("button")).toBeNull();
  });

  it("plus calls map.zoomIn with a short duration", () => {
    const stub = makeStub();
    renderWith(root, stub, true);
    const plus = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Zoom in"]',
    );
    expect(plus).not.toBeNull();
    act(() => {
      plus!.click();
    });
    expect(stub.zoomIn).toHaveBeenCalledTimes(1);
    expect(stub.zoomIn).toHaveBeenCalledWith({ duration: 200 });
  });

  it("minus calls map.zoomOut with a short duration", () => {
    const stub = makeStub();
    renderWith(root, stub, true);
    const minus = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Zoom out"]',
    );
    expect(minus).not.toBeNull();
    act(() => {
      minus!.click();
    });
    expect(stub.zoomOut).toHaveBeenCalledTimes(1);
    expect(stub.zoomOut).toHaveBeenCalledWith({ duration: 200 });
  });
});
