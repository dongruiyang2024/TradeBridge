import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore } from "../src/index.js";

test("acceptSyncBatch stores seller account, customer, conversation, and messages", async () => {
  const store = new InMemorySyncStore();
  const result = await store.acceptSyncBatch({
    orgId: "org_internal",
    sellerAccount: { externalAccountId: "seller-1", displayName: "Seller One" },
    device: { deviceId: "device-1", deviceName: "MacBook" },
    cursor: { since: "2026-05-01T00:00:00.000Z" },
    sourceMeta: { collectedAt: "2026-05-25T10:00:00.000Z", collectorVersion: "0.1.0" },
    customers: [{ externalCustomerId: "customer-1", loginId: "buyer", displayName: "Buyer", country: "US" }],
    conversations: [
      {
        externalConversationId: "conv-1",
        externalCustomerId: "customer-1",
        lastMessageAt: "2026-05-25T09:00:00.000Z"
      }
    ],
    messages: [
      {
        externalConversationId: "conv-1",
        externalMessageId: "msg-1",
        direction: "received",
        content: "hello",
        sentAt: "2026-05-25T09:00:00.000Z"
      }
    ]
  });

  assert.equal(result.acceptedCount, 1);
  assert.equal(result.rejectedCount, 0);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.nextCursor, "2026-05-25T09:00:00.000Z");
  assert.equal(store.listSellerAccounts("org_internal").length, 1);
  assert.equal(store.listCustomers("org_internal").length, 1);
  assert.equal(store.listConversations("org_internal").length, 1);
  assert.equal(store.listMessages("org_internal").length, 1);
});

test("acceptSyncBatch is idempotent by external message id", async () => {
  const store = new InMemorySyncStore();
  const batch = {
    orgId: "org_internal",
    sellerAccount: { externalAccountId: "seller-1" },
    device: { deviceId: "device-1" },
    conversations: [{ externalConversationId: "conv-1" }],
    messages: [
      {
        externalConversationId: "conv-1",
        externalMessageId: "msg-1",
        direction: "sent",
        content: "same",
        sentAt: "2026-05-25T09:00:00.000Z"
      },
      {
        externalConversationId: "conv-1",
        externalMessageId: "msg-1",
        direction: "sent",
        content: "same",
        sentAt: "2026-05-25T09:00:00.000Z"
      }
    ]
  } as const;

  const first = await store.acceptSyncBatch(batch);
  const second = await store.acceptSyncBatch(batch);

  assert.equal(first.acceptedCount, 1);
  assert.equal(first.rejectedCount, 1);
  assert.equal(second.acceptedCount, 0);
  assert.equal(second.rejectedCount, 2);
  assert.equal(store.listMessages("org_internal").length, 1);
});

test("acceptSyncBatch deduplicates messages without upstream ids by content hash", async () => {
  const store = new InMemorySyncStore();
  await store.acceptSyncBatch({
    orgId: "org_internal",
    sellerAccount: { externalAccountId: "seller-1" },
    device: { deviceId: "device-1" },
    conversations: [{ externalConversationId: "conv-1" }],
    messages: [
      {
        externalConversationId: "conv-1",
        direction: "received",
        content: "fallback",
        sentAt: "2026-05-25T09:00:00.000Z"
      },
      {
        externalConversationId: "conv-1",
        direction: "received",
        content: "fallback",
        sentAt: "2026-05-25T09:00:00.000Z"
      }
    ]
  });

  assert.equal(store.listMessages("org_internal").length, 1);
  assert.equal(store.listMessages("org_internal")[0].contentHash.length, 64);
});

test("acceptSyncBatch rejects messages for unknown conversations", async () => {
  const store = new InMemorySyncStore();
  const result = await store.acceptSyncBatch({
    orgId: "org_internal",
    sellerAccount: { externalAccountId: "seller-1" },
    device: { deviceId: "device-1" },
    conversations: [],
    messages: [
      {
        externalConversationId: "missing-conv",
        externalMessageId: "msg-1",
        direction: "received",
        content: "hello",
        sentAt: "2026-05-25T09:00:00.000Z"
      }
    ]
  });

  assert.equal(result.acceptedCount, 0);
  assert.equal(result.rejectedCount, 1);
  assert.deepEqual(result.warnings, ["message msg-1 references unknown conversation missing-conv"]);
  assert.equal(store.listMessages("org_internal").length, 0);
});

