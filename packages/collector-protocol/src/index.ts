export const COLLECTOR_WS_VERSION = 1;

export const BUILT_IN_CHANNEL_IDS = [
  "alibaba-im",
  "whatsapp-web",
  "facebook-messenger",
  "web-chat",
  "mock-web"
] as const;

export type BuiltInChannelId = (typeof BUILT_IN_CHANNEL_IDS)[number];
export type ChannelId = BuiltInChannelId | (string & {});
export type MessageDirection = "received" | "sent" | "unknown";

export interface ChannelAccountRef {
  channel: ChannelId;
  externalAccountId: string;
  displayName?: string;
  surface?: string;
}

export interface ChannelSyncSellerAccountInput {
  externalAccountId: string;
  displayName?: string;
  status?: string;
}

export interface ChannelSyncDeviceInput {
  deviceId: string;
  deviceName?: string;
}

export interface ChannelSyncContact {
  externalContactId?: string;
  externalCustomerId: string;
  loginId?: string;
  loginIdEncrypt?: string;
  displayName?: string;
  companyName?: string;
  avatarUrl?: string;
  country?: string;
  currentTimeZone?: string;
  accountId?: string;
  accountIdEncrypt?: string;
  aliId?: string;
  aliIdEncrypt?: string;
  ownerUserId?: string;
  stage?: string;
}

export interface ChannelSyncConversation {
  externalConversationId: string;
  externalContactId?: string;
  externalCustomerId?: string;
  lastMessageAt?: string;
}

export interface ChannelSyncMessage {
  externalConversationId: string;
  externalMessageId?: string;
  direction: MessageDirection;
  messageType?: string | number;
  content?: string;
  attachments?: ChannelSyncAttachment[];
  richContent?: ChannelSyncRichContent[];
  sentAt?: string;
  rawSanitized?: Record<string, unknown>;
}

export interface ChannelSyncAttachment {
  type?: "file" | "image";
  fileName?: string;
  fileSize?: number;
  fileSizeLabel?: string;
  mimeType?: string;
  thumbnailUrl?: string;
  url?: string;
}

export type ChannelSyncRichContent = ChannelSyncProductContent;

export interface ChannelSyncProductContent {
  type: "product";
  url: string;
  title?: string;
  imageUrl?: string;
  priceText?: string;
  moqText?: string;
  productId?: string;
}

export interface ChannelSyncSourceMeta extends Record<string, unknown> {
  source?: string;
  surface?: string;
  collectedAt?: string;
  sourceBatchKey?: string;
}

export interface ChannelSyncBatch {
  channel: ChannelId;
  channelAccount: ChannelAccountRef;
  sellerAccount: ChannelSyncSellerAccountInput;
  device: ChannelSyncDeviceInput;
  cursor?: Record<string, unknown>;
  sourceMeta?: ChannelSyncSourceMeta;
  contacts?: ChannelSyncContact[];
  customers?: ChannelSyncContact[];
  conversations?: ChannelSyncConversation[];
  messages?: ChannelSyncMessage[];
}

export interface ChannelConnectionStatus {
  channel: ChannelId;
  connected: boolean;
  surface?: string;
  pageUrl?: string;
  lastSyncedAt?: string;
  lastErrorCode?: string;
}

export interface OutboundDeliveryTask {
  id: string;
  channel: ChannelId;
  channelAccount?: ChannelAccountRef;
  sellerAccountExternalId: string;
  externalContactId?: string;
  externalCustomerId?: string;
  externalConversationId: string;
  content: string;
  createdAt?: string;
}

export interface OutboundDeliveryReport {
  outboundMessageId: string;
  channel: ChannelId;
  status: "sent" | "failed";
  externalMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  deliveredAt: string;
}

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
    channelAccounts?: ChannelAccountRef[];
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
    channel?: ChannelId;
    channelAccountExternalId?: string;
  }
>;

export type OutboundClaimMessage = CollectorWsEnvelope<
  "outbound.claim",
  {
    limit: number;
    leaseMs: number;
    channel?: ChannelId;
    channelAccountExternalId?: string;
    surface?: string;
  }
>;

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
    channel?: ChannelId;
    channelAccountExternalId?: string;
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
  channel?: ChannelId;
  channelAccountExternalId?: string;
  channelSurface?: string;
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

export function isBuiltInChannelId(value: unknown): value is BuiltInChannelId {
  return typeof value === "string" && BUILT_IN_CHANNEL_IDS.includes(value as BuiltInChannelId);
}

