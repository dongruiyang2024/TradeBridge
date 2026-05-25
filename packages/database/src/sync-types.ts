export type MessageDirection = "received" | "sent" | "unknown";

export interface SyncSellerAccountInput {
  externalAccountId: string;
  displayName?: string;
  status?: string;
}

export interface SyncDeviceInput {
  deviceId: string;
  deviceName?: string;
}

export interface SyncCustomerInput {
  externalCustomerId: string;
  loginId?: string;
  displayName?: string;
  country?: string;
  ownerUserId?: string;
  stage?: string;
}

export interface SyncConversationInput {
  externalConversationId: string;
  externalCustomerId?: string;
  lastMessageAt?: string;
}

export interface SyncMessageInput {
  externalConversationId: string;
  externalMessageId?: string;
  direction: MessageDirection;
  messageType?: string | number;
  content?: string;
  sentAt?: string;
  rawSanitized?: Record<string, unknown>;
}

export interface SyncBatch {
  orgId: string;
  sellerAccount: SyncSellerAccountInput;
  device: SyncDeviceInput;
  cursor?: Record<string, unknown>;
  sourceMeta?: Record<string, unknown>;
  customers?: SyncCustomerInput[];
  conversations?: SyncConversationInput[];
  messages?: SyncMessageInput[];
}

export interface SyncBatchResult {
  acceptedCount: number;
  rejectedCount: number;
  nextCursor: string | null;
  warnings: string[];
}

export interface StoredSellerAccount extends SyncSellerAccountInput {
  orgId: string;
  lastSeenAt: string;
}

export interface StoredCustomer extends SyncCustomerInput {
  orgId: string;
  sellerAccountExternalId: string;
}

export interface StoredConversation extends SyncConversationInput {
  orgId: string;
  sellerAccountExternalId: string;
}

export interface StoredMessage extends SyncMessageInput {
  orgId: string;
  sellerAccountExternalId: string;
  contentHash: string;
  uniqueKey: string;
}
