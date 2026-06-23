import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCollectorWsMessage, parseCollectorWsMessage } from "@wangwang/collector-protocol";
import { TradeBridgeWsClient, tradebridgeWsUrl } from "../src/background/tradebridge-ws-client.js";

test("tradebridgeWsUrl maps http and https server urls to ws urls", () => {
  assert.equal(tradebridgeWsUrl("http://127.0.0.1:5032"), "ws://127.0.0.1:5032/collector/v1/ws");
  assert.equal(tradebridgeWsUrl("https://example.com/base"), "wss://example.com/collector/v1/ws");
});

test("TradeBridgeWsClient sends hello and handles ready", async () => {
  const sockets: FakeWebSocket[] = [];
  const client = new TradeBridgeWsClient({
    socketFactory: (url) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
    now: () => new Date("2026-06-01T00:00:00.000Z"),
    nextId: () => "client-msg-1",
    setInterval: () => 1,
    clearInterval: () => undefined
  });

  const ready = client.connect({
    serverUrl: "http://127.0.0.1:5032",
    collectorToken: "collector-token",
    sellerAccountExternalId: "seller-1",
    channelAccountExternalId: "onetalk-account",
    whatsappChannelAccountExternalId: "wa-account",
    deviceId: "device-1",
    deviceName: "Chrome Extension"
  });
  sockets[0].open();
  const hello = parseCollectorWsMessage(sockets[0].sent[0]);
  assert.equal(hello.type, "collector.hello");
  assert.equal(hello.payload.collectorToken, "collector-token");
  assert.deepEqual(hello.payload.channelAccounts, [
    {
      channel: "alibaba-im",
      externalAccountId: "onetalk-account",
      surface: "onetalk-web"
    },
    {
      channel: "whatsapp-web",
      externalAccountId: "wa-account",
      surface: "whatsapp-web"
    }
  ]);

  sockets[0].message(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "server-1",
        type: "collector.ready",
        sentAt: "2026-06-01T00:00:00.000Z",
        payload: {
          sessionId: "session-1",
          sellerAccountExternalId: "seller-1",
          deviceId: "device-1",
          heartbeatIntervalMs: 20000,
          serverTime: "2026-06-01T00:00:00.000Z"
        }
      })
    )
  );

  assert.equal((await ready).sessionId, "session-1");
  assert.equal(client.state.kind, "connected");
});

test("TradeBridgeWsClient rejects connect when socket closes before ready", async () => {
  const sockets: FakeWebSocket[] = [];
  const client = new TradeBridgeWsClient({
    socketFactory: (url) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
    setInterval: () => 1,
    clearInterval: () => undefined
  });

  const ready = client.connect({
    serverUrl: "http://127.0.0.1:5032",
    collectorToken: "collector-token",
    sellerAccountExternalId: "seller-1",
    deviceId: "device-1"
  });
  sockets[0].open();
  sockets[0].close();

  await assert.rejects(ready, /collector_ws_closed/);
  assert.equal(client.state.kind, "closed");
});

class FakeWebSocket {
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  message(data: string) {
    this.onmessage?.({ data });
  }
}
