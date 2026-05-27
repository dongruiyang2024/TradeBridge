import assert from "node:assert/strict";
import { test } from "node:test";
import { mapWebliteToSyncBatch } from "../src/browser.js";

test("mapWebliteToSyncBatch maps conversations and messages into collector batch shape", () => {
  const batch = mapWebliteToSyncBatch({
    sellerAccount: { externalAccountId: "seller-demo", displayName: "Seller Demo" },
    device: { deviceId: "chrome-extension-demo", deviceName: "Chrome Extension" },
    collectedAt: "2026-05-26T08:10:00.000Z",
    source: "chrome-extension",
    previousCursor: null,
    weblite: {
      html: "",
      bootstrap: { aliId: "self-ali" },
      conversations: [
        {
          cid: "conv-1",
          contactAccountId: "buyer-1",
          contactNick: "Buyer One",
          lastMessageTime: 1779706200000
        }
      ]
    },
    messagesByConversationId: {
      "conv-1": [
        {
          messageId: "m1",
          senderAliId: "self-ali",
          messageType: "text",
          content: "I can ship tomorrow",
          sendTime: 1779706140000
        },
        {
          messageId: "m2",
          senderAliId: "buyer-ali",
          messageType: "text",
          content: "Thanks",
          sendTime: 1779706200000
        }
      ]
    }
  });

  assert.equal(Object.hasOwn(batch, ["org", "Id"].join("")), false);
  assert.equal(batch.sourceMeta?.source, "chrome-extension");
  assert.equal(batch.sourceMeta?.sourceBatchKey, "seller-demo:chrome-extension-demo:2026-05-26T08:10:00.000Z");
  assert.deepEqual(batch.customers, [
    {
      externalCustomerId: "buyer-1",
      displayName: "Buyer One"
    }
  ]);
  assert.deepEqual(batch.conversations, [
    {
      externalConversationId: "conv-1",
      externalCustomerId: "buyer-1",
      lastMessageAt: "2026-05-25T10:50:00.000Z"
    }
  ]);
  assert.deepEqual(batch.messages?.map((message) => [message.externalMessageId, message.direction]), [
    ["m1", "sent"],
    ["m2", "received"]
  ]);
});

test("mapWebliteToSyncBatch filters messages at or before the previous cursor", () => {
  const batch = mapWebliteToSyncBatch({
    sellerAccount: { externalAccountId: "seller-demo" },
    device: { deviceId: "chrome-extension-demo" },
    collectedAt: "2026-05-26T08:10:00.000Z",
    source: "chrome-extension",
    previousCursor: "2026-05-25T10:49:00.000Z",
    weblite: {
      html: "",
      bootstrap: { aliId: "self-ali" },
      conversations: [{ cid: "conv-1", contactAccountId: "buyer-1" }]
    },
    messagesByConversationId: {
      "conv-1": [
        { messageId: "old", senderAliId: "buyer", content: "old", sendTime: 1779706140000 },
        { messageId: "new", senderAliId: "buyer", content: "new", sendTime: 1779706200000 }
      ]
    }
  });

  assert.deepEqual(batch.messages?.map((message) => message.externalMessageId), ["new"]);
});

test("mapWebliteToSyncBatch maps alternate OneTalk customer and message fields", () => {
  const batch = mapWebliteToSyncBatch({
    sellerAccount: { externalAccountId: "seller-demo" },
    device: { deviceId: "chrome-extension-demo" },
    collectedAt: "2026-05-27T04:10:00.000Z",
    source: "chrome-extension",
    previousCursor: null,
    weblite: {
      html: "",
      bootstrap: { aliId: "seller-ali" },
      conversations: [
        {
          id: "conv-alt",
          buyerAccountId: "buyer-alt",
          buyerName: "Peter SHU",
          country: "CN",
          latestMessage: { sendTime: 1779854700000 },
          selfAliId: "seller-ali"
        }
      ]
    },
    messagesByConversationId: {
      "conv-alt": [
        {
          msgId: "msg-alt",
          fromId: "buyer-ali",
          msgType: "text",
          messageContent: "I would like to have a copy of your catalog",
          gmtCreate: "2026-05-27T04:05:00.000Z"
        }
      ]
    }
  });

  assert.equal(batch.customers?.[0].displayName, "Peter SHU");
  assert.equal(batch.conversations?.[0].lastMessageAt, "2026-05-27T04:05:00.000Z");
  assert.equal(batch.messages?.[0].externalMessageId, "msg-alt");
  assert.equal(batch.messages?.[0].content, "I would like to have a copy of your catalog");
  assert.equal(batch.messages?.[0].sentAt, "2026-05-27T04:05:00.000Z");
  assert.equal(batch.messages?.[0].direction, "received");
});

test("mapWebliteToSyncBatch maps LWP conversation and message models from OneTalk WebSocket", () => {
  const lastMessageAt = Date.parse("2026-05-27T04:33:20.000Z");
  const inboundAt = Date.parse("2026-05-27T04:32:30.000Z");
  const outboundAt = Date.parse("2026-05-27T04:33:10.000Z");

  const batch = mapWebliteToSyncBatch({
    sellerAccount: { externalAccountId: "seller-demo" },
    device: { deviceId: "chrome-extension-demo" },
    collectedAt: "2026-05-27T04:40:00.000Z",
    source: "chrome-extension",
    previousCursor: null,
    weblite: {
      html: "",
      bootstrap: { aliId: "seller-ali" },
      conversations: [
        {
          singleChatUserConversation: {
            modifyTime: lastMessageAt,
            lastMessage: {
              message: {
                cid: "conv-lwp-1",
                createAt: lastMessageAt,
                content: { contentType: 1, text: { content: "latest message" } }
              }
            },
            singleChatConversation: {
              cid: "conv-lwp-1",
              pairFirst: "seller-ali",
              pairSecond: "buyer-ali"
            }
          }
        }
      ]
    },
    messagesByConversationId: {
      "conv-lwp-1": [
        {
          message: {
            messageId: "msg-lwp-in",
            cid: "conv-lwp-1",
            createAt: inboundAt,
            content: { contentType: 1, text: { content: "Hello from buyer" } },
            searchableContent: { summary: "Hello from buyer" },
            sender: { uid: "buyer-ali" },
            receivers: [{ uid: "seller-ali" }]
          }
        },
        {
          message: {
            messageId: "msg-lwp-out",
            cid: "conv-lwp-1",
            createAt: outboundAt,
            content: { contentType: 1, text: { content: "Offer sent" } },
            searchableContent: { summary: "Offer sent" },
            sender: { uid: "seller-ali" },
            receivers: [{ uid: "buyer-ali" }]
          }
        }
      ]
    }
  });

  assert.deepEqual(batch.customers, [{ externalCustomerId: "buyer-ali" }]);
  assert.deepEqual(batch.conversations, [
    {
      externalConversationId: "conv-lwp-1",
      externalCustomerId: "buyer-ali",
      lastMessageAt: "2026-05-27T04:33:20.000Z"
    }
  ]);
  assert.deepEqual(
    batch.messages?.map((message) => ({
      id: message.externalMessageId,
      direction: message.direction,
      content: message.content,
      sentAt: message.sentAt
    })),
    [
      {
        id: "msg-lwp-in",
        direction: "received",
        content: "Hello from buyer",
        sentAt: "2026-05-27T04:32:30.000Z"
      },
      {
        id: "msg-lwp-out",
        direction: "sent",
        content: "Offer sent",
        sentAt: "2026-05-27T04:33:10.000Z"
      }
    ]
  );
});
