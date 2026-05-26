import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore } from "@wangwang/database";
import { createServer } from "../src/server.js";

test("POST /collector/v1/sync-batches requires a registered device token", async () => {
  const app = await createServer({ store: new InMemorySyncStore(), deviceTokens: ["device-token"] });
  const response = await app.inject({ method: "POST", url: "/collector/v1/sync-batches", payload: {} });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false, error: "unauthorized" });
});

test("POST /collector/v1/sync-batches accepts a valid batch", async () => {
  const store = new InMemorySyncStore();
  const app = await createServer({ store, deviceTokens: ["device-token"] });
  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: "Bearer device-token" },
    payload: {
      orgId: "org_internal",
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
  assert.equal(store.listMessages("org_internal").length, 1);
});

test("POST /collector/v1/sync-batches rejects invalid batch shapes before writing", async () => {
  const store = new InMemorySyncStore();
  const app = await createServer({ store, deviceTokens: ["device-token"] });
  const invalidPayloads = [
    { sellerAccount: { externalAccountId: "seller-1" }, device: { deviceId: "device-1" } },
    { orgId: "org_internal", sellerAccount: {}, device: { deviceId: "device-1" } },
    { orgId: "org_internal", sellerAccount: { externalAccountId: "seller-1" }, device: {} },
    {
      orgId: "org_internal",
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
      headers: { authorization: "Bearer device-token" },
      payload
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { ok: false, error: "invalid_sync_batch" });
  }

  assert.equal(store.listMessages("org_internal").length, 0);
});

test("POST /collector/v1/sync-batches returns idempotent counts for duplicate messages", async () => {
  const store = new InMemorySyncStore();
  const app = await createServer({ store, deviceTokens: ["device-token"] });
  const payload = {
    orgId: "org_internal",
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
    headers: { authorization: "Bearer device-token" },
    payload
  });
  const duplicate = await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: "Bearer device-token" },
    payload
  });

  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json().acceptedCount, 0);
  assert.equal(duplicate.json().rejectedCount, 1);
  assert.equal(store.listMessages("org_internal").length, 1);
});

test("GET /health returns internal server status", async () => {
  const app = await createServer({ store: new InMemorySyncStore(), deviceTokens: [] });
  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().service, "wangwang-internal-server");
});
