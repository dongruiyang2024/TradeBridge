import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore } from "@wangwang/database";
import { createServer } from "../src/server.js";

const customerPath = "/internal/v1/customers/customer-1";
const customerQuery = "orgId=org_internal&sellerAccountExternalId=seller-1";

async function createSeededApp() {
  const store = new InMemorySyncStore();
  const app = await createServer({
    store,
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

  return { app, store };
}

test("POST and GET customer assignment are scoped and audited", async () => {
  const { app, store } = await createSeededApp();
  const createResponse = await app.inject({
    method: "POST",
    url: `${customerPath}/assignment?${customerQuery}`,
    headers: { authorization: "Bearer internal-token" },
    payload: { assignedToUserId: "user-2" }
  });
  const getResponse = await app.inject({
    method: "GET",
    url: `${customerPath}/assignment?${customerQuery}`,
    headers: { authorization: "Bearer internal-token" }
  });

  assert.equal(createResponse.statusCode, 200);
  assert.equal(createResponse.json().ok, true);
  assert.equal(createResponse.json().assignment.assignedToUserId, "user-2");
  assert.equal(createResponse.json().assignment.assignedByUserId, "bootstrap");
  assert.equal(getResponse.statusCode, 200);
  assert.deepEqual(getResponse.json().assignment, createResponse.json().assignment);

  const auditLogs = await store.listAuditLogs("org_internal");
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].action, "customer.assignment.updated");
  assert.equal(auditLogs[0].actorUserId, "bootstrap");
  assert.equal(auditLogs[0].targetType, "customer");
  assert.deepEqual(auditLogs[0].metadata, {
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1",
    assignedToUserId: "user-2"
  });
});

test("PATCH /internal/v1/follow-up-tasks/:id updates mutable fields and writes audit", async () => {
  const { app, store } = await createSeededApp();
  const createTaskResponse = await app.inject({
    method: "POST",
    url: `${customerPath}/follow-up-tasks?${customerQuery}`,
    headers: { authorization: "Bearer internal-token" },
    payload: {
      title: "Send revised quotation",
      assignedToUserId: "user-1"
    }
  });
  const taskId = createTaskResponse.json().task.id;
  const updateResponse = await app.inject({
    method: "PATCH",
    url: `/internal/v1/follow-up-tasks/${taskId}`,
    headers: { authorization: "Bearer internal-token" },
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
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].action, "follow_up_task.updated");
  assert.equal(auditLogs[0].actorUserId, "bootstrap");
  assert.equal(auditLogs[0].targetType, "follow_up_task");
  assert.equal(auditLogs[0].targetId, taskId);
  assert.deepEqual(auditLogs[0].metadata, {
    status: "done",
    title: "Send revised quotation tomorrow",
    assignedToUserId: "user-2",
    dueAt: "2026-05-27T09:00:00.000Z"
  });
});

test("assignment and follow-up update routes reject invalid scopes", async () => {
  const { app } = await createSeededApp();
  const assignmentResponse = await app.inject({
    method: "POST",
    url: `${customerPath}/assignment?orgId=org_internal`,
    headers: { authorization: "Bearer internal-token" },
    payload: { assignedToUserId: "user-2" }
  });
  const updateResponse = await app.inject({
    method: "PATCH",
    url: "/internal/v1/follow-up-tasks/missing-task",
    headers: { authorization: "Bearer internal-token" },
    payload: { status: "done" }
  });

  assert.equal(assignmentResponse.statusCode, 400);
  assert.deepEqual(assignmentResponse.json(), { ok: false, error: "customer_scope_required" });
  assert.equal(updateResponse.statusCode, 400);
  assert.deepEqual(updateResponse.json(), { ok: false, error: "org_id_required" });
});
