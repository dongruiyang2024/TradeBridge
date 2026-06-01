import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore } from "@wangwang/database";
import { createRealtimeOrchestrator } from "../../apps/chrome-extension/src/background/realtime-orchestrator.js";
import {
  TradeBridgeWsClient,
  type BrowserWebSocketLike
} from "../../apps/chrome-extension/src/background/tradebridge-ws-client.js";
import type { OutboundMessage } from "../../apps/chrome-extension/src/shared/sync-types.js";
import { hashPassword } from "../../apps/server/src/auth.js";
import { createServer } from "../../apps/server/src/server.js";

const SELLER_ACCOUNT_ID = "seller-ws-e2e";
const CUSTOMER_ID = "customer-ws-e2e";
const CONVERSATION_ID = "conv-ws-e2e";
const DEVICE_ID = "chrome-extension-e2e";

test("collector websocket drives realtime outbound delivery from web to OneTalk", async () => {
  const store = new InMemorySyncStore();
  await store.createInternalUser({
    email: "ws-admin@example.com",
    displayName: "WS Admin",
    passwordHash: await hashPassword("secret"),
    roles: ["admin"]
  });
  const app = await createServer({ store });
  await app.ready();

  let client: TradeBridgeWsClient | null = null;
  try {
    const activation = await activateCollector(app);
    await uploadConversationFixture(app, activation.token);

    const injected = await app.injectWS("/collector/v1/ws");
    const socket = new InjectedBrowserWebSocket(injected);
    const deliveredMessages: OutboundMessage[] = [];
    let nextId = 0;

    const orchestrator = createRealtimeOrchestrator({
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      nextId: () => `client-msg-${++nextId}`,
      sendWsMessage: (message) => {
        if (!client) throw new Error("collector_ws_not_connected");
        client.send(message);
      },
      sendOutboundMessagesViaOneTalk: async ({ messages }) => {
        deliveredMessages.push(...messages);
        return messages.map((message) => ({
          outboundMessageId: message.id,
          status: "sent",
          externalMessageId: `onetalk-${message.id}`
        }));
      },
      runSyncNow: async () => ({ ok: true, acceptedCount: 0, rejectedCount: 0 })
    });

    client = new TradeBridgeWsClient({
      socketFactory: () => socket,
      onMessage: (message) => orchestrator.handleMessage(message),
      setInterval: () => 1,
      clearInterval: () => undefined
    });

    const ready = await withTimeout(
      client.connect({
        serverUrl: "http://tradebridge.internal",
        collectorToken: activation.token,
        sellerAccountExternalId: SELLER_ACCOUNT_ID,
        deviceId: DEVICE_ID,
        deviceName: "Chrome Extension E2E"
      })
    );
    assert.equal(ready.sellerAccountExternalId, SELLER_ACCOUNT_ID);

    const internalHeaders = await createInternalAuthHeaders(app);
    const outboundResponse = await app.inject({
      method: "POST",
      url: `/internal/v1/conversations/${CONVERSATION_ID}/outbound-messages?sellerAccountExternalId=${SELLER_ACCOUNT_ID}`,
      headers: internalHeaders,
      payload: { content: "Hello from web over WS" }
    });
    assert.equal(outboundResponse.statusCode, 200);
    const outboundId = outboundResponse.json().message.id as string;

    await waitFor(async () => {
      const messages = await store.listOutboundMessages({
        sellerAccountExternalId: SELLER_ACCOUNT_ID,
        externalConversationId: CONVERSATION_ID
      });
      return messages.some(
        (message) =>
          message.id === outboundId &&
          message.status === "sent" &&
          message.externalMessageId === `onetalk-${outboundId}` &&
          message.deliveredByDeviceId === DEVICE_ID
      );
    });

    assert.deepEqual(deliveredMessages.map((message) => message.id), [outboundId]);
  } finally {
    client?.close();
    await app.close();
  }
});

async function activateCollector(app: Awaited<ReturnType<typeof createServer>>) {
  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/auth/login",
    payload: {
      email: "ws-admin@example.com",
      password: "secret",
      sellerAccountExternalId: SELLER_ACCOUNT_ID,
      deviceExternalId: DEVICE_ID,
      deviceName: "Chrome Extension E2E"
    }
  });
  assert.equal(response.statusCode, 200);
  return response.json() as { token: string };
}

async function uploadConversationFixture(app: Awaited<ReturnType<typeof createServer>>, collectorToken: string) {
  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: `Bearer ${collectorToken}` },
    payload: {
      sellerAccount: { externalAccountId: SELLER_ACCOUNT_ID },
      device: { deviceId: DEVICE_ID },
      customers: [{ externalCustomerId: CUSTOMER_ID }],
      conversations: [{ externalConversationId: CONVERSATION_ID, externalCustomerId: CUSTOMER_ID }]
    }
  });
  assert.equal(response.statusCode, 200);
}

async function createInternalAuthHeaders(app: Awaited<ReturnType<typeof createServer>>) {
  const loginResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/auth/login",
    payload: { email: "ws-admin@example.com", password: "secret" }
  });
  assert.equal(loginResponse.statusCode, 200);
  return { authorization: `Bearer ${loginResponse.json().token}` };
}

class InjectedBrowserWebSocket implements BrowserWebSocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(private readonly ws: InjectedWebSocket) {
    this.ws.on("message", (data) => {
      this.onmessage?.({ data: data.toString() });
    });
    this.ws.on("close", () => {
      this.readyState = 3;
      this.onclose?.();
    });
    this.ws.on("error", () => {
      this.onerror?.();
    });
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(data: string): void {
    this.ws.send(data);
  }

  close(): void {
    this.readyState = 3;
    if (this.ws.terminate) this.ws.terminate();
    else this.ws.close();
  }
}

interface InjectedWebSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  terminate?: () => void;
  on(event: "message", listener: (data: Buffer) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: () => void): void;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = 1_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error("e2e_timeout")), timeoutMs);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
  }
  throw new Error("e2e_wait_timeout");
}
