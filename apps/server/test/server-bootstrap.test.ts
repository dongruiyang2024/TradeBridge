import assert from "node:assert/strict";
import { test } from "node:test";
import type { SqlClient } from "@wangwang/database";
import { createServerFromEnv } from "../src/server.js";

class BootstrapSqlClient implements SqlClient {
  readonly queries: Array<{ sql: string; params: readonly unknown[] }> = [];

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    this.queries.push({ sql, params });

    if (/select id from schema_migration/i.test(sql)) return { rows: [] as T[], rowCount: 0 };
    if (/upsert_seller_account/i.test(sql)) return { rows: [{ id: "seller-db-id" }] as T[], rowCount: 1 };
    if (/upsert_collector_device/i.test(sql)) return { rows: [{ id: "device-db-id" }] as T[], rowCount: 1 };
    if (/upsert_conversation/i.test(sql)) return { rows: [{ id: "conversation-db-id" }] as T[], rowCount: 1 };
    if (/insert_message/i.test(sql)) return { rows: [{ id: "message-db-id" }] as T[], rowCount: 1 };

    return { rows: [] as T[], rowCount: 0 };
  }
}

const syncPayload = {
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

test("createServerFromEnv uses in-memory store when DATABASE_URL is absent", async () => {
  const app = await createServerFromEnv({ env: {}, deviceTokens: ["device-token"] });
  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: "Bearer device-token" },
    payload: syncPayload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().acceptedCount, 1);
});

test("createServerFromEnv runs migrations and uses PostgresSyncStore when DATABASE_URL is present", async () => {
  const client = new BootstrapSqlClient();
  const app = await createServerFromEnv({
    env: { DATABASE_URL: "postgres://local/test" },
    deviceTokens: ["device-token"],
    sqlClientFactory: async (url) => {
      assert.equal(url, "postgres://local/test");
      return client;
    }
  });
  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: "Bearer device-token" },
    payload: syncPayload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().acceptedCount, 1);
  assert.equal(client.queries.some((query) => /CREATE TABLE IF NOT EXISTS schema_migration/i.test(query.sql)), true);
  assert.equal(client.queries.some((query) => /CREATE TABLE IF NOT EXISTS seller_account/i.test(query.sql)), true);
  assert.equal(client.queries.some((query) => /CREATE TABLE IF NOT EXISTS org/i.test(query.sql)), false);
  assert.equal(client.queries.some((query) => /insert_message/i.test(query.sql)), true);
});
