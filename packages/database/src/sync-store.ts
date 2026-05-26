import crypto from "node:crypto";
import type {
  AddCustomerTagInput,
  AcceptUserInvitationInput,
  AcceptUserInvitationResult,
  AssignCustomerInput,
  CollectorDevice,
  ConversationCustomerScope,
  CreateAiSummaryInput,
  CreateAuditLogInput,
  CreateCustomerNoteInput,
  CreateFollowUpTaskInput,
  CreateInternalUserInput,
  CreateReplySuggestionInput,
  CreateUserInvitationInput,
  CustomerScope,
  GetInternalUserCredentialsByEmailInput,
  GetInternalUserCredentialsInput,
  InternalSession,
  InternalUser,
  InternalUserCredentials,
  IssueInternalSessionInput,
  RegisteredCollectorDevice,
  RegisterCollectorDeviceInput,
  RevokeInternalSessionInput,
  RevokeCollectorDeviceInput,
  StoredAuditLog,
  StoredAiSummary,
  StoredCustomerAssignment,
  StoredCustomerNote,
  StoredConversation,
  StoredCustomer,
  StoredCustomerTag,
  StoredFollowUpTask,
  StoredMessage,
  StoredReplySuggestion,
  StoredSellerAccount,
  StoredUserInvitation,
  SyncBatch,
  SyncBatchResult,
  SyncConversationInput,
  SyncCustomerInput,
  SyncMessageInput,
  UpdateFollowUpTaskInput,
  UpdateInternalUserInput
} from "./sync-types.js";

export class InMemorySyncStore {
  private readonly sellerAccounts = new Map<string, StoredSellerAccount>();
  private readonly customers = new Map<string, StoredCustomer>();
  private readonly conversations = new Map<string, StoredConversation>();
  private readonly messages = new Map<string, StoredMessage>();
  private readonly customerNotes = new Map<string, StoredCustomerNote>();
  private readonly customerTags = new Map<string, StoredCustomerTag>();
  private readonly followUpTasks = new Map<string, StoredFollowUpTask>();
  private readonly customerAssignments = new Map<string, StoredCustomerAssignment>();
  private readonly aiSummaries = new Map<string, StoredAiSummary>();
  private readonly replySuggestions = new Map<string, StoredReplySuggestion>();
  private readonly auditLogs: StoredAuditLog[] = [];
  private readonly internalUsers = new Map<string, InternalUser & { passwordHash: string }>();
  private readonly internalSessions = new Map<string, InternalSession>();
  private readonly userInvitations = new Map<string, StoredUserInvitation & { tokenHash: string }>();
  private readonly collectorDevices = new Map<string, CollectorDevice & { tokenHash: string }>();
  private collaborationSequence = 0;
  private internalUserSequence = 0;
  private collectorDeviceSequence = 0;
  private auditLogSequence = 0;
  private aiSequence = 0;

  async acceptSyncBatch(batch: SyncBatch): Promise<SyncBatchResult> {
    const warnings: string[] = [];
    let acceptedCount = 0;
    let rejectedCount = 0;

    const sellerKey = sellerAccountKey(batch.sellerAccount.externalAccountId);
    this.sellerAccounts.set(sellerKey, {
      ...batch.sellerAccount,
      lastSeenAt: sourceTime(batch)
    });

    for (const customer of batch.customers || []) {
      this.customers.set(customerKey(batch.sellerAccount.externalAccountId, customer.externalCustomerId), {
        sellerAccountExternalId: batch.sellerAccount.externalAccountId,
        ...customer
      });
    }

    for (const conversation of batch.conversations || []) {
      this.conversations.set(
        conversationKey(batch.sellerAccount.externalAccountId, conversation.externalConversationId),
        {
          sellerAccountExternalId: batch.sellerAccount.externalAccountId,
          ...conversation
        }
      );
    }

    let nextCursor: string | null = null;
    for (const message of batch.messages || []) {
      const convKey = conversationKey(batch.sellerAccount.externalAccountId, message.externalConversationId);
      if (!this.conversations.has(convKey)) {
        rejectedCount += 1;
        warnings.push(
          `message ${message.externalMessageId || "without-id"} references unknown conversation ${message.externalConversationId}`
        );
        continue;
      }

      const contentHash = hashContent(message.content || "");
      const uniqueKey = messageUniqueKey(batch, message, contentHash);
      if (this.messages.has(uniqueKey)) {
        rejectedCount += 1;
        continue;
      }

      this.messages.set(uniqueKey, {
        sellerAccountExternalId: batch.sellerAccount.externalAccountId,
        ...message,
        contentHash,
        uniqueKey
      });
      acceptedCount += 1;
      nextCursor = maxIso(nextCursor, message.sentAt || null);
    }

    return {
      acceptedCount,
      rejectedCount,
      nextCursor,
      warnings
    };
  }

