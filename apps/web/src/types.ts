export type MessageDirection = "received" | "sent" | "unknown";

export interface StoredCustomer {
  sellerAccountExternalId: string;
  externalCustomerId: string;
  loginId?: string;
  displayName?: string;
  country?: string;
  ownerUserId?: string;
  stage?: string;
}

export interface StoredConversation {
  sellerAccountExternalId: string;
  externalConversationId: string;
  externalCustomerId?: string;
  lastMessageAt?: string;
}

export interface StoredMessage {
  sellerAccountExternalId: string;
  externalConversationId: string;
  externalMessageId?: string;
  direction: MessageDirection;
  messageType?: string | number;
  content?: string;
  sentAt?: string;
  rawSanitized?: Record<string, unknown>;
  contentHash: string;
  uniqueKey: string;
}

export interface CustomerScope {
  sellerAccountExternalId: string;
  externalCustomerId: string;
}

export interface StoredCustomerNote extends CustomerScope {
  id: string;
  body: string;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredCustomerTag extends CustomerScope {
  id: string;
  tag: string;
  createdByUserId?: string;
  createdAt: string;
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

export interface StoredCustomerAssignment extends CustomerScope {
  id: string;
  assignedToUserId: string;
  assignedByUserId?: string;
  assignedAt: string;
  updatedAt: string;
}

export type InternalRole = "admin" | "supervisor" | "sales";

export interface InternalUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
  roles: InternalRole[];
  createdAt?: string;
  updatedAt?: string;
}

export interface InternalInvitation {
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

export interface LoginResult {
  token: string;
  expiresAt?: string;
  user: InternalUser;
}

export interface SetupAdminInput {
  email: string;
  displayName: string;
  password: string;
}

export interface CreateInternalUserInput {
  email: string;
  displayName: string;
  password: string;
  roles: InternalRole[];
}

export interface DisableInternalUserInput {
  userId: string;
}

export interface ResetInternalUserPasswordInput {
  userId: string;
  password: string;
}

export interface CreateInvitationInput {
  email: string;
  displayName: string;
  roles: InternalRole[];
}

export interface AcceptInvitationInput {
  token: string;
  password: string;
}

export interface AcceptInvitationResult extends LoginResult {
  invitation: InternalInvitation;
}

export interface InternalApiClient {
  login(input: { email: string; password: string }): Promise<LoginResult>;
  logout(): Promise<void>;
  setupAdmin(input: SetupAdminInput): Promise<InternalUser>;
  listInternalUsers(): Promise<InternalUser[]>;
  createInternalUser(input: CreateInternalUserInput): Promise<InternalUser>;
  disableInternalUser(input: DisableInternalUserInput): Promise<InternalUser>;
  resetInternalUserPassword(input: ResetInternalUserPasswordInput): Promise<InternalUser>;
  createInvitation(input: CreateInvitationInput): Promise<InternalInvitation>;
  getInvitation(token: string): Promise<InternalInvitation>;
  acceptInvitation(input: AcceptInvitationInput): Promise<AcceptInvitationResult>;
  listCustomers(): Promise<StoredCustomer[]>;
  listConversations(): Promise<StoredConversation[]>;
  listMessages(externalConversationId: string): Promise<StoredMessage[]>;
  getCustomerAssignment(scope: CustomerScope): Promise<StoredCustomerAssignment | null>;
  listCustomerNotes(scope: CustomerScope): Promise<StoredCustomerNote[]>;
  createCustomerNote(scope: CustomerScope, input: { body: string }): Promise<StoredCustomerNote>;
  listCustomerTags(scope: CustomerScope): Promise<StoredCustomerTag[]>;
  addCustomerTag(scope: CustomerScope, input: { tag: string }): Promise<StoredCustomerTag>;
  listFollowUpTasks(scope: CustomerScope): Promise<StoredFollowUpTask[]>;
  createFollowUpTask(
    scope: CustomerScope,
    input: { title: string; assignedToUserId?: string; dueAt?: string }
  ): Promise<StoredFollowUpTask>;
}

export interface DashboardState {
  status: string;
  error?: string;
  customers: StoredCustomer[];
  selectedCustomerId?: string;
  conversations: StoredConversation[];
  selectedConversationId?: string;
  assignment?: StoredCustomerAssignment | null;
  messages: StoredMessage[];
  notes: StoredCustomerNote[];
  tags: StoredCustomerTag[];
  tasks: StoredFollowUpTask[];
}
