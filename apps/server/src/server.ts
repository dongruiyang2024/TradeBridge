import crypto from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import { loadWorkspaceEnv } from "@wangwang/env";
import {
  type ClaimPendingOutboundMessagesInput,
  InMemorySyncStore,
  PostgresSyncStore,
  createNodePostgresClient,
  runMigrations,
  type AddCustomerTagInput,
  type AcceptUserInvitationInput,
  type AcceptUserInvitationResult,
  type AssignCustomerInput,
  type CollectorDevice,
  type ConversationCustomerScope,
  type CreateAiSummaryInput,
  type CreateAuditLogInput,
  type RegisteredCollectorDevice,
  type RegisterCollectorDeviceInput,
  type RevokeCollectorDeviceInput,
  type RevokeInternalSessionInput,
  type CreateInternalUserInput,
  type CreateUserInvitationInput,
  type CreateCustomerNoteInput,
  type CreateFollowUpTaskInput,
  type CreateOutboundMessageInput,
  type CreateReplySuggestionInput,
  type CustomerScope,
  type GetInternalUserCredentialsByEmailInput,
  type GetInternalUserCredentialsInput,
  type InternalRole,
  type InternalSession,
  type InternalUser,
  type InternalUserCredentials,
  type IssueInternalSessionInput,
  type ListOutboundMessagesInput,
  type ListPendingOutboundMessagesInput,
  type MarkOutboundMessageDeliveredInput,
  type StoredConversation,
  type StoredAuditLog,
  type StoredAiSummary,
  type StoredCustomerAssignment,
  type StoredCustomer,
  type StoredCustomerNote,
  type StoredCustomerTag,
  type StoredFollowUpTask,
  type StoredMessage,
  type StoredOutboundMessage,
  type StoredReplySuggestion,
  type StoredUserInvitation,
  type SqlClient,
  type SyncBatch,
  type SyncBatchResult,
  type UpdateInternalUserInput,
  type UpdateFollowUpTaskInput
} from "@wangwang/database";
import {
  createBullMqAiJobQueue,
  createSyncAiJobQueue,
  publicAiJob,
  type AiJobQueue
} from "./ai-queue.js";
import { createDeterministicAiProvider, type AiProvider } from "./ai-service.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { createCollectorRealtimeHub } from "./collector-realtime-hub.js";
import { registerCollectorWsRoutes } from "./collector-ws.js";

const DEFAULT_SELLER_ACCOUNT_EXTERNAL_ID = "default-seller";
const DEFAULT_COLLECTOR_DEVICE_NAME = "TradeBridge Collector";

export interface CreateServerOptions {
  store?: SyncStore;
  aiProvider?: AiProvider;
  aiJobQueue?: AiJobQueue;
  logger?: boolean;
}

export interface CreateServerFromEnvOptions {
  env?: Record<string, string | undefined>;
  logger?: boolean;
  sqlClientFactory?: (databaseUrl: string) => Promise<SqlClient> | SqlClient;
  aiJobQueueFactory?: (env: Record<string, string | undefined>) => Promise<AiJobQueue | undefined> | AiJobQueue | undefined;
}

export interface SyncStore {
  acceptSyncBatch(batch: SyncBatch): Promise<SyncBatchResult>;
  listCustomers(): Promise<StoredCustomer[]> | StoredCustomer[];
  listConversations(): Promise<StoredConversation[]> | StoredConversation[];
  listMessages(externalConversationId?: string): Promise<StoredMessage[]> | StoredMessage[];
  createCustomerNote(input: CreateCustomerNoteInput): Promise<StoredCustomerNote> | StoredCustomerNote;
  listCustomerNotes(scope: CustomerScope): Promise<StoredCustomerNote[]> | StoredCustomerNote[];
  addCustomerTag(input: AddCustomerTagInput): Promise<StoredCustomerTag> | StoredCustomerTag;
  listCustomerTags(scope: CustomerScope): Promise<StoredCustomerTag[]> | StoredCustomerTag[];
  createFollowUpTask(input: CreateFollowUpTaskInput): Promise<StoredFollowUpTask> | StoredFollowUpTask;
  listFollowUpTasks(scope: CustomerScope): Promise<StoredFollowUpTask[]> | StoredFollowUpTask[];
  assignCustomer(input: AssignCustomerInput): Promise<StoredCustomerAssignment> | StoredCustomerAssignment;
  getCustomerAssignment(scope: CustomerScope): Promise<StoredCustomerAssignment | null> | StoredCustomerAssignment | null;
  updateFollowUpTask(input: UpdateFollowUpTaskInput): Promise<StoredFollowUpTask> | StoredFollowUpTask;
  appendAuditLog(input: CreateAuditLogInput): Promise<StoredAuditLog> | StoredAuditLog;
  createAiSummary(input: CreateAiSummaryInput): Promise<StoredAiSummary> | StoredAiSummary;
  getLatestAiSummary(scope: CustomerScope): Promise<StoredAiSummary | null> | StoredAiSummary | null;
  createReplySuggestion(input: CreateReplySuggestionInput): Promise<StoredReplySuggestion> | StoredReplySuggestion;
  listReplySuggestions(scope: ConversationCustomerScope): Promise<StoredReplySuggestion[]> | StoredReplySuggestion[];
  createOutboundMessage(input: CreateOutboundMessageInput): Promise<StoredOutboundMessage> | StoredOutboundMessage;
  listPendingOutboundMessages(input: ListPendingOutboundMessagesInput): Promise<StoredOutboundMessage[]> | StoredOutboundMessage[];
  claimPendingOutboundMessages(input: ClaimPendingOutboundMessagesInput): Promise<StoredOutboundMessage[]> | StoredOutboundMessage[];
  listOutboundMessages(input: ListOutboundMessagesInput): Promise<StoredOutboundMessage[]> | StoredOutboundMessage[];
  markOutboundMessageDelivered(input: MarkOutboundMessageDeliveredInput): Promise<StoredOutboundMessage> | StoredOutboundMessage;
  createInternalUser(input: CreateInternalUserInput): Promise<InternalUser> | InternalUser;
  listInternalUsers(): Promise<InternalUser[]> | InternalUser[];
  getInternalUserCredentials(input: GetInternalUserCredentialsInput): Promise<InternalUserCredentials | null> | InternalUserCredentials | null;
  getInternalUserCredentialsByEmail(input: GetInternalUserCredentialsByEmailInput): Promise<InternalUserCredentials[]> | InternalUserCredentials[];
  updateInternalUser(input: UpdateInternalUserInput): Promise<InternalUser> | InternalUser;
  issueInternalSession(input: IssueInternalSessionInput): Promise<InternalSession> | InternalSession;
  getInternalSession(token: string): Promise<InternalSession | null> | InternalSession | null;
  revokeInternalSession(input: RevokeInternalSessionInput): Promise<boolean> | boolean;
  createUserInvitation(input: CreateUserInvitationInput): Promise<StoredUserInvitation> | StoredUserInvitation;
  getUserInvitation(token: string): Promise<StoredUserInvitation | null> | StoredUserInvitation | null;
  acceptUserInvitation(input: AcceptUserInvitationInput): Promise<AcceptUserInvitationResult> | AcceptUserInvitationResult;
  registerCollectorDevice(input: RegisterCollectorDeviceInput): Promise<RegisteredCollectorDevice> | RegisteredCollectorDevice;
  listCollectorDevices(): Promise<CollectorDevice[]> | CollectorDevice[];
  revokeCollectorDevice(input: RevokeCollectorDeviceInput): Promise<CollectorDevice> | CollectorDevice;
  authenticateCollectorDevice(token: string): Promise<CollectorDevice | null> | CollectorDevice | null;
}