  listSellerAccounts(): StoredSellerAccount[] {
    return Array.from(this.sellerAccounts.values());
  }

  listCustomers(): StoredCustomer[] {
    return Array.from(this.customers.values());
  }

  listConversations(): StoredConversation[] {
    return Array.from(this.conversations.values());
  }

  listMessages(externalConversationId?: string): StoredMessage[] {
    return Array.from(this.messages.values()).filter(
      (item) => !externalConversationId || item.externalConversationId === externalConversationId
    );
  }

  createCustomerNote(input: CreateCustomerNoteInput): StoredCustomerNote {
    const now = new Date().toISOString();
    const note: StoredCustomerNote = {
      ...input,
      id: this.nextCollaborationId("note"),
      createdAt: now,
      updatedAt: now
    };
    this.customerNotes.set(note.id, note);
    return note;
  }

  listCustomerNotes(scope: CustomerScope): StoredCustomerNote[] {
    return Array.from(this.customerNotes.values()).filter((item) => isSameCustomerScope(item, scope));
  }

  addCustomerTag(input: AddCustomerTagInput): StoredCustomerTag {
    const existing = this.listCustomerTags(input).find((item) => item.tag === input.tag);
    if (existing) return existing;

    const tag: StoredCustomerTag = {
      ...input,
      id: this.nextCollaborationId("tag"),
      createdAt: new Date().toISOString()
    };
    this.customerTags.set(tag.id, tag);
    return tag;
  }

  listCustomerTags(scope: CustomerScope): StoredCustomerTag[] {
    return Array.from(this.customerTags.values()).filter((item) => isSameCustomerScope(item, scope));
  }

  createFollowUpTask(input: CreateFollowUpTaskInput): StoredFollowUpTask {
    const now = new Date().toISOString();
    const task: StoredFollowUpTask = {
      ...input,
      id: this.nextCollaborationId("follow_up"),
      status: input.status || "open",
      createdAt: now,
      updatedAt: now
    };
    this.followUpTasks.set(task.id, task);
    return task;
  }

  listFollowUpTasks(scope: CustomerScope): StoredFollowUpTask[] {
    return Array.from(this.followUpTasks.values()).filter((item) => isSameCustomerScope(item, scope));
  }

  async assignCustomer(input: AssignCustomerInput): Promise<StoredCustomerAssignment> {
    const now = new Date().toISOString();
    const key = customerKey(input.sellerAccountExternalId, input.externalCustomerId);
    const existing = this.customerAssignments.get(key);
    const assignment: StoredCustomerAssignment = {
      ...input,
      id: existing?.id || this.nextCollaborationId("assignment"),
      assignedAt: existing?.assignedAt || now,
      updatedAt: now
    };
    this.customerAssignments.set(key, assignment);
    return assignment;
  }

  async getCustomerAssignment(scope: CustomerScope): Promise<StoredCustomerAssignment | null> {
    return this.customerAssignments.get(customerKey(scope.sellerAccountExternalId, scope.externalCustomerId)) || null;
  }

