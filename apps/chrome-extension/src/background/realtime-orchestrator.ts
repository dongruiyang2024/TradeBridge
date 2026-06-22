import {
  buildCollectorWsMessage,
  type CollectorWsMessage,
  type OutboundClaimedMessage
} from "@wangwang/collector-protocol";
import type { OutboundDeliveryReport } from "./outbound-orchestrator.js";
import type { SyncNowResponse } from "../shared/extension-messages.js";
import type { OutboundMessage } from "../shared/sync-types.js";

// Claim a small batch at a time so deliveries trickle out under the pacer
// rather than arriving as a large burst. Lease must comfortably exceed the
// pacer's worst-case batch time so messages are not reclaimed mid-send.
const DEFAULT_CLAIM_LIMIT = 4;
const DEFAULT_LEASE_MS = 180_000;

export interface RealtimeOrchestrator {
  handleMessage(message: CollectorWsMessage): Promise<void>;
}

export interface RealtimeOrchestratorOptions {
  now?: () => Date;
  nextId?: () => string;
  sendWsMessage(message: CollectorWsMessage): void;
  sendOutboundMessages(input: { messages: OutboundMessage[] }): Promise<OutboundDeliveryReport[]>;
  runSyncNow(): Promise<SyncNowResponse>;
}

export function createRealtimeOrchestrator(options: RealtimeOrchestratorOptions): RealtimeOrchestrator {
  const now = options.now || (() => new Date());
  const nextId = options.nextId || (() => crypto.randomUUID());

  return {
    async handleMessage(message) {
      if (message.type === "heartbeat.ping") {
        sendHeartbeatPong(message.payload.nonce);
        return;
      }

      if (message.type === "outbound.available") {
        if (message.payload.pendingCount <= 0) return;
        claimOutboundMessages(message.payload.channel, message.payload.channelAccountExternalId);
        return;
      }

      if (message.type === "outbound.claimed") {
        await deliverClaimedMessages(message);
        return;
      }

      if (message.type === "sync.request") {
        await options.runSyncNow();
      }
    }
  };

  function claimOutboundMessages(channel?: string, channelAccountExternalId?: string): void {
    options.sendWsMessage(
      buildCollectorWsMessage({
        id: nextId(),
        type: "outbound.claim",
        sentAt: now().toISOString(),
        payload: {
          limit: DEFAULT_CLAIM_LIMIT,
          leaseMs: DEFAULT_LEASE_MS,
          channel,
          channelAccountExternalId
        }
      })
    );
  }

  function sendHeartbeatPong(nonce: string): void {
    options.sendWsMessage(
      buildCollectorWsMessage({
        id: nextId(),
        type: "heartbeat.pong",
        sentAt: now().toISOString(),
        payload: { nonce, status: "alive" }
      })
    );
  }

  async function deliverClaimedMessages(message: OutboundClaimedMessage): Promise<void> {
    const reports = await options.sendOutboundMessages({ messages: message.payload.messages });
    for (const report of reports) {
      const deliveredMessage = message.payload.messages.find((item) => item.id === report.outboundMessageId);
      options.sendWsMessage(
        buildCollectorWsMessage({
          id: nextId(),
          type: "outbound.delivery.report",
          sentAt: now().toISOString(),
          payload: {
            outboundMessageId: report.outboundMessageId,
            channel: deliveredMessage?.channel,
            channelAccountExternalId: deliveredMessage?.channelAccountExternalId,
            status: report.status,
            externalMessageId: report.externalMessageId,
            errorCode: report.errorCode,
            errorMessage: report.errorMessage,
            deliveredAt: now().toISOString()
          }
        })
      );
    }
  }
}
