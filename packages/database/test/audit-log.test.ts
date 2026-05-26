import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore, PostgresSyncStore, type SqlClient } from "../src/index.js";

class AuditFakeClient implements SqlClient {
  readonly queries: Array<{ sql: string; params: readonly unknown[] }> = [];

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    this.queries.push({ sql, params });

    if (/append_audit_log/i.test(sql)) {
      return {
        rows: [
          {
            id: "audit-db-id",
            orgId: "org_internal",
            actorUserId: "manager-1",
            action: "customer.assignment.updated",
            targetType: "customer",
            targetId: "assignment-db-id",
            metadata: { assignedToUserId: "user-2" },
            createdAt: "2026-05-25T11:00:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }

    if (/list_audit_logs/i.test(sql)) {
      return {
        rows: [
          {
            id: "audit-db-id",
            orgId: "org_internal",
            actorUserId: "manager-1",
            action: "customer.assignment.updated",
            targetType: "customer",
            targetId: "assignment-db-id",
            metadata: { assignedToUserId: "user-2" },
            createdAt: "2026-05-25T11:00:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }

    return { rows: [], rowCount: 0 };
  }
}

test("InMemorySyncStore appends and lists audit logs without organization scope", async () => {
  const store = new InMemorySyncStore();
  const log = await store.appendAuditLog({
    actorUserId: "user-1",
    action: "auth.login",
    targetType: "customer",
    targetId: "user-1",
    metadata: { email: "admin@example.com" }
  });

  assert.equal(log.actorUserId, "user-1");
  assert.equal(log.action, "auth.login");
  assert.equal("orgId" in log, false);
  assert.deepEqual(await store.listAuditLogs(), [log]);
});

test("PostgresSyncStore appends audit logs with parameterized metadata", async () => {
  const client = new AuditFakeClient();
  const store = new PostgresSyncStore(client);

  const log = await store.appendAuditLog({
    orgId: "org_internal",
    actorUserId: "manager-1",
    action: "customer.assignment.updated",
    targetType: "customer",
    targetId: "assignment-db-id",
    metadata: { assignedToUserId: "user-2" }
  });
  const logs = await store.listAuditLogs("org_internal");

  assert.equal(log.id, "audit-db-id");
  assert.deepEqual(logs, [log]);
  assert.deepEqual(client.queries.find((query) => /append_audit_log/i.test(query.sql))?.params, [
    "org_internal",
    "manager-1",
    "customer.assignment.updated",
    "customer",
    "assignment-db-id",
    { assignedToUserId: "user-2" }
  ]);
  assert.deepEqual(client.queries.find((query) => /list_audit_logs/i.test(query.sql))?.params, ["org_internal"]);
});