  async updateFollowUpTask(input: UpdateFollowUpTaskInput): Promise<StoredFollowUpTask> {
    const existing = this.followUpTasks.get(input.taskId);
    if (!existing) {
      throw new Error("follow_up_task_not_found");
    }

    const updated: StoredFollowUpTask = {
      ...existing,
      title: input.title ?? existing.title,
      assignedToUserId: input.assignedToUserId ?? existing.assignedToUserId,
      dueAt: input.dueAt ?? existing.dueAt,
      status: input.status ?? existing.status,
      updatedAt: new Date().toISOString()
    };
    this.followUpTasks.set(updated.id, updated);
    return updated;
  }

  async appendAuditLog(input: CreateAuditLogInput): Promise<StoredAuditLog> {
    const log: StoredAuditLog = {
      ...input,
      id: this.nextAuditLogId(),
      createdAt: new Date().toISOString()
    };
    this.auditLogs.push(log);
    return log;
  }

  async listAuditLogs(): Promise<StoredAuditLog[]> {
    return [...this.auditLogs];
  }

  async createAiSummary(input: CreateAiSummaryInput): Promise<StoredAiSummary> {
    const summary: StoredAiSummary = {
      ...input,
      id: this.nextAiId("summary"),
      createdAt: new Date().toISOString()
    };
    this.aiSummaries.set(summary.id, summary);
    return summary;
  }

  async getLatestAiSummary(scope: CustomerScope): Promise<StoredAiSummary | null> {
    const summaries = Array.from(this.aiSummaries.values()).filter((item) => isSameCustomerScope(item, scope));
    return summaries.at(-1) || null;
  }

  async createReplySuggestion(input: CreateReplySuggestionInput): Promise<StoredReplySuggestion> {
    const now = new Date().toISOString();
    const suggestion: StoredReplySuggestion = {
      ...input,
      id: this.nextAiId("reply"),
      status: input.status || "draft",
      createdAt: now,
      updatedAt: now
    };
    this.replySuggestions.set(suggestion.id, suggestion);
    return suggestion;
  }

  async listReplySuggestions(scope: ConversationCustomerScope): Promise<StoredReplySuggestion[]> {
    return Array.from(this.replySuggestions.values()).filter((item) => isSameConversationCustomerScope(item, scope));
  }

  private nextCollaborationId(prefix: string): string {
    this.collaborationSequence += 1;
    return `${prefix}_${this.collaborationSequence}`;
  }

  async createInternalUser(input: CreateInternalUserInput): Promise<InternalUser> {
    const now = new Date().toISOString();
    const normalizedEmail = input.email.trim().toLowerCase();
    const key = internalUserKey(normalizedEmail);
    const existing = this.internalUsers.get(key);
    const user: InternalUser & { passwordHash: string } = {
      id: existing?.id || this.nextInternalUserId(),
      email: normalizedEmail,
      displayName: input.displayName,
      status: input.status || "active",
      roles: input.roles ?? ["sales"],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      passwordHash: input.passwordHash
    };
    this.internalUsers.set(key, user);
    return toPublicInternalUser(user);
  }

  async listInternalUsers(): Promise<InternalUser[]> {
    return Array.from(this.internalUsers.values())
      .map(toPublicInternalUser)
      .sort((left, right) => left.email.localeCompare(right.email));
  }

  async getInternalUserCredentials(input: GetInternalUserCredentialsInput): Promise<InternalUserCredentials | null> {
    const user = this.internalUsers.get(internalUserKey(input.email.trim().toLowerCase()));
    return user ? { ...toPublicInternalUser(user), passwordHash: user.passwordHash } : null;
  }

  async getInternalUserCredentialsByEmail(
    input: GetInternalUserCredentialsByEmailInput
  ): Promise<InternalUserCredentials[]> {
    const normalizedEmail = input.email.trim().toLowerCase();
    return Array.from(this.internalUsers.values())
      .filter((user) => user.email === normalizedEmail && user.status === "active")
      .map((user) => ({ ...toPublicInternalUser(user), passwordHash: user.passwordHash }));
  }

