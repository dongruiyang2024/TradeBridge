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

export interface SyncChannelAccountInput {
  channel: string;
  externalAccountId: string;
  displayName?: string;
  surface?: string;
}

export interface SyncCustomerInput {
  externalCustomerId: string;
  channel?: string;
  channelAccountExternalId?: string;
  channelSurface?: string;
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

export interface SyncConversationInput {
  externalConversationId: string;
  channel?: string;
  channelAccountExternalId?: string;
  channelSurface?: string;
  externalCustomerId?: string;
  lastMessageAt?: string;
}

export interface SyncMessageInput {
  externalConversationId: string;
  externalMessageId?: string;
  channel?: string;
  channelAccountExternalId?: string;
  channelSurface?: string;
  direction: MessageDirection;
  messageType?: string | number;
  content?: string;
  sentAt?: string;
  rawSanitized?: Record<string, unknown>;
}

export interface SyncBatch {
  channel?: string;
  channelAccount?: SyncChannelAccountInput;
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
  lastSeenAt: string;
}

export interface StoredCustomer extends SyncCustomerInput {
  sellerAccountExternalId: string;
}

export interface StoredConversation extends SyncConversationInput {
  sellerAccountExternalId: string;
}

export interface StoredMessage extends SyncMessageInput {
  sellerAccountExternalId: string;
  contentHash: string;
  uniqueKey: string;
}

export interface CustomerScope {
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

export type OutboundMessageStatus = "queued" | "sent" | "failed";

export interface CreateOutboundMessageInput extends ConversationCustomerScope {
  content: string;
  createdByUserId?: string;
}

export interface ListPendingOutboundMessagesInput {
  sellerAccountExternalId: string;
  limit?: number;
  now?: Date;
}

export interface ClaimPendingOutboundMessagesInput {
  sellerAccountExternalId: string;
  deviceId: string;
  limit?: number;
  leaseMs?: number;
  now?: Date;
}

export interface ListOutboundMessagesInput {
  sellerAccountExternalId: string;
  externalConversationId?: string;
}

export interface MarkOutboundMessageDeliveredInput {
  id: string;
  sellerAccountExternalId: string;
  status: "sent" | "failed";
  externalMessageId?: string;
  deliveredByDeviceId?: string;
  deliveredAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface StoredOutboundMessage extends ConversationCustomerScope {
  id: string;
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
  claimedByDeviceId?: string;
  claimExpiresAt?: string;
}

export type InternalRole = "admin" | "supervisor" | "sales";

export interface InternalUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
  roles: InternalRole[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateInternalUserInput {
  email: string;
  displayName: string;
  passwordHash: string;
  roles?: InternalRole[];
  status?: string;
}

export interface InternalUserCredentials extends InternalUser {
  passwordHash: string;
}

export interface GetInternalUserCredentialsInput {
  email: string;
}

export interface GetInternalUserCredentialsByEmailInput {
  email: string;
}

export interface UpdateInternalUserInput {
  userId: string;
  displayName?: string;
  passwordHash?: string;
  roles?: InternalRole[];
  status?: "pending" | "active" | "disabled";
}

export interface RevokeInternalSessionInput {
  token: string;
}

export interface CreateUserInvitationInput {
  email: string;
  displayName: string;
  roles: InternalRole[];
  createdByUserId?: string;
  token?: string;
  expiresAt?: string;
}

export interface StoredUserInvitation {
  id: string;
  email: string;
  displayName: string;
  roles: InternalRole[];
  token?: string;
  createdByUserId?: string;
  expiresAt: string;
  acceptedAt?: string;
  createdAt: string;
}

export interface AcceptUserInvitationInput {
  token: string;
  passwordHash: string;
}

export interface AcceptUserInvitationResult {
  invitation: StoredUserInvitation;
  user: InternalUser;
}

export interface IssueInternalSessionInput {
  email: string;
  passwordHash: string;
  token?: string;
  expiresAt?: string;
}

export interface InternalSession {
  token: string;
  tokenHash: string;
  userId: string;
  email: string;
  displayName: string;
  roles: InternalRole[];
  createdAt: string;
  expiresAt: string;
}

export interface CollectorDevice {
  id: string;
  externalDeviceId?: string;
  sellerAccountExternalId?: string;
  deviceName?: string;
  activatedByUserId?: string;
  activatedByUserEmail?: string;
  activatedByUserDisplayName?: string;
  activatedByUserRoles?: InternalRole[];
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
  sellerAccountExternalId?: string;
  externalDeviceId?: string;
  deviceName?: string;
  activatedByUserId?: string;
  activatedByUserEmail?: string;
  activatedByUserDisplayName?: string;
  activatedByUserRoles?: InternalRole[];
  token?: string;
  status?: string;
}

export interface RevokeCollectorDeviceInput {
  deviceId: string;
}