export async function createServer(options: CreateServerOptions = {}): Promise<FastifyInstance> {
  const store = options.store || new InMemorySyncStore();
  const aiProvider = options.aiProvider || createDeterministicAiProvider();
  const aiJobQueue = options.aiJobQueue || createSyncAiJobQueue();
  const realtimeHub = createCollectorRealtimeHub();
  const internalAccessRoles: InternalRole[] = ["admin", "supervisor", "sales"];
  const adminRoles: InternalRole[] = ["admin"];
  let setupInProgress = false;
  const app = Fastify({
    logger: options.logger ?? false
  });

  await app.register(websocket, {
    options: { maxPayload: 1024 * 1024 },
    preClose: terminateWebsocketServer
  });
  await registerCollectorWsRoutes(app, { store, hub: realtimeHub });

  app.addHook("onRequest", async (request, reply) => {
    applyCorsHeaders(request, reply);
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  app.get("/health", async () => ({
    ok: true,
    service: "wangwang-internal-server",
    time: new Date().toISOString()
  }));

  app.post("/collector/v1/auth/login", async (request, reply) => {
    const email = bodyStringField(request.body, "email");
    const password = bodyStringField(request.body, "password");
    const sellerAccountExternalId =
      bodyStringField(request.body, "sellerAccountExternalId") || DEFAULT_SELLER_ACCOUNT_EXTERNAL_ID;
    const deviceExternalId = bodyStringField(request.body, "deviceExternalId") || defaultCollectorDeviceExternalId();
    const deviceName = bodyStringField(request.body, "deviceName") || DEFAULT_COLLECTOR_DEVICE_NAME;
    if (!email || !password) {
      return reply.code(400).send({ ok: false, error: "invalid_collector_login_request" });
    }

    const credentials = await store.getInternalUserCredentials({ email });
    const validPassword = credentials ? await verifyPassword(password, credentials.passwordHash) : false;
    if (!credentials || credentials.status !== "active" || !validPassword) {
      await appendLoginFailedAuditLog(store, email);
      return reply.code(401).send({ ok: false, error: "invalid_credentials" });
    }
    if (!credentials.roles.some((role) => adminRoles.includes(role))) {
      return reply.code(403).send({ ok: false, error: "forbidden" });
    }

    const registered = await store.registerCollectorDevice({
      sellerAccountExternalId,
      externalDeviceId: deviceExternalId,
      deviceName
    });
    await store.appendAuditLog({
      actorUserId: credentials.id,
      action: "collector_device.activated",
      targetType: "collector_device",
      targetId: registered.id,
      metadata: {
        sellerAccountExternalId: registered.sellerAccountExternalId,
        externalDeviceId: registered.externalDeviceId,
        deviceName: registered.deviceName
      }
    });

    return {
      ok: true,
      token: registered.token,
      device: publicCollectorDevice(registered)
    };
  });

  app.post("/collector/v1/sync-batches", async (request, reply) => {
    const collectorDevice = await collectorDeviceFromAuthorization(request.headers.authorization || "", store);
    if (!collectorDevice) {
      return reply.code(401).send({ ok: false, error: "unauthorized" });
    }

    const batch = request.body as SyncBatch;
    if (!isValidSyncBatch(batch)) {
      return reply.code(400).send({ ok: false, error: "invalid_sync_batch" });
    }

    const result = await store.acceptSyncBatch(collectorScopedBatch(batch, collectorDevice));
    return {
      ok: true,
      ...result
    };
  });

  app.get("/collector/v1/outbound-messages", async (request, reply) => {
    const collectorDevice = await collectorDeviceFromAuthorization(request.headers.authorization || "", store);
    if (!collectorDevice) {
      return reply.code(401).send({ ok: false, error: "unauthorized" });
    }

    return {
      ok: true,
      messages: await store.listPendingOutboundMessages({
        sellerAccountExternalId: collectorSellerAccountExternalId(collectorDevice),
        limit: queryNumberField(request.query, "limit") || 20
      })
    };
  });

  app.post("/collector/v1/outbound-messages/:messageId/delivery", async (request, reply) => {
    const collectorDevice = await collectorDeviceFromAuthorization(request.headers.authorization || "", store);
    if (!collectorDevice) {
      return reply.code(401).send({ ok: false, error: "unauthorized" });
    }

    const messageId = queryStringField(request.params, "messageId");
    const status = bodyDeliveryStatusField(request.body);
    if (!messageId || !status) {
      return reply.code(400).send({ ok: false, error: "invalid_outbound_delivery" });
    }

    try {
      const message = await store.markOutboundMessageDelivered({
        id: messageId,
        sellerAccountExternalId: collectorSellerAccountExternalId(collectorDevice),
        status,
        externalMessageId: bodyStringField(request.body, "externalMessageId") || undefined,
        deliveredByDeviceId: collectorDevice.externalDeviceId || collectorDevice.id,
        deliveredAt: bodyStringField(request.body, "deliveredAt") || undefined,
        errorCode: bodyStringField(request.body, "errorCode") || undefined,
        errorMessage: bodyStringField(request.body, "errorMessage") || undefined
      });

      return { ok: true, message };
    } catch (error) {
      if (isNotFoundError(error, "outbound_message")) {
        return reply.code(404).send({ ok: false, error: "outbound_message_not_found" });
      }
      throw error;
    }
  });

  app.post("/internal/v1/auth/login", async (request, reply) => {
    const email = bodyStringField(request.body, "email");
    const password = bodyStringField(request.body, "password");
    if (!email || !password) {
      return reply.code(400).send({ ok: false, error: "invalid_login_request" });
    }

    const credentials = await store.getInternalUserCredentials({ email });
    if (!credentials || !(await verifyPassword(password, credentials.passwordHash))) {
      await appendLoginFailedAuditLog(store, email);
      return reply.code(401).send({ ok: false, error: "invalid_credentials" });
    }

    try {
      return {
        ok: true,
        ...(await issueLoginSession(store, credentials))
      };
    } catch (error) {
      if (isInvalidCredentialsError(error)) {
        await appendLoginFailedAuditLog(store, email);
        return reply.code(401).send({ ok: false, error: "invalid_credentials" });
      }
      throw error;
    }
  });

  app.post("/internal/v1/setup/admin", async (request, reply) => {
    const email = bodyStringField(request.body, "email");
    const displayName = bodyStringField(request.body, "displayName");
    const password = bodyStringField(request.body, "password");
    if (!email || !displayName || !password) {
      return reply.code(400).send({ ok: false, error: "invalid_setup_request" });
    }

    if (setupInProgress) {
      return reply.code(409).send({ ok: false, error: "setup_in_progress" });
    }

    setupInProgress = true;
    try {
      const existingUsers = await store.listInternalUsers();
      const existingAdmins = existingUsers.filter((user) => user.roles.includes("admin"));
      if (existingAdmins.length > 0) {
        return reply.code(409).send({ ok: false, error: "admin_already_exists" });
      }
      if (existingUsers.some((user) => user.email === email.trim().toLowerCase())) {
        return reply.code(409).send({ ok: false, error: "user_already_exists" });
      }

      const user = await store.createInternalUser({
        email,
        displayName,
        passwordHash: await hashPassword(password),
        roles: ["admin"],
        status: "active"
      });
      return { ok: true, user };
    } finally {
      setupInProgress = false;
    }
  });

  app.get("/internal/v1/me", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store);
    if (!auth) return;

    return {
      ok: true,
      user: auth.user
    };
  });

  app.post("/internal/v1/auth/logout", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store);
    if (!auth) return;

    const token = bearerToken(request.headers.authorization || "");
    if (token) await store.revokeInternalSession({ token });
    await store.appendAuditLog({
      actorUserId: auth.user.id,
      action: "auth.logout",
      targetType: "app_user",
      targetId: auth.user.id
    });

    return { ok: true };
  });

  app.get("/internal/v1/users", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, adminRoles);
    if (!auth) return;

    return { ok: true, users: await store.listInternalUsers() };
  });

  app.post("/internal/v1/users", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, adminRoles);
    if (!auth) return;

    const email = bodyStringField(request.body, "email");
    const displayName = bodyStringField(request.body, "displayName");
    const password = bodyStringField(request.body, "password");
    const roles = bodyRolesField(request.body);
    if (!email || !displayName || !password || roles.length === 0) {
      return reply.code(400).send({ ok: false, error: "invalid_user_request" });
    }

    const user = await store.createInternalUser({
      email,
      displayName,
      passwordHash: await hashPassword(password),
      roles,
      status: "active"
    });
    return { ok: true, user };
  });

  app.post("/internal/v1/users/:userId/disable", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, adminRoles);
    if (!auth) return;

    const userId = queryStringField(request.params, "userId");
    if (!userId) return reply.code(400).send({ ok: false, error: "invalid_user_request" });

    try {
      const user = await store.updateInternalUser({ userId, status: "disabled" });
      return { ok: true, user };
    } catch (error) {
      if (isNotFoundError(error, "internal_user")) {
        return reply.code(404).send({ ok: false, error: "user_not_found" });
      }
      throw error;
    }
  });

  app.post("/internal/v1/users/:userId/reset-password", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, adminRoles);
    if (!auth) return;

    const userId = queryStringField(request.params, "userId");
    const password = bodyStringField(request.body, "password");
    if (!userId || !password) return reply.code(400).send({ ok: false, error: "invalid_user_request" });

    try {
      const user = await store.updateInternalUser({
        userId,
        passwordHash: await hashPassword(password),
        status: "active"
      });
      return { ok: true, user };
    } catch (error) {
      if (isNotFoundError(error, "internal_user")) {
        return reply.code(404).send({ ok: false, error: "user_not_found" });
      }
      throw error;
    }
  });

  app.post("/internal/v1/invitations", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, adminRoles);
    if (!auth) return;

    const email = bodyStringField(request.body, "email");
    const displayName = bodyStringField(request.body, "displayName");
    const roles = bodyRolesField(request.body);
    if (!email || !displayName || roles.length === 0) {
      return reply.code(400).send({ ok: false, error: "invalid_invitation_request" });
    }

    const invitation = await store.createUserInvitation({
      email,
      displayName,
      roles,
      createdByUserId: auth.user.id
    });
    return { ok: true, invitation };
  });

  app.get("/internal/v1/invitations/:token", async (request, reply) => {
    const token = queryStringField(request.params, "token");
    if (!token) return reply.code(400).send({ ok: false, error: "invalid_invitation_request" });

    const invitation = await store.getUserInvitation(token);
    if (!invitation) return reply.code(404).send({ ok: false, error: "invitation_not_found" });

    return { ok: true, invitation };
  });

  app.post("/internal/v1/invitations/:token/accept", async (request, reply) => {
    const token = queryStringField(request.params, "token");
    const password = bodyStringField(request.body, "password");
    if (!token || !password) return reply.code(400).send({ ok: false, error: "invalid_invitation_request" });

    const passwordHash = await hashPassword(password);
    try {
      const result = await store.acceptUserInvitation({ token, passwordHash });
      const session = await store.issueInternalSession({
        email: result.user.email,
        passwordHash
      });

      return {
        ok: true,
        invitation: result.invitation,
        user: result.user,
        token: session.token,
        expiresAt: session.expiresAt
      };
    } catch (error) {
      const response = invitationErrorResponse(error);
      if (response) return reply.code(response.statusCode).send({ ok: false, error: response.error });
      throw error;
    }
  });

  app.post("/internal/v1/collector-devices", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, adminRoles);
    if (!auth) return;

    const registered = await store.registerCollectorDevice({
      sellerAccountExternalId: bodyStringField(request.body, "sellerAccountExternalId") || undefined,
      externalDeviceId: bodyStringField(request.body, "deviceExternalId") || undefined,
      deviceName: bodyStringField(request.body, "deviceName") || undefined
    });
    await store.appendAuditLog({
      actorUserId: auth.user.id,
      action: "collector_device.registered",
      targetType: "collector_device",
      targetId: registered.id,
      metadata: {
        sellerAccountExternalId: registered.sellerAccountExternalId,
        externalDeviceId: registered.externalDeviceId,
        deviceName: registered.deviceName
      }
    });

    return {
      ok: true,
      token: registered.token,
      device: publicCollectorDevice(registered)
    };
  });

  app.get("/internal/v1/collector-devices", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, adminRoles);
    if (!auth) return;

    return {
      ok: true,
      devices: (await store.listCollectorDevices()).map(publicCollectorDevice)
    };
  });

  app.post("/internal/v1/collector-devices/:deviceId/revoke", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, adminRoles);
    if (!auth) return;

    const deviceId = queryStringField(request.params, "deviceId");
    if (!deviceId) {
      return reply.code(400).send({ ok: false, error: "collector_device_scope_required" });
    }

    try {
      const device = await store.revokeCollectorDevice({ deviceId });
      await store.appendAuditLog({
        actorUserId: auth.user.id,
        action: "collector_device.revoked",
        targetType: "collector_device",
        targetId: device.id,
        metadata: {
          sellerAccountExternalId: device.sellerAccountExternalId,
          deviceName: device.deviceName
        }
      });
      return {
        ok: true,
        device: publicCollectorDevice(device)
      };
    } catch (error) {
      if (isNotFoundError(error, "collector_device")) {
        return reply.code(404).send({ ok: false, error: "collector_device_not_found" });
      }
      throw error;
    }
  });

  app.get("/internal/v1/customers", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    return {
      ok: true,
      customers: await store.listCustomers()
    };
  });

  app.get("/internal/v1/conversations", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    return {
      ok: true,
      conversations: await store.listConversations()
    };
  });

  app.get("/internal/v1/conversations/:externalConversationId/messages", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    const params = request.params as { externalConversationId?: string };
    return {
      ok: true,
      messages: await store.listMessages(params.externalConversationId)
    };
  });

  app.get("/internal/v1/conversations/:externalConversationId/outbound-messages", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    const conversationScope = await resolveConversationScope(store, request.query, request.params);
    if (!conversationScope) {
      return reply.code(400).send({ ok: false, error: "conversation_scope_required" });
    }

    return {
      ok: true,
      outboundMessages: await store.listOutboundMessages({
        sellerAccountExternalId: conversationScope.scope.sellerAccountExternalId,
        externalConversationId: conversationScope.scope.externalConversationId
      })
    };
  });

  app.post("/internal/v1/conversations/:externalConversationId/outbound-messages", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    const conversationScope = await resolveConversationScope(store, request.query, request.params);
    if (!conversationScope) {
      return reply.code(400).send({ ok: false, error: "conversation_scope_required" });
    }

    const content = bodyStringField(request.body, "content");
    if (!content) {
      return reply.code(400).send({ ok: false, error: "outbound_content_required" });
    }

    try {
      const message = await store.createOutboundMessage({
        ...conversationScope.scope,
        content,
        createdByUserId: auth.user.id
      });
      await store.appendAuditLog({
        actorUserId: auth.user.id,
        action: "outbound_message.queued",
        targetType: "outbound_message",
        targetId: message.id,
        metadata: {
          sellerAccountExternalId: message.sellerAccountExternalId,
          externalCustomerId: message.externalCustomerId,
          externalConversationId: message.externalConversationId
        }
      });

      return { ok: true, message };
    } catch (error) {
      if (isNotFoundError(error, "outbound_conversation")) {
        return reply.code(404).send({ ok: false, error: "outbound_conversation_not_found" });
      }
      throw error;
    }
  });

  app.post("/internal/v1/customers/:externalCustomerId/ai-summary", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    const scope = customerScopeFromQueryOrSession(request.query, request.params, auth);
    if (!scope) {
      return reply.code(400).send({ ok: false, error: "customer_scope_required" });
    }

    const bundle = await loadCustomerMessageBundle(store, scope);
    if (!bundle.customer) {
      return reply.code(404).send({ ok: false, error: "customer_not_found" });
    }

    const job = await aiJobQueue.run("customer-summary", { scope }, async () => {
      const generated = await aiProvider.generateCustomerSummary({
        scope,
        customer: bundle.customer,
        conversations: bundle.conversations,
        messages: bundle.messages
      });
      return store.createAiSummary({
        ...scope,
        promptVersion: generated.promptVersion,
        summary: generated.summary,
        intentLevel: generated.intentLevel,
        nextAction: generated.nextAction,
        sourceMessageStartAt: minMessageTime(bundle.messages),
        sourceMessageEndAt: maxMessageTime(bundle.messages)
      });
    });

    return {
      ok: true,
      job: publicAiJob(job),
      summary: job.result || null
    };
  });

  app.get("/internal/v1/customers/:externalCustomerId/ai-summary", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    const scope = customerScopeFromQueryOrSession(request.query, request.params, auth);
    if (!scope) {
      return reply.code(400).send({ ok: false, error: "customer_scope_required" });
    }

    return {
      ok: true,
      summary: await store.getLatestAiSummary(scope)
    };
  });

  app.post("/internal/v1/conversations/:externalConversationId/reply-suggestions", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    const conversationScope = await resolveConversationScope(store, request.query, request.params);
    if (!conversationScope) {
      return reply.code(400).send({ ok: false, error: "conversation_scope_required" });
    }

    const { scope, conversation, customer } = conversationScope;
    const messages = await store.listMessages(scope.externalConversationId);
    const job = await aiJobQueue.run("reply-suggestions", { scope }, async () => {
      const generated = await aiProvider.generateReplySuggestion({
        scope,
        customer,
        conversation,
        messages,
        tone: bodyStringField(request.body, "tone") || undefined
      });
      const suggestions = [];
      for (const suggestion of generated.suggestions) {
        suggestions.push(
          await store.createReplySuggestion({
            ...scope,
            promptVersion: generated.promptVersion,
            suggestion,
            createdByUserId: auth.user.id
          })
        );
      }
      return suggestions;
    });

    return {
      ok: true,
      job: publicAiJob(job),
      suggestions: job.result || []
    };
  });

  app.get("/internal/v1/conversations/:externalConversationId/reply-suggestions", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    const conversationScope = await resolveConversationScope(store, request.query, request.params);
    if (!conversationScope) {
      return reply.code(400).send({ ok: false, error: "conversation_scope_required" });
    }

    return {
      ok: true,
      suggestions: await store.listReplySuggestions(conversationScope.scope)
    };
  });

  app.post("/internal/v1/customers/:externalCustomerId/notes", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    const scope = customerScopeFromQueryOrSession(request.query, request.params, auth);
    if (!scope) {
      return reply.code(400).send({ ok: false, error: "customer_scope_required" });
    }

    const body = bodyStringField(request.body, "body");
    if (!body) {
      return reply.code(400).send({ ok: false, error: "note_body_required" });
    }

    return {
      ok: true,
      note: await store.createCustomerNote({ ...scope, body })
    };
  });

  app.get("/internal/v1/customers/:externalCustomerId/notes", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    const scope = customerScopeFromQueryOrSession(request.query, request.params, auth);
    if (!scope) {
      return reply.code(400).send({ ok: false, error: "customer_scope_required" });
    }

    return {
      ok: true,
      notes: await store.listCustomerNotes(scope)
    };
  });

  app.post("/internal/v1/customers/:externalCustomerId/tags", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    const scope = customerScopeFromQueryOrSession(request.query, request.params, auth);
    if (!scope) {
      return reply.code(400).send({ ok: false, error: "customer_scope_required" });
    }

    const tag = bodyStringField(request.body, "tag");
    if (!tag) {
      return reply.code(400).send({ ok: false, error: "tag_required" });
    }

    return {
      ok: true,
      tag: await store.addCustomerTag({ ...scope, tag })
    };
  });

  app.get("/internal/v1/customers/:externalCustomerId/tags", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    const scope = customerScopeFromQueryOrSession(request.query, request.params, auth);
    if (!scope) {
      return reply.code(400).send({ ok: false, error: "customer_scope_required" });
    }

    return {
      ok: true,
      tags: await store.listCustomerTags(scope)
    };
  });

  app.post("/internal/v1/customers/:externalCustomerId/assignment", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    const scope = customerScopeFromQueryOrSession(request.query, request.params, auth);
    if (!scope) {
      return reply.code(400).send({ ok: false, error: "customer_scope_required" });
    }

    const assignedToUserId = bodyStringField(request.body, "assignedToUserId");
    if (!assignedToUserId) {
      return reply.code(400).send({ ok: false, error: "assigned_to_user_required" });
    }

    const assignment = await store.assignCustomer({
      ...scope,
      assignedToUserId,
      assignedByUserId: auth.user.id
    });
    await store.appendAuditLog({
      actorUserId: auth.user.id,
      action: "customer.assignment.updated",
      targetType: "customer",
      targetId: assignment.id,
      metadata: {
        sellerAccountExternalId: scope.sellerAccountExternalId,
        externalCustomerId: scope.externalCustomerId,
        assignedToUserId
      }
    });

    return {
      ok: true,
      assignment
    };
  });

  app.get("/internal/v1/customers/:externalCustomerId/assignment", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    const scope = customerScopeFromQueryOrSession(request.query, request.params, auth);
    if (!scope) {
      return reply.code(400).send({ ok: false, error: "customer_scope_required" });
    }

    return {
      ok: true,
      assignment: await store.getCustomerAssignment(scope)
    };
  });

  app.post("/internal/v1/customers/:externalCustomerId/follow-up-tasks", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    const scope = customerScopeFromQueryOrSession(request.query, request.params, auth);
    if (!scope) {
      return reply.code(400).send({ ok: false, error: "customer_scope_required" });
    }

    const title = bodyStringField(request.body, "title");
    if (!title) {
      return reply.code(400).send({ ok: false, error: "follow_up_title_required" });
    }

    return {
      ok: true,
      task: await store.createFollowUpTask({
        ...scope,
        title,
        assignedToUserId: bodyStringField(request.body, "assignedToUserId") || undefined,
        dueAt: bodyStringField(request.body, "dueAt") || undefined,
        status: bodyStringField(request.body, "status") || undefined
      })
    };
  });

  app.get("/internal/v1/customers/:externalCustomerId/follow-up-tasks", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    const scope = customerScopeFromQueryOrSession(request.query, request.params, auth);
    if (!scope) {
      return reply.code(400).send({ ok: false, error: "customer_scope_required" });
    }

    return {
      ok: true,
      tasks: await store.listFollowUpTasks(scope)
    };
  });

  app.patch("/internal/v1/follow-up-tasks/:taskId", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
    if (!auth) return;

    const taskId = queryStringField(request.params, "taskId");
    if (!taskId) {
      return reply.code(400).send({ ok: false, error: "follow_up_task_required" });
    }

    const update = compactRecord({
      status: bodyStringField(request.body, "status"),
      title: bodyStringField(request.body, "title"),
      assignedToUserId: bodyStringField(request.body, "assignedToUserId"),
      dueAt: bodyStringField(request.body, "dueAt")
    });
    if (Object.keys(update).length === 0) {
      return reply.code(400).send({ ok: false, error: "follow_up_update_required" });
    }

    try {
      const task = await store.updateFollowUpTask({
        taskId,
        ...update
      });
      await store.appendAuditLog({
        actorUserId: auth.user.id,
        action: "follow_up_task.updated",
        targetType: "follow_up_task",
        targetId: task.id,
        metadata: update
      });

      return {
        ok: true,
        task
      };
    } catch (error) {
      if (isNotFoundError(error, "follow_up_task")) {
        return reply.code(404).send({ ok: false, error: "follow_up_task_not_found" });
      }
      throw error;
    }
  });

  return app;
}

