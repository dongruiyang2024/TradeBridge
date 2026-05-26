import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore } from "@wangwang/database";
import { createServer } from "../src/server.js";

const customerPath = "/internal/v1/customers/customer-1";
const customerQuery = "orgId=org_internal&sellerAccountExternalId=seller-1";

async function createSeededApp() {
  const app = await createServer({
    store: new InMemorySyncStore(),
    deviceTokens: ["device-token"],
    internalTokens: ["internal-token"]
  });

  await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: "Bearer device-token" },
    payload: {
      orgId: "org_internal",
      sellerAccount: { externalAccountId: "seller-1" },
      device: { deviceId: "device-1" },
      customers: [{ externalCustomerId: "customer-1", displayName: "Buyer One" }],
      conversations: [{ externalConversationId: "conv-1", externalCustomerId: "customer-1" }]
    }
  });

  return app;
}

test("POST and GET customer notes require an internal token and scoped customer query", async () => {
  const app = await createSeededApp();
  const createResponse = await app.inject({
    method: "POST",
    url: `${customerPath}/notes?${customerQuery}`,
    headers: { authorization: "Bearer internal-token" },
    payload: { body: "Customer asked for updated MOQ." }
  });
  const listResponse = await app.inject({
    method: "GET",
    url: `${customerPath}/notes?${customerQuery}`,
    headers: { authorization: "Bearer internal-token" }
  });

  assert.equal(createResponse.statusCode, 200);
  assert.equal(createResponse.json().ok, true);
  assert.equal(createResponse.json().note.body, "Customer asked for updated MOQ.");
  assert.equal(listResponse.statusCode, 200);
  assert.deepEqual(listResponse.json().notes, [createResponse.json().note]);
});

test("POST and GET customer tags are idempotent within a customer scope", async () => {
  const app = await createSeededApp();
  const createResponse = await app.inject({
    method: "POST",
    url: `${customerPath}/tags?${customerQuery}`,
    headers: { authorization: "Bearer internal-token" },
    payload: { tag: "hot-lead" }
  });
  const duplicateResponse = await app.inject({
    method: "POST",
    url: `${customerPath}/tags?${customerQuery}`,
    headers: { authorization: "Bearer internal-token" },
    payload: { tag: "hot-lead" }
  });
  const listResponse = await app.inject({
    method: "GET",
    url: `${customerPath}/tags?${customerQuery}`,
    headers: { authorization: "Bearer internal-token" }
  });

  assert.equal(createResponse.statusCode, 200);
  assert.equal(duplicateResponse.statusCode, 200);
  assert.equal(createResponse.json().tag.id, duplicateResponse.json().tag.id);
  assert.deepEqual(listResponse.json().tags, [createResponse.json().tag]);
});

test("POST and GET follow-up tasks return open tasks by default", async () => {
  const app = await createSeededApp();
  const createResponse = await app.inject({
    method: "POST",
    url: `${customerPath}/follow-up-tasks?${customerQuery}`,
    headers: { authorization: "Bearer internal-token" },
    payload: {
      title: "Send revised quotation",
      assignedToUserId: "user-1",
      dueAt: "2026-05-26T09:00:00.000Z"
    }
  });
  const listResponse = await app.inject({
    method: "GET",
    url: `${customerPath}/follow-up-tasks?${customerQuery}`,
    headers: { authorization: "Bearer internal-token" }
  });

  assert.equal(createResponse.statusCode, 200);
  assert.equal(createResponse.json().task.status, "open");
  assert.equal(createResponse.json().task.title, "Send revised quotation");
  assert.deepEqual(listResponse.json().tasks, [createResponse.json().task]);
});

test("customer collaboration routes reject collector device tokens", async () => {
  const app = await createSeededApp();
  const response = await app.inject({
    method: "GET",
    url: `${customerPath}/notes?${customerQuery}`,
    headers: { authorization: "Bearer device-token" }
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false, error: "internal_unauthorized" });
});

test("customer collaboration routes require seller account scope", async () => {
  const app = await createSeededApp();
  const response = await app.inject({
    method: "GET",
    url: `${customerPath}/notes?orgId=org_internal`,
    headers: { authorization: "Bearer internal-token" }
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { ok: false, error: "customer_scope_required" });
});
