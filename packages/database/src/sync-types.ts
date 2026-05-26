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

export interface CustomerScope {
  orgId: string;
  sellerAccountExternalId: string;
  externalCustomerId: string;
}

export interface CreateCustomerNoteInput extends CustomerScope {
  body: string;
  createdByUserId?: string;
}

export interface StoredCustomerNote extends CustomerScope {
  id: string;
  body: string;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AddCustomerTagInput extends CustomerScope {
  tag: string;
  createdByUserId?: string;
}

export interface StoredCustomerTag extends CustomerScope {
  id: string;
  tag: string;
  createdByUserId?: string;
  createdAt: string;
}

export interface CreateFollowUpTaskInput extends CustomerScope {
  title: string;
  assignedToUserId?: string;
  dueAt?: string;
  status?: string;
}

export interface UpdateFollowUpTaskInput {
  orgId: string;
  taskId: string;
  title?: string;
  assignedToUserId?: string;
  dueAt?: string;
  status?: string;
}

export interface StoredFollowUpTask extends CustomerScope {
  id: string;
  title: string;
  assignedToUserId?: string;
  status: string;
  dueAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssignCustomerInput extends CustomerScope {
  assignedToUserId: string;
  assignedByUserId?: string;
}

export interface StoredCustomerAssignment extends CustomerScope {
  id: string;
  assignedToUserId: string;
  assignedByUserId?: string;
  assignedAt: string;
  updatedAt: string;
}

export interface CreateAuditLogInput {
  orgId: string;
  actorUserId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export interface StoredAuditLog extends CreateAuditLogInput {
  id: string;
  createdAt: string;
}

export interface ConversationCustomerScope extends CustomerScope {
  externalConversationId: string;
}

export interface CreateAiSummaryInput extends CustomerScope {
  promptVersion: string;
  summary: string;
  intentLevel?: string;
  nextAction?: string;
  sourceMessageStartAt?: string;
  sourceMessageEndAt?: string;
}

export interface StoredAiSummary extends CreateAiSummaryInput {
  id: string;
  createdAt: string;
}

export interface CreateReplySuggestionInput extends ConversationCustomerScope {
  promptVersion: string;
  suggestion: string;
  status?: string;
  createdByUserId?: string;
}

export interface StoredReplySuggestion extends CreateReplySuggestionInput {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export type InternalRole = "admin" | "supervisor" | "sales";

export interface InternalUser {
  id: string;
  orgId: string;
  email: string;
  displayName: string;
  status: string;
  roles: InternalRole[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateInternalUserInput {
  orgId: string;
  email: string;
  displayName: string;
  passwordHash: string;
  roles?: InternalRole[];
  status?: string;
}

export interface IssueInternalSessionInput {
  orgId: string;
  email: string;
  passwordHash: string;
  token?: string;
  expiresAt?: string;
}

export interface InternalSession {
  token: string;
  tokenHash: string;
  orgId: string;
  userId: string;
  email: string;
  displayName: string;
  roles: InternalRole[];
  createdAt: string;
  expiresAt: string;
}

export interface CollectorDevice {
  id: string;
  orgId: string;
  sellerAccountExternalId?: string;
  deviceName?: string;
  status: string;
  lastHeartbeatAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegisteredCollectorDevice extends CollectorDevice {
  token: string;
  tokenHash: string;
}

export interface RegisterCollectorDeviceInput {
  orgId: string;
  sellerAccountExternalId?: string;
  deviceName?: string;
  token?: string;
  status?: string;
}

export interface RevokeCollectorDeviceInput {
  orgId: string;
  deviceId: string;
}