  async updateInternalUser(input: UpdateInternalUserInput): Promise<InternalUser> {
    const existing = Array.from(this.internalUsers.values()).find((user) => user.id === input.userId);
    if (!existing) throw new Error("internal_user_not_found");

    const updated: InternalUser & { passwordHash: string } = {
      ...existing,
      displayName: input.displayName ?? existing.displayName,
      passwordHash: input.passwordHash ?? existing.passwordHash,
      roles: input.roles ?? existing.roles,
      status: input.status ?? existing.status,
      updatedAt: new Date().toISOString()
    };
    this.internalUsers.set(internalUserKey(updated.email), updated);
    return toPublicInternalUser(updated);
  }

  async issueInternalSession(input: IssueInternalSessionInput): Promise<InternalSession> {
    const user = this.internalUsers.get(internalUserKey(input.email.trim().toLowerCase()));
    if (!user || user.status !== "active" || user.passwordHash !== input.passwordHash) {
      throw new Error("invalid_credentials");
    }

    const token = input.token || crypto.randomBytes(32).toString("hex");
    const session: InternalSession = {
      token,
      tokenHash: hashContent(token),
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };
    this.internalSessions.set(session.tokenHash, session);
    return session;
  }

  async revokeInternalSession(input: RevokeInternalSessionInput): Promise<boolean> {
    return this.internalSessions.delete(hashContent(input.token));
  }

  async createUserInvitation(input: CreateUserInvitationInput): Promise<StoredUserInvitation> {
    const now = new Date().toISOString();
    const token = input.token || crypto.randomBytes(32).toString("hex");
    const invitation: StoredUserInvitation & { tokenHash: string } = {
      id: this.nextInternalUserId().replace("user_", "inv_"),
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName,
      roles: input.roles,
      token,
      tokenHash: hashContent(token),
      createdByUserId: input.createdByUserId,
      expiresAt: input.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now
    };
    this.userInvitations.set(invitation.tokenHash, invitation);
    const { tokenHash: _tokenHash, ...publicInvitation } = invitation;
    return publicInvitation;
  }

  async getUserInvitation(token: string): Promise<StoredUserInvitation | null> {
    const invitation = this.userInvitations.get(hashContent(token));
    if (!invitation || invitation.acceptedAt || Date.parse(invitation.expiresAt) <= Date.now()) return null;
    const { tokenHash: _tokenHash, token: _rawToken, ...publicInvitation } = invitation;
    return publicInvitation;
  }

  async acceptUserInvitation(input: AcceptUserInvitationInput): Promise<AcceptUserInvitationResult> {
    const tokenHash = hashContent(input.token);
    const invitation = this.userInvitations.get(tokenHash);
    if (!invitation) throw new Error("invitation_not_found");
    if (invitation.acceptedAt) throw new Error("invitation_already_accepted");
    if (Date.parse(invitation.expiresAt) <= Date.now()) throw new Error("invitation_expired");

    const user = await this.createInternalUser({
      email: invitation.email,
      displayName: invitation.displayName,
      passwordHash: input.passwordHash,
      roles: invitation.roles,
      status: "active"
    });
    invitation.acceptedAt = new Date().toISOString();
    const { tokenHash: _tokenHash, token: _rawToken, ...publicInvitation } = invitation;
    return { invitation: publicInvitation, user };
  }

  async getInternalSession(token: string): Promise<InternalSession | null> {
    const session = this.internalSessions.get(hashContent(token));
    if (!session) return null;
    if (Date.parse(session.expiresAt) <= Date.now()) return null;
    const user = Array.from(this.internalUsers.values()).find((item) => item.id === session.userId);
    if (!user || user.status !== "active") return null;
    return session;
  }

