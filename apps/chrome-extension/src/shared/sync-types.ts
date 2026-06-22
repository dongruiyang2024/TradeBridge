export type {
  ChannelSyncBatch as SyncBatch,
  ChannelSyncDeviceInput as SyncDeviceInput,
  ChannelSyncSellerAccountInput as SyncSellerAccountInput
} from "@wangwang/collector-protocol";

export interface SyncBatchResult {
  acceptedCount: number;
  rejectedCount: number;
  nextCursor: string | null;
  warnings: string[];
}

export interface CollectorActivationInput {
  serverUrl: string;
  activationToken?: string;
  email?: string;
  password?: string;
  sellerAccountExternalId?: string;
  tradeMindBindingToken?: string;
  channelAccountExternalId?: string;
  deviceExternalId?: string;
  deviceName?: string;
}

export interface CollectorActivationResult {
  token: string;
  account?: TradeBridgeAccount;
  device: {
    id: string;
    externalDeviceId: string;
    sellerAccountExternalId?: string;
    deviceName?: string;
    status: string;
    lastHeartbeatAt?: string;
    lastSyncAt?: string;
    lastError?: string;
  };
}

export interface TradeBridgeAccount {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
}

export interface CollectorAccountValidationResult {
  account: TradeBridgeAccount;
  device: {
    id: string;
    externalDeviceId: string;
    sellerAccountExternalId?: string;
    deviceName?: string;
    status: string;
    lastHeartbeatAt?: string;
    lastSyncAt?: string;
    lastError?: string;
  };
}

export type OutboundMessageStatus = "queued" | "sent" | "failed";

export interface OutboundMessage {
  id: string;
  sellerAccountExternalId: string;
  externalCustomerId: string;
  externalConversationId: string;
  channel?: string;
  channelAccountExternalId?: string;
  channelSurface?: string;
  content: string;
  status: OutboundMessageStatus;
  createdByUserId?: string;
  deliveredByDeviceId?: string;
  externalMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
}

export interface ExtensionConfig {
  serverUrl: string;
  collectorToken: string;
  tradeBridgeAccountEmail?: string;
  sellerAccountExternalId: string;
  sellerAccountDisplayName?: string;
  channelAccountExternalId?: string;
  whatsappChannelAccountExternalId?: string;
  tradeMindBindingToken?: string;
  deviceId: string;
  deviceName?: string;
  syncIntervalMinutes?: number;
  syncIntervalSeconds?: number;
  historyBackfillEnabled?: boolean;
  historyMessagesPerConversation?: number;
}

export type ExtensionTradeMindConnectionStatus = "connected" | "disconnected" | "error" | "stale";
export type ExtensionTradeMindBindingState = "unbound" | "bound" | "revoked";
export type ExtensionTradeMindTokenStatus = "valid" | "invalid" | "unknown";
export type ExtensionTradeMindRuntimeStatus = "online" | "offline" | "stale" | "error";
export type ExtensionTradeMindRecommendedAction = "none" | "open_plugin" | "open_onetalk" | "rebind" | "retry";

export interface TradeMindBindingValidationResult {
  valid: boolean;
  status: ExtensionTradeMindConnectionStatus;
  bindingStatus: ExtensionTradeMindBindingState;
  tokenStatus: ExtensionTradeMindTokenStatus;
  runtimeStatus: ExtensionTradeMindRuntimeStatus;
  recommendedAction: ExtensionTradeMindRecommendedAction;
  reason?: string;
  tmAliId?: string | null;
  tmLoginId?: string;
  userId?: string;
  workspaceId?: string;
  lastError?: string | null;
  lastHeartbeatAt?: string | null;
  lastSyncAt?: string | null;
  checkedAt?: string;
}

export interface ExtensionTradeMindBindingStatus extends TradeMindBindingValidationResult {
  checkedAt: string;
}

export interface ExtensionStatus {
  lastSyncedAt?: string;
  nextCursor?: string | null;
  accountValidation?: ExtensionAccountValidationStatus;
  tradeMindBinding?: ExtensionTradeMindBindingStatus;
  realtime?: ExtensionRealtimeStatus;
  lastDiagnostics?: SyncDiagnostics;
  update?: ExtensionUpdateStatus;
  captureDiagnostics?: ExtensionCaptureDiagnostics;
  lastError?: {
    code: string;
    message: string;
  };
}

export interface ExtensionCaptureDiagnostics {
  observedMessageCount: number;
  lastObservedAt?: string;
  seenEventNames: string[];
}

export interface ExtensionAccountValidationStatus {
  state: "unknown" | "valid" | "invalid";
  email?: string;
  checkedAt?: string;
  error?: string;
}

export interface ExtensionRealtimeStatus {
  state: "idle" | "connecting" | "connected" | "closed" | "error";
  sessionId?: string;
  connectedAt?: string;
  disconnectedAt?: string;
  lastChangedAt: string;
  lastError?: string;
  reconnectCount?: number;
}

export interface ExtensionUpdateStatus {
  state: "available" | "reloading";
  version?: string;
  checkedAt?: string;
  reloadScheduledAt?: string;
  strategy: "auto-reload";
}

export interface SyncDiagnostics {
  conversations: number;
  messageRequests: MessageRequestDiagnostic[];
  lwpRoutes?: LwpRouteDiagnostic[];
}

export interface LwpRouteDiagnostic {
  route: string;
  status: number;
  listLength?: number;
  hasMore?: boolean;
}

export interface MessageRequestDiagnostic {
  conversationId: string;
  status: number;
  code?: string | number | null;
  contentType?: string | null;
  listLength: number;
  listPath?: string;
  topLevelKeys: string[];
  dataKeys: string[];
}
