import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore } from "@wangwang/database";
import { hashPassword } from "../src/auth.js";
import { createServer } from "../src/server.js";

const customerPath = "/internal/v1/customers/customer-1";
const customerQuery = "orgId=org_internal&sellerAccountExternalId=seller-1";

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

test("POST and GET customer notes require an internal token and scoped customer query", async () => {
  const app = await createSeededApp();
  const authHeaders = await createInternalAuthHeaders(app);
  const createResponse = await app.inject({
    method: "POST",
    url: `${customerPath}/notes?${customerQuery}`,
    headers: authHeaders,
    payload: { body: "Customer asked for updated MOQ." }
  });
  const listResponse = await app.inject({
    method: "GET",
    url: `${customerPath}/notes?${customerQuery}`,
    headers: authHeaders
  });

  assert.equal(createResponse.statusCode, 200);
  assert.equal(createResponse.json().ok, true);
  assert.equal(createResponse.json().note.body, "Customer asked for updated MOQ.");
  assert.equal(listResponse.statusCode, 200);
  assert.deepEqual(listResponse.json().notes, [createResponse.json().note]);
});

test("POST and GET customer tags are idempotent within a customer scope", async () => {
  const app = await createSeededApp();
  const authHeaders = await createInternalAuthHeaders(app);
  const createResponse = await app.inject({
    method: "POST",
    url: `${customerPath}/tags?${customerQuery}`,
    headers: authHeaders,
    payload: { tag: "hot-lead" }
  });
  const duplicateResponse = await app.inject({
    method: "POST",
    url: `${customerPath}/tags?${customerQuery}`,
    headers: authHeaders,
    payload: { tag: "hot-lead" }
  });
  const listResponse = await app.inject({
    method: "GET",
    url: `${customerPath}/tags?${customerQuery}`,
    headers: authHeaders
  });

  assert.equal(createResponse.statusCode, 200);
  assert.equal(duplicateResponse.statusCode, 200);
  assert.equal(createResponse.json().tag.id, duplicateResponse.json().tag.id);
  assert.deepEqual(listResponse.json().tags, [createResponse.json().tag]);
});

test("POST and GET follow-up tasks return open tasks by default", async () => {
  const app = await createSeededApp();
  const authHeaders = await createInternalAuthHeaders(app);
  const createResponse = await app.inject({
    method: "POST",
    url: `${customerPath}/follow-up-tasks?${customerQuery}`,
    headers: authHeaders,
    payload: {
      title: "Send revised quotation",
      assignedToUserId: "user-1",
      dueAt: "2026-05-26T09:00:00.000Z"
    }
  });
  const listResponse = await app.inject({
    method: "GET",
    url: `${customerPath}/follow-up-tasks?${customerQuery}`,
    headers: authHeaders
  });

  assert.equal(createResponse.statusCode, 200);
  assert.equal(createResponse.json().task.status, "open");
  assert.equal(createResponse.json().task.title, "Send revised quotation");
  assert.deepEqual(listResponse.json().tasks, [createResponse.json().task]);
});

test("customer collaboration routes use session org when orgId is omitted", async () => {
  const app = await createSeededApp();
  const headers = await createInternalAuthHeaders(app);

  const notesResponse = await app.inject({
    method: "GET",
    url: `${customerPath}/notes?sellerAccountExternalId=seller-1`,
    headers
  });
  const tasksResponse = await app.inject({
    method: "GET",
    url: `${customerPath}/follow-up-tasks?sellerAccountExternalId=seller-1`,
    headers
  });

  assert.equal(notesResponse.statusCode, 200);
  assert.deepEqual(notesResponse.json().notes, []);
  assert.equal(tasksResponse.statusCode, 200);
  assert.deepEqual(tasksResponse.json().tasks, []);
});

test("customer collaboration routes reject orgId outside the authenticated user's org", async () => {
  const app = await createSeededApp();
  const authHeaders = await createInternalAuthHeaders(app);
  const crossOrgQuery = "orgId=org_other&sellerAccountExternalId=seller-1";
  const requests = [
    { method: "POST", url: `${customerPath}/notes?${crossOrgQuery}`, headers: authHeaders, payload: { body: "Nope." } },
    { method: "GET", url: `${customerPath}/notes?${crossOrgQuery}`, headers: authHeaders },
    { method: "POST", url: `${customerPath}/tags?${crossOrgQuery}`, headers: authHeaders, payload: { tag: "hot-lead" } },
    { method: "GET", url: `${customerPath}/tags?${crossOrgQuery}`, headers: authHeaders },
    {
      method: "POST",
      url: `${customerPath}/follow-up-tasks?${crossOrgQuery}`,
      headers: authHeaders,
      payload: { title: "Send revised quotation" }
    },
    { method: "GET", url: `${customerPath}/follow-up-tasks?${crossOrgQuery}`, headers: authHeaders }
  ] as const;

  for (const request of requests) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { ok: false, error: "forbidden" });
  }
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
    headers: await createInternalAuthHeaders(app)
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { ok: false, error: "customer_scope_required" });
});