export function isChannelSyncBatch(value: unknown): value is ChannelSyncBatch {
  if (!isRecord(value)) return false;
  if (!isBuiltInChannelId(value.channel)) return false;
  if (!isChannelAccountRef(value.channelAccount, value.channel)) return false;
  if (!isSyncSellerAccount(value.sellerAccount)) return false;
  if (!isSyncDevice(value.device)) return false;
  if (!isOptionalRecord(value.cursor)) return false;
  if (!isOptionalRecord(value.sourceMeta)) return false;
  if (!isOptionalArray(value.contacts, isChannelSyncContact)) return false;
  if (!isOptionalArray(value.customers, isChannelSyncContact)) return false;
  if (!isOptionalArray(value.conversations, isChannelSyncConversation)) return false;
  return isOptionalArray(value.messages, isChannelSyncMessage);
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
	        value.payload.capabilities.every((item) => typeof item === "string") &&
	        isOptionalArray(value.payload.channelAccounts, isChannelAccountRefAnyChannel)
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
	        typeof value.payload.pendingCount === "number" &&
	        isOptionalString(value.payload.channel) &&
	        isOptionalString(value.payload.channelAccountExternalId)
	      );
	    case "outbound.claim":
	      return (
	        typeof value.payload.limit === "number" &&
	        typeof value.payload.leaseMs === "number" &&
	        isOptionalString(value.payload.channel) &&
	        isOptionalString(value.payload.channelAccountExternalId) &&
	        isOptionalString(value.payload.surface)
	      );
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
	        isOptionalString(value.payload.channel) &&
	        isOptionalString(value.payload.channelAccountExternalId) &&
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
	    isOptionalString(value.channel) &&
	    isOptionalString(value.channelAccountExternalId) &&
	    isOptionalString(value.channelSurface) &&
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

function isChannelAccountRef(value: unknown, channel: unknown): value is ChannelAccountRef {
  return (
    isRecord(value) &&
    value.channel === channel &&
    typeof value.externalAccountId === "string" &&
    isOptionalString(value.displayName) &&
    isOptionalString(value.surface)
  );
}

function isChannelAccountRefAnyChannel(value: unknown): value is ChannelAccountRef {
  return (
    isRecord(value) &&
    typeof value.channel === "string" &&
    typeof value.externalAccountId === "string" &&
    isOptionalString(value.displayName) &&
    isOptionalString(value.surface)
  );
}

function isSyncSellerAccount(value: unknown): value is ChannelSyncSellerAccountInput {
  return (
    isRecord(value) &&
    typeof value.externalAccountId === "string" &&
    isOptionalString(value.displayName) &&
    isOptionalString(value.status)
  );
}

function isSyncDevice(value: unknown): value is ChannelSyncDeviceInput {
  return isRecord(value) && typeof value.deviceId === "string" && isOptionalString(value.deviceName);
}

function isChannelSyncContact(value: unknown): value is ChannelSyncContact {
  return (
    isRecord(value) &&
    isOptionalString(value.externalContactId) &&
    typeof value.externalCustomerId === "string" &&
    isOptionalString(value.loginId) &&
    isOptionalString(value.displayName) &&
    isOptionalString(value.country) &&
    isOptionalString(value.ownerUserId) &&
    isOptionalString(value.stage)
  );
}

function isChannelSyncConversation(value: unknown): value is ChannelSyncConversation {
  return (
    isRecord(value) &&
    typeof value.externalConversationId === "string" &&
    isOptionalString(value.externalContactId) &&
    isOptionalString(value.externalCustomerId) &&
    isOptionalString(value.lastMessageAt)
  );
}

function isChannelSyncMessage(value: unknown): value is ChannelSyncMessage {
  return (
    isRecord(value) &&
    typeof value.externalConversationId === "string" &&
    isOptionalString(value.externalMessageId) &&
    (value.direction === "received" || value.direction === "sent" || value.direction === "unknown") &&
    (value.messageType === undefined || typeof value.messageType === "string" || typeof value.messageType === "number") &&
    isOptionalString(value.content) &&
    isOptionalArray(value.attachments, isChannelSyncAttachment) &&
    isOptionalArray(value.richContent, isChannelSyncRichContent) &&
    isOptionalString(value.sentAt) &&
    isOptionalRecord(value.rawSanitized)
  );
}

function isChannelSyncAttachment(value: unknown): value is ChannelSyncAttachment {
  return (
    isRecord(value) &&
    (value.type === undefined || value.type === "file" || value.type === "image") &&
    isOptionalString(value.fileName) &&
    (value.fileSize === undefined || typeof value.fileSize === "number") &&
    isOptionalString(value.fileSizeLabel) &&
    isOptionalString(value.mimeType) &&
    isOptionalString(value.thumbnailUrl) &&
    isOptionalString(value.url)
  );
}

function isChannelSyncRichContent(value: unknown): value is ChannelSyncRichContent {
  return (
    isRecord(value) &&
    value.type === "product" &&
    typeof value.url === "string" &&
    isOptionalString(value.title) &&
    isOptionalString(value.imageUrl) &&
    isOptionalString(value.priceText) &&
    isOptionalString(value.moqText) &&
    isOptionalString(value.productId)
  );
}

function isOptionalRecord(value: unknown): boolean {
  return value === undefined || isRecord(value);
}

function isOptionalArray<T>(value: unknown, guard: (item: unknown) => item is T): boolean {
  return value === undefined || (Array.isArray(value) && value.every(guard));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}
