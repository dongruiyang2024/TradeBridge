import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILT_IN_CHANNEL_IDS,
  buildCollectorWsMessage,
  isCollectorHelloMessage,
  isChannelSyncBatch,
  isOutboundClaimMessage,
  parseCollectorWsMessage
} from "../src/index.js";

test("collector protocol parses hello and outbound claim messages", () => {
  const hello = parseCollectorWsMessage(
    JSON.stringify({
      v: 1,
      id: "msg-1",
      type: "collector.hello",
      sentAt: "2026-06-01T00:00:00.000Z",
      payload: {
        collectorToken: "collector-token",
        deviceId: "device-1",
        deviceName: "Chrome Extension",
        capabilities: ["outbound.claim", "delivery.report"]
      }
    })
  );

  assert.equal(isCollectorHelloMessage(hello), true);
  assert.equal(hello.payload.collectorToken, "collector-token");

  const claim = parseCollectorWsMessage(
    JSON.stringify({
      v: 1,
      id: "msg-2",
      type: "outbound.claim",
      sentAt: "2026-06-01T00:00:01.000Z",
      payload: { limit: 10, leaseMs: 120000 }
    })
  );

  assert.equal(isOutboundClaimMessage(claim), true);
  assert.equal(claim.payload.limit, 10);
});

test("collector protocol rejects invalid payloads", () => {
  assert.throws(() => parseCollectorWsMessage("not-json"), /collector_ws_invalid_json/);
  assert.throws(
    () => parseCollectorWsMessage(JSON.stringify({ v: 1, id: "x", type: "collector.hello", payload: {} })),
    /collector_ws_invalid_message/
  );
});

test("collector protocol builds typed messages with timestamps", () => {
  const message = buildCollectorWsMessage({
    id: "server-1",
    type: "outbound.available",
    sentAt: "2026-06-01T00:00:02.000Z",
    payload: {
      sellerAccountExternalId: "seller-1",
      pendingCount: 2
    }
  });

  assert.deepEqual(message, {
    v: 1,
    id: "server-1",
    type: "outbound.available",
    sentAt: "2026-06-01T00:00:02.000Z",
    payload: {
      sellerAccountExternalId: "seller-1",
      pendingCount: 2
    }
  });
});

test("collector protocol owns channel sync batch semantics", () => {
  assert.deepEqual(BUILT_IN_CHANNEL_IDS, [
    "alibaba-im",
    "whatsapp-web",
    "facebook-messenger",
    "web-chat",
    "mock-web"
  ]);

  assert.equal(
    isChannelSyncBatch({
      channel: "alibaba-im",
      channelAccount: {
        channel: "alibaba-im",
        externalAccountId: "seller-ali",
        displayName: "Trial Seller",
        surface: "onetalk-web"
      },
      sellerAccount: { externalAccountId: "seller-trial" },
      device: { deviceId: "chrome-extension-trial" },
      sourceMeta: { source: "chrome-extension", surface: "onetalk-web" },
      customers: [{ externalCustomerId: "buyer-trial", displayName: "Trial Buyer" }],
      conversations: [{ externalConversationId: "conv-trial", externalCustomerId: "buyer-trial" }],
      messages: [
        {
          externalConversationId: "conv-trial",
          externalMessageId: "msg-1",
          direction: "received",
          content: "hello"
        }
      ]
    }),
    true
  );
  assert.equal(isChannelSyncBatch({ channel: "onetalk", sellerAccount: {}, device: {} }), false);
});
