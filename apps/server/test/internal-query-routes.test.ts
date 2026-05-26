import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore } from "@wangwang/database";
import { hashPassword } from "../src/auth.js";
import { createServer } from "../src/server.js";

const syncPayload = {
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
    url: "/internal/v1/customers",
    headers: await createInternalAuthHeaders(app)
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.deepEqual(response.json().customers, [
    {
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
    url: "/internal/v1/conversations",
    headers: await createInternalAuthHeaders(app)
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.deepEqual(response.json().conversations, [
    {
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
    url: "/internal/v1/conversations/conv-1/messages",
    headers: await createInternalAuthHeaders(app)
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().messages.length, 1);
  assert.equal(response.json().messages[0].externalConversationId, "conv-1");
  assert.equal(response.json().messages[0].externalMessageId, "msg-1");
  assert.equal(response.json().messages[0].content, "hello");
});

test("collector device tokens cannot read internal query APIs", async () => {
  const app = await createSeededApp();
  const response = await app.inject({
    method: "GET",
    url: "/internal/v1/customers",
    headers: { authorization: "Bearer device-token" }
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false, error: "internal_unauthorized" });
});

test("internal query APIs do not expose org fields", async () => {
  const app = await createSeededApp();
  const authHeaders = await createInternalAuthHeaders(app);

  const customersResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/customers",
    headers: authHeaders
  });
  const conversationsResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/conversations",
    headers: authHeaders
  });
  const messagesResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/conversations/conv-1/messages",
    headers: authHeaders
  });

  assert.equal(customersResponse.statusCode, 200);
  assert.equal(Object.hasOwn(customersResponse.json().customers[0], "orgId"), false);
  assert.equal(conversationsResponse.statusCode, 200);
  assert.equal(Object.hasOwn(conversationsResponse.json().conversations[0], "orgId"), false);
  assert.equal(messagesResponse.statusCode, 200);
  assert.equal(Object.hasOwn(messagesResponse.json().messages[0], "orgId"), false);
});
