import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore } from "@wangwang/database";
import { hashPassword } from "../src/auth.js";
import { createServer } from "../src/server.js";

const syncPayload = {
  orgId: "org_internal",
  sellerAccount: { externalAccountId: "seller-1", displayName: "Seller One" },
  device: { deviceId: "device-1", deviceName: "MacBook" },
  customers: [
    {
      externalCustomerId: "customer-1",
      loginId: "buyer_login",
      displayName: "Buyer One",
      country: "US",
      stage: "qualified"
    }
  ],
  conversations: [
    {
      externalConversationId: "conv-1",
      externalCustomerId: "customer-1",
      lastMessageAt: "2026-05-25T09:30:00.000Z"
    }
  ],
  messages: [
    {
      externalConversationId: "conv-1",
      externalMessageId: "msg-1",
      direction: "received",
      messageType: "text",
      content: "hello",
      sentAt: "2026-05-25T09:00:00.000Z",
      rawSanitized: { messageId: "msg-1" }
    }
  ]
};

async function createSeededApp() {
  const store = new InMemorySyncStore();
  await store.createInternalUser({
    orgId: "org_internal",
    email: "admin@example.com",
    displayName: "Admin User",
    passwordHash: await hashPassword("secret"),
    roles: ["admin"]
  });
  const app = await createServer({
    store,
    deviceTokens: ["device-token"]
  });

  await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: "Bearer device-token" },
    payload: syncPayload
  });

  return app;
}

async function createInternalAuthHeaders(app: Awaited<ReturnType<typeof createServer>>) {
  const loginResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/auth/login",
    payload: {
      orgId: "org_internal",
      email: "admin@example.com",
      password: "secret"
    }
  });
  assert.equal(loginResponse.statusCode, 200);
  return { authorization: `Bearer ${loginResponse.json().token}` };
}

test("GET /internal/v1/customers returns customers for an authorized internal token", async () => {
  const app = await createSeededApp();
  const response = await app.inject({
    method: "GET",
    url: "/internal/v1/customers?orgId=org_internal",
    headers: await createInternalAuthHeaders(app)
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.deepEqual(response.json().customers, [
    {
      orgId: "org_internal",
      sellerAccountExternalId: "seller-1",
      externalCustomerId: "customer-1",
      loginId: "buyer_login",
      displayName: "Buyer One",
      country: "US",
      stage: "qualified"
    }
  ]);
});

test("GET /internal/v1/conversations returns conversations for an authorized internal token", async () => {
  const app = await createSeededApp();
  const response = await app.inject({
    method: "GET",
    url: "/internal/v1/conversations?orgId=org_internal",
    headers: await createInternalAuthHeaders(app)
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.deepEqual(response.json().conversations, [
    {
      orgId: "org_internal",
      sellerAccountExternalId: "seller-1",
      externalConversationId: "conv-1",
      externalCustomerId: "customer-1",
      lastMessageAt: "2026-05-25T09:30:00.000Z"
    }
  ]);
});

test("GET /internal/v1/conversations/:id/messages returns conversation messages", async () => {
  const app = await createSeededApp();
  const response = await app.inject({
    method: "GET",
    url: "/internal/v1/conversations/conv-1/messages?orgId=org_internal",
    headers: await createInternalAuthHeaders(app)
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().messages.length, 1);
  assert.equal(response.json().messages[0].externalConversationId, "conv-1");
  assert.equal(response.json().messages[0].externalMessageId, "msg-1");
  assert.equal(response.json().messages[0].content, "hello");
});

test("internal query APIs reject orgId outside the authenticated user's org", async () => {
  const app = await createSeededApp();
  const authHeaders = await createInternalAuthHeaders(app);
  const requests = [
    { method: "GET", url: "/internal/v1/customers?orgId=org_other", headers: authHeaders },
    { method: "GET", url: "/internal/v1/conversations?orgId=org_other", headers: authHeaders },
    { method: "GET", url: "/internal/v1/conversations/conv-1/messages?orgId=org_other", headers: authHeaders }
  ] as const;

  for (const request of requests) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { ok: false, error: "forbidden" });
  }
});

test("collector device tokens cannot read internal query APIs", async () => {
  const app = await createSeededApp();
  const response = await app.inject({
    method: "GET",
    url: "/internal/v1/customers?orgId=org_internal",
    headers: { authorization: "Bearer device-token" }
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false, error: "internal_unauthorized" });
});

test("internal query APIs require orgId", async () => {
  const app = await createSeededApp();
  const response = await app.inject({
    method: "GET",
    url: "/internal/v1/customers",
    headers: await createInternalAuthHeaders(app)
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { ok: false, error: "org_id_required" });
});
