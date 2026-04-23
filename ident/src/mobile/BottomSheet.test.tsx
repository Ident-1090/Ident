// React 18 act() requires this flag; set before importing React.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomSheet } from "./BottomSheet";

describe("BottomSheet", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalInnerHeight: number;

  beforeEach(() => {
    originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.documentElement.style.removeProperty("--mobile-sheet-height");
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    });
  });

  it("sizes at the snap height and pads the scroll tail past the chrome zone", () => {
    act(() => {
      root.render(
        <BottomSheet snap="half" onSnapChange={vi.fn()}>
          <div>Sheet content</div>
        </BottomSheet>,
      );
    });

    const sheet = container.querySelector<HTMLElement>('[aria-label="Sheet"]');
    const scrollArea = sheet?.querySelector<HTMLElement>(
      ".mobile-bottom-sheet-content",
    );
    const inner = sheet?.querySelector<HTMLElement>(
      ".mobile-bottom-sheet-content-inner",
    );
    expect(sheet?.className).toContain("fixed");
    expect(sheet?.style.height).toBe("320px");
    expect(
      document.documentElement.style.getPropertyValue("--mobile-sheet-height"),
    ).toBe("320px");
    expect(sheet?.style.transform).toBe("");
    expect(sheet?.style.paddingBottom).toBe("");
    expect(scrollArea?.className).toContain("overflow-y-auto");
    expect(scrollArea?.className).toContain("overscroll-contain");
    expect(inner?.style.paddingBottom).toBe(
      "calc(var(--mobile-safe-bottom) + 24px)",
    );
  });

  it("dismisses when dragged below the collapsed peek", () => {
    const onDismiss = vi.fn();
    const onSnapChange = vi.fn();
    act(() => {
      root.render(
        <BottomSheet
          snap="collapsed"
          onSnapChange={onSnapChange}
          onDismiss={onDismiss}
        >
          <div>Sheet content</div>
        </BottomSheet>,
      );
    });

    const handle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Sheet position: collapsed. Tap to cycle."]',
    );
    expect(handle).toBeTruthy();
    if (!handle) throw new Error("missing bottom sheet handle");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 700));
      handle.dispatchEvent(pointerEvent("pointermove", 780));
      handle.dispatchEvent(pointerEvent("pointerup", 780));
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSnapChange).not.toHaveBeenCalled();
  });
});

function pointerEvent(type: string, clientY: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientY: { value: clientY },
    pointerId: { value: 1 },
  });
  return event;
}