test("customer collaboration records are scoped by seller account and customer", async () => {
  const store = new InMemorySyncStore();
  const scope = {
    orgId: "org_internal",
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1"
  };
  const otherScope = {
    orgId: "org_internal",
    sellerAccountExternalId: "seller-2",
    externalCustomerId: "customer-1"
  };

  const note = await store.createCustomerNote({
    ...scope,
    body: "Customer asked for updated MOQ."
  });
  const tag = await store.addCustomerTag({
    ...scope,
    tag: "hot-lead"
  });
  const task = await store.createFollowUpTask({
    ...scope,
    title: "Send revised quotation",
    assignedToUserId: "user-1",
    dueAt: "2026-05-26T09:00:00.000Z"
  });
  await store.createCustomerNote({
    ...otherScope,
    body: "Different seller account note."
  });

  assert.equal(note.body, "Customer asked for updated MOQ.");
  assert.equal(note.externalCustomerId, "customer-1");
  assert.equal(note.sellerAccountExternalId, "seller-1");
  assert.equal(tag.tag, "hot-lead");
  assert.equal(task.status, "open");
  assert.equal(task.title, "Send revised quotation");
  assert.deepEqual(store.listCustomerNotes(scope), [note]);
  assert.deepEqual(store.listCustomerTags(scope), [tag]);
  assert.deepEqual(store.listFollowUpTasks(scope), [task]);
  assert.equal(store.listCustomerNotes(otherScope).length, 1);
});

test("customer assignments, follow-up updates, and audit logs are stored by organization scope", async () => {
  const store = new InMemorySyncStore();
  const scope = {
    orgId: "org_internal",
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1"
  };
  const task = await store.createFollowUpTask({
    ...scope,
    title: "Send revised quotation",
    assignedToUserId: "user-1"
  });

  const assignment = await store.assignCustomer({
    ...scope,
    assignedToUserId: "user-2",
    assignedByUserId: "manager-1"
  });
  const updatedTask = await store.updateFollowUpTask({
    orgId: "org_internal",
    taskId: task.id,
    status: "done",
    title: "Send revised quotation tomorrow",
    assignedToUserId: "user-2",
    dueAt: "2026-05-27T09:00:00.000Z"
  });
  const audit = await store.appendAuditLog({
    orgId: "org_internal",
    actorUserId: "manager-1",
    action: "customer.assignment.updated",
    targetType: "customer",
    targetId: assignment.id,
    metadata: { assignedToUserId: "user-2" }
  });

  assert.equal(assignment.assignedToUserId, "user-2");
  assert.equal(assignment.assignedByUserId, "manager-1");
  assert.deepEqual(await store.getCustomerAssignment(scope), assignment);
  assert.equal(updatedTask.status, "done");
  assert.equal(updatedTask.title, "Send revised quotation tomorrow");
  assert.equal(updatedTask.assignedToUserId, "user-2");
  assert.equal(updatedTask.dueAt, "2026-05-27T09:00:00.000Z");
  assert.deepEqual(await store.listAuditLogs("org_internal"), [audit]);
  assert.deepEqual(await store.listAuditLogs("other_org"), []);
});

