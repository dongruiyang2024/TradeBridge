import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCollectorWsMessage, parseCollectorWsMessage } from "@wangwang/collector-protocol";
import { InMemorySyncStore } from "@wangwang/database";
import { hashPassword } from "../src/auth.js";
import { createServer } from "../src/server.js";

test("collector websocket accepts hello with registered device token", async () => {
  const store = new InMemorySyncStore();
  await store.registerCollectorDevice({
    sellerAccountExternalId: "seller-1",
    externalDeviceId: "device-1",
    deviceName: "Chrome Extension",
    token: "device-token"
  });
  const app = await createServer({ store });
  await app.ready();

  const ws = await app.injectWS("/collector/v1/ws");
  const ready = nextMessage(ws);
  const closed = nextClose(ws);
  ws.send(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "client-1",
        type: "collector.hello",
        sentAt: "2026-06-01T00:00:00.000Z",
        payload: {
          collectorToken: "device-token",
          deviceId: "device-1",
          deviceName: "Chrome Extension",
          capabilities: ["outbound.claim", "delivery.report"]
        }
      })
    )
  );

  const message = parseCollectorWsMessage(await ready);
  assert.equal(message.type, "collector.ready");
  assert.equal(message.payload.sellerAccountExternalId, "seller-1");
  closeWs(ws);
  await closed;
  await app.close();
});

test("collector websocket receives outbound availability and reports delivery", async () => {
  const store = new InMemorySyncStore();
  await store.createInternalUser({
    email: "admin@example.com",
    displayName: "Admin User",
    passwordHash: await hashPassword("secret"),
    roles: ["admin"]
  });
  await store.registerCollectorDevice({
    sellerAccountExternalId: "seller-1",
    externalDeviceId: "device-1",
    deviceName: "Chrome Extension",
    token: "device-token"
  });
  const app = await createServer({ store });
  await app.ready();
  await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: "Bearer device-token" },
    payload: {
      sellerAccount: { externalAccountId: "seller-1" },
      device: { deviceId: "device-1" },
      customers: [{ externalCustomerId: "customer-1" }],
      conversations: [{ externalConversationId: "conv-1", externalCustomerId: "customer-1" }]
    }
  });

  const ws = await app.injectWS("/collector/v1/ws");
  const ready = nextMessage(ws);
  const closed = nextClose(ws);
  ws.send(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "hello-1",
        type: "collector.hello",
        sentAt: "2026-06-01T00:00:00.000Z",
        payload: { collectorToken: "device-token", deviceId: "device-1", capabilities: ["outbound.claim"] }
      })
    )
  );
  assert.equal(parseCollectorWsMessage(await withTimeout(ready)).type, "collector.ready");

  const authHeaders = await createInternalAuthHeaders(app);
  const available = nextMessage(ws);
  await app.inject({
    method: "POST",
    url: "/internal/v1/conversations/conv-1/outbound-messages?sellerAccountExternalId=seller-1",
    headers: authHeaders,
    payload: { content: "Hello from web" }
  });
  assert.equal(parseCollectorWsMessage(await withTimeout(available)).type, "outbound.available");

  const claimed = nextMessage(ws);
  ws.send(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "claim-1",
        type: "outbound.claim",
        sentAt: "2026-06-01T00:00:01.000Z",
        payload: { limit: 10, leaseMs: 120000 }
      })
    )
  );
  const claimedMessage = parseCollectorWsMessage(await withTimeout(claimed));
  assert.equal(claimedMessage.type, "outbound.claimed");
  assert.equal(claimedMessage.payload.messages.length, 1);

  const ack = nextMessage(ws);
  ws.send(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "delivery-1",
        type: "outbound.delivery.report",
        sentAt: "2026-06-01T00:00:02.000Z",
        payload: {
          outboundMessageId: claimedMessage.payload.messages[0].id,
          status: "sent",
          externalMessageId: "onetalk-msg-1",
          deliveredAt: "2026-06-01T00:00:02.000Z"
        }
      })
    )
  );
  assert.equal(parseCollectorWsMessage(await withTimeout(ack)).type, "ack");

  closeWs(ws);
  await closed;
  await app.close();
});

