import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCollectorWsMessage,
  isCollectorHelloMessage,
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
