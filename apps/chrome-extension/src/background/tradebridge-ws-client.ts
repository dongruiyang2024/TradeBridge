import {
  buildCollectorWsMessage,
  parseCollectorWsMessage,
  serializeCollectorWsMessage,
  type CollectorReadyMessage,
  type CollectorWsMessage,
  type CollectorWsMessageInput
} from "@wangwang/collector-protocol";
import type { ExtensionConfig } from "../shared/sync-types.js";

const SOCKET_OPEN = 1;
const KEEPALIVE_MS = 20_000;

export interface BrowserWebSocketLike {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export interface TradeBridgeWsClientOptions {
  socketFactory?: (url: string) => BrowserWebSocketLike;
  now?: () => Date;
  nextId?: () => string;
  setInterval?: (handler: () => void, timeoutMs: number) => unknown;
  clearInterval?: (timerId: unknown) => void;
  onMessage?: (message: CollectorWsMessage) => void | Promise<void>;
  onStateChange?: (state: TradeBridgeWsState) => void | Promise<void>;
}

export type TradeBridgeWsState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected"; sessionId: string }
  | { kind: "closed"; reason?: string }
  | { kind: "error"; error: string };

export class TradeBridgeWsClient {
  state: TradeBridgeWsState = { kind: "idle" };
  private socket: BrowserWebSocketLike | null = null;
  private keepaliveId: unknown = null;

  constructor(private readonly options: TradeBridgeWsClientOptions = {}) {}

  connect(config: ExtensionConfig): Promise<CollectorReadyMessage["payload"]> {
    this.close();
    this.setState({ kind: "connecting" });
    const socket =
      this.options.socketFactory?.(tradebridgeWsUrl(config.serverUrl)) ||
      (new WebSocket(tradebridgeWsUrl(config.serverUrl)) as BrowserWebSocketLike);
    this.socket = socket;

    return new Promise((resolve, reject) => {
      let resolved = false;

      socket.onopen = () => {
        this.send({
          id: this.nextId(),
          type: "collector.hello",
          sentAt: this.now().toISOString(),
          payload: {
            collectorToken: config.collectorToken,
            deviceId: config.deviceId,
            deviceName: config.deviceName,
            capabilities: [
              "outbound.claim",
              "delivery.report",
              "collector.status",
              "channel:alibaba-im",
              "channel:whatsapp-web"
            ],
            channelAccounts: [
              {
                channel: "alibaba-im",
                externalAccountId: config.channelAccountExternalId || config.sellerAccountExternalId,
                surface: "onetalk-web"
              },
              {
                channel: "whatsapp-web",
                externalAccountId:
                  config.whatsappChannelAccountExternalId ||
                  config.channelAccountExternalId ||
                  config.sellerAccountExternalId,
                surface: "whatsapp-web"
              }
            ]
          }
        });
        this.startKeepalive();
      };

      socket.onmessage = (event) => {
        try {
          const message = parseCollectorWsMessage(event.data);
          if (message.type === "collector.ready") {
            resolved = true;
            this.setState({ kind: "connected", sessionId: message.payload.sessionId });
            resolve(message.payload);
            return;
          }
          void this.options.onMessage?.(message);
        } catch (error) {
          const message = error instanceof Error ? error.message : "collector_ws_parse_failed";
          this.setState({ kind: "error", error: message });
          if (!resolved) reject(error);
        }
      };

      socket.onerror = () => {
        this.setState({ kind: "error", error: "collector_ws_socket_error" });
        if (!resolved) reject(new Error("collector_ws_socket_error"));
      };

      socket.onclose = () => {
        this.stopKeepalive();
        this.setState({ kind: "closed" });
        if (!resolved) reject(new Error("collector_ws_closed"));
      };
    });
  }

  send(message: CollectorWsMessageInput): void {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) throw new Error("collector_ws_not_connected");
    this.socket.send(serializeCollectorWsMessage(buildCollectorWsMessage(message)));
  }

  close(): void {
    this.stopKeepalive();
    this.socket?.close();
    this.socket = null;
  }

  private startKeepalive(): void {
    const setIntervalFn = this.options.setInterval || globalThis.setInterval;
    this.keepaliveId = setIntervalFn(() => {
      if (!this.socket || this.socket.readyState !== SOCKET_OPEN) return;
      this.send({
        id: this.nextId(),
        type: "heartbeat.pong",
        sentAt: this.now().toISOString(),
        payload: { nonce: this.nextId(), status: "alive" }
      });
    }, KEEPALIVE_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveId == null) return;
    if (this.options.clearInterval) this.options.clearInterval(this.keepaliveId);
    else globalThis.clearInterval(this.keepaliveId as ReturnType<typeof globalThis.setInterval>);
    this.keepaliveId = null;
  }

  private setState(state: TradeBridgeWsState): void {
    this.state = state;
    void this.options.onStateChange?.(state);
  }

  private now(): Date {
    return this.options.now?.() || new Date();
  }

  private nextId(): string {
    return this.options.nextId?.() || crypto.randomUUID();
  }
}

export function tradebridgeWsUrl(serverUrl: string): string {
  const url = new URL("/collector/v1/ws", serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