export async function createServerFromEnv(options: CreateServerFromEnvOptions = {}): Promise<FastifyInstance> {
  const env = options.env || process.env;
  const databaseUrl = env.DATABASE_URL;
  const store = databaseUrl
    ? await createPostgresStore(databaseUrl, options.sqlClientFactory)
    : new InMemorySyncStore();
  const aiJobQueue = options.aiJobQueueFactory
    ? await options.aiJobQueueFactory(env)
    : await createAiJobQueueFromEnv(env);

  return createServer({
    store,
    aiJobQueue,
    logger: options.logger
  });
}

async function createAiJobQueueFromEnv(env: Record<string, string | undefined>): Promise<AiJobQueue | undefined> {
  const redisUrl = env.REDIS_URL || env.WANGWANG_REDIS_URL;
  if (!redisUrl) return undefined;
  return createBullMqAiJobQueue({
    redisUrl,
    waitForCompletion: env.WANGWANG_AI_QUEUE_WAIT_FOR_COMPLETION === "true"
  });
}

async function createPostgresStore(
  databaseUrl: string,
  sqlClientFactory?: (databaseUrl: string) => Promise<SqlClient> | SqlClient
): Promise<PostgresSyncStore> {
  const client = await (sqlClientFactory ? sqlClientFactory(databaseUrl) : createNodePostgresClient(databaseUrl));
  await runMigrations(client);
  return new PostgresSyncStore(client);
}

