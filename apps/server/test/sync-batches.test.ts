import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { InMemorySyncStore } from "@wangwang/database";
import { createServer } from "../src/server.js";

async function createCollectorToken(store: InMemorySyncStore, externalDeviceId = "device-1"): Promise<string> {
  const registered = await store.registerCollectorDevice({
    sellerAccountExternalId: "seller-1",
    externalDeviceId,
    deviceName: "Test Device",
    token: "device-token"
  });
  return registered.token;
}

test("POST /collector/v1/sync-batches requires a registered device token", async () => {
  const app = await createServer({ store: new InMemorySyncStore() });
  const response = await app.inject({ method: "POST", url: "/collector/v1/sync-batches", payload: {} });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false, error: "unauthorized" });
});

test("POST /collector/v1/sync-batches accepts a valid batch", async () => {
  const store = new InMemorySyncStore();
  const token = await createCollectorToken(store);
  const app = await createServer({ store });
  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      sellerAccount: { externalAccountId: "seller-1" },
      device: { deviceId: "device-1" },
      conversations: [{ externalConversationId: "conv-1" }],
      messages: [
        {
          externalConversationId: "conv-1",
          externalMessageId: "msg-1",
          direction: "received",
          content: "hello",
          sentAt: "2026-05-25T09:00:00.000Z"
        }
      ]
    }
  });

  const body = response.json();
  assert.equal(response.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.acceptedCount, 1);
  assert.equal(body.rejectedCount, 0);
  assert.equal(body.nextCursor, "2026-05-25T09:00:00.000Z");
  assert.equal(store.listMessages().length, 1);
});

test("POST /collector/v1/sync-batches forwards scoped batches to Trade-Mind with signed binding token payloads", async () => {
  const store = new InMemorySyncStore();
  const registered = await store.registerCollectorDevice({
    sellerAccountExternalId: "self-ali-1",
    externalDeviceId: "device-token",
    deviceName: "Bound Device",
    token: "bound-token",
    tradeMindBindingToken: "tm-binding-token"
  });
  const forwardCalls: Array<{ body: string; headers: Record<string, string>; url: string }> = [];
  const app = await createServer({
    store,
    tradeMindForwarder: {
      fetch: async (url, init) => {
        forwardCalls.push({
          body: String(init?.body),
          headers: init?.headers as Record<string, string>,
          url: String(url)
        });
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      },
      ingestSecret: "shared-secret",
      ingestUrl: "http://trademind.local/api/ingest/conversations",
      nonce: () => "nonce-1",
      now: () => new Date("2026-06-10T08:00:00.000Z")
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: `Bearer ${registered.token}` },
    payload: {
      channel: "alibaba-im",
      channelAccount: {
        channel: "alibaba-im",
        externalAccountId: "self-login-1",
        surface: "onetalk-web"
      },
      sellerAccount: { externalAccountId: "forged-seller" },
      device: { deviceId: "forged-device", deviceName: "Forged Device" },
      conversations: [{ externalConversationId: "conv-1" }],
      messages: [
        {
          externalConversationId: "conv-1",
          externalMessageId: "msg-1",
          direction: "received",
          content: "hello",
          sentAt: "2026-06-10T07:59:00.000Z"
        }
      ],
      sourceMeta: { sourceBatchKey: "source-batch-1" }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(forwardCalls.length, 1);
  assert.equal(forwardCalls[0].url, "http://trademind.local/api/ingest/conversations");
  const forwarded = JSON.parse(forwardCalls[0].body);
  assert.equal(forwarded.bindingToken, "tm-binding-token");
  assert.equal(forwarded.channel, "alibaba-im");
  assert.equal(forwarded.channelAccount.externalAccountId, "self-login-1");
  assert.equal(forwarded.sellerAccount.externalAccountId, "self-ali-1");
  assert.equal(forwarded.device.deviceId, "device-token");
  assert.equal(typeof forwarded.sourceBatchId, "string");
  assert.match(forwarded.sourceBatchId, /^tb_[a-f0-9]{48}$/);
  assert.equal(forwardCalls[0].headers["Content-Type"], "application/json");
  assert.equal(forwardCalls[0].headers["x-trademind-ingest-secret"], "shared-secret");
  assert.equal(forwardCalls[0].headers["x-trademind-timestamp"], "1781078400");
  assert.equal(forwardCalls[0].headers["x-trademind-nonce"], "nonce-1");
  assert.equal(
    forwardCalls[0].headers["x-trademind-signature"],
    createHmac("sha256", "shared-secret")
      .update(`1781078400.nonce-1.${forwardCalls[0].body}`)
      .digest("hex")
  );
});

test("POST /collector/v1/sync-batches skips Trade-Mind forwarding for devices without binding tokens", async () => {
  const store = new InMemorySyncStore();
  const token = await createCollectorToken(store);
  let forwardCount = 0;
  const app = await createServer({
    store,
    tradeMindForwarder: {
      fetch: async () => {
        forwardCount += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      },
      ingestSecret: "shared-secret",
      ingestUrl: "http://trademind.local/api/ingest/conversations"
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      sellerAccount: { externalAccountId: "seller-1" },
      device: { deviceId: "device-1" },
      conversations: [{ externalConversationId: "conv-1" }]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(forwardCount, 0);
});

test("POST /collector/v1/sync-batches uses collector device scope over uploaded seller and device ids", async () => {
  const store = new InMemorySyncStore();
  const registered = await store.registerCollectorDevice({
    sellerAccountExternalId: "seller-token",
    externalDeviceId: "device-token",
    deviceName: "Bound Device",
    token: "bound-token"
  });
  const app = await createServer({ store });
  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: `Bearer ${registered.token}` },
    payload: {
      sellerAccount: { externalAccountId: "seller-forged" },
      device: { deviceId: "device-forged", deviceName: "Forged Device" },
      customers: [{ externalCustomerId: "customer-1", displayName: "Buyer One" }]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(store.listCustomers(), [
    {
      sellerAccountExternalId: "seller-token",
      externalCustomerId: "customer-1",
      displayName: "Buyer One"
    }
  ]);
  assert.deepEqual(await store.listCollectorDevices(), [
    {
      id: registered.id,
      externalDeviceId: "device-token",
      sellerAccountExternalId: "seller-token",
      deviceName: "Bound Device",
      status: "active",
      lastHeartbeatAt: undefined,
      createdAt: registered.createdAt,
      updatedAt: registered.updatedAt
    }
  ]);
});

test("POST /collector/v1/sync-batches rejects invalid batch shapes before writing", async () => {
  const store = new InMemorySyncStore();
  const token = await createCollectorToken(store);
  const app = await createServer({ store });
  const invalidPayloads = [
    { sellerAccount: {}, device: { deviceId: "device-1" } },
    { sellerAccount: { externalAccountId: "seller-1" }, device: {} },
    {
      sellerAccount: { externalAccountId: "seller-1" },
      device: { deviceId: "device-1" },
      conversations: [{ externalConversationId: "conv-1" }],
      messages: [{ externalConversationId: "conv-1", direction: "sideways", content: "bad" }]
    }
  ];

  for (const payload of invalidPayloads) {
    const response = await app.inject({
      method: "POST",
      url: "/collector/v1/sync-batches",
      headers: { authorization: `Bearer ${token}` },
      payload
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { ok: false, error: "invalid_sync_batch" });
  }

  assert.equal(store.listMessages().length, 0);
});

test("POST /collector/v1/sync-batches returns idempotent counts for duplicate messages", async () => {
  const store = new InMemorySyncStore();
  const token = await createCollectorToken(store);
  const app = await createServer({ store });
  const payload = {
    sellerAccount: { externalAccountId: "seller-1" },
    device: { deviceId: "device-1" },
    conversations: [{ externalConversationId: "conv-1" }],
    messages: [
      {
        externalConversationId: "conv-1",
        externalMessageId: "msg-1",
        direction: "received",
        content: "hello",
        sentAt: "2026-05-25T09:00:00.000Z"
      }
    ]
  };

  await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: `Bearer ${token}` },
    payload
  });
  const duplicate = await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: `Bearer ${token}` },
    payload
  });

  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json().acceptedCount, 0);
  assert.equal(duplicate.json().rejectedCount, 1);
  assert.equal(store.listMessages().length, 1);
});

