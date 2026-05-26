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

export interface ExtensionConfig {
  serverUrl: string;
  collectorToken: string;
  orgId: string;
  sellerAccountExternalId: string;
  sellerAccountDisplayName?: string;
  deviceId: string;
  deviceName?: string;
  syncIntervalMinutes?: number;
}

export interface ExtensionStatus {
  lastSyncedAt?: string;
  nextCursor?: string | null;
  lastError?: {
    code: string;
    message: string;
  };
}