async function collectorDeviceFromAuthorization(authorization: string, store: SyncStore): Promise<CollectorDevice | null> {
  const token = bearerToken(authorization);
  if (!token) return null;

  return store.authenticateCollectorDevice(token);
}

function collectorScopedBatch(batch: SyncBatch, device: CollectorDevice): SyncBatch {
  const sellerAccountExternalId = collectorSellerAccountExternalId(device);
  const deviceId = device.externalDeviceId || batch.device.deviceId;
  return {
    ...batch,
    sellerAccount: {
      ...batch.sellerAccount,
      externalAccountId: sellerAccountExternalId
    },
    device: {
      ...batch.device,
      deviceId,
      deviceName: device.deviceName || batch.device.deviceName
    }
  };
}

function collectorSellerAccountExternalId(device: CollectorDevice): string {
  return device.sellerAccountExternalId || DEFAULT_SELLER_ACCOUNT_EXTERNAL_ID;
}

function applyCorsHeaders(request: FastifyRequest, reply: FastifyReply): void {
  const origin = requestOrigin(request);
  if (!origin || !isAllowedCorsOrigin(origin)) return;

  reply.header("Access-Control-Allow-Origin", origin);
  reply.header("Vary", "Origin");
  reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  reply.header("Access-Control-Allow-Headers", allowedCorsHeaders(request));
  reply.header("Access-Control-Max-Age", "600");
}