test("AI summaries and reply suggestions are scoped and retrievable", async () => {
  const store = new InMemorySyncStore();
  const scope = {
    orgId: "org_internal",
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
  const suggestion = await store.createReplySuggestion({
    ...conversationScope,
    promptVersion: "fake-ai-v1",
    suggestion: "Thanks, I will send the quote today.",
    createdByUserId: "user-1"
  });

  assert.equal(summary.summary, "Buyer wants a quote for 500 units.");
  assert.equal(summary.intentLevel, "high");
  assert.equal(summary.nextAction, "Send revised quotation");
  assert.equal(suggestion.status, "draft");
  assert.equal(suggestion.externalConversationId, "conv-1");
  assert.deepEqual(await store.getLatestAiSummary(scope), summary);
  assert.deepEqual(await store.listReplySuggestions(conversationScope), [suggestion]);
  assert.equal(
    await store.getLatestAiSummary({
      orgId: "org_internal",
      sellerAccountExternalId: "seller-2",
      externalCustomerId: "customer-1"
    }),
    null
  );
});

test("internal users can issue and resolve sessions", async () => {
  const store = new InMemorySyncStore();
  const futureExpiresAt = new Date(Date.now() + 60_000).toISOString();
  const user = await store.createInternalUser({
    orgId: "org_internal",
    email: "admin@example.com",
    displayName: "Admin User",
    passwordHash: "password-hash",
    roles: ["admin"]
  });

  const session = await store.issueInternalSession({
    orgId: "org_internal",
    email: "admin@example.com",
    passwordHash: "password-hash",
    token: "session-token",
    expiresAt: futureExpiresAt
  });

  assert.equal(user.email, "admin@example.com");
  assert.deepEqual(user.roles, ["admin"]);
  assert.equal(session.token, "session-token");
  assert.equal(session.userId, user.id);
  assert.deepEqual(session.roles, ["admin"]);
  assert.deepEqual(await store.getInternalSession("session-token"), session);
  assert.equal(await store.getInternalSession("wrong-token"), null);
  await assert.rejects(
    () =>
      store.issueInternalSession({
        orgId: "org_internal",
        email: "admin@example.com",
        passwordHash: "wrong"
      }),
    /invalid_credentials/
  );
});

test("internal users can be listed, updated, disabled, reset, and resolved for credential checks", async () => {
  const store = new InMemorySyncStore();
  const created = await store.createInternalUser({
    orgId: "org_internal",
    email: "Admin@Example.com",
    displayName: "Admin User",
    passwordHash: "scrypt$hash-1",
    roles: ["admin"]
  });

  assert.equal(created.email, "admin@example.com");

  const credentials = await store.getInternalUserCredentials({
    orgId: "org_internal",
    email: "ADMIN@example.com"
  });
  assert.equal(credentials?.passwordHash, "scrypt$hash-1");

  const users = await store.listInternalUsers("org_internal");
  assert.equal(users.length, 1);
  assert.equal(users[0].email, "admin@example.com");
  assert.equal("passwordHash" in users[0], false);

  const disabled = await store.updateInternalUser({
    orgId: "org_internal",
    userId: created.id,
    status: "disabled"
  });
  assert.equal(disabled.status, "disabled");

  await assert.rejects(
    () =>
      store.issueInternalSession({
        orgId: "org_internal",
        email: "admin@example.com",
        passwordHash: "scrypt$hash-1"
      }),
    /invalid_credentials/
  );

  const reset = await store.updateInternalUser({
    orgId: "org_internal",
    userId: created.id,
    passwordHash: "scrypt$hash-2",
    status: "active",
    roles: ["supervisor", "sales"]
  });
  assert.deepEqual(reset.roles, ["supervisor", "sales"]);
  assert.equal(
    (await store.getInternalUserCredentials({ orgId: "org_internal", email: "admin@example.com" }))?.passwordHash,
    "scrypt$hash-2"
  );

  const session = await store.issueInternalSession({
    orgId: "org_internal",
    email: " ADMIN@example.com ",
    passwordHash: "scrypt$hash-2",
    token: "session-token"
  });
  assert.equal(session.token, "session-token");
  await store.updateInternalUser({
    orgId: "org_internal",
    userId: created.id,
    status: "disabled"
  });
  assert.equal(await store.getInternalSession("session-token"), null);
  assert.equal(await store.revokeInternalSession({ token: "session-token" }), true);
  assert.equal(await store.revokeInternalSession({ token: "session-token" }), false);
  assert.equal(await store.getInternalSession("session-token"), null);
});

test("collector devices authenticate by one-time tokens and can be revoked", async () => {
  const store = new InMemorySyncStore();
  const registered = await store.registerCollectorDevice({
    orgId: "org_internal",
    deviceName: "MacBook",
    token: "collector-token"
  });

  assert.equal(registered.orgId, "org_internal");
  assert.equal(registered.deviceName, "MacBook");
  assert.equal(registered.status, "active");
  assert.equal(registered.token, "collector-token");
  assert.notEqual(registered.tokenHash, "collector-token");

  const devices = await store.listCollectorDevices("org_internal");
  assert.equal(devices.length, 1);
  assert.equal(devices[0].id, registered.id);
  assert.equal("token" in devices[0], false);
  assert.equal("tokenHash" in devices[0], false);

  const authenticated = await store.authenticateCollectorDevice("collector-token");
  assert.deepEqual(authenticated, devices[0]);
  assert.equal(await store.authenticateCollectorDevice("wrong-token"), null);

  const revoked = await store.revokeCollectorDevice({
    orgId: "org_internal",
    deviceId: registered.id
  });
  assert.equal(revoked.status, "revoked");
  assert.equal(await store.authenticateCollectorDevice("collector-token"), null);
});
