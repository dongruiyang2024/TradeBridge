export type {
  BrowserSyncBatch as SyncBatch,
  BrowserSyncDeviceInput as SyncDeviceInput,
  BrowserSyncSellerAccountInput as SyncSellerAccountInput
} from "@wangwang/onetalk-adapter/browser";

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

export interface ExtensionConfig {
  serverUrl: string;
  collectorToken: string;
  sellerAccountExternalId: string;
  sellerAccountDisplayName?: string;
  deviceId: string;
  deviceName?: string;
  syncIntervalMinutes?: number;
}

export interface ExtensionStatus {
  lastSyncedAt?: string;
  nextCursor?: string | null;
  lastDiagnostics?: SyncDiagnostics;
  lastError?: {
    code: string;
    message: string;
  };
}

export interface SyncDiagnostics {
  conversations: number;
  messageRequests: MessageRequestDiagnostic[];
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
