import assert from "node:assert/strict";
import { test } from "node:test";
import { PostgresSyncStore, type SqlClient } from "../src/index.js";

class FakePostgresClient implements SqlClient {
  readonly queries: Array<{ sql: string; params: readonly unknown[] }> = [];
  private messageInsertCalls = 0;

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    this.queries.push({ sql, params });

    if (/upsert_seller_account/i.test(sql)) {
      return { rows: [{ id: "seller-db-id" }] as T[], rowCount: 1 };
    }
    if (/upsert_collector_device/i.test(sql)) {
      return { rows: [{ id: "device-db-id" }] as T[], rowCount: 1 };
    }
    if (/upsert_customer/i.test(sql)) {
      return { rows: [{ id: "customer-db-id" }] as T[], rowCount: 1 };
    }
    if (/upsert_conversation/i.test(sql)) {
      return { rows: [{ id: "conversation-db-id" }] as T[], rowCount: 1 };
    }
    if (/insert_message/i.test(sql)) {
      this.messageInsertCalls += 1;
      const inserted = this.messageInsertCalls === 1;
      return { rows: inserted ? [{ id: "message-db-id" }] as T[] : [], rowCount: inserted ? 1 : 0 };
    }
    if (/list_customers/i.test(sql)) {
      return {
        rows: [
          {
            sellerAccountExternalId: "seller-1",
            externalCustomerId: "customer-1",
            loginId: "buyer_login",
            displayName: "Buyer One",
            country: "US",
            ownerUserId: "user-1",
            stage: "qualified"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/list_conversations/i.test(sql)) {
      return {
        rows: [
          {
            sellerAccountExternalId: "seller-1",
            externalConversationId: "conv-1",
            externalCustomerId: "customer-1",
            lastMessageAt: "2026-05-25T09:30:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/list_messages/i.test(sql)) {
      return {
        rows: [
          {
            sellerAccountExternalId: "seller-1",
            externalConversationId: "conv-1",
            externalMessageId: "msg-1",
            direction: "received",
            messageType: "text",
            content: "hello",
            sentAt: "2026-05-25T09:00:00.000Z",
            rawSanitized: { messageId: "msg-1" },
            contentHash: "hash-1",
            uniqueKey: "seller-1:conv-1:msg-1"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/create_customer_note/i.test(sql)) {
      return {
        rows: [
          {
            id: "note-db-id",
            sellerAccountExternalId: "seller-1",
            externalCustomerId: "customer-1",
            body: "Customer asked for updated MOQ.",
            createdByUserId: null,
            createdAt: "2026-05-25T10:00:00.000Z",
            updatedAt: "2026-05-25T10:00:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/list_customer_notes/i.test(sql)) {
      return {
        rows: [
          {
            id: "note-db-id",
            sellerAccountExternalId: "seller-1",
            externalCustomerId: "customer-1",
            body: "Customer asked for updated MOQ.",
            createdByUserId: null,
            createdAt: "2026-05-25T10:00:00.000Z",
            updatedAt: "2026-05-25T10:00:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/add_customer_tag/i.test(sql)) {
      return {
        rows: [
          {
            id: "tag-db-id",
            sellerAccountExternalId: "seller-1",
            externalCustomerId: "customer-1",
            tag: "hot-lead",
            createdByUserId: null,
            createdAt: "2026-05-25T10:01:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/list_customer_tags/i.test(sql)) {
      return {
        rows: [
          {
            id: "tag-db-id",
            sellerAccountExternalId: "seller-1",
            externalCustomerId: "customer-1",
            tag: "hot-lead",
            createdByUserId: null,
            createdAt: "2026-05-25T10:01:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/create_follow_up_task/i.test(sql)) {
      return {
        rows: [
          {
            id: "task-db-id",
            sellerAccountExternalId: "seller-1",
            externalCustomerId: "customer-1",
            title: "Send revised quotation",
            assignedToUserId: "user-1",
            status: "open",
            dueAt: "2026-05-26T09:00:00.000Z",
            createdAt: "2026-05-25T10:02:00.000Z",
            updatedAt: "2026-05-25T10:02:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/list_follow_up_tasks/i.test(sql)) {
      return {
        rows: [
          {
            id: "task-db-id",
            sellerAccountExternalId: "seller-1",
            externalCustomerId: "customer-1",
            title: "Send revised quotation",
            assignedToUserId: "user-1",
            status: "open",
            dueAt: "2026-05-26T09:00:00.000Z",
            createdAt: "2026-05-25T10:02:00.000Z",
            updatedAt: "2026-05-25T10:02:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/assign_customer/i.test(sql)) {
      return {
        rows: [
          {
            id: "assignment-db-id",
            sellerAccountExternalId: "seller-1",
            externalCustomerId: "customer-1",
            assignedToUserId: "user-2",
            assignedByUserId: "manager-1",
            assignedAt: "2026-05-25T11:00:00.000Z",
            updatedAt: "2026-05-25T11:00:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/get_customer_assignment/i.test(sql)) {
      return {
        rows: [
          {
            id: "assignment-db-id",
            sellerAccountExternalId: "seller-1",
            externalCustomerId: "customer-1",
            assignedToUserId: "user-2",
            assignedByUserId: "manager-1",
            assignedAt: "2026-05-25T11:00:00.000Z",
            updatedAt: "2026-05-25T11:00:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/update_follow_up_task/i.test(sql)) {
      return {
        rows: [
          {
            id: "task-db-id",
            sellerAccountExternalId: "seller-1",
            externalCustomerId: "customer-1",
            title: "Send revised quotation tomorrow",
            assignedToUserId: "user-2",
            status: "done",
            dueAt: "2026-05-27T09:00:00.000Z",
            createdAt: "2026-05-25T10:02:00.000Z",
            updatedAt: "2026-05-25T11:01:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/register_collector_device/i.test(sql)) {
      return {
        rows: [
          {
            id: "device-db-id",
            externalDeviceId: "chrome-extension-demo",
            sellerAccountExternalId: params[0] || null,
            deviceName: "MacBook",
            status: "active",
            tokenHash: "device-token-hash",
            lastHeartbeatAt: null,
            createdAt: "2026-05-25T10:00:00.000Z",
            updatedAt: "2026-05-25T10:00:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/list_collector_devices/i.test(sql)) {
      return {
        rows: [
          {
            id: "device-db-id",
            externalDeviceId: "chrome-extension-demo",
            sellerAccountExternalId: null,
            deviceName: "MacBook",
            status: "active",
            lastHeartbeatAt: null,
            createdAt: "2026-05-25T10:00:00.000Z",
            updatedAt: "2026-05-25T10:00:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/revoke_collector_device/i.test(sql)) {
      return {
        rows: [
          {
            id: "device-db-id",
            externalDeviceId: "chrome-extension-demo",
            sellerAccountExternalId: null,
            deviceName: "MacBook",
            status: "revoked",
            lastHeartbeatAt: null,
            createdAt: "2026-05-25T10:00:00.000Z",
            updatedAt: "2026-05-25T10:05:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/authenticate_collector_device/i.test(sql)) {
      return {
        rows: [
          {
            id: "device-db-id",
            externalDeviceId: "chrome-extension-demo",
            sellerAccountExternalId: null,
            deviceName: "MacBook",
            status: "active",
            lastHeartbeatAt: "2026-05-25T10:06:00.000Z",
            createdAt: "2026-05-25T10:00:00.000Z",
            updatedAt: "2026-05-25T10:06:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/create_internal_user/i.test(sql)) {
      return {
        rows: [
          {
            id: "user-db-id",
            email: "admin@example.com",
            displayName: "Admin User",
            status: "active",
            roles: ["admin"],
            createdAt: "2026-05-25T10:00:00.000Z",
            updatedAt: "2026-05-25T10:00:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/list_internal_users/i.test(sql)) {
      return {
        rows: [
          {
            id: "user-db-id",
            email: "admin@example.com",
            displayName: "Admin User",
            status: "active",
            roles: ["admin"],
            createdAt: "2026-05-25T10:00:00.000Z",
            updatedAt: "2026-05-25T10:00:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/get_internal_user_credentials_by_email/i.test(sql)) {
      return {
        rows: [
          {
            id: "user-db-id",
            email: "admin@example.com",
            displayName: "Admin User",
            status: "active",
            roles: ["admin"],
            createdAt: "2026-05-25T10:00:00.000Z",
            updatedAt: "2026-05-25T10:00:00.000Z",
            passwordHash: "password-hash"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/get_internal_user_credentials/i.test(sql)) {
      return {
        rows: [
          {
            id: "user-db-id",
            email: "admin@example.com",
            displayName: "Admin User",
            status: "active",
            roles: ["admin"],
            createdAt: "2026-05-25T10:00:00.000Z",
            updatedAt: "2026-05-25T10:00:00.000Z",
            passwordHash: "password-hash"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/update_internal_user/i.test(sql)) {
      return {
        rows: [
          {
            id: "user-db-id",
            email: "admin@example.com",
            displayName: "Renamed Admin",
            status: "active",
            roles: ["admin", "supervisor"],
            createdAt: "2026-05-25T10:00:00.000Z",
            updatedAt: "2026-05-25T10:05:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/revoke_internal_session/i.test(sql)) {
      return { rows: [] as T[], rowCount: 1 };
    }
    if (/create_user_invitation/i.test(sql)) {
      return {
        rows: [
          {
            id: "inv-1",
            email: "invitee@example.com",
            displayName: "Invitee",
            roles: ["sales"],
            createdByUserId: null,
            expiresAt: "2030-01-01T00:00:00.000Z",
            acceptedAt: null,
            createdAt: "2026-05-26T00:00:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/get_user_invitation/i.test(sql)) {
      return {
        rows: [
          {
            id: "inv-1",
            email: "invitee@example.com",
            displayName: "Invitee",
            roles: ["sales"],
            createdByUserId: null,
            expiresAt: "2030-01-01T00:00:00.000Z",
            acceptedAt: null,
            createdAt: "2026-05-26T00:00:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/accept_user_invitation/i.test(sql)) {
      return {
        rows: [
          {
            errorCode: null,
            id: "inv-1",
            email: "invitee@example.com",
            displayName: "Invitee",
            roles: ["sales"],
            createdByUserId: null,
            expiresAt: "2030-01-01T00:00:00.000Z",
            acceptedAt: "2026-05-26T00:01:00.000Z",
            createdAt: "2026-05-26T00:00:00.000Z",
            userId: "user-db-id",
            userEmail: "invitee@example.com",
            userDisplayName: "Invitee",
            userStatus: "active",
            userRoles: ["sales"],
            userCreatedAt: "2026-05-26T00:01:00.000Z",
            userUpdatedAt: "2026-05-26T00:01:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/issue_internal_session/i.test(sql)) {
      return {
        rows: [
          {
            tokenHash: "session-token-hash",
            userId: "user-db-id",
            email: "admin@example.com",
            displayName: "Admin User",
            roles: ["admin"],
            createdAt: "2026-05-25T10:01:00.000Z",
            expiresAt: "2026-05-26T00:00:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/get_internal_session/i.test(sql)) {
      return {
        rows: [
          {
            tokenHash: "session-token-hash",
            userId: "user-db-id",
            email: "admin@example.com",
            displayName: "Admin User",
            roles: ["admin"],
            createdAt: "2026-05-25T10:01:00.000Z",
            expiresAt: "2026-05-26T00:00:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/create_ai_summary/i.test(sql)) {
      return {
        rows: [
          {
            id: "summary-db-id",
            sellerAccountExternalId: "seller-1",
            externalCustomerId: "customer-1",
            promptVersion: "fake-ai-v1",
            summary: "Buyer wants a quote for 500 units.",
            intentLevel: "high",
            nextAction: "Send revised quotation",
            sourceMessageStartAt: "2026-05-25T09:00:00.000Z",
            sourceMessageEndAt: "2026-05-25T09:05:00.000Z",
            createdAt: "2026-05-25T10:00:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/get_latest_ai_summary/i.test(sql)) {
      return {
        rows: [
          {
            id: "summary-db-id",
            sellerAccountExternalId: "seller-1",
            externalCustomerId: "customer-1",
            promptVersion: "fake-ai-v1",
            summary: "Buyer wants a quote for 500 units.",
            intentLevel: "high",
            nextAction: "Send revised quotation",
            sourceMessageStartAt: "2026-05-25T09:00:00.000Z",
            sourceMessageEndAt: "2026-05-25T09:05:00.000Z",
            createdAt: "2026-05-25T10:00:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/create_reply_suggestion/i.test(sql)) {
      return {
        rows: [
          {
            id: "suggestion-db-id",
            sellerAccountExternalId: "seller-1",
            externalCustomerId: "customer-1",
            externalConversationId: "conv-1",
            promptVersion: "fake-ai-v1",
            suggestion: "Thanks, I will send the quote today.",
            status: "draft",
            createdByUserId: "user-1",
            createdAt: "2026-05-25T10:01:00.000Z",
            updatedAt: "2026-05-25T10:01:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }
    if (/list_reply_suggestions/i.test(sql)) {
      return {
        rows: [
          {
            id: "suggestion-db-id",
            sellerAccountExternalId: "seller-1",
            externalCustomerId: "customer-1",
            externalConversationId: "conv-1",
            promptVersion: "fake-ai-v1",
            suggestion: "Thanks, I will send the quote today.",
            status: "draft",
            createdByUserId: "user-1",
            createdAt: "2026-05-25T10:01:00.000Z",
            updatedAt: "2026-05-25T10:01:00.000Z"
          }
        ] as T[],
        rowCount: 1
      };
    }

    return { rows: [], rowCount: 0 };
  }
}

class AcceptedInvitationClient extends FakePostgresClient {
  override async query<T>(sql: string, params: readonly unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    if (/accept_user_invitation/i.test(sql)) {
      this.queries.push({ sql, params });
      return {
        rows: [{ errorCode: "invitation_already_accepted" }] as T[],
        rowCount: 1
      };
    }
    return super.query<T>(sql, params);
  }
}

class FailingMessageInsertClient extends FakePostgresClient {
  override async query<T>(sql: string, params: readonly unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    if (/insert_message/i.test(sql)) {
      this.queries.push({ sql, params });
      throw new Error("insert_message_failed");
    }
    return super.query<T>(sql, params);
  }
}

function makeBatch() {
  return {
    sellerAccount: { externalAccountId: "seller-1", displayName: "Seller One" },
    device: { deviceId: "device-1", deviceName: "MacBook" },
    sourceMeta: { collectedAt: "2026-05-25T10:00:00.000Z" },
    customers: [{ externalCustomerId: "customer-1", displayName: "Buyer", country: "US" }],
    conversations: [{ externalConversationId: "conv-1", externalCustomerId: "customer-1" }],
    messages: [
      {
        externalConversationId: "conv-1",
        externalMessageId: "msg-1",
        direction: "received",
        content: "hello",
        sentAt: "2026-05-25T09:00:00.000Z",
        rawSanitized: { messageId: "msg-1" }
      }
    ]
  } as const;
}

test("PostgresSyncStore creates internal users without organization columns", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);

  await store.createInternalUser({
    email: "admin@example.com",
    displayName: "Admin",
    passwordHash: "hash",
    roles: ["admin"]
  });

  const sql = client.queries.map((query) => query.sql).join("\n").toLowerCase();
  assert.doesNotMatch(sql, new RegExp(`\\b${["org", "id"].join("_")}\\b`));
  assert.match(sql, /insert into app_user \(email, display_name, password_hash, status\)/);
  assert.match(sql, /insert into role \(name\)/);
  assert.match(sql, /insert into user_role \(user_id, role_id\)/);
});

test("PostgresSyncStore stores sync batches without organization parameters", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);

  await store.acceptSyncBatch(makeBatch());

  const sql = client.queries.map((query) => query.sql).join("\n").toLowerCase();
  assert.doesNotMatch(sql, new RegExp(`\\b${["org", "id"].join("_")}\\b`));
  assert.doesNotMatch(sql, /ensure_org/);
});

test("PostgresSyncStore upserts entities and inserts messages with idempotent counts", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);

  const result = await store.acceptSyncBatch({
    sellerAccount: { externalAccountId: "seller-1", displayName: "Seller One" },
    device: { deviceId: "device-1", deviceName: "MacBook" },
    sourceMeta: { collectedAt: "2026-05-25T10:00:00.000Z" },
    customers: [{ externalCustomerId: "customer-1", displayName: "Buyer", country: "US" }],
    conversations: [{ externalConversationId: "conv-1", externalCustomerId: "customer-1" }],
    messages: [
      {
        externalConversationId: "conv-1",
        externalMessageId: "msg-1",
        direction: "received",
        content: "hello",
        sentAt: "2026-05-25T09:00:00.000Z",
        rawSanitized: { messageId: "msg-1" }
      },
      {
        externalConversationId: "conv-1",
        externalMessageId: "msg-1",
        direction: "received",
        content: "hello",
        sentAt: "2026-05-25T09:00:00.000Z",
        rawSanitized: { messageId: "msg-1" }
      }
    ]
  });

  assert.equal(result.acceptedCount, 1);
  assert.equal(result.rejectedCount, 1);
  assert.equal(result.nextCursor, "2026-05-25T09:00:00.000Z");
  assert.equal(client.queries.some((query) => /ON CONFLICT/i.test(query.sql)), true);
  assert.equal(client.queries.filter((query) => /insert_message/i.test(query.sql)).length, 2);
});

test("PostgresSyncStore persists sync batch result statistics", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);

  await store.acceptSyncBatch({
    sellerAccount: { externalAccountId: "seller-1" },
    device: { deviceId: "device-1" },
    sourceMeta: { sourceBatchKey: "batch-1" },
    conversations: [{ externalConversationId: "conv-1" }],
    messages: [
      {
        externalConversationId: "conv-1",
        externalMessageId: "msg-1",
        direction: "received",
        content: "hello",
        sentAt: "2026-05-25T09:00:00.000Z"
      },
      {
        externalConversationId: "conv-1",
        externalMessageId: "msg-1",
        direction: "received",
        content: "hello",
        sentAt: "2026-05-25T09:00:00.000Z"
      }
    ]
  });

  const statsQuery = client.queries.find((query) => /update_sync_batch_result/i.test(query.sql));
  assert.ok(statsQuery);
  assert.deepEqual(statsQuery.params, [1, 1, [], "seller-db-id", "batch-1"]);
});

test("PostgresSyncStore wraps sync batch writes in a transaction", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);

  await store.acceptSyncBatch({
    sellerAccount: { externalAccountId: "seller-1" },
    device: { deviceId: "device-1" },
    conversations: [{ externalConversationId: "conv-1" }],
    messages: [
      {
        externalConversationId: "conv-1",
        direction: "received",
        content: "hello",
        sentAt: "2026-05-25T09:00:00.000Z"
      }
    ]
  });

  assert.equal(client.queries[0].sql.trim().toUpperCase(), "BEGIN");
  assert.equal(client.queries.at(-1)?.sql.trim().toUpperCase(), "COMMIT");
});

test("PostgresSyncStore rolls back sync batch writes when a database write fails", async () => {
  const client = new FailingMessageInsertClient();
  const store = new PostgresSyncStore(client);

  await assert.rejects(
    () =>
      store.acceptSyncBatch({
        sellerAccount: { externalAccountId: "seller-1" },
        device: { deviceId: "device-1" },
        conversations: [{ externalConversationId: "conv-1" }],
        messages: [
          {
            externalConversationId: "conv-1",
            direction: "received",
            content: "hello",
            sentAt: "2026-05-25T09:00:00.000Z"
          }
        ]
      }),
    /insert_message_failed/
  );

  assert.equal(client.queries[0].sql.trim().toUpperCase(), "BEGIN");
  assert.equal(client.queries.at(-1)?.sql.trim().toUpperCase(), "ROLLBACK");
  assert.equal(client.queries.some((query) => query.sql.trim().toUpperCase() === "COMMIT"), false);
});

test("PostgresSyncStore parameterizes raw sanitized data and never writes raw credential field names", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);

  await store.acceptSyncBatch({
    sellerAccount: { externalAccountId: "seller-1" },
    device: { deviceId: "device-1" },
    conversations: [{ externalConversationId: "conv-1" }],
    messages: [
      {
        externalConversationId: "conv-1",
        direction: "sent",
        content: "no secrets",
        sentAt: "2026-05-25T09:00:00.000Z",
        rawSanitized: { safe: true }
      }
    ]
  });

  const allSql = client.queries.map((query) => query.sql.toLowerCase()).join("\n");
  assert.equal(allSql.includes("cookie2"), false);
  assert.equal(allSql.includes("sgcookie"), false);
  assert.equal(allSql.includes("ctoken"), false);
  assert.equal(allSql.includes("_tb_token_"), false);
  assert.equal(allSql.includes("chat_token"), false);
  assert.equal(
    client.queries.some((query) => query.params.some((param) => JSON.stringify(param) === JSON.stringify({ safe: true }))),
    true
  );
});

test("PostgresSyncStore lists customers without organization scope", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);

  const customers = await store.listCustomers();

  assert.deepEqual(customers, [
    {
      sellerAccountExternalId: "seller-1",
      externalCustomerId: "customer-1",
      loginId: "buyer_login",
      displayName: "Buyer One",
      country: "US",
      ownerUserId: "user-1",
      stage: "qualified"
    }
  ]);
  assert.deepEqual(client.queries.at(-1)?.params, []);
  assert.match(client.queries.at(-1)?.sql || "", /list_customers/i);
});

test("PostgresSyncStore lists conversations with customer linkage", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);

  const conversations = await store.listConversations();

  assert.deepEqual(conversations, [
    {
      sellerAccountExternalId: "seller-1",
      externalConversationId: "conv-1",
      externalCustomerId: "customer-1",
      lastMessageAt: "2026-05-25T09:30:00.000Z"
    }
  ]);
  assert.deepEqual(client.queries.at(-1)?.params, []);
  assert.match(client.queries.at(-1)?.sql || "", /list_conversations/i);
});

test("PostgresSyncStore lists messages scoped by conversation", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);

  const messages = await store.listMessages("conv-1");

  assert.deepEqual(messages, [
    {
      sellerAccountExternalId: "seller-1",
      externalConversationId: "conv-1",
      externalMessageId: "msg-1",
      direction: "received",
      messageType: "text",
      content: "hello",
      sentAt: "2026-05-25T09:00:00.000Z",
      rawSanitized: { messageId: "msg-1" },
      contentHash: "hash-1",
      uniqueKey: "seller-1:conv-1:msg-1"
    }
  ]);
  assert.deepEqual(client.queries.at(-1)?.params, ["conv-1"]);
  assert.match(client.queries.at(-1)?.sql || "", /list_messages/i);
});

test("PostgresSyncStore creates and lists customer notes with scoped params", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);
  const scope = {
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1"
  };

  const note = await store.createCustomerNote({
    ...scope,
    body: "Customer asked for updated MOQ."
  });
  const notes = await store.listCustomerNotes(scope);

  assert.equal(note.id, "note-db-id");
  assert.equal(note.body, "Customer asked for updated MOQ.");
  assert.deepEqual(notes, [note]);
  assert.deepEqual(client.queries.find((query) => /create_customer_note/i.test(query.sql))?.params, [
    "seller-1",
    "customer-1",
    "Customer asked for updated MOQ.",
    null
  ]);
  assert.deepEqual(client.queries.find((query) => /list_customer_notes/i.test(query.sql))?.params, [
    "seller-1",
    "customer-1"
  ]);
});

test("PostgresSyncStore adds and lists customer tags with scoped params", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);
  const scope = {
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1"
  };

  const tag = await store.addCustomerTag({ ...scope, tag: "hot-lead" });
  const tags = await store.listCustomerTags(scope);

  assert.equal(tag.id, "tag-db-id");
  assert.equal(tag.tag, "hot-lead");
  assert.deepEqual(tags, [tag]);
  assert.deepEqual(client.queries.find((query) => /add_customer_tag/i.test(query.sql))?.params, [
    "seller-1",
    "customer-1",
    "hot-lead",
    null
  ]);
});

test("PostgresSyncStore creates and lists follow-up tasks with scoped params", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);
  const scope = {
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1"
  };

  const task = await store.createFollowUpTask({
    ...scope,
    title: "Send revised quotation",
    assignedToUserId: "user-1",
    dueAt: "2026-05-26T09:00:00.000Z"
  });
  const tasks = await store.listFollowUpTasks(scope);

  assert.equal(task.id, "task-db-id");
  assert.equal(task.status, "open");
  assert.equal(task.assignedToUserId, "user-1");
  assert.deepEqual(tasks, [task]);
  assert.deepEqual(client.queries.find((query) => /create_follow_up_task/i.test(query.sql))?.params, [
    "seller-1",
    "customer-1",
    "Send revised quotation",
    "user-1",
    "2026-05-26T09:00:00.000Z",
    "open"
  ]);
});

test("PostgresSyncStore assigns customers and updates follow-up tasks with scoped params", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);
  const scope = {
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1"
  };

  const assignment = await store.assignCustomer({
    ...scope,
    assignedToUserId: "user-2",
    assignedByUserId: "manager-1"
  });
  const currentAssignment = await store.getCustomerAssignment(scope);
  const task = await store.updateFollowUpTask({
    taskId: "task-db-id",
    status: "done",
    title: "Send revised quotation tomorrow",
    assignedToUserId: "user-2",
    dueAt: "2026-05-27T09:00:00.000Z"
  });

  assert.equal(assignment.id, "assignment-db-id");
  assert.equal(assignment.assignedToUserId, "user-2");
  assert.deepEqual(currentAssignment, assignment);
  assert.equal(task.status, "done");
  assert.equal(task.title, "Send revised quotation tomorrow");
  assert.deepEqual(client.queries.find((query) => /assign_customer/i.test(query.sql))?.params, [
    "seller-1",
    "customer-1",
    "user-2",
    "manager-1"
  ]);
  assert.deepEqual(client.queries.find((query) => /get_customer_assignment/i.test(query.sql))?.params, [
    "seller-1",
    "customer-1"
  ]);
  assert.deepEqual(client.queries.find((query) => /update_follow_up_task/i.test(query.sql))?.params, [
    "task-db-id",
    "done",
    "Send revised quotation tomorrow",
    "user-2",
    "2026-05-27T09:00:00.000Z"
  ]);
});

test("PostgresSyncStore creates internal users and resolves sessions without storing raw tokens", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);

  const user = await store.createInternalUser({
    email: " Admin@Example.com ",
    displayName: "Admin User",
    passwordHash: "password-hash",
    roles: ["admin"]
  });
  const session = await store.issueInternalSession({
    email: " Admin@Example.com ",
    passwordHash: "password-hash",
    token: "session-token",
    expiresAt: "2026-05-26T00:00:00.000Z"
  });
  const resolved = await store.getInternalSession("session-token");

  assert.equal(user.id, "user-db-id");
  assert.deepEqual(user.roles, ["admin"]);
  assert.equal(session.token, "session-token");
  assert.equal(session.tokenHash, "session-token-hash");
  assert.deepEqual(resolved, session);
  assert.deepEqual(client.queries.find((query) => /create_internal_user/i.test(query.sql))?.params, [
    "admin@example.com",
    "Admin User",
    "password-hash",
    ["admin"],
    "active"
  ]);
  const createSql = client.queries.find((query) => /create_internal_user/i.test(query.sql))?.sql || "";
  assert.match(createSql, /DELETE\s+FROM\s+user_role/i);
  assert.match(createSql, /roles_removed/i);
  assert.match(createSql, /CROSS JOIN roles_removed/i);
  const issueParams = client.queries.find((query) => /issue_internal_session/i.test(query.sql))?.params || [];
  assert.equal(issueParams.includes("session-token"), false);
  assert.equal(issueParams[0], "admin@example.com");
  assert.equal(issueParams[1], "password-hash");
  assert.equal(issueParams[3], "2026-05-26T00:00:00.000Z");
});

test("PostgresSyncStore supports internal user management and invitations", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);

  const users = await store.listInternalUsers();
  const credentials = await store.getInternalUserCredentials({
    email: " Admin@Example.com "
  });
  const updated = await store.updateInternalUser({
    userId: "user-db-id",
    displayName: "Renamed Admin",
    roles: ["admin", "supervisor"]
  });
  const revoked = await store.revokeInternalSession({ token: "session-token" });
  const invitation = await store.createUserInvitation({
    email: " Invitee@Example.com ",
    displayName: "Invitee",
    roles: ["sales"],
    token: "invite-token"
  });
  const inspected = await store.getUserInvitation("invite-token");
  const accepted = await store.acceptUserInvitation({
    token: "invite-token",
    passwordHash: "scrypt$password"
  });

  assert.equal(users[0].email, "admin@example.com");
  assert.equal(credentials?.passwordHash, "password-hash");
  assert.equal(updated.displayName, "Renamed Admin");
  assert.equal(revoked, true);
  assert.equal(invitation.token, "invite-token");
  assert.equal("tokenHash" in invitation, false);
  assert.equal(client.queries.find((query) => /create_user_invitation/i.test(query.sql))?.params[0], "invitee@example.com");
  assert.equal(inspected?.email, "invitee@example.com");
  assert.equal(inspected && "token" in inspected, false);
  assert.equal(accepted.user.email, "invitee@example.com");
  assert.equal("token" in accepted.invitation, false);

  const sqlText = client.queries.map((query) => query.sql).join("\n");
  const updateSql = client.queries.find((query) => /update_internal_user/i.test(query.sql))?.sql || "";
  const acceptSql = client.queries.find((query) => /accept_user_invitation/i.test(query.sql))?.sql || "";
  assert.match(sqlText, /list_internal_users/);
  assert.match(sqlText, /get_internal_user_credentials/);
  assert.match(sqlText, /update_internal_user/);
  assert.match(sqlText, /revoke_internal_session/);
  assert.match(sqlText, /create_user_invitation/);
  assert.match(sqlText, /get_user_invitation/);
  assert.match(sqlText, /accept_user_invitation/);
  assert.equal(
    client.queries.find((query) => /get_internal_user_credentials/i.test(query.sql))?.params[1],
    undefined
  );
  assert.equal(
    client.queries.find((query) => /get_internal_user_credentials/i.test(query.sql))?.params[0],
    "admin@example.com"
  );
  assert.equal(client.queries.some((query) => query.params.includes("invite-token")), false);
  assert.match(
    acceptSql,
    /UPDATE\s+user_invitation[\s\S]*WHERE\s+token_hash\s*=\s*\$1[\s\S]*accepted_at\s+IS\s+NULL[\s\S]*expires_at\s*>\s*now\(\)/i
  );
  assert.match(updateSql, /roles_removed/i);
  assert.match(updateSql, /CROSS JOIN roles_removed/i);
  assert.match(updateSql, /FROM\s+updated_user[\s\S]*CROSS JOIN LATERAL\s+unnest/i);
  assert.match(acceptSql, /roles_removed/i);
  assert.match(acceptSql, /CROSS JOIN roles_removed/i);
});

test("PostgresSyncStore resolves credentials by email without workspace lookup", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);

  const credentials = await store.getInternalUserCredentialsByEmail({
    email: " Admin@Example.com "
  });

  assert.deepEqual(
    credentials.map((item) => ({
      email: item.email,
      passwordHash: item.passwordHash
    })),
    [{ email: "admin@example.com", passwordHash: "password-hash" }]
  );

  const sql = client.queries.map((query) => query.sql).join("\n");
  assert.match(sql, /get_internal_user_credentials_by_email/);
  assert.doesNotMatch(sql, /workspace/i);
  assert.doesNotMatch(sql, /switch_internal_session_org/i);
  assert.equal(
    client.queries.find((query) => /get_internal_user_credentials_by_email/i.test(query.sql))?.params[0],
    "admin@example.com"
  );
  assert.equal(client.queries.some((query) => query.params.includes("session-token")), false);
});

test("PostgresSyncStore reports already accepted invitations distinctly", async () => {
  const client = new AcceptedInvitationClient();
  const store = new PostgresSyncStore(client);

  await assert.rejects(
    () =>
      store.acceptUserInvitation({
        token: "invite-token",
        passwordHash: "scrypt$password"
      }),
    /invitation_already_accepted/
  );

  assert.equal(client.queries.some((query) => query.params.includes("invite-token")), false);
});

test("PostgresSyncStore manages collector devices without storing raw tokens", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);

  const registered = await store.registerCollectorDevice({
    externalDeviceId: "chrome-extension-demo",
    deviceName: "MacBook",
    token: "collector-token"
  });
  const devices = await store.listCollectorDevices();
  const authenticated = await store.authenticateCollectorDevice("collector-token");
  const revoked = await store.revokeCollectorDevice({
    deviceId: "device-db-id"
  });

  assert.equal(registered.id, "device-db-id");
  assert.equal(registered.token, "collector-token");
  assert.equal(registered.tokenHash, "device-token-hash");
  assert.deepEqual(devices, [
    {
      id: "device-db-id",
      externalDeviceId: "chrome-extension-demo",
      sellerAccountExternalId: undefined,
      deviceName: "MacBook",
      status: "active",
      lastHeartbeatAt: undefined,
      createdAt: "2026-05-25T10:00:00.000Z",
      updatedAt: "2026-05-25T10:00:00.000Z"
    }
  ]);
  assert.equal(authenticated?.id, "device-db-id");
  assert.equal(authenticated?.lastHeartbeatAt, "2026-05-25T10:06:00.000Z");
  assert.equal(revoked.status, "revoked");

  const registerQuery = client.queries.find((query) => /register_collector_device/i.test(query.sql));
  const authQuery = client.queries.find((query) => /authenticate_collector_device/i.test(query.sql));
  assert.ok(registerQuery);
  assert.ok(authQuery);
  assert.equal(registerQuery.params.includes("collector-token"), false);
  assert.equal(authQuery.params.includes("collector-token"), false);
  assert.equal(registerQuery.params[0], null);
  assert.equal(registerQuery.params[1], "chrome-extension-demo");
  assert.equal(registerQuery.params[2], "MacBook");
});

test("PostgresSyncStore registers collector devices with a persisted seller binding", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);

  const registered = await store.registerCollectorDevice({
    sellerAccountExternalId: "default-seller",
    externalDeviceId: "chrome-extension-demo",
    deviceName: "Chrome Extension",
    token: "collector-token"
  });

  const registerQuery = client.queries.find((query) => /register_collector_device/i.test(query.sql));
  assert.ok(registerQuery);
  assert.match(registerQuery.sql, /INSERT INTO seller_account/i);
  assert.match(registerQuery.sql, /SELECT \$1::text/i);
  assert.match(registerQuery.sql, /WHERE \$1::text IS NOT NULL/i);
  assert.match(registerQuery.sql, /ON CONFLICT \(external_account_id\)/i);
  assert.equal(registerQuery.params[0], "default-seller");
  assert.equal(registered.sellerAccountExternalId, "default-seller");
});

test("PostgresSyncStore sync batch upserts collector devices by external device id", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);

  await store.acceptSyncBatch({
    sellerAccount: { externalAccountId: "seller-1" },
    device: { deviceId: "chrome-extension-demo", deviceName: "Chrome Extension" }
  });

  const upsertQuery = client.queries.find((query) => /upsert_collector_device/i.test(query.sql));
  assert.ok(upsertQuery);
  assert.match(upsertQuery.sql, /external_device_id/i);
  assert.doesNotMatch(upsertQuery.sql, /device_token_hash,\s*last_heartbeat_at/i);
  assert.equal(upsertQuery.params[1], "chrome-extension-demo");
  assert.equal(upsertQuery.params.includes("collector-token"), false);
});

test("PostgresSyncStore creates and reads AI summaries and reply suggestions with scoped params", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);
  const scope = {
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1"
  };
  const conversationScope = {
    ...scope,
    externalConversationId: "conv-1"
  };

  const summary = await store.createAiSummary({
    ...scope,
    promptVersion: "fake-ai-v1",
    summary: "Buyer wants a quote for 500 units.",
    intentLevel: "high",
    nextAction: "Send revised quotation",
    sourceMessageStartAt: "2026-05-25T09:00:00.000Z",
    sourceMessageEndAt: "2026-05-25T09:05:00.000Z"
  });
  const latestSummary = await store.getLatestAiSummary(scope);
  const suggestion = await store.createReplySuggestion({
    ...conversationScope,
    promptVersion: "fake-ai-v1",
    suggestion: "Thanks, I will send the quote today.",
    createdByUserId: "user-1"
  });
  const suggestions = await store.listReplySuggestions(conversationScope);

  assert.equal(summary.id, "summary-db-id");
  assert.deepEqual(latestSummary, summary);
  assert.equal(suggestion.id, "suggestion-db-id");
  assert.deepEqual(suggestions, [suggestion]);
  assert.deepEqual(client.queries.find((query) => /create_ai_summary/i.test(query.sql))?.params, [
    "seller-1",
    "customer-1",
    "fake-ai-v1",
    "Buyer wants a quote for 500 units.",
    "high",
    "Send revised quotation",
    "2026-05-25T09:00:00.000Z",
    "2026-05-25T09:05:00.000Z"
  ]);
  assert.deepEqual(client.queries.find((query) => /create_reply_suggestion/i.test(query.sql))?.params, [
    "seller-1",
    "conv-1",
    "fake-ai-v1",
    "Thanks, I will send the quote today.",
    "draft",
    "user-1"
  ]);
});
