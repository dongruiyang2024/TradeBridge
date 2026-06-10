import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCollectorWsMessage, parseCollectorWsMessage } from "@wangwang/collector-protocol";
import { createRealtimeOrchestrator } from "../src/background/realtime-orchestrator.js";
import type { OutboundMessage } from "../src/shared/sync-types.js";

test("realtime orchestrator claims outbound messages and reports delivery", async () => {
  const sent: string[] = [];
  let deliveredMessages: OutboundMessage[] = [];
  const orchestrator = createRealtimeOrchestrator({
    now: () => new Date("2026-06-01T00:00:00.000Z"),
    nextId: () => "client-msg-1",
    sendWsMessage: (message) => sent.push(JSON.stringify(message)),
    sendOutboundMessagesViaOneTalk: async ({ messages }) => {
      deliveredMessages = messages;
      return [
        {
          outboundMessageId: "outbound-1",
          status: "sent",
          externalMessageId: "onetalk-msg-1"
        }
      ];
    },
    runSyncNow: async () => ({ ok: true, acceptedCount: 1, rejectedCount: 0 })
  });

  await orchestrator.handleMessage(
    buildCollectorWsMessage({
      id: "server-1",
      type: "outbound.available",
      sentAt: "2026-06-01T00:00:00.000Z",
      payload: { sellerAccountExternalId: "seller-1", pendingCount: 1 }
    })
  );

  const claim = parseCollectorWsMessage(sent[0]);
  assert.equal(claim.type, "outbound.claim");
  assert.equal(claim.payload.limit, 4);

  await orchestrator.handleMessage(
    buildCollectorWsMessage({
      id: "server-2",
      type: "outbound.claimed",
      sentAt: "2026-06-01T00:00:00.000Z",
      payload: {
        requestId: "client-msg-1",
        leaseMs: 120000,
        messages: [outboundMessage()]
      }
    })
  );

  assert.deepEqual(deliveredMessages, [outboundMessage()]);
  const report = parseCollectorWsMessage(sent[1]);
  assert.equal(report.type, "outbound.delivery.report");
  assert.equal(report.payload.outboundMessageId, "outbound-1");
  assert.equal(report.payload.status, "sent");
  assert.equal(report.payload.externalMessageId, "onetalk-msg-1");
});

test("realtime orchestrator runs sync when server requests it", async () => {
  let syncCount = 0;
  const orchestrator = createRealtimeOrchestrator({
    sendWsMessage: () => undefined,
    sendOutboundMessagesViaOneTalk: async () => [],
    runSyncNow: async () => {
      syncCount += 1;
      return { ok: true, acceptedCount: 1, rejectedCount: 0 };
    }
  });

  await orchestrator.handleMessage(
    buildCollectorWsMessage({
      id: "server-1",
      type: "sync.request",
      sentAt: "2026-06-01T00:00:00.000Z",
      payload: { reason: "server-request" }
    })
  );

  assert.equal(syncCount, 1);
});

test("realtime orchestrator answers heartbeat pings", async () => {
  const sent: string[] = [];
  const orchestrator = createRealtimeOrchestrator({
    now: () => new Date("2026-06-01T00:00:00.000Z"),
    nextId: () => "client-msg-1",
    sendWsMessage: (message) => sent.push(JSON.stringify(message)),
    sendOutboundMessagesViaOneTalk: async () => [],
    runSyncNow: async () => ({ ok: true })
  });

  await orchestrator.handleMessage(
    buildCollectorWsMessage({
      id: "server-1",
      type: "heartbeat.ping",
      sentAt: "2026-06-01T00:00:00.000Z",
      payload: { nonce: "server-nonce-1" }
    })
  );

  const pong = parseCollectorWsMessage(sent[0]);
  assert.equal(pong.type, "heartbeat.pong");
  assert.equal(pong.payload.nonce, "server-nonce-1");
});

function outboundMessage(): OutboundMessage {
  return {
    id: "outbound-1",
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1",
    externalConversationId: "conv-1",
    content: "Hello",
    status: "queued",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z"
  };
}