function requestOrigin(request: FastifyRequest): string | null {
  const origin = request.headers.origin;
  return typeof origin === "string" && origin.trim() ? origin.trim() : null;
}

function isAllowedCorsOrigin(origin: string): boolean {
  return (
    /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) ||
    /^chrome-extension:\/\/[a-p]{32}$/.test(origin)
  );
}

function allowedCorsHeaders(request: FastifyRequest): string {
  const requested = request.headers["access-control-request-headers"];
  return typeof requested === "string" && requested.trim() ? requested : "authorization,content-type";
}

function defaultCollectorDeviceExternalId(): string {
  return `collector-${crypto.randomUUID()}`;
}

interface PublicInternalUser {
  id: string;
  email: string;
  displayName: string;
  roles: InternalRole[];
}

interface InternalAuthContext {
  user: PublicInternalUser;
  roles: InternalRole[];
}

async function requireInternalAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  store: SyncStore,
  allowedRoles?: InternalRole[]
): Promise<InternalAuthContext | null> {
  const token = bearerToken(request.headers.authorization || "");
  if (!token) {
    reply.code(401).send({ ok: false, error: "internal_unauthorized" });
    return null;
  }

  const auth = await sessionAuthContext(store, token);
  if (!auth) {
    reply.code(401).send({ ok: false, error: "internal_unauthorized" });
    return null;
  }

  if (allowedRoles && !requireRole(auth, allowedRoles)) {
    reply.code(403).send({ ok: false, error: "forbidden" });
    return null;
  }

  return auth;
}