test("collector devices can claim and mark outbound messages for their seller account", async () => {
  const store = new InMemorySyncStore();
  const token = await createCollectorToken(store);
  await store.acceptSyncBatch({
    sellerAccount: { externalAccountId: "seller-1" },
    device: { deviceId: "device-1" },
    customers: [{ externalCustomerId: "customer-1" }],
    conversations: [{ externalConversationId: "conv-1", externalCustomerId: "customer-1" }]
  });
  const queued = await store.createOutboundMessage({
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1",
    externalConversationId: "conv-1",
    content: "Hello from web"
  });
  const app = await createServer({ store });

  const listResponse = await app.inject({
    method: "GET",
    url: "/collector/v1/outbound-messages",
    headers: { authorization: `Bearer ${token}` }
  });

  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.json().ok, true);
  assert.equal(listResponse.json().messages.length, 1);
  assert.equal(listResponse.json().messages[0].id, queued.id);

  const deliveryResponse = await app.inject({
    method: "POST",
    url: `/collector/v1/outbound-messages/${queued.id}/delivery`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      status: "sent",
      externalMessageId: "onetalk-msg-1",
      deliveredAt: "2026-05-27T07:00:00.000Z"
    }
  });

  assert.equal(deliveryResponse.statusCode, 200);
  assert.equal(deliveryResponse.json().ok, true);
  assert.equal(deliveryResponse.json().message.status, "sent");
  assert.equal((await store.listPendingOutboundMessages({ sellerAccountExternalId: "seller-1", limit: 10 })).length, 0);
});

test("HTTP outbound polling skips messages actively claimed by websocket delivery", async () => {
  const store = new InMemorySyncStore();
  const token = await createCollectorToken(store);
  await store.acceptSyncBatch({
    sellerAccount: { externalAccountId: "seller-1" },
    device: { deviceId: "device-1" },
    customers: [{ externalCustomerId: "customer-1" }],
    conversations: [{ externalConversationId: "conv-1", externalCustomerId: "customer-1" }]
  });
  await store.createOutboundMessage({
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1",
    externalConversationId: "conv-1",
    content: "Hello from web"
  });
  const app = await createServer({ store });
  const claimed = await store.claimPendingOutboundMessages({
    sellerAccountExternalId: "seller-1",
    deviceId: "device-1",
    leaseMs: 120000,
    limit: 10
  });

  const listAfterClaim = await app.inject({
    method: "GET",
    url: "/collector/v1/outbound-messages",
    headers: { authorization: `Bearer ${token}` }
  });

  assert.equal(claimed.length, 1);
  assert.equal(listAfterClaim.statusCode, 200);
  assert.equal(listAfterClaim.json().messages.length, 0);
});

test("GET /health returns internal server status", async () => {
  const app = await createServer({ store: new InMemorySyncStore() });
  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().service, "wangwang-internal-server");
});
