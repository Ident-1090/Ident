import { describe, expect, it } from "vitest";
import { relativeTimeAgo } from "./recency";

describe("relativeTimeAgo", () => {
  const NOW = 1_700_000_000_000;

  it.each([
    [NOW, "just now"],
    [NOW - 4_000, "just now"],
    [NOW - 5_000, "5s ago"],
    [NOW - 59_000, "59s ago"],
    [NOW - 60_000, "1m ago"],
    [NOW - 30 * 60_000, "30m ago"],
    [NOW - 60 * 60_000, "1h ago"],
    [NOW - 5 * 60 * 60_000, "5h ago"],
    [NOW - 24 * 60 * 60_000, "1d ago"],
    [NOW - 7 * 24 * 60 * 60_000, "7d ago"],
  ])("%i ms ago -> %s", (epochMs, expected) => {
    expect(relativeTimeAgo(epochMs, NOW)).toBe(expected);
  });

  it("clamps future times to just now (clock skew defense)", () => {
    expect(relativeTimeAgo(NOW + 10_000, NOW)).toBe("just now");
  });
});
