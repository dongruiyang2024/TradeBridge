import {
  buildCollectorWsMessage,
  isCollectorHelloMessage,
  isOutboundClaimMessage,
  isOutboundDeliveryReportMessage,
  parseCollectorWsMessage,
  serializeCollectorWsMessage,
  type CollectorWsMessage,
  type CollectorWsMessageInput
} from "@wangwang/collector-protocol";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { CollectorRealtimeHub } from "./collector-realtime-hub.js";
import type { SyncStore } from "./server.js";

const HEARTBEAT_INTERVAL_MS = 20_000;
const OUTBOUND_LEASE_MS = 120_000;

export interface RegisterCollectorWsRoutesOptions {
  store: SyncStore;
  hub: CollectorRealtimeHub;
  now?: () => Date;
  nextId?: () => string;
}

export async function registerCollectorWsRoutes(
  app: FastifyInstance,
  options: RegisterCollectorWsRoutesOptions
): Promise<void> {
  const now = options.now || (() => new Date());
  const nextId = options.nextId || (() => crypto.randomUUID());

  app.get("/collector/v1/ws", { websocket: true }, (socket: WebSocket) => {
    let sessionId: string | null = null;
    let sellerAccountExternalId: string | null = null;
    let deviceId: string | null = null;
    let capabilities: string[] = [];
    const heartbeat = globalThis.setInterval(() => {
      send(socket, {
        id: nextId(),
        type: "heartbeat.ping",
        sentAt: now().toISOString(),
        payload: { nonce: nextId() }
      });
    }, HEARTBEAT_INTERVAL_MS);
    (heartbeat as { unref?: () => void }).unref?.();

    socket.on("message", (data) => {
      void handleIncoming(data.toString());
    });

    socket.on("close", () => {
      globalThis.clearInterval(heartbeat);
      if (sessionId) options.hub.removeSession(sessionId);
    });

    async function handleIncoming(data: string): Promise<void> {
      try {
        const message = parseCollectorWsMessage(data);
        if (!sessionId) {
          await handleHello(socket, message);
          return;
        }

        if (message.type === "heartbeat.pong" || message.type === "collector.status") return;

        if (isOutboundClaimMessage(message)) {
          const messages = await options.store.claimPendingOutboundMessages({
            sellerAccountExternalId: sellerAccountExternalId || "default-seller",
            deviceId: deviceId || "unknown-device",
            limit: message.payload.limit,
            leaseMs: message.payload.leaseMs || OUTBOUND_LEASE_MS,
            channel: claimChannel(message.payload.channel, capabilities),
            channelAccountExternalId: message.payload.channelAccountExternalId
          });
          send(socket, {
            id: nextId(),
            type: "outbound.claimed",
            sentAt: now().toISOString(),
            payload: {
              requestId: message.id,
              leaseMs: message.payload.leaseMs || OUTBOUND_LEASE_MS,
              messages
            }
          });
          return;
        }

        if (isOutboundDeliveryReportMessage(message)) {
          await options.store.markOutboundMessageDelivered({
            id: message.payload.outboundMessageId,
            sellerAccountExternalId: sellerAccountExternalId || "default-seller",
            channel: message.payload.channel,
            channelAccountExternalId: message.payload.channelAccountExternalId,
            status: message.payload.status,
            externalMessageId: message.payload.externalMessageId,
            deliveredByDeviceId: deviceId || undefined,
            deliveredAt: message.payload.deliveredAt,
            errorCode: message.payload.errorCode,
            errorMessage: message.payload.errorMessage
          });
          send(socket, {
            id: nextId(),
            type: "ack",
            sentAt: now().toISOString(),
            payload: { requestId: message.id }
          });
          return;
        }

        send(socket, {
          id: nextId(),
          type: "error",
          sentAt: now().toISOString(),
          payload: { requestId: message.id, code: "collector_ws_unknown_message", message: message.type }
        });
      } catch (error) {
        send(socket, {
          id: nextId(),
          type: "error",
          sentAt: now().toISOString(),
          payload: {
            code: "collector_ws_message_failed",
            message: error instanceof Error ? error.message : "collector_ws_message_failed"
          }
        });
      }
    }

    async function handleHello(socket: WebSocket, message: CollectorWsMessage): Promise<void> {
      if (!isCollectorHelloMessage(message)) {
        socket.close(1008, "collector_hello_required");
        return;
      }

      const collectorDevice = await options.store.authenticateCollectorDevice(message.payload.collectorToken);
      if (!collectorDevice) {
        socket.close(1008, "collector_unauthorized");
        return;
      }

      sessionId = nextId();
      sellerAccountExternalId = collectorDevice.sellerAccountExternalId || "default-seller";
      deviceId = collectorDevice.externalDeviceId || message.payload.deviceId;
      capabilities = message.payload.capabilities;
      options.hub.addSession({
        sessionId,
        sellerAccountExternalId,
        deviceId,
        capabilities,
        socket
      });
      send(socket, {
        id: nextId(),
        type: "collector.ready",
        sentAt: now().toISOString(),
        payload: {
          sessionId,
          sellerAccountExternalId,
          deviceId,
          heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
          serverTime: now().toISOString()
        }
      });
    }
  });
}

function claimChannel(requestedChannel: string | undefined, capabilities: string[]): string | undefined {
  if (requestedChannel) return requestedChannel;
  const supportedChannels = capabilities
    .filter((capability) => capability.startsWith("channel:"))
    .map((capability) => capability.slice("channel:".length));
  return supportedChannels.length === 1 ? supportedChannels[0] : undefined;
}

function send(socket: WebSocket, message: CollectorWsMessageInput): void {
  socket.send(serializeCollectorWsMessage(buildCollectorWsMessage(message)));
}
