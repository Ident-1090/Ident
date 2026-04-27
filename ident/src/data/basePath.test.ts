import { afterEach, describe, expect, it } from "vitest";
import { appPath, appWebSocketUrl } from "./basePath";

describe("app path helpers", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("resolves service URLs at the origin root", () => {
    window.history.replaceState(null, "", "/#/aircraft/abc123");

    expect(appPath("api/update.json")).toBe("/api/update.json");
    expect(appPath("/api/trails/recent.json")).toBe("/api/trails/recent.json");
    expect(appWebSocketUrl("api/ws")).toBe("ws://localhost:3000/api/ws");
  });

  it("resolves service URLs under a subpath mount with hash routes", () => {
    window.history.replaceState(null, "", "/ident/#/aircraft/abc123");

    expect(appPath("api/update.json")).toBe("/ident/api/update.json");
    expect(appPath("/api/trails/recent.json")).toBe(
      "/ident/api/trails/recent.json",
    );
    expect(appWebSocketUrl("/api/ws")).toBe("ws://localhost:3000/ident/api/ws");
  });
});
