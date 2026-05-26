import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore } from "@wangwang/database";
import { hashPassword } from "../src/auth.js";
import { createServer } from "../src/server.js";

const customerPath = "/internal/v1/customers/customer-1";
const customerQuery = "orgId=org_internal&sellerAccountExternalId=seller-1";

async function createSeededApp() {
  const store = new InMemorySyncStore();
  const admin = await store.createInternalUser({
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

  return { app, store, admin };
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

test("POST and GET customer assignment are scoped and audited", async () => {
  const { app, store, admin } = await createSeededApp();
  const authHeaders = await createInternalAuthHeaders(app);
  const createResponse = await app.inject({
    method: "POST",
    url: `${customerPath}/assignment?${customerQuery}`,
    headers: authHeaders,
    payload: { assignedToUserId: "user-2" }
  });
  const getResponse = await app.inject({
    method: "GET",
    url: `${customerPath}/assignment?${customerQuery}`,
    headers: authHeaders
  });

  assert.equal(createResponse.statusCode, 200);
  assert.equal(createResponse.json().ok, true);
  assert.equal(createResponse.json().assignment.assignedToUserId, "user-2");
  assert.equal(createResponse.json().assignment.assignedByUserId, admin.id);
  assert.equal(getResponse.statusCode, 200);
  assert.deepEqual(getResponse.json().assignment, createResponse.json().assignment);

  const auditLogs = await store.listAuditLogs("org_internal");
  const assignmentAuditLog = auditLogs.find((log) => log.action === "customer.assignment.updated");
  assert.equal(assignmentAuditLog?.actorUserId, admin.id);
  assert.equal(assignmentAuditLog?.targetType, "customer");
  assert.deepEqual(assignmentAuditLog?.metadata, {
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1",
    assignedToUserId: "user-2"
  });
});

test("PATCH /internal/v1/follow-up-tasks/:id updates mutable fields and writes audit", async () => {
  const { app, store, admin } = await createSeededApp();
  const authHeaders = await createInternalAuthHeaders(app);
  const createTaskResponse = await app.inject({
    method: "POST",
    url: `${customerPath}/follow-up-tasks?${customerQuery}`,
    headers: authHeaders,
    payload: {
      title: "Send revised quotation",
      assignedToUserId: "user-1"
    }
  });
  const taskId = createTaskResponse.json().task.id;
  const updateResponse = await app.inject({
    method: "PATCH",
    url: `/internal/v1/follow-up-tasks/${taskId}`,
    headers: authHeaders,
    payload: {
      orgId: "org_internal",
      status: "done",
      title: "Send revised quotation tomorrow",
      assignedToUserId: "user-2",
      dueAt: "2026-05-27T09:00:00.000Z"
    }
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.json().ok, true);
  assert.equal(updateResponse.json().task.status, "done");
  assert.equal(updateResponse.json().task.title, "Send revised quotation tomorrow");
  assert.equal(updateResponse.json().task.assignedToUserId, "user-2");
  assert.equal(updateResponse.json().task.dueAt, "2026-05-27T09:00:00.000Z");

  const auditLogs = await store.listAuditLogs("org_internal");
  const followUpAuditLog = auditLogs.find((log) => log.action === "follow_up_task.updated");
  assert.equal(followUpAuditLog?.actorUserId, admin.id);
  assert.equal(followUpAuditLog?.targetType, "follow_up_task");
  assert.equal(followUpAuditLog?.targetId, taskId);
  assert.deepEqual(followUpAuditLog?.metadata, {
    status: "done",
    title: "Send revised quotation tomorrow",
    assignedToUserId: "user-2",
    dueAt: "2026-05-27T09:00:00.000Z"
  });
});

test("PATCH /internal/v1/follow-up-tasks/:id rejects orgId outside the authenticated user's org", async () => {
  const { app } = await createSeededApp();
  const authHeaders = await createInternalAuthHeaders(app);
  const createTaskResponse = await app.inject({
    method: "POST",
    url: `${customerPath}/follow-up-tasks?${customerQuery}`,
    headers: authHeaders,
    payload: { title: "Send revised quotation" }
  });
  const response = await app.inject({
    method: "PATCH",
    url: `/internal/v1/follow-up-tasks/${createTaskResponse.json().task.id}`,
    headers: authHeaders,
    payload: {
      orgId: "org_other",
      status: "done"
    }
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { ok: false, error: "forbidden" });
});

test("customer assignment routes reject orgId outside the authenticated user's org", async () => {
  const { app } = await createSeededApp();
  const authHeaders = await createInternalAuthHeaders(app);
  const crossOrgQuery = "orgId=org_other&sellerAccountExternalId=seller-1";
  const requests = [
    {
      method: "POST",
      url: `${customerPath}/assignment?${crossOrgQuery}`,
      headers: authHeaders,
      payload: { assignedToUserId: "user-2" }
    },
    { method: "GET", url: `${customerPath}/assignment?${crossOrgQuery}`, headers: authHeaders }
  ] as const;

  for (const request of requests) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { ok: false, error: "forbidden" });
  }
});

test("assignment and follow-up update routes reject invalid scopes", async () => {
  const { app } = await createSeededApp();
  const authHeaders = await createInternalAuthHeaders(app);
  const assignmentResponse = await app.inject({
    method: "POST",
    url: `${customerPath}/assignment?orgId=org_internal`,
    headers: authHeaders,
    payload: { assignedToUserId: "user-2" }
  });
  const updateResponse = await app.inject({
    method: "PATCH",
    url: "/internal/v1/follow-up-tasks/missing-task",
    headers: authHeaders,
    payload: { status: "done" }
  });

  assert.equal(assignmentResponse.statusCode, 400);
  assert.deepEqual(assignmentResponse.json(), { ok: false, error: "customer_scope_required" });
  assert.equal(updateResponse.statusCode, 400);
  assert.deepEqual(updateResponse.json(), { ok: false, error: "org_id_required" });
});