function requireRole(auth: InternalAuthContext, allowedRoles: InternalRole[]): boolean {
  return allowedRoles.some((role) => auth.roles.includes(role));
}

async function sessionAuthContext(store: SyncStore, token: string): Promise<InternalAuthContext | null> {
  const session = await store.getInternalSession(token);
  if (!session) return null;

  return {
    user: publicUserFromSession(session),
    roles: session.roles
  };
}

async function issueLoginSession(store: SyncStore, credentials: InternalUserCredentials): Promise<{
  token: string;
  expiresAt: string;
  user: PublicInternalUser;
}> {
  const session = await store.issueInternalSession({
    email: credentials.email,
    passwordHash: credentials.passwordHash
  });
  await store.appendAuditLog({
    actorUserId: session.userId,
    action: "auth.login.succeeded",
    targetType: "app_user",
    targetId: session.userId
  });
  return {
    token: session.token,
    expiresAt: session.expiresAt,
    user: publicUserFromSession(session)
  };
}

function publicUserFromSession(session: InternalSession): PublicInternalUser {
  return {
    id: session.userId,
    email: session.email,
    displayName: session.displayName,
    roles: session.roles
  };
}

function publicCollectorDevice(device: CollectorDevice | RegisteredCollectorDevice): CollectorDevice {
  return {
    id: device.id,
    externalDeviceId: device.externalDeviceId,
    sellerAccountExternalId: device.sellerAccountExternalId,
    deviceName: device.deviceName,
    status: device.status,
    lastHeartbeatAt: device.lastHeartbeatAt,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt
  };
}

