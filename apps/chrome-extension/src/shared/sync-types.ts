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
  email: string;
  password: string;
  sellerAccountExternalId?: string;
  tradeMindBindingToken?: string;
  deviceExternalId?: string;
  deviceName?: string;
}

export interface CollectorActivationResult {
  token: string;
  device: {
    id: string;
    externalDeviceId: string;
    sellerAccountExternalId?: string;
    deviceName?: string;
    status: string;
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
  };
}

export type OutboundMessageStatus = "queued" | "sent" | "failed";

export interface OutboundMessage {
  id: string;
  sellerAccountExternalId: string;
  externalCustomerId: string;
  externalConversationId: string;
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
  tradeMindBindingToken?: string;
  deviceId: string;
  deviceName?: string;
  syncIntervalMinutes?: number;
  historyBackfillEnabled?: boolean;
  historyMessagesPerConversation?: number;
}

export interface ExtensionStatus {
  lastSyncedAt?: string;
  nextCursor?: string | null;
  accountValidation?: ExtensionAccountValidationStatus;
  realtime?: ExtensionRealtimeStatus;
  lastDiagnostics?: SyncDiagnostics;
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