  async registerCollectorDevice(input: RegisterCollectorDeviceInput): Promise<RegisteredCollectorDevice> {
    const now = new Date().toISOString();
    const token = input.token || crypto.randomBytes(32).toString("hex");
    const tokenHash = hashContent(token);
    const device: CollectorDevice & { tokenHash: string } = {
      id: this.nextCollectorDeviceId(),
      sellerAccountExternalId: input.sellerAccountExternalId,
      deviceName: input.deviceName,
      status: input.status || "active",
      createdAt: now,
      updatedAt: now,
      tokenHash
    };
    this.collectorDevices.set(device.id, device);
    return {
      ...toPublicCollectorDevice(device),
      token,
      tokenHash
    };
  }

  listCollectorDevices(): CollectorDevice[] {
    return Array.from(this.collectorDevices.values()).map(toPublicCollectorDevice);
  }

  async revokeCollectorDevice(input: RevokeCollectorDeviceInput): Promise<CollectorDevice> {
    const existing = this.collectorDevices.get(input.deviceId);
    if (!existing) {
      throw new Error("collector_device_not_found");
    }

    const updated: CollectorDevice & { tokenHash: string } = {
      ...existing,
      status: "revoked",
      updatedAt: new Date().toISOString()
    };
    this.collectorDevices.set(updated.id, updated);
    return toPublicCollectorDevice(updated);
  }

  async authenticateCollectorDevice(token: string): Promise<CollectorDevice | null> {
    const tokenHash = hashContent(token);
    const device = Array.from(this.collectorDevices.values()).find(
      (item) => item.tokenHash === tokenHash && item.status === "active"
    );
    return device ? toPublicCollectorDevice(device) : null;
  }

  private nextInternalUserId(): string {
    this.internalUserSequence += 1;
    return `user_${this.internalUserSequence}`;
  }

  private nextCollectorDeviceId(): string {
    this.collectorDeviceSequence += 1;
    return `collector_device_${this.collectorDeviceSequence}`;
  }

  private nextAuditLogId(): string {
    this.auditLogSequence += 1;
    return `audit_${this.auditLogSequence}`;
  }

  private nextAiId(prefix: string): string {
    this.aiSequence += 1;
    return `${prefix}_${this.aiSequence}`;
  }
}

function sellerAccountKey(sellerAccountExternalId: string): string {
  return sellerAccountExternalId;
}

function customerKey(sellerAccountExternalId: string, externalCustomerId: string): string {
  return [sellerAccountExternalId, externalCustomerId].join(":");
}

function conversationKey(sellerAccountExternalId: string, externalConversationId: string): string {
  return [sellerAccountExternalId, externalConversationId].join(":");
}

function messageUniqueKey(batch: SyncBatch, message: SyncMessageInput, contentHash: string): string {
  const prefix = conversationKey(batch.sellerAccount.externalAccountId, message.externalConversationId);
  if (message.externalMessageId) {
    return [prefix, message.externalMessageId].join(":");
  }
  return [prefix, message.sentAt || "", message.direction, contentHash].join(":");
}

function hashContent(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function maxIso(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

function sourceTime(batch: SyncBatch): string {
  const collectedAt = batch.sourceMeta?.collectedAt;
  return typeof collectedAt === "string" ? collectedAt : new Date(0).toISOString();
}

function isSameCustomerScope(left: CustomerScope, right: CustomerScope): boolean {
  return (
    left.sellerAccountExternalId === right.sellerAccountExternalId &&
    left.externalCustomerId === right.externalCustomerId
  );
}

function isSameConversationCustomerScope(left: ConversationCustomerScope, right: ConversationCustomerScope): boolean {
  return isSameCustomerScope(left, right) && left.externalConversationId === right.externalConversationId;
}

function internalUserKey(email: string): string {
  return email.toLowerCase();
}

function toPublicInternalUser(user: InternalUser & { passwordHash: string }): InternalUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    roles: user.roles,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function toPublicCollectorDevice(device: CollectorDevice & { tokenHash: string }): CollectorDevice {
  return {
    id: device.id,
    sellerAccountExternalId: device.sellerAccountExternalId,
    deviceName: device.deviceName,
    status: device.status,
    lastHeartbeatAt: device.lastHeartbeatAt,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt
  };
}