async function loadCustomerMessageBundle(store: SyncStore, scope: CustomerScope): Promise<{
  customer: StoredCustomer | null;
  conversations: StoredConversation[];
  messages: StoredMessage[];
}> {
  const [customers, conversations] = await Promise.all([
    store.listCustomers(),
    store.listConversations()
  ]);
  const customer =
    customers.find(
      (item) =>
        item.sellerAccountExternalId === scope.sellerAccountExternalId &&
        item.externalCustomerId === scope.externalCustomerId
    ) || null;
  const scopedConversations = conversations.filter(
    (item) =>
      item.sellerAccountExternalId === scope.sellerAccountExternalId &&
      item.externalCustomerId === scope.externalCustomerId
  );
  const messageGroups = await Promise.all(
    scopedConversations.map((conversation) => store.listMessages(conversation.externalConversationId))
  );
  return {
    customer,
    conversations: scopedConversations,
    messages: messageGroups.flat().sort((left, right) => compareIso(left.sentAt, right.sentAt))
  };
}

async function resolveConversationScope(
  store: SyncStore,
  query: unknown,
  params: unknown
): Promise<{
  scope: ConversationCustomerScope;
  conversation: StoredConversation;
  customer: StoredCustomer | null;
} | null> {
  const sellerAccountExternalId = queryStringField(query, "sellerAccountExternalId");
  const externalConversationId = queryStringField(params, "externalConversationId");
  if (!sellerAccountExternalId || !externalConversationId) return null;

  const conversations = await store.listConversations();
  const conversation = conversations.find(
    (item) =>
      item.sellerAccountExternalId === sellerAccountExternalId &&
      item.externalConversationId === externalConversationId &&
      item.externalCustomerId
  );
  if (!conversation?.externalCustomerId) return null;

  const customers = await store.listCustomers();
  const customer =
    customers.find(
      (item) =>
        item.sellerAccountExternalId === sellerAccountExternalId &&
        item.externalCustomerId === conversation.externalCustomerId
    ) || null;

  return {
    scope: {
      sellerAccountExternalId,
      externalCustomerId: conversation.externalCustomerId,
      externalConversationId
    },
    conversation,
    customer
  };
}

