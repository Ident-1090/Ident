import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

describe("runtime dependencies", () => {
  it("ships the map runtime with the application", () => {
    expect(indexHtml).not.toContain("cdn.jsdelivr.net/npm/maplibre-gl");
  });
});
