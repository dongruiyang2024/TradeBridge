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
