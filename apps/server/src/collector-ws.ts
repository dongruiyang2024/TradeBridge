import {
  buildCollectorWsMessage,
  isCollectorHelloMessage,
  isOutboundClaimMessage,
  isOutboundDeliveryReportMessage,
  parseCollectorWsMessage,
  serializeCollectorWsMessage,
  type ChannelAccountRef,
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
    let channelAccounts: ChannelAccountRef[] = [];
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
          const scope = claimScope(message.payload, capabilities, channelAccounts);
          const messages = await options.store.claimPendingOutboundMessages({
            sellerAccountExternalId: sellerAccountExternalId || "default-seller",
            deviceId: deviceId || "unknown-device",
            limit: message.payload.limit,
            leaseMs: message.payload.leaseMs || OUTBOUND_LEASE_MS,
            channel: scope.channel,
            channelAccountExternalId: scope.channelAccountExternalId
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
      channelAccounts = message.payload.channelAccounts || [];
      options.hub.addSession({
        sessionId,
        sellerAccountExternalId,
        deviceId,
        capabilities,
        channelAccounts,
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

function claimScope(
  payload: { channel?: string; channelAccountExternalId?: string },
  capabilities: string[],
  channelAccounts: ChannelAccountRef[]
): { channel?: string; channelAccountExternalId?: string } {
  const channel =
    payload.channel ||
    channelForAccount(payload.channelAccountExternalId, channelAccounts) ||
    singleSupportedChannel(capabilities, channelAccounts);
  if (channel && !supportsChannel(channel, capabilities, channelAccounts)) {
    throw new Error("collector_channel_not_supported");
  }
  if (
    payload.channelAccountExternalId &&
    channelAccounts.length &&
    !supportsChannelAccount(channel, payload.channelAccountExternalId, channelAccounts)
  ) {
    throw new Error("collector_channel_account_not_supported");
  }
  if (payload.channelAccountExternalId) return { channel, channelAccountExternalId: payload.channelAccountExternalId };
  const matchingAccounts = payload.channel
    ? channelAccounts.filter((account) => account.channel === payload.channel)
    : [];
  return {
    channel,
    channelAccountExternalId: matchingAccounts.length === 1 ? matchingAccounts[0].externalAccountId : undefined
  };
}

function singleSupportedChannel(capabilities: string[], channelAccounts: ChannelAccountRef[]): string | undefined {
  const declaredChannels = Array.from(new Set(channelAccounts.map((account) => account.channel)));
  if (declaredChannels.length === 1) return declaredChannels[0];
  const capabilityChannels = capabilities
    .filter((capability) => capability.startsWith("channel:"))
    .map((capability) => capability.slice("channel:".length));
  return capabilityChannels.length === 1 ? capabilityChannels[0] : undefined;
}

function channelForAccount(
  channelAccountExternalId: string | undefined,
  channelAccounts: ChannelAccountRef[]
): string | undefined {
  if (!channelAccountExternalId) return undefined;
  const matchingAccounts = channelAccounts.filter((account) => account.externalAccountId === channelAccountExternalId);
  return matchingAccounts.length === 1 ? matchingAccounts[0].channel : undefined;
}

function supportsChannel(channel: string, capabilities: string[], channelAccounts: ChannelAccountRef[]): boolean {
  return channelAccounts.some((account) => account.channel === channel) || capabilities.includes(`channel:${channel}`);
}

function supportsChannelAccount(
  channel: string | undefined,
  channelAccountExternalId: string,
  channelAccounts: ChannelAccountRef[]
): boolean {
  return channelAccounts.some(
    (account) =>
      (!channel || account.channel === channel) &&
      account.externalAccountId === channelAccountExternalId
  );
}

function send(socket: WebSocket, message: CollectorWsMessageInput): void {
  socket.send(serializeCollectorWsMessage(buildCollectorWsMessage(message)));
}