function minMessageTime(messages: StoredMessage[]): string | undefined {
  return messages.reduce<string | undefined>((current, message) => minIso(current, message.sentAt), undefined);
}

function maxMessageTime(messages: StoredMessage[]): string | undefined {
  return messages.reduce<string | undefined>((current, message) => maxIso(current, message.sentAt), undefined);
}

function compareIso(left?: string, right?: string): number {
  return isoTimestamp(left) - isoTimestamp(right);
}

function minIso(current?: string, candidate?: string): string | undefined {
  if (!candidate) return current;
  if (!current) return candidate;
  return Date.parse(candidate) < Date.parse(current) ? candidate : current;
}

function maxIso(current?: string, candidate?: string): string | undefined {
  if (!candidate) return current;
  if (!current) return candidate;
  return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

function isoTimestamp(value?: string): number {
  return value ? Date.parse(value) : 0;
}

function compactRecord<T extends Record<string, string | null | undefined>>(value: T): Partial<Record<keyof T, string>> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null)) as Partial<Record<keyof T, string>>;
}

function bearerToken(authorization: string): string {
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
}

async function appendLoginFailedAuditLog(store: SyncStore, email: string): Promise<void> {
  try {
    await store.appendAuditLog({
      action: "auth.login.failed",
      targetType: "app_user",
      metadata: { email }
    });
  } catch {
    return;
  }
}

function isInvalidCredentialsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message === "invalid_credentials" || message === "internal_session_not_found";
}

function isNotFoundError(error: unknown, source: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message === `${source}_not_found`;
}

function invitationErrorResponse(error: unknown): { statusCode: number; error: string } | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "invitation_not_found") return { statusCode: 404, error: "invitation_not_found" };
  if (message === "invitation_already_accepted") return { statusCode: 409, error: "invitation_already_accepted" };
  if (message === "invitation_expired") return { statusCode: 410, error: "invitation_expired" };
  return null;
}

function customerScopeFromQueryOrSession(
  query: unknown,
  params: unknown,
  _auth: InternalAuthContext
): CustomerScope | null {
  const sellerAccountExternalId = queryStringField(query, "sellerAccountExternalId");
  const externalCustomerId = queryStringField(params, "externalCustomerId");
  if (!sellerAccountExternalId || !externalCustomerId) return null;

  return {
    sellerAccountExternalId,
    externalCustomerId
  };
}

function queryStringField(source: unknown, field: string): string | null {
  const value = (source as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function bodyStringField(source: unknown, field: string): string | null {
  const value = (source as Record<string, unknown> | null | undefined)?.[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function bodyDeliveryStatusField(source: unknown): "sent" | "failed" | null {
  const value = bodyStringField(source, "status");
  return value === "sent" || value === "failed" ? value : null;
}

function queryNumberField(source: unknown, field: string): number | null {
  const value = (source as Record<string, unknown> | null | undefined)?.[field];
  const raw = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
}

function bodyRolesField(source: unknown): InternalRole[] {
  const roles = (source as Record<string, unknown> | null | undefined)?.roles;
  if (!Array.isArray(roles)) return [];
  const allowedRoles = new Set<InternalRole>(["admin", "supervisor", "sales"]);
  if (roles.length === 0 || !roles.every((role) => typeof role === "string" && allowedRoles.has(role as InternalRole))) {
    return [];
  }
  if (new Set(roles).size !== roles.length) return [];
  return roles as InternalRole[];
}

function isValidSyncBatch(value: unknown): value is SyncBatch {
  const batch = value as Partial<SyncBatch> | null | undefined;
  if (!batch || typeof batch !== "object") return false;
  if (!batch.sellerAccount || !isNonEmptyString(batch.sellerAccount.externalAccountId)) return false;
  if (!batch.device || !isNonEmptyString(batch.device.deviceId)) return false;

  if (batch.customers && !batch.customers.every((customer) => isNonEmptyString(customer.externalCustomerId))) {
    return false;
  }
  if (
    batch.conversations &&
    !batch.conversations.every((conversation) => isNonEmptyString(conversation.externalConversationId))
  ) {
    return false;
  }
  if (
    batch.messages &&
    !batch.messages.every(
      (message) => isNonEmptyString(message.externalConversationId) && isValidDirection(message.direction)
    )
  ) {
    return false;
  }

  return true;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDirection(value: unknown): boolean {
  return value === "received" || value === "sent" || value === "unknown";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadWorkspaceEnv();
  const app = await createServerFromEnv({ env: process.env, logger: true });
  const host = process.env.WANGWANG_SERVER_HOST || "127.0.0.1";
  const port = Number(process.env.WANGWANG_SERVER_PORT || 5032);
  await app.listen({ host, port });
}

function terminateWebsocketServer(this: FastifyInstance, done: () => void): void {
  for (const socket of this.websocketServer.clients) {
    socket.terminate();
  }
  this.websocketServer.close(done);
}
