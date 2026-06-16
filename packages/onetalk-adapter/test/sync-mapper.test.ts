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
  assert.equal(batch.channel, "alibaba-im");
  assert.deepEqual(batch.channelAccount, {
    channel: "alibaba-im",
    externalAccountId: "seller-demo",
    displayName: "Seller Demo",
    surface: "onetalk-web"
  });
  assert.equal(batch.sourceMeta?.source, "chrome-extension");
  assert.equal(batch.sourceMeta?.surface, "onetalk-web");
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
          buyerName: "Buyer Sample",
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

  assert.equal(batch.customers?.[0].displayName, "Buyer Sample");
  assert.equal(batch.conversations?.[0].lastMessageAt, "2026-05-27T04:05:00.000Z");
  assert.equal(batch.messages?.[0].externalMessageId, "msg-alt");
  assert.equal(batch.messages?.[0].content, "I would like to have a copy of your catalog");
  assert.equal(batch.messages?.[0].sentAt, "2026-05-27T04:05:00.000Z");
  assert.equal(batch.messages?.[0].direction, "received");
});

test("mapWebliteToSyncBatch preserves rich product card metadata from OneTalk messages", () => {
  const productUrl = "https://workspace.alibaba.com/card?type=2000&ids=1601793092954";
  const batch = mapWebliteToSyncBatch({
    sellerAccount: { externalAccountId: "seller-demo" },
    device: { deviceId: "chrome-extension-demo" },
    collectedAt: "2026-06-15T10:45:00.000Z",
    source: "chrome-extension",
    previousCursor: null,
    weblite: {
      html: "",
      bootstrap: { aliId: "seller-ali" },
      conversations: [{ cid: "conv-product", contactAccountId: "buyer-product" }]
    },
    messagesByConversationId: {
      "conv-product": [
        {
          messageId: "msg-product",
          senderAliId: "buyer-ali",
          content: productUrl,
          productCard: {
            url: productUrl,
            title: "Outdoor Travel Essential Pet Foldable Bowl",
            imageUrl: "https://img.example.com/product.jpg",
            priceText: "CN¥5.72-6.73",
            moqText: "最小订购量：100 Pieces",
            productId: "1601793092954"
          },
          sendTime: 1781520300000
        }
      ]
    }
  });

  assert.deepEqual(batch.messages?.[0].richContent, [
    {
      type: "product",
      url: productUrl,
      title: "Outdoor Travel Essential Pet Foldable Bowl",
      imageUrl: "https://img.example.com/product.jpg",
      priceText: "CN¥5.72-6.73",
      moqText: "最小订购量：100 Pieces",
      productId: "1601793092954"
    }
  ]);
});

