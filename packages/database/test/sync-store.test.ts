import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore } from "../src/index.js";

test("acceptSyncBatch stores seller account, customer, conversation, and messages", async () => {
  const store = new InMemorySyncStore();
  const result = await store.acceptSyncBatch({
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
  assert.equal(store.listSellerAccounts().length, 1);
  assert.equal(store.listCustomers().length, 1);
  assert.equal(store.listConversations().length, 1);
  assert.equal(store.listMessages().length, 1);
});

test("acceptSyncBatch is idempotent by external message id", async () => {
  const store = new InMemorySyncStore();
  const batch = {
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
  assert.equal(store.listMessages().length, 1);
});

test("acceptSyncBatch keeps identical external ids isolated by channel", async () => {
  const store = new InMemorySyncStore();

  const first = await store.acceptSyncBatch(channelBatch("alibaba-im", "seller-alibaba", "hello from alibaba"));
  const second = await store.acceptSyncBatch(channelBatch("mock-web", "seller-web", "hello from web chat"));

  assert.equal(first.acceptedCount, 1);
  assert.equal(second.acceptedCount, 1);
  assert.deepEqual(
    store.listCustomers().map((customer) => [customer.channel, customer.channelAccountExternalId, customer.externalCustomerId]),
    [
      ["alibaba-im", "seller-alibaba", "customer-same"],
      ["mock-web", "seller-web", "customer-same"]
    ]
  );
  assert.deepEqual(
    store.listConversations().map((conversation) => [
      conversation.channel,
      conversation.channelAccountExternalId,
      conversation.externalConversationId
    ]),
    [
      ["alibaba-im", "seller-alibaba", "conv-same"],
      ["mock-web", "seller-web", "conv-same"]
    ]
  );
  assert.deepEqual(
    store.listMessages().map((message) => [
      message.channel,
      message.channelAccountExternalId,
      message.externalMessageId,
      message.content
    ]),
    [
      ["alibaba-im", "seller-alibaba", "msg-same", "hello from alibaba"],
      ["mock-web", "seller-web", "msg-same", "hello from web chat"]
    ]
  );
});

test("acceptSyncBatch deduplicates messages without upstream ids by content hash", async () => {
  const store = new InMemorySyncStore();
  await store.acceptSyncBatch({
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

  assert.equal(store.listMessages().length, 1);
  assert.equal(store.listMessages()[0].contentHash.length, 64);
});

function channelBatch(channel: string, channelAccountExternalId: string, content: string) {
  return {
    channel,
    channelAccount: {
      channel,
      externalAccountId: channelAccountExternalId,
      displayName: channelAccountExternalId,
      surface: channel === "alibaba-im" ? "onetalk-web" : "mock-web"
    },
    sellerAccount: { externalAccountId: "seller-1" },
    device: { deviceId: `device-${channel}` },
    customers: [{ externalCustomerId: "customer-same", displayName: `Buyer ${channel}` }],
    conversations: [{ externalConversationId: "conv-same", externalCustomerId: "customer-same" }],
    messages: [
      {
        externalConversationId: "conv-same",
        externalMessageId: "msg-same",
        direction: "received" as const,
        content,
        sentAt: "2026-05-25T09:00:00.000Z"
      }
    ]
  };
}

test("acceptSyncBatch rejects messages for unknown conversations", async () => {
  const store = new InMemorySyncStore();
  const result = await store.acceptSyncBatch({
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
  assert.equal(store.listMessages().length, 0);
});

test("customer collaboration records are scoped by seller account and customer", async () => {
  const store = new InMemorySyncStore();
  const scope = {
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1"
  };
  const otherScope = {
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

test("customer assignments, follow-up updates, and audit logs are stored without organization scope", async () => {
  const store = new InMemorySyncStore();
  const scope = {
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
    taskId: task.id,
    status: "done",
    title: "Send revised quotation tomorrow",
    assignedToUserId: "user-2",
    dueAt: "2026-05-27T09:00:00.000Z"
  });
  const audit = await store.appendAuditLog({
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
  assert.deepEqual(await store.listAuditLogs(), [audit]);
});

test("AI summaries and reply suggestions are scoped and retrievable", async () => {
  const store = new InMemorySyncStore();
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
      sellerAccountExternalId: "seller-2",
      externalCustomerId: "customer-1"
    }),
    null
  );
});

test("outbound messages are queued and marked delivered by collector devices", async () => {
  const store = new InMemorySyncStore();
  await store.acceptSyncBatch({
    sellerAccount: { externalAccountId: "seller-1" },
    device: { deviceId: "device-1" },
    customers: [{ externalCustomerId: "customer-1" }],
    conversations: [{ externalConversationId: "conv-1", externalCustomerId: "customer-1" }]
  });

  const queued = await store.createOutboundMessage({
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1",
    externalConversationId: "conv-1",
    content: "Thanks, I will send the quotation today.",
    createdByUserId: "sales-1"
  });

  assert.equal(queued.status, "queued");
  assert.equal(queued.content, "Thanks, I will send the quotation today.");

  const pending = await store.listPendingOutboundMessages({
    sellerAccountExternalId: "seller-1",
    limit: 10
  });
  assert.deepEqual(pending, [queued]);

  const sent = await store.markOutboundMessageDelivered({
    id: queued.id,
    sellerAccountExternalId: "seller-1",
    status: "sent",
    externalMessageId: "onetalk-msg-1",
    deliveredByDeviceId: "device-1",
    deliveredAt: "2026-05-27T07:00:00.000Z"
  });

  assert.equal(sent.status, "sent");
  assert.equal(sent.externalMessageId, "onetalk-msg-1");
  assert.equal(sent.deliveredByDeviceId, "device-1");
  assert.equal((await store.listPendingOutboundMessages({ sellerAccountExternalId: "seller-1", limit: 10 })).length, 0);
});

test("outbound messages are claimed once until lease expires", async () => {
  const store = new InMemorySyncStore();
  await store.acceptSyncBatch({
    sellerAccount: { externalAccountId: "seller-1" },
    device: { deviceId: "device-1" },
    customers: [{ externalCustomerId: "customer-1" }],
    conversations: [{ externalConversationId: "conv-1", externalCustomerId: "customer-1" }]
  });
  await store.createOutboundMessage({
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1",
    externalConversationId: "conv-1",
    content: "Please check the updated quote."
  });

  const first = await store.claimPendingOutboundMessages({
    sellerAccountExternalId: "seller-1",
    deviceId: "device-a",
    limit: 10,
    leaseMs: 120000,
    now: new Date("2026-06-01T00:00:00.000Z")
  });
  const second = await store.claimPendingOutboundMessages({
    sellerAccountExternalId: "seller-1",
    deviceId: "device-b",
    limit: 10,
    leaseMs: 120000,
    now: new Date("2026-06-01T00:00:30.000Z")
  });
  const hiddenFromPolling = await store.listPendingOutboundMessages({
    sellerAccountExternalId: "seller-1",
    limit: 10,
    now: new Date("2026-06-01T00:00:30.000Z")
  });
  const expired = await store.claimPendingOutboundMessages({
    sellerAccountExternalId: "seller-1",
    deviceId: "device-b",
    limit: 10,
    leaseMs: 120000,
    now: new Date("2026-06-01T00:03:00.000Z")
  });

  assert.equal(first.length, 1);
  assert.equal(first[0].claimedByDeviceId, "device-a");
  assert.equal(first[0].claimExpiresAt, "2026-06-01T00:02:00.000Z");
  assert.equal(second.length, 0);
  assert.equal(hiddenFromPolling.length, 0);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].claimedByDeviceId, "device-b");
});

test("internal user invitations can be created, inspected, and accepted once", async () => {
  const store = new InMemorySyncStore();
  const invitation = await store.createUserInvitation({
    email: "Invitee@Example.com",
    displayName: "Invitee",
    roles: ["sales"],
    createdByUserId: "admin-1",
    token: "invite-token",
    expiresAt: "2030-01-01T00:00:00.000Z"
  });

  assert.equal(invitation.email, "invitee@example.com");
  assert.equal(invitation.token, "invite-token");
  assert.equal("tokenHash" in invitation, false);

  const inspected = await store.getUserInvitation("invite-token");
  assert.equal(inspected?.email, "invitee@example.com");
  assert.equal(inspected && "token" in inspected, false);

  const accepted = await store.acceptUserInvitation({
    token: "invite-token",
    passwordHash: "scrypt$password"
  });
  assert.equal(accepted.user.email, "invitee@example.com");
  assert.equal(accepted.invitation.acceptedAt !== undefined, true);
  assert.equal("token" in accepted.invitation, false);

  await assert.rejects(
    () => store.acceptUserInvitation({ token: "invite-token", passwordHash: "scrypt$password" }),
    /invitation_already_accepted/
  );
});

test("internal users can issue and resolve sessions", async () => {
  const store = new InMemorySyncStore();
  const futureExpiresAt = new Date(Date.now() + 60_000).toISOString();
  const user = await store.createInternalUser({
    email: "admin@example.com",
    displayName: "Admin User",
    passwordHash: "password-hash",
    roles: ["admin"]
  });

  const session = await store.issueInternalSession({
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
        email: "admin@example.com",
        passwordHash: "wrong"
      }),
    /invalid_credentials/
  );
});

test("internal users can be listed, updated, disabled, reset, and resolved for credential checks", async () => {
  const store = new InMemorySyncStore();
  const created = await store.createInternalUser({
    email: "Admin@Example.com",
    displayName: "Admin User",
    passwordHash: "scrypt$hash-1",
    roles: ["admin"]
  });

  assert.equal(created.email, "admin@example.com");

  const credentials = await store.getInternalUserCredentials({
    email: "ADMIN@example.com"
  });
  assert.equal(credentials?.passwordHash, "scrypt$hash-1");

  const users = await store.listInternalUsers();
  assert.equal(users.length, 1);
  assert.equal(users[0].email, "admin@example.com");
  assert.equal("passwordHash" in users[0], false);

  const disabled = await store.updateInternalUser({
    userId: created.id,
    status: "disabled"
  });
  assert.equal(disabled.status, "disabled");

  await assert.rejects(
    () =>
      store.issueInternalSession({
        email: "admin@example.com",
        passwordHash: "scrypt$hash-1"
      }),
    /invalid_credentials/
  );

  const reset = await store.updateInternalUser({
    userId: created.id,
    passwordHash: "scrypt$hash-2",
    status: "active",
    roles: ["supervisor", "sales"]
  });
  assert.deepEqual(reset.roles, ["supervisor", "sales"]);
  assert.equal(
    (await store.getInternalUserCredentials({ email: "admin@example.com" }))?.passwordHash,
    "scrypt$hash-2"
  );

  const session = await store.issueInternalSession({
    email: " ADMIN@example.com ",
    passwordHash: "scrypt$hash-2",
    token: "session-token"
  });
  assert.equal(session.token, "session-token");
  await store.updateInternalUser({
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
    externalDeviceId: "desktop-demo",
    deviceName: "MacBook",
    token: "collector-token"
  });

  assert.equal(registered.externalDeviceId, "desktop-demo");
  assert.equal(registered.deviceName, "MacBook");
  assert.equal(registered.status, "active");
  assert.equal(registered.token, "collector-token");
  assert.notEqual(registered.tokenHash, "collector-token");

  const devices = await store.listCollectorDevices();
  assert.equal(devices.length, 1);
  assert.equal(devices[0].id, registered.id);
  assert.equal("token" in devices[0], false);
  assert.equal("tokenHash" in devices[0], false);

  const authenticated = await store.authenticateCollectorDevice("collector-token");
  assert.deepEqual(authenticated, devices[0]);
  assert.equal(await store.authenticateCollectorDevice("wrong-token"), null);

  const revoked = await store.revokeCollectorDevice({
    deviceId: registered.id
  });
  assert.equal(revoked.status, "revoked");
  assert.equal(await store.authenticateCollectorDevice("collector-token"), null);
});

test("collector device activation updates existing external devices without exposing token hashes", async () => {
  const store = new InMemorySyncStore();
  const first = await store.registerCollectorDevice({
    sellerAccountExternalId: "seller-demo",
    externalDeviceId: "chrome-extension-demo",
    deviceName: "Chrome Extension",
    token: "collector-token"
  });
  const updated = await store.registerCollectorDevice({
    sellerAccountExternalId: "seller-demo",
    externalDeviceId: "chrome-extension-demo",
    deviceName: "Chrome Extension Updated",
    token: "rotated-token"
  });

  assert.equal(updated.id, first.id);
  assert.equal(updated.externalDeviceId, "chrome-extension-demo");
  assert.equal(updated.token, "rotated-token");
  assert.equal((await store.listCollectorDevices()).length, 1);
  assert.equal(await store.authenticateCollectorDevice("collector-token"), null);
  assert.equal((await store.authenticateCollectorDevice("rotated-token"))?.id, first.id);
});

test("internal users are unique by email in single-tenant mode", async () => {
  const store = new InMemorySyncStore();
  const first = await store.createInternalUser({
    email: " Admin@Example.com ",
    displayName: "Admin",
    passwordHash: "hash-1",
    roles: ["admin"]
  });
  const second = await store.createInternalUser({
    email: "admin@example.com",
    displayName: "Admin Updated",
    passwordHash: "hash-2",
    roles: ["supervisor"]
  });

  assert.equal(second.id, first.id);
  assert.equal(second.email, "admin@example.com");
  assert.equal(["org", "Id"].join("") in second, false);
  assert.deepEqual(second.roles, ["supervisor"]);
  assert.equal((await store.listInternalUsers()).length, 1);
});

test("internal sessions resolve users without organization scope", async () => {
  const store = new InMemorySyncStore();
  await store.createInternalUser({
    email: "sales@example.com",
    displayName: "Sales",
    passwordHash: "hash",
    roles: ["sales"]
  });

  const session = await store.issueInternalSession({
    email: "sales@example.com",
    passwordHash: "hash",
    token: "session-token"
  });

  assert.equal(session.email, "sales@example.com");
  assert.equal(["org", "Id"].join("") in session, false);
  assert.deepEqual(session.roles, ["sales"]);
  assert.equal((await store.getInternalSession("session-token"))?.userId, session.userId);
});
