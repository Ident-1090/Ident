export interface WsStatusInfo {
  isRetry: boolean;
}

export interface WsClientOpts {
  url: string;
  onBinary?: (data: ArrayBuffer) => void;
  onText?: (text: string) => void;
  onStatus?: (
    status: "connecting" | "open" | "closed",
    info?: WsStatusInfo,
  ) => void;
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
}

export class WsClient {
  private ws?: WebSocket;
  private closed = false;
  private attempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly opts: Required<
    Pick<WsClientOpts, "baseDelayMs" | "maxDelayMs" | "now">
  > &
    WsClientOpts;

  constructor(opts: WsClientOpts) {
    this.opts = {
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      now: () => Date.now(),
      ...opts,
    };
  }

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  sendJSON(value: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(value));
    return true;
  }

  private connect(): void {
    if (this.attempt > 0) console.info("[ident/ws] reconnecting");
    this.opts.onStatus?.("connecting", { isRetry: this.attempt > 0 });
    const ws = new WebSocket(this.opts.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.attempt = 0;
      this.opts.onStatus?.("open");
    });
    ws.addEventListener("message", (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        this.opts.onBinary?.(ev.data);
      } else if (typeof ev.data === "string") {
        this.opts.onText?.(ev.data);
      }
    });
    ws.addEventListener("close", () => this.scheduleReconnect());
    ws.addEventListener("error", () => ws.close());
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.opts.onStatus?.("closed");
    const delay = this.backoffDelay();
    console.info(
      `[ident/ws] connection closed; retrying in ${Math.round(delay)}ms`,
    );
    this.attempt++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private backoffDelay(): number {
    const exp = Math.min(
      this.opts.baseDelayMs * 2 ** this.attempt,
      this.opts.maxDelayMs,
    );
    return exp * (0.5 + Math.random() * 0.5);
  }
}