test("mapWebliteToSyncBatch extracts product card metadata from serialized OneTalk content", () => {
  const productUrl = "https://workspace.alibaba.com/card?type=2000&ids=1601793092954";
  const batch = mapWebliteToSyncBatch({
    sellerAccount: { externalAccountId: "seller-demo" },
    device: { deviceId: "chrome-extension-demo" },
    collectedAt: "2026-06-16T02:23:00.000Z",
    source: "chrome-extension",
    previousCursor: null,
    weblite: {
      html: "",
      bootstrap: { aliId: "seller-ali" },
      conversations: [{ cid: "conv-product-json", contactAccountId: "buyer-product" }]
    },
    messagesByConversationId: {
      "conv-product-json": [
        {
          messageId: "msg-product-json",
          senderAliId: "buyer-ali",
          content: JSON.stringify({
            contentType: "card",
            text: { content: productUrl },
            card: {
              actionUrl: productUrl,
              productInfo: {
                subject: "High-Quality Newly Design Kitchen Bowl Plate Tableware",
                image: { url: "https://img.example.com/kitchen-rack.jpg" },
                price: { text: "CN¥46.11-55.31" },
                moq: { value: 500, unit: "Pieces" },
                offerId: "1601793092954"
              }
            }
          }),
          sendTime: 1781598180000
        }
      ]
    }
  });

  assert.deepEqual(batch.messages?.[0].richContent, [
    {
      type: "product",
      url: productUrl,
      title: "High-Quality Newly Design Kitchen Bowl Plate Tableware",
      imageUrl: "https://img.example.com/kitchen-rack.jpg",
      priceText: "CN¥46.11-55.31",
      moqText: "500 Pieces",
      productId: "1601793092954"
    }
  ]);
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

test("mapWebliteToSyncBatch maps SDK conversation customer fields without DOM snapshots", () => {
  const batch = mapWebliteToSyncBatch({
    sellerAccount: { externalAccountId: "seller-demo" },
    device: { deviceId: "chrome-extension-demo" },
    collectedAt: "2026-05-27T09:20:00.000Z",
    source: "chrome-extension",
    previousCursor: null,
    weblite: {
      html: "",
      bootstrap: { aliId: "seller-ali" },
      conversations: [
        {
          cid: "conv-sdk-1",
          name: "Root Conversation Name",
          accountIdEncrypt: "root-account-should-not-win",
          aliIdEncrypt: "root-ali-should-not-win",
          latestMessage: {
            gmtChatLong: 1779873600000,
            message: {
              sendTime: 1779873600000,
              contact: {
                name: "Stale Active Contact Name",
                companyName: "Stale Active Contact Co.",
                loginId: "stale-active-contact-login",
                accountIdEncrypt: "stale-active-account-encrypted",
                complianceCountryCode: "CN"
              },
              owner: {
                name: "Seller Owner Name",
                loginId: "seller-login"
              }
            }
          },
          contact: {
            name: "Contact Natural Name",
            companyName: "Contact Co.",
            loginId: "contact-login",
            loginIdEncrypt: "buyer-login-encrypted",
            accountIdEncrypt: "buyer-account-encrypted",
            aliIdEncrypt: "buyer-ali-encrypted",
            fullPortrait: "https://img.example/contact.png",
            complianceCountryCode: "US",
            currentTimeZone: "Asia/Shanghai"
          }
        }
      ]
    },
    messagesByConversationId: {
      "conv-sdk-1": []
    }
  });

  assert.deepEqual(batch.customers, [
    {
      externalCustomerId: "contact-login",
      loginId: "contact-login",
      displayName: "Contact Natural Name",
      country: "US",
      companyName: "Contact Co.",
      avatarUrl: "https://img.example/contact.png",
      currentTimeZone: "Asia/Shanghai",
      accountIdEncrypt: "buyer-account-encrypted",
      aliIdEncrypt: "buyer-ali-encrypted",
      loginIdEncrypt: "buyer-login-encrypted"
    }
  ]);
  assert.deepEqual(batch.conversations, [
    {
      externalConversationId: "conv-sdk-1",
      externalCustomerId: "contact-login",
      lastMessageAt: "2026-05-27T09:20:00.000Z"
    }
  ]);
});

test("mapWebliteToSyncBatch uses stable loginId as the customer anchor across rotating encrypted ids", () => {
  const sellerStableId = "2500001744639";
  const buyerStableId = "2500000676595";
  const first = mapWebliteToSyncBatch({
    sellerAccount: { externalAccountId: "seller-demo" },
    device: { deviceId: "chrome-extension-demo" },
    collectedAt: "2026-05-27T09:20:00.000Z",
    source: "chrome-extension",
    previousCursor: null,
    weblite: {
      html: "",
      bootstrap: { aliId: sellerStableId },
      conversations: [
        {
          cid: `${buyerStableId}-${sellerStableId}#11011@icbu`,
          contact: {
            name: "Contact Natural Name",
            loginId: "contact-login",
            accountIdEncrypt: "rotating-encrypted-id-1"
          }
        }
      ]
    },
    messagesByConversationId: {}
  });
  const second = mapWebliteToSyncBatch({
    sellerAccount: { externalAccountId: "seller-demo" },
    device: { deviceId: "chrome-extension-demo" },
    collectedAt: "2026-05-27T09:30:00.000Z",
    source: "chrome-extension",
    previousCursor: null,
    weblite: {
      html: "",
      bootstrap: { aliId: sellerStableId },
      conversations: [
        {
          cid: `${buyerStableId}-${sellerStableId}#11011@icbu`,
          contact: {
            name: "Contact Natural Name",
            loginId: "contact-login",
            accountIdEncrypt: "rotating-encrypted-id-2"
          }
        }
      ]
    },
    messagesByConversationId: {}
  });

  assert.equal(first.customers?.[0].externalCustomerId, "contact-login");
  assert.equal(second.customers?.[0].externalCustomerId, "contact-login");
  assert.equal(first.conversations?.[0].externalCustomerId, "contact-login");
  assert.equal(second.conversations?.[0].externalCustomerId, "contact-login");
});

test("mapWebliteToSyncBatch does not split one buyer across conversations when bootstrap.aliId is missing", () => {
  // Regression: with the page-SDK source, bootstrap.aliId is empty. The cid
  // pair places the seller on either side, so the old cid-guess produced a
  // different externalCustomerId per conversation, splitting one buyer into
  // several customers. loginId is the same across both, so they must collapse.
  const batch = mapWebliteToSyncBatch({
    sellerAccount: { externalAccountId: "seller-demo" },
    device: { deviceId: "chrome-extension-demo" },
    collectedAt: "2026-05-27T09:20:00.000Z",
    source: "chrome-extension",
    previousCursor: null,
    weblite: {
      html: "",
      bootstrap: {},
      conversations: [
        {
          cid: "2208575300890-2500001744639#11011@icbu",
          contact: { name: "Mark Liu", loginId: "cn1533540714pmvw" }
        },
        {
          cid: "2500001744639-2208575300890#22022@icbu",
          contact: { name: "Mark Liu", loginId: "cn1533540714pmvw" }
        }
      ]
    },
    messagesByConversationId: {}
  });

  assert.equal(batch.customers?.length, 1, "one buyer, one customer");
  assert.equal(batch.customers?.[0].externalCustomerId, "cn1533540714pmvw");
  assert.equal(batch.conversations?.length, 2, "both conversations retained");
  assert.ok(batch.conversations?.every((c) => c.externalCustomerId === "cn1533540714pmvw"));
});
