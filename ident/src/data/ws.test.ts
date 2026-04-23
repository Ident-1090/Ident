import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WsClient } from "./ws";

type Listener = (event: Event) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  binaryType: BinaryType = "blob";
  private listeners: Record<string, Listener[]> = {};

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  close(): void {
    this.dispatch("close");
  }

  dispatch(type: string): void {
    for (const listener of this.listeners[type] ?? []) {
      listener(new Event(type));
    }
  }
}

describe("WsClient status", () => {
  const RealWebSocket = globalThis.WebSocket;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    randomSpy = vi.spyOn(Math, "random").mockReturnValue(1);
  });

  afterEach(() => {
    globalThis.WebSocket = RealWebSocket;
    infoSpy.mockRestore();
    randomSpy.mockRestore();
    vi.useRealTimers();
  });

  it("logs retry scheduling and reconnect attempts", () => {
    const client = new WsClient({
      url: "ws://ident.test/ws",
      baseDelayMs: 1000,
      maxDelayMs: 1000,
    });

    client.start();
    MockWebSocket.instances[0].dispatch("open");
    MockWebSocket.instances[0].dispatch("close");

    expect(infoSpy).toHaveBeenCalledWith(
      "[ident/ws] connection closed; retrying in 1000ms",
    );

    vi.advanceTimersByTime(1000);

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(infoSpy).toHaveBeenCalledWith("[ident/ws] reconnecting");

    client.stop();
  });

  it("marks reconnecting status reports as retries", () => {
    const statuses: Array<{
      status: string;
      info: { isRetry: boolean } | undefined;
    }> = [];
    const client = new WsClient({
      url: "ws://ident.test/ws",
      baseDelayMs: 1000,
      maxDelayMs: 1000,
      onStatus: (status, info) => statuses.push({ status, info }),
    });

    client.start();
    MockWebSocket.instances[0].dispatch("close");
    vi.advanceTimersByTime(1000);

    expect(statuses).toEqual([
      { status: "connecting", info: { isRetry: false } },
      { status: "closed", info: undefined },
      { status: "connecting", info: { isRetry: true } },
    ]);

    client.stop();
  });

  it("does not report closed when stopped intentionally", () => {
    const statuses: string[] = [];
    const client = new WsClient({
      url: "ws://ident.test/ws",
      onStatus: (status) => statuses.push(status),
    });

    client.start();
    MockWebSocket.instances[0].dispatch("open");
    client.stop();

    expect(statuses).toEqual(["connecting", "open"]);
  });
});
