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

  it("shows a skeleton placeholder while the photo is loading", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );

    act(() => {
      root.render(<PhotoCard hex="def456" reg="N12345" type="B738" />);
    });

    const skeleton = container.querySelector(".animate-pulse");
    expect(skeleton).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders the photo once the API resolves", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              photos: [
                {
                  thumbnail_large: {
                    src: "https://example.test/photo.jpg",
                    size: { width: 320, height: 213 },
                  },
                  photographer: "A. Spotter",
                  link: "https://example.test/p",
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    act(() => {
      root.render(<PhotoCard hex="abc123" reg="N12345" type="B738" />);
    });
    await act(async () => {
      await flushMicrotasks();
    });

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://example.test/photo.jpg");
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
