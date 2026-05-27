import { buildHeartbeatFrame, parseLwpFrame, type ParsedLwpFrame } from "@wangwang/onetalk-adapter/browser";

const LWP_ENDPOINT = "wss://wss-icbu.dingtalk.com/";
const SOCKET_OPEN = 1;

interface SocketLike {
  readyState: number;
  addEventListener(type: "open" | "message" | "error" | "close", callback: (event: Event | MessageEvent) => void): void;
  removeEventListener(type: "open" | "message" | "error" | "close", callback: (event: Event | MessageEvent) => void): void;
  send(data: string): void;
  close(): void;
}

export interface LwpRpcClientOptions {
  socketFactory?: () => SocketLike;
  nextMid?: () => string;
  timeoutMs?: number;
}

export class LwpRpcClient {
  private socket: SocketLike | null = null;
  private sequence = 0;
  private readonly pending = new Map<string, { resolve(frame: ParsedLwpFrame): void; reject(error: Error): void; timer: number }>();

  constructor(private readonly options: LwpRpcClientOptions = {}) {}

  connect(): Promise<void> {
    const socket = this.options.socketFactory?.() || new WebSocket(LWP_ENDPOINT);
    this.socket = socket;
    socket.addEventListener("message", this.handleMessage);
    return new Promise((resolve, reject) => {
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error("lwp_socket_open_failed"));
      };
      const cleanup = () => {
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleError);
      };
      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleError);
    });
  }

  request(route: string, body: unknown): Promise<ParsedLwpFrame> {
    const mid = this.nextMid();
    const frame = JSON.stringify({ lwp: route, headers: { mid }, body });
    return this.requestFrame(frame);
  }

  requestFrame(frameText: string): Promise<ParsedLwpFrame> {
    const socket = this.requireOpenSocket();
    const parsed = parseLwpFrame(frameText);
    if (!parsed.mid) throw new Error("lwp_request_mid_missing");
    const mid = parsed.mid;
    const timeoutMs = this.options.timeoutMs || 15_000;
    const timeoutRoute = parsed.route || "unknown";
    return new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.pending.delete(mid);
        reject(new Error(`lwp_request_timeout:${timeoutRoute}`));
      }, timeoutMs) as unknown as number;
      this.pending.set(mid, { resolve, reject, timer });
      socket.send(frameText);
    });
  }

  heartbeat(): void {
    this.requireOpenSocket().send(buildHeartbeatFrame(this.nextMid()));
  }

  close(): void {
    for (const [mid, pending] of this.pending) {
      globalThis.clearTimeout(pending.timer);
      pending.reject(new Error("lwp_socket_closed"));
      this.pending.delete(mid);
    }
    this.socket?.close();
    this.socket = null;
  }

  private readonly handleMessage = (event: Event | MessageEvent): void => {
    const data = "data" in event && typeof event.data === "string" ? event.data : "";
    if (!data) return;
    const frame = parseLwpFrame(data);
    if (frame.route?.startsWith("/s/")) {
      this.socket?.send(JSON.stringify({ code: 200, headers: frame.headers }));
    }
    if (!frame.mid) return;
    const pending = this.pending.get(frame.mid);
    if (!pending) return;
    globalThis.clearTimeout(pending.timer);
    this.pending.delete(frame.mid);
    pending.resolve(frame);
  };

  private requireOpenSocket(): SocketLike {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) {
      throw new Error("lwp_socket_not_open");
    }
    return this.socket;
  }

  private nextMid(): string {
    if (this.options.nextMid) return this.options.nextMid();
    this.sequence += 1;
    return `${Math.floor(Math.random() * 1000)}${Date.now()} ${this.sequence - 1}`;
  }
}
