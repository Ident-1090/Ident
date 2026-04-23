(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __clearPhotoCache, PhotoCard } from "./PhotoCard";

function flushMicrotasks() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("PhotoCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    __clearPhotoCache();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders nothing when the API returns no photos", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ photos: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    act(() => {
      root.render(<PhotoCard hex="abc123" reg="N12345" type="B738" />);
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
