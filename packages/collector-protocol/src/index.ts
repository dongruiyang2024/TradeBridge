export const COLLECTOR_WS_VERSION = 1;

export type CollectorWsMessage =
  | CollectorHelloMessage
  | CollectorReadyMessage
  | HeartbeatPingMessage
  | HeartbeatPongMessage
  | OutboundAvailableMessage
  | OutboundClaimMessage
  | OutboundClaimedMessage
  | OutboundDeliveryReportMessage
  | SyncRequestMessage
  | CollectorStatusMessage
  | CollectorAckMessage
  | CollectorErrorMessage;

export interface CollectorWsEnvelope<TType extends string, TPayload> {
  v: 1;
  id: string;
  type: TType;
  sentAt: string;
  payload: TPayload;
}

export type CollectorHelloMessage = CollectorWsEnvelope<
  "collector.hello",
  {
    collectorToken: string;
    deviceId: string;
    deviceName?: string;
    capabilities: string[];
  }
>;

export type CollectorReadyMessage = CollectorWsEnvelope<
  "collector.ready",
  {
    sessionId: string;
    sellerAccountExternalId: string;
    deviceId: string;
    heartbeatIntervalMs: number;
    serverTime: string;
  }
>;

export type HeartbeatPingMessage = CollectorWsEnvelope<"heartbeat.ping", { nonce: string }>;
export type HeartbeatPongMessage = CollectorWsEnvelope<"heartbeat.pong", { nonce: string; status?: string }>;

export type OutboundAvailableMessage = CollectorWsEnvelope<
  "outbound.available",
  {
    sellerAccountExternalId: string;
    pendingCount: number;
  }
>;

export type OutboundClaimMessage = CollectorWsEnvelope<"outbound.claim", { limit: number; leaseMs: number }>;

export type OutboundClaimedMessage = CollectorWsEnvelope<
  "outbound.claimed",
  {
    requestId: string;
    leaseMs: number;
    messages: CollectorOutboundMessage[];
  }
>;

export type OutboundDeliveryReportMessage = CollectorWsEnvelope<
  "outbound.delivery.report",
  {
    outboundMessageId: string;
    status: "sent" | "failed";
    externalMessageId?: string;
    errorCode?: string;
    errorMessage?: string;
    deliveredAt: string;
  }
>;

export type SyncRequestMessage = CollectorWsEnvelope<
  "sync.request",
  {
    reason: "server-request" | "outbound-delivered" | "watchdog";
  }
>;

export type CollectorStatusMessage = CollectorWsEnvelope<
  "collector.status",
  {
    connectedToOneTalk: boolean;
    lastSyncedAt?: string;
    lastErrorCode?: string;
  }
>;

export type CollectorAckMessage = CollectorWsEnvelope<"ack", { requestId: string }>;
export type CollectorErrorMessage = CollectorWsEnvelope<"error", { requestId?: string; code: string; message: string }>;

export interface CollectorOutboundMessage {
  id: string;
  sellerAccountExternalId: string;
  externalCustomerId: string;
  externalConversationId: string;
  content: string;
  status: "queued" | "sent" | "failed";
  createdByUserId?: string;
  deliveredByDeviceId?: string;
  externalMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  claimedByDeviceId?: string;
  claimExpiresAt?: string;
}

export type CollectorWsMessageInput = Omit<CollectorWsMessage, "v">;

export function buildCollectorWsMessage(input: CollectorWsMessageInput): CollectorWsMessage {
  return { v: COLLECTOR_WS_VERSION, ...input } as CollectorWsMessage;
}

export function serializeCollectorWsMessage(message: CollectorWsMessage): string {
  return JSON.stringify(message);
}

export function parseCollectorWsMessage(text: string): CollectorWsMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("collector_ws_invalid_json");
  }
  if (!isCollectorWsMessage(parsed)) {
    throw new Error("collector_ws_invalid_message");
  }
  return parsed;
}

