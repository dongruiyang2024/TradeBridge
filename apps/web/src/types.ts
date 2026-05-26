export type MessageDirection = "received" | "sent" | "unknown";

export interface StoredCustomer {
  orgId: string;
  sellerAccountExternalId: string;
  externalCustomerId: string;
  loginId?: string;
  displayName?: string;
  country?: string;
  ownerUserId?: string;
  stage?: string;
}

export interface StoredConversation {
  orgId: string;
  sellerAccountExternalId: string;
  externalConversationId: string;
  externalCustomerId?: string;
  lastMessageAt?: string;
}

export interface StoredMessage {
  orgId: string;
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
  orgId: string;
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

export interface InternalUser {
  id: string;
  orgId: string;
  email: string;
  displayName?: string;
  roles: string[];
}

export interface LoginResult {
  token: string;
  expiresAt?: string;
  user: InternalUser;
}

export interface InternalApiClient {
  login(input: { orgId: string; email: string; password: string }): Promise<LoginResult>;
  listCustomers(orgId: string): Promise<StoredCustomer[]>;
  listConversations(orgId: string): Promise<StoredConversation[]>;
  listMessages(orgId: string, externalConversationId: string): Promise<StoredMessage[]>;
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

export interface WorkspaceState {
  orgId: string;
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