test("collector websocket claims only declared channel account outbound messages", async () => {
  const store = new InMemorySyncStore();
  await store.registerCollectorDevice({
    sellerAccountExternalId: "seller-1",
    externalDeviceId: "device-1",
    deviceName: "Chrome Extension",
    token: "device-token"
  });
  await store.acceptSyncBatch(channelBatch("wa-account-1", "customer-1", "conv-1"));
  await store.acceptSyncBatch(channelBatch("wa-account-2", "customer-2", "conv-2"));
  const matching = await store.createOutboundMessage({
    sellerAccountExternalId: "seller-1",
    channel: "whatsapp-web",
    channelAccountExternalId: "wa-account-1",
    externalCustomerId: "customer-1",
    externalConversationId: "conv-1",
    content: "message for account 1"
  });
  await store.createOutboundMessage({
    sellerAccountExternalId: "seller-1",
    channel: "whatsapp-web",
    channelAccountExternalId: "wa-account-2",
    externalCustomerId: "customer-2",
    externalConversationId: "conv-2",
    content: "message for account 2"
  });
  const app = await createServer({ store });
  await app.ready();

  const ws = await app.injectWS("/collector/v1/ws");
  const ready = nextMessage(ws);
  const closed = nextClose(ws);
  ws.send(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "hello-1",
        type: "collector.hello",
        sentAt: "2026-06-01T00:00:00.000Z",
        payload: {
          collectorToken: "device-token",
          deviceId: "device-1",
          capabilities: ["outbound.claim", "channel:whatsapp-web"],
          channelAccounts: [{ channel: "whatsapp-web", externalAccountId: "wa-account-1" }]
        }
      })
    )
  );
  assert.equal(parseCollectorWsMessage(await withTimeout(ready)).type, "collector.ready");

  const claimed = nextMessage(ws);
  ws.send(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "claim-1",
        type: "outbound.claim",
        sentAt: "2026-06-01T00:00:01.000Z",
        payload: { limit: 10, leaseMs: 120000, channel: "whatsapp-web" }
      })
    )
  );
  const claimedMessage = parseCollectorWsMessage(await withTimeout(claimed));

  assert.equal(claimedMessage.type, "outbound.claimed");
  assert.deepEqual(
    claimedMessage.payload.messages.map((message) => message.id),
    [matching.id]
  );
  closeWs(ws);
  await closed;
  await app.close();
});

test("collector websocket closes when hello token is invalid", async () => {
  const app = await createServer({ store: new InMemorySyncStore() });
  await app.ready();

  const ws = await app.injectWS("/collector/v1/ws");
  const closed = new Promise<{ code: number }>((resolve) => {
    ws.on("close", (code) => resolve({ code }));
  });
  ws.send(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "client-1",
        type: "collector.hello",
        sentAt: "2026-06-01T00:00:00.000Z",
        payload: {
          collectorToken: "bad-token",
          deviceId: "device-1",
          capabilities: []
        }
      })
    )
  );

  assert.equal((await closed).code, 1008);
  await app.close();
});

function channelBatch(channelAccountExternalId: string, externalCustomerId: string, externalConversationId: string) {
  return {
    channel: "whatsapp-web",
    channelAccount: {
      channel: "whatsapp-web",
      externalAccountId: channelAccountExternalId,
      surface: "whatsapp-web"
    },
    sellerAccount: { externalAccountId: "seller-1" },
    device: { deviceId: "device-1" },
    customers: [{ externalCustomerId }],
    conversations: [{ externalConversationId, externalCustomerId }]
  };
}

async function createInternalAuthHeaders(app: Awaited<ReturnType<typeof createServer>>) {
  const loginResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/auth/login",
    payload: { email: "admin@example.com", password: "secret" }
  });
  assert.equal(loginResponse.statusCode, 200);
  return { authorization: `Bearer ${loginResponse.json().token}` };
}

function nextMessage(ws: { once(event: "message", listener: (data: Buffer) => void): void }): Promise<string> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(data.toString()));
  });
}

function nextClose(ws: { once(event: "close", listener: () => void): void }): Promise<void> {
  return new Promise((resolve) => {
    ws.once("close", () => resolve());
  });
}

function closeWs(ws: { close(): void; terminate?: () => void }): void {
  if (ws.terminate) ws.terminate();
  else ws.close();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = 500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error("websocket_test_timeout")), timeoutMs);
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