export function isCollectorHelloMessage(message: CollectorWsMessage): message is CollectorHelloMessage {
  return message.type === "collector.hello";
}

export function isOutboundClaimMessage(message: CollectorWsMessage): message is OutboundClaimMessage {
  return message.type === "outbound.claim";
}

export function isOutboundDeliveryReportMessage(message: CollectorWsMessage): message is OutboundDeliveryReportMessage {
  return message.type === "outbound.delivery.report";
}

function isCollectorWsMessage(value: unknown): value is CollectorWsMessage {
  if (!isRecord(value)) return false;
  if (value.v !== COLLECTOR_WS_VERSION) return false;
  if (typeof value.id !== "string" || typeof value.type !== "string" || typeof value.sentAt !== "string") return false;
  if (!isRecord(value.payload)) return false;

  switch (value.type) {
    case "collector.hello":
      return (
        typeof value.payload.collectorToken === "string" &&
        typeof value.payload.deviceId === "string" &&
        isOptionalString(value.payload.deviceName) &&
        Array.isArray(value.payload.capabilities) &&
        value.payload.capabilities.every((item) => typeof item === "string")
      );
    case "collector.ready":
      return (
        typeof value.payload.sessionId === "string" &&
        typeof value.payload.sellerAccountExternalId === "string" &&
        typeof value.payload.deviceId === "string" &&
        typeof value.payload.heartbeatIntervalMs === "number" &&
        typeof value.payload.serverTime === "string"
      );
    case "heartbeat.ping":
    case "heartbeat.pong":
      return typeof value.payload.nonce === "string";
    case "outbound.available":
      return (
        typeof value.payload.sellerAccountExternalId === "string" &&
        typeof value.payload.pendingCount === "number"
      );
    case "outbound.claim":
      return typeof value.payload.limit === "number" && typeof value.payload.leaseMs === "number";
    case "outbound.claimed":
      return (
        typeof value.payload.requestId === "string" &&
        typeof value.payload.leaseMs === "number" &&
        Array.isArray(value.payload.messages) &&
        value.payload.messages.every(isCollectorOutboundMessage)
      );
    case "outbound.delivery.report":
      return (
        typeof value.payload.outboundMessageId === "string" &&
        (value.payload.status === "sent" || value.payload.status === "failed") &&
        isOptionalString(value.payload.externalMessageId) &&
        isOptionalString(value.payload.errorCode) &&
        isOptionalString(value.payload.errorMessage) &&
        typeof value.payload.deliveredAt === "string"
      );
    case "sync.request":
      return (
        value.payload.reason === "server-request" ||
        value.payload.reason === "outbound-delivered" ||
        value.payload.reason === "watchdog"
      );
    case "collector.status":
      return (
        typeof value.payload.connectedToOneTalk === "boolean" &&
        isOptionalString(value.payload.lastSyncedAt) &&
        isOptionalString(value.payload.lastErrorCode)
      );
    case "ack":
      return typeof value.payload.requestId === "string";
    case "error":
      return (
        isOptionalString(value.payload.requestId) &&
        typeof value.payload.code === "string" &&
        typeof value.payload.message === "string"
      );
    default:
      return false;
  }
}

function isCollectorOutboundMessage(value: unknown): value is CollectorOutboundMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sellerAccountExternalId === "string" &&
    typeof value.externalCustomerId === "string" &&
    typeof value.externalConversationId === "string" &&
    typeof value.content === "string" &&
    (value.status === "queued" || value.status === "sent" || value.status === "failed") &&
    isOptionalString(value.createdByUserId) &&
    isOptionalString(value.deliveredByDeviceId) &&
    isOptionalString(value.externalMessageId) &&
    isOptionalString(value.errorCode) &&
    isOptionalString(value.errorMessage) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    isOptionalString(value.deliveredAt) &&
    isOptionalString(value.claimedByDeviceId) &&
    isOptionalString(value.claimExpiresAt)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}
