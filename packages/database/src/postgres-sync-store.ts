import crypto from "node:crypto";
import type { SqlClient } from "./sql-client.js";
import type {
  AddCustomerTagInput,
  AcceptUserInvitationInput,
  AcceptUserInvitationResult,
  AssignCustomerInput,
  ClaimPendingOutboundMessagesInput,
  CollectorDevice,
  RecordCollectorHeartbeatInput,
  ProvisionedManagedTradeMindActivation,
  ProvisionManagedTradeMindActivationInput,
  ManagedTradeMindIdentity,
  ConsumedManagedTradeMindActivation,
  ConsumeManagedTradeMindActivationInput,
  ConversationCustomerScope,
  CreateAiSummaryInput,
  CreateAuditLogInput,
  CreateCustomerNoteInput,
  CreateFollowUpTaskInput,
  CreateInternalUserInput,
  CreateOutboundMessageInput,
  CreateReplySuggestionInput,
  CreateUserInvitationInput,
  CustomerScope,
  GetInternalUserCredentialsByEmailInput,
  GetInternalUserCredentialsInput,
  InternalRole,
  InternalSession,
  InternalUser,
  InternalUserCredentials,
  IssueInternalSessionInput,
  ListOutboundMessagesInput,
  ListMessagesInput,
  ListPendingOutboundMessagesInput,
  MarkOutboundMessageDeliveredInput,
  MessageDirection,
  OutboundMessageStatus,
  RegisteredCollectorDevice,
  RegisterCollectorDeviceInput,
  RevokeCollectorDeviceInput,
  RevokeInternalSessionInput,
  StoredAuditLog,
  StoredAiSummary,
  StoredCustomerAssignment,
  StoredConversation,
  StoredCustomer,
  StoredCustomerNote,
  StoredCustomerTag,
  StoredFollowUpTask,
  StoredMessage,
  StoredOutboundMessage,
  StoredSellerAccount,
  StoredReplySuggestion,
  StoredUserInvitation,
  SyncBatch,
  SyncBatchResult,
  SyncMessageInput,
  UpdateFollowUpTaskInput,
  UpdateInternalUserInput
} from "./sync-types.js";

interface IdRow {
  id: string;
}

interface CustomerRow {
  sellerAccountExternalId: string;
  channel: string | null;
  channelAccountExternalId: string | null;
  channelSurface: string | null;
  externalCustomerId: string;
  loginId: string | null;
  loginIdEncrypt: string | null;
  displayName: string | null;
  companyName: string | null;
  avatarUrl: string | null;
  country: string | null;
  currentTimeZone: string | null;
  accountId: string | null;
  accountIdEncrypt: string | null;
  aliId: string | null;
  aliIdEncrypt: string | null;
  ownerUserId: string | null;
  stage: string | null;
}

interface ConversationRow {
  sellerAccountExternalId: string;
  channel: string | null;
  channelAccountExternalId: string | null;
  channelSurface: string | null;
  externalConversationId: string;
  externalCustomerId: string | null;
  lastMessageAt: string | Date | null;
}

interface MessageRow {
  sellerAccountExternalId: string;
  channel: string | null;
  channelAccountExternalId: string | null;
  channelSurface: string | null;
  externalConversationId: string;
  externalMessageId: string | null;
  direction: MessageDirection;
  messageType: string | null;
  content: string | null;
  sentAt: string | Date | null;
  rawSanitized: Record<string, unknown> | null;
  contentHash: string;
  uniqueKey: string;
}

interface CustomerNoteRow {
  id: string;
  sellerAccountExternalId: string;
  channel: string | null;
  channelAccountExternalId: string | null;
  channelSurface: string | null;
  externalCustomerId: string;
  body: string;
  createdByUserId: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface CustomerTagRow {
  id: string;
  sellerAccountExternalId: string;
  channel: string | null;
  channelAccountExternalId: string | null;
  channelSurface: string | null;
  externalCustomerId: string;
  tag: string;
  createdByUserId: string | null;
  createdAt: string | Date;
}

interface FollowUpTaskRow {
  id: string;
  sellerAccountExternalId: string;
  channel: string | null;
  channelAccountExternalId: string | null;
  channelSurface: string | null;
  externalCustomerId: string;
  title: string;
  assignedToUserId: string | null;
  status: string;
  dueAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface CustomerAssignmentRow {
  id: string;
  sellerAccountExternalId: string;
  channel: string | null;
  channelAccountExternalId: string | null;
  channelSurface: string | null;
  externalCustomerId: string;
  assignedToUserId: string;
  assignedByUserId: string | null;
  assignedAt: string | Date;
  updatedAt: string | Date;
}

interface AuditLogRow {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string | Date;
}

interface AiSummaryRow {
  id: string;
  sellerAccountExternalId: string;
  channel: string | null;
  channelAccountExternalId: string | null;
  channelSurface: string | null;
  externalCustomerId: string;
  promptVersion: string;
  summary: string;
  intentLevel: string | null;
  nextAction: string | null;
  sourceMessageStartAt: string | Date | null;
  sourceMessageEndAt: string | Date | null;
  createdAt: string | Date;
}

interface ReplySuggestionRow {
  id: string;
  sellerAccountExternalId: string;
  channel: string | null;
  channelAccountExternalId: string | null;
  channelSurface: string | null;
  externalCustomerId: string;
  externalConversationId: string;
  promptVersion: string;
  suggestion: string;
  status: string;
  createdByUserId: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface OutboundMessageRow {
  id: string;
  sellerAccountExternalId: string;
  channel: string | null;
  channelAccountExternalId: string | null;
  channelSurface: string | null;
  externalCustomerId: string;
  externalConversationId: string;
  content: string;
  status: OutboundMessageStatus;
  createdByUserId: string | null;
  deliveredByDeviceId: string | null;
  externalMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  deliveredAt: string | Date | null;
  claimedByDeviceId?: string | null;
  claimExpiresAt?: string | Date | null;
}

interface InternalUserRow {
  id: string;
  email: string;
  displayName: string;
  status: string;
  roles: InternalRole[] | string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface InternalUserCredentialsRow extends InternalUserRow {
  passwordHash: string;
}

interface InternalSessionRow {
  tokenHash: string;
  userId: string;
  email: string;
  displayName: string;
  roles: InternalRole[] | string;
  createdAt: string | Date;
  expiresAt: string | Date;
}

interface UserInvitationRow {
  id: string;
  email: string;
  displayName: string;
  roles: InternalRole[] | string;
  createdByUserId: string | null;
  expiresAt: string | Date;
  acceptedAt: string | Date | null;
  createdAt: string | Date;
}

interface AcceptUserInvitationRow extends UserInvitationRow {
  errorCode: string | null;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  userStatus: string;
  userRoles: InternalRole[] | string;
  userCreatedAt: string | Date;
  userUpdatedAt: string | Date;
}

interface ManagedTradeMindActivationRow {
  identityKey: string;
  provider: string;
  workspaceId: string;
  userId: string;
  userEmail: string;
  userDisplayName: string | null;
  channel: string;
  bindingToken: string;
  activationTokenHash: string;
  expiresAt: string | Date;
  consumedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface CollectorDeviceRow {
  id: string;
  externalDeviceId: string | null;
  sellerAccountExternalId: string | null;
  tradeMindBindingToken: string | null;
  deviceName: string | null;
  activatedByUserId: string | null;
  activatedByUserEmail: string | null;
  activatedByUserDisplayName: string | null;
  activatedByUserRoles: InternalRole[] | string | null;
  status: string;
  tokenHash?: string | null;
  lastHeartbeatAt: string | Date | null;
  lastSyncAt: string | Date | null;
  lastError: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export class PostgresSyncStore {
  constructor(private readonly client: SqlClient) {}

  async acceptSyncBatch(batch: SyncBatch): Promise<SyncBatchResult> {
    await this.client.query("BEGIN");
    try {
      const result = await this.acceptSyncBatchWrites(batch);
      await this.client.query("COMMIT");
      return result;
    } catch (error) {
      await this.client.query("ROLLBACK");
      throw error;
    }
  }

  private async acceptSyncBatchWrites(batch: SyncBatch): Promise<SyncBatchResult> {
    let acceptedCount = 0;
    let rejectedCount = 0;
    let nextCursor: string | null = null;

    const sellerAccountId = await this.upsertSellerAccount(batch);
    const deviceId = await this.upsertCollectorDevice(batch, sellerAccountId);
    const channelScope = syncChannelScope(batch);
    const channelAccountId = await this.upsertChannelAccount(batch, sellerAccountId, channelScope);
    const customerIds = new Map<string, string>();
    const conversationIds = new Map<string, string>();

    for (const customer of batch.customers || []) {
      customerIds.set(
        customer.externalCustomerId,
        await this.upsertCustomer(batch, sellerAccountId, channelAccountId, channelScope, customer.externalCustomerId)
      );
    }

    for (const conversation of batch.conversations || []) {
      const customerId = conversation.externalCustomerId ? customerIds.get(conversation.externalCustomerId) || null : null;
      conversationIds.set(
        conversation.externalConversationId,
        await this.upsertConversation(batch, sellerAccountId, channelAccountId, channelScope, conversation.externalConversationId, customerId)
      );
    }

    await this.insertSyncBatch(batch, sellerAccountId, deviceId, channelAccountId, channelScope);

    for (const message of batch.messages || []) {
      const conversationId = conversationIds.get(message.externalConversationId);
      if (!conversationId) {
        rejectedCount += 1;
        continue;
      }
      const rowCount = await this.insertMessage(batch, sellerAccountId, channelAccountId, channelScope, conversationId, message);
      if (rowCount > 0) {
        acceptedCount += 1;
        nextCursor = maxIso(nextCursor, message.sentAt || null);
      } else {
        rejectedCount += 1;
      }
    }

    const result = {
      acceptedCount,
      rejectedCount,
      nextCursor,
      warnings: []
    };
    await this.updateSyncBatchResult(batch, sellerAccountId, channelAccountId, channelScope, result);
    return result;
  }

  async listSellerAccounts(): Promise<StoredSellerAccount[]> {
    return [];
  }

  async listCustomers(): Promise<StoredCustomer[]> {
    const result = await this.client.query<CustomerRow>(
      `
      /* list_customers */
      SELECT
        s.external_account_id AS "sellerAccountExternalId",
        c.channel AS "channel",
        ca.external_account_id AS "channelAccountExternalId",
        ca.surface AS "channelSurface",
        c.external_customer_id AS "externalCustomerId",
        c.login_id AS "loginId",
        c.login_id_encrypt AS "loginIdEncrypt",
        c.display_name AS "displayName",
        c.company_name AS "companyName",
        c.avatar_url AS "avatarUrl",
        c.country AS "country",
        c.current_time_zone AS "currentTimeZone",
        c.account_id AS "accountId",
        c.account_id_encrypt AS "accountIdEncrypt",
        c.ali_id AS "aliId",
        c.ali_id_encrypt AS "aliIdEncrypt",
        c.owner_user_id AS "ownerUserId",
        c.stage AS "stage"
      FROM customer c
      INNER JOIN seller_account s ON s.id = c.seller_account_id
      LEFT JOIN channel_account ca ON ca.id = c.channel_account_id
      ORDER BY c.updated_at DESC, c.external_customer_id ASC
      `,
      []
    );

    return result.rows.map((row) => ({
      sellerAccountExternalId: row.sellerAccountExternalId,
      externalCustomerId: row.externalCustomerId,
      ...optionalProps({
        channel: row.channel,
        channelAccountExternalId: row.channelAccountExternalId,
        channelSurface: row.channelSurface,
        loginId: row.loginId,
        loginIdEncrypt: row.loginIdEncrypt,
        displayName: row.displayName,
        companyName: row.companyName,
        avatarUrl: row.avatarUrl,
        country: row.country,
        currentTimeZone: row.currentTimeZone,
        accountId: row.accountId,
        accountIdEncrypt: row.accountIdEncrypt,
        aliId: row.aliId,
        aliIdEncrypt: row.aliIdEncrypt,
        ownerUserId: row.ownerUserId,
        stage: row.stage
      })
    }));
  }

  async listConversations(): Promise<StoredConversation[]> {
    const result = await this.client.query<ConversationRow>(
      `
      /* list_conversations */
      SELECT
        s.external_account_id AS "sellerAccountExternalId",
        conv.channel AS "channel",
        ca.external_account_id AS "channelAccountExternalId",
        ca.surface AS "channelSurface",
        conv.external_conversation_id AS "externalConversationId",
        c.external_customer_id AS "externalCustomerId",
        conv.last_message_at AS "lastMessageAt"
      FROM conversation conv
      INNER JOIN seller_account s ON s.id = conv.seller_account_id
      LEFT JOIN customer c ON c.id = conv.customer_id
      LEFT JOIN channel_account ca ON ca.id = conv.channel_account_id
      ORDER BY conv.last_message_at DESC NULLS LAST, conv.external_conversation_id ASC
      `,
      []
    );

    return result.rows.map((row) => ({
      sellerAccountExternalId: row.sellerAccountExternalId,
      externalConversationId: row.externalConversationId,
      ...optionalProps({
        channel: row.channel,
        channelAccountExternalId: row.channelAccountExternalId,
        channelSurface: row.channelSurface,
        externalCustomerId: row.externalCustomerId,
        lastMessageAt: isoString(row.lastMessageAt)
      })
    }));
  }

  async listMessages(input?: string | ListMessagesInput): Promise<StoredMessage[]> {
    const scope = typeof input === "string" ? { externalConversationId: input } : input || {};
    const result = await this.client.query<MessageRow>(
      `
      /* list_messages */
      SELECT
        s.external_account_id AS "sellerAccountExternalId",
        m.channel AS "channel",
        ca.external_account_id AS "channelAccountExternalId",
        ca.surface AS "channelSurface",
        conv.external_conversation_id AS "externalConversationId",
        m.external_message_id AS "externalMessageId",
        m.direction AS "direction",
        m.message_type AS "messageType",
        m.content AS "content",
        m.sent_at AS "sentAt",
        m.raw_sanitized AS "rawSanitized",
        m.content_hash AS "contentHash",
        COALESCE(
          m.external_message_id,
          concat_ws(':', conv.external_conversation_id, COALESCE(m.sent_at::text, ''), m.direction, m.content_hash)
        ) AS "uniqueKey"
      FROM message m
      INNER JOIN seller_account s ON s.id = m.seller_account_id
      INNER JOIN conversation conv ON conv.id = m.conversation_id
      LEFT JOIN channel_account ca ON ca.id = m.channel_account_id
      WHERE ($1::text IS NULL OR conv.external_conversation_id = $1)
        AND ($2::text IS NULL OR s.external_account_id = $2)
        AND ($3::text IS NULL OR m.channel = $3)
        AND ($4::text IS NULL OR ca.external_account_id = $4)
      ORDER BY m.sent_at ASC NULLS LAST, m.id ASC
      `,
      [
        scope.externalConversationId || null,
        scope.sellerAccountExternalId || null,
        scope.channel || null,
        scope.channelAccountExternalId || null
      ]
    );

    return result.rows.map((row) => ({
      sellerAccountExternalId: row.sellerAccountExternalId,
      externalConversationId: row.externalConversationId,
      direction: row.direction,
      contentHash: row.contentHash,
      uniqueKey: row.uniqueKey,
      ...optionalProps({
        channel: row.channel,
        channelAccountExternalId: row.channelAccountExternalId,
        channelSurface: row.channelSurface,
        externalMessageId: row.externalMessageId,
        messageType: row.messageType,
        content: row.content,
        sentAt: isoString(row.sentAt),
        rawSanitized: row.rawSanitized
      })
    }));
  }

  async createCustomerNote(input: CreateCustomerNoteInput): Promise<StoredCustomerNote> {
    const result = await this.client.query<CustomerNoteRow>(
      `
      /* create_customer_note */
        WITH scoped_customer AS (
          SELECT c.id AS customer_id
          FROM customer c
          INNER JOIN seller_account s ON s.id = c.seller_account_id
          LEFT JOIN channel_account ca ON ca.id = c.channel_account_id
          WHERE s.external_account_id = $1
            AND c.external_customer_id = $2
            AND ($5::text IS NULL OR c.channel = $5)
            AND ($6::text IS NULL OR ca.external_account_id = $6)
        )
      INSERT INTO customer_note (customer_id, body, created_by)
      SELECT customer_id, $3, $4
      FROM scoped_customer
      RETURNING
          id::text AS "id",
          $1::text AS "sellerAccountExternalId",
          $5::text AS "channel",
          $6::text AS "channelAccountExternalId",
          NULL::text AS "channelSurface",
          $2::text AS "externalCustomerId",
        body AS "body",
        created_by::text AS "createdByUserId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      `,
      [
        input.sellerAccountExternalId,
        input.externalCustomerId,
        input.body,
        input.createdByUserId || null,
        input.channel || null,
        input.channelAccountExternalId || null
      ]
    );
    return mapCustomerNote(requiredRow(result.rows[0], "customer_note"));
  }

  async listCustomerNotes(scope: CustomerScope): Promise<StoredCustomerNote[]> {
    const result = await this.client.query<CustomerNoteRow>(
      `
      /* list_customer_notes */
      SELECT
          n.id::text AS "id",
          s.external_account_id AS "sellerAccountExternalId",
          c.channel AS "channel",
          ca.external_account_id AS "channelAccountExternalId",
          ca.surface AS "channelSurface",
          c.external_customer_id AS "externalCustomerId",
        n.body AS "body",
        n.created_by::text AS "createdByUserId",
        n.created_at AS "createdAt",
        n.updated_at AS "updatedAt"
        FROM customer_note n
        INNER JOIN customer c ON c.id = n.customer_id
        INNER JOIN seller_account s ON s.id = c.seller_account_id
        LEFT JOIN channel_account ca ON ca.id = c.channel_account_id
        WHERE s.external_account_id = $1
          AND c.external_customer_id = $2
          AND ($3::text IS NULL OR c.channel = $3)
          AND ($4::text IS NULL OR ca.external_account_id = $4)
        ORDER BY n.created_at DESC, n.id ASC
      `,
      customerScopeParams(scope)
    );
    return result.rows.map(mapCustomerNote);
  }

  async addCustomerTag(input: AddCustomerTagInput): Promise<StoredCustomerTag> {
    const result = await this.client.query<CustomerTagRow>(
      `
      /* add_customer_tag */
        WITH scoped_customer AS (
          SELECT c.id AS customer_id
          FROM customer c
          INNER JOIN seller_account s ON s.id = c.seller_account_id
          LEFT JOIN channel_account ca ON ca.id = c.channel_account_id
          WHERE s.external_account_id = $1
            AND c.external_customer_id = $2
            AND ($5::text IS NULL OR c.channel = $5)
            AND ($6::text IS NULL OR ca.external_account_id = $6)
        )
      INSERT INTO customer_tag (customer_id, tag, created_by)
      SELECT customer_id, $3, $4
      FROM scoped_customer
      ON CONFLICT (customer_id, tag)
      DO UPDATE SET tag = customer_tag.tag
      RETURNING
          id::text AS "id",
          $1::text AS "sellerAccountExternalId",
          $5::text AS "channel",
          $6::text AS "channelAccountExternalId",
          NULL::text AS "channelSurface",
          $2::text AS "externalCustomerId",
        tag AS "tag",
        created_by::text AS "createdByUserId",
        created_at AS "createdAt"
      `,
      [
        input.sellerAccountExternalId,
        input.externalCustomerId,
        input.tag,
        input.createdByUserId || null,
        input.channel || null,
        input.channelAccountExternalId || null
      ]
    );
    return mapCustomerTag(requiredRow(result.rows[0], "customer_tag"));
  }

  async listCustomerTags(scope: CustomerScope): Promise<StoredCustomerTag[]> {
    const result = await this.client.query<CustomerTagRow>(
      `
      /* list_customer_tags */
      SELECT
          t.id::text AS "id",
          s.external_account_id AS "sellerAccountExternalId",
          c.channel AS "channel",
          ca.external_account_id AS "channelAccountExternalId",
          ca.surface AS "channelSurface",
          c.external_customer_id AS "externalCustomerId",
        t.tag AS "tag",
        t.created_by::text AS "createdByUserId",
        t.created_at AS "createdAt"
        FROM customer_tag t
        INNER JOIN customer c ON c.id = t.customer_id
        INNER JOIN seller_account s ON s.id = c.seller_account_id
        LEFT JOIN channel_account ca ON ca.id = c.channel_account_id
        WHERE s.external_account_id = $1
          AND c.external_customer_id = $2
          AND ($3::text IS NULL OR c.channel = $3)
          AND ($4::text IS NULL OR ca.external_account_id = $4)
        ORDER BY t.tag ASC
      `,
      customerScopeParams(scope)
    );
    return result.rows.map(mapCustomerTag);
  }

  async createFollowUpTask(input: CreateFollowUpTaskInput): Promise<StoredFollowUpTask> {
    const status = input.status || "open";
    const result = await this.client.query<FollowUpTaskRow>(
      `
      /* create_follow_up_task */
        WITH scoped_customer AS (
          SELECT c.id AS customer_id
          FROM customer c
          INNER JOIN seller_account s ON s.id = c.seller_account_id
          LEFT JOIN channel_account ca ON ca.id = c.channel_account_id
          WHERE s.external_account_id = $1
            AND c.external_customer_id = $2
            AND ($7::text IS NULL OR c.channel = $7)
            AND ($8::text IS NULL OR ca.external_account_id = $8)
        )
      INSERT INTO follow_up_task (customer_id, title, assigned_to, due_at, status)
      SELECT customer_id, $3, $4, $5, $6
      FROM scoped_customer
      RETURNING
          id::text AS "id",
          $1::text AS "sellerAccountExternalId",
          $7::text AS "channel",
          $8::text AS "channelAccountExternalId",
          NULL::text AS "channelSurface",
          $2::text AS "externalCustomerId",
        title AS "title",
        assigned_to::text AS "assignedToUserId",
        status AS "status",
        due_at AS "dueAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      `,
      [
        input.sellerAccountExternalId,
        input.externalCustomerId,
        input.title,
        input.assignedToUserId || null,
        input.dueAt || null,
        status,
        input.channel || null,
        input.channelAccountExternalId || null
      ]
    );
    return mapFollowUpTask(requiredRow(result.rows[0], "follow_up_task"));
  }

  async listFollowUpTasks(scope: CustomerScope): Promise<StoredFollowUpTask[]> {
    const result = await this.client.query<FollowUpTaskRow>(
      `
      /* list_follow_up_tasks */
      SELECT
          f.id::text AS "id",
          s.external_account_id AS "sellerAccountExternalId",
          c.channel AS "channel",
          ca.external_account_id AS "channelAccountExternalId",
          ca.surface AS "channelSurface",
          c.external_customer_id AS "externalCustomerId",
        f.title AS "title",
        f.assigned_to::text AS "assignedToUserId",
        f.status AS "status",
        f.due_at AS "dueAt",
        f.created_at AS "createdAt",
        f.updated_at AS "updatedAt"
        FROM follow_up_task f
        INNER JOIN customer c ON c.id = f.customer_id
        INNER JOIN seller_account s ON s.id = c.seller_account_id
        LEFT JOIN channel_account ca ON ca.id = c.channel_account_id
        WHERE s.external_account_id = $1
          AND c.external_customer_id = $2
          AND ($3::text IS NULL OR c.channel = $3)
          AND ($4::text IS NULL OR ca.external_account_id = $4)
        ORDER BY f.due_at ASC NULLS LAST, f.created_at DESC
      `,
      customerScopeParams(scope)
    );
    return result.rows.map(mapFollowUpTask);
  }

  async assignCustomer(input: AssignCustomerInput): Promise<StoredCustomerAssignment> {
    const result = await this.client.query<CustomerAssignmentRow>(
      `
      /* assign_customer */
        WITH scoped_customer AS (
          SELECT c.id AS customer_id
          FROM customer c
          INNER JOIN seller_account s ON s.id = c.seller_account_id
          LEFT JOIN channel_account ca ON ca.id = c.channel_account_id
          WHERE s.external_account_id = $1
            AND c.external_customer_id = $2
            AND ($5::text IS NULL OR c.channel = $5)
            AND ($6::text IS NULL OR ca.external_account_id = $6)
        )
      INSERT INTO customer_assignment (customer_id, user_id, assigned_by)
      SELECT customer_id, $3, $4
      FROM scoped_customer
      ON CONFLICT (customer_id, user_id)
      DO UPDATE SET
        assigned_by = EXCLUDED.assigned_by,
        updated_at = now()
      RETURNING
          id::text AS "id",
          $1::text AS "sellerAccountExternalId",
          $5::text AS "channel",
          $6::text AS "channelAccountExternalId",
          NULL::text AS "channelSurface",
          $2::text AS "externalCustomerId",
        user_id::text AS "assignedToUserId",
        assigned_by::text AS "assignedByUserId",
        assigned_at AS "assignedAt",
        updated_at AS "updatedAt"
      `,
      [
        input.sellerAccountExternalId,
        input.externalCustomerId,
        input.assignedToUserId,
        input.assignedByUserId || null,
        input.channel || null,
        input.channelAccountExternalId || null
      ]
    );
    return mapCustomerAssignment(requiredRow(result.rows[0], "customer_assignment"));
  }

  async getCustomerAssignment(scope: CustomerScope): Promise<StoredCustomerAssignment | null> {
    const result = await this.client.query<CustomerAssignmentRow>(
      `
      /* get_customer_assignment */
      SELECT
          a.id::text AS "id",
          s.external_account_id AS "sellerAccountExternalId",
          c.channel AS "channel",
          ca.external_account_id AS "channelAccountExternalId",
          ca.surface AS "channelSurface",
          c.external_customer_id AS "externalCustomerId",
        a.user_id::text AS "assignedToUserId",
        a.assigned_by::text AS "assignedByUserId",
        a.assigned_at AS "assignedAt",
        a.updated_at AS "updatedAt"
        FROM customer_assignment a
        INNER JOIN customer c ON c.id = a.customer_id
        INNER JOIN seller_account s ON s.id = c.seller_account_id
        LEFT JOIN channel_account ca ON ca.id = c.channel_account_id
        WHERE s.external_account_id = $1
          AND c.external_customer_id = $2
          AND ($3::text IS NULL OR c.channel = $3)
          AND ($4::text IS NULL OR ca.external_account_id = $4)
        ORDER BY a.updated_at DESC, a.assigned_at DESC
      LIMIT 1
      `,
      customerScopeParams(scope)
    );
    const row = result.rows[0];
    return row ? mapCustomerAssignment(row) : null;
  }

  async updateFollowUpTask(input: UpdateFollowUpTaskInput): Promise<StoredFollowUpTask> {
    const result = await this.client.query<FollowUpTaskRow>(
      `
      /* update_follow_up_task */
      WITH updated_task AS (
        UPDATE follow_up_task
        SET
          status = COALESCE($2, status),
          title = COALESCE($3, title),
          assigned_to = COALESCE($4, assigned_to),
          due_at = COALESCE($5, due_at),
          updated_at = now()
        WHERE id = $1
        RETURNING id, customer_id, title, assigned_to, status, due_at, created_at, updated_at
      )
      SELECT
          f.id::text AS "id",
          s.external_account_id AS "sellerAccountExternalId",
          c.channel AS "channel",
          ca.external_account_id AS "channelAccountExternalId",
          ca.surface AS "channelSurface",
          c.external_customer_id AS "externalCustomerId",
        f.title AS "title",
        f.assigned_to::text AS "assignedToUserId",
        f.status AS "status",
        f.due_at AS "dueAt",
        f.created_at AS "createdAt",
        f.updated_at AS "updatedAt"
        FROM updated_task f
        INNER JOIN customer c ON c.id = f.customer_id
        INNER JOIN seller_account s ON s.id = c.seller_account_id
        LEFT JOIN channel_account ca ON ca.id = c.channel_account_id
      `,
      [
        input.taskId,
        input.status || null,
        input.title || null,
        input.assignedToUserId || null,
        input.dueAt || null
      ]
    );
    return mapFollowUpTask(requiredRow(result.rows[0], "follow_up_task"));
  }

  async appendAuditLog(input: CreateAuditLogInput): Promise<StoredAuditLog> {
    const result = await this.client.query<AuditLogRow>(
      `
      /* append_audit_log */
      INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id::text AS "id",
        actor_user_id::text AS "actorUserId",
        action AS "action",
        target_type AS "targetType",
        target_id::text AS "targetId",
        metadata AS "metadata",
        created_at AS "createdAt"
      `,
      [
        input.actorUserId || null,
        input.action,
        input.targetType,
        input.targetId || null,
        input.metadata || null
      ]
    );
    return mapAuditLog(requiredRow(result.rows[0], "audit_log"));
  }

  async listAuditLogs(): Promise<StoredAuditLog[]> {
    const result = await this.client.query<AuditLogRow>(
      `
      /* list_audit_logs */
      SELECT
        id::text AS "id",
        actor_user_id::text AS "actorUserId",
        action AS "action",
        target_type AS "targetType",
        target_id::text AS "targetId",
        metadata AS "metadata",
        created_at AS "createdAt"
      FROM audit_log
      ORDER BY created_at ASC
      `,
      []
    );
    return result.rows.map(mapAuditLog);
  }

  async createAiSummary(input: CreateAiSummaryInput): Promise<StoredAiSummary> {
    const result = await this.client.query<AiSummaryRow>(
      `
      /* create_ai_summary */
        WITH scoped_customer AS (
          SELECT c.id AS customer_id
          FROM customer c
          INNER JOIN seller_account s ON s.id = c.seller_account_id
          LEFT JOIN channel_account ca ON ca.id = c.channel_account_id
          WHERE s.external_account_id = $1
            AND c.external_customer_id = $2
            AND ($9::text IS NULL OR c.channel = $9)
            AND ($10::text IS NULL OR ca.external_account_id = $10)
        )
      INSERT INTO ai_summary (
        customer_id,
        prompt_version,
        summary,
        intent_level,
        next_action,
        source_message_start_at,
        source_message_end_at
      )
      SELECT customer_id, $3, $4, $5, $6, $7, $8
      FROM scoped_customer
      RETURNING
          id::text AS "id",
          $1::text AS "sellerAccountExternalId",
          $9::text AS "channel",
          $10::text AS "channelAccountExternalId",
          NULL::text AS "channelSurface",
          $2::text AS "externalCustomerId",
        prompt_version AS "promptVersion",
        summary AS "summary",
        intent_level AS "intentLevel",
        next_action AS "nextAction",
        source_message_start_at AS "sourceMessageStartAt",
        source_message_end_at AS "sourceMessageEndAt",
        created_at AS "createdAt"
      `,
      [
        input.sellerAccountExternalId,
        input.externalCustomerId,
        input.promptVersion,
        input.summary,
        input.intentLevel || null,
        input.nextAction || null,
        input.sourceMessageStartAt || null,
        input.sourceMessageEndAt || null,
        input.channel || null,
        input.channelAccountExternalId || null
      ]
    );
    return mapAiSummary(requiredRow(result.rows[0], "ai_summary"));
  }

  async getLatestAiSummary(scope: CustomerScope): Promise<StoredAiSummary | null> {
    const result = await this.client.query<AiSummaryRow>(
      `
      /* get_latest_ai_summary */
      SELECT
          a.id::text AS "id",
          s.external_account_id AS "sellerAccountExternalId",
          c.channel AS "channel",
          ca.external_account_id AS "channelAccountExternalId",
          ca.surface AS "channelSurface",
          c.external_customer_id AS "externalCustomerId",
        a.prompt_version AS "promptVersion",
        a.summary AS "summary",
        a.intent_level AS "intentLevel",
        a.next_action AS "nextAction",
        a.source_message_start_at AS "sourceMessageStartAt",
        a.source_message_end_at AS "sourceMessageEndAt",
        a.created_at AS "createdAt"
        FROM ai_summary a
        INNER JOIN customer c ON c.id = a.customer_id
        INNER JOIN seller_account s ON s.id = c.seller_account_id
        LEFT JOIN channel_account ca ON ca.id = c.channel_account_id
        WHERE s.external_account_id = $1
          AND c.external_customer_id = $2
          AND ($3::text IS NULL OR c.channel = $3)
          AND ($4::text IS NULL OR ca.external_account_id = $4)
        ORDER BY a.created_at DESC, a.id DESC
      LIMIT 1
      `,
      customerScopeParams(scope)
    );
    const row = result.rows[0];
    return row ? mapAiSummary(row) : null;
  }

  async createReplySuggestion(input: CreateReplySuggestionInput): Promise<StoredReplySuggestion> {
    const result = await this.client.query<ReplySuggestionRow>(
      `
      /* create_reply_suggestion */
      WITH scoped_conversation AS (
        SELECT
            conv.id AS conversation_id,
            conv.customer_id,
            c.external_customer_id,
            conv.channel,
            ca.external_account_id AS channel_account_external_id,
            ca.surface AS channel_surface
          FROM conversation conv
          INNER JOIN seller_account s ON s.id = conv.seller_account_id
          INNER JOIN customer c ON c.id = conv.customer_id
          LEFT JOIN channel_account ca ON ca.id = conv.channel_account_id
          WHERE s.external_account_id = $1
            AND conv.external_conversation_id = $2
            AND c.external_customer_id = $7
            AND ($8::text IS NULL OR conv.channel = $8)
            AND ($9::text IS NULL OR ca.external_account_id = $9)
        )
      INSERT INTO reply_suggestion (
        customer_id,
        conversation_id,
        prompt_version,
        suggestion,
        status,
        created_by
      )
      SELECT customer_id, conversation_id, $3, $4, $5, $6
      FROM scoped_conversation
      RETURNING
          id::text AS "id",
          $1::text AS "sellerAccountExternalId",
          (SELECT channel FROM scoped_conversation) AS "channel",
          (SELECT channel_account_external_id FROM scoped_conversation) AS "channelAccountExternalId",
          (SELECT channel_surface FROM scoped_conversation) AS "channelSurface",
          (SELECT external_customer_id FROM scoped_conversation) AS "externalCustomerId",
        $2::text AS "externalConversationId",
        prompt_version AS "promptVersion",
        suggestion AS "suggestion",
        status AS "status",
        created_by::text AS "createdByUserId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      `,
      [
        input.sellerAccountExternalId,
        input.externalConversationId,
        input.promptVersion,
        input.suggestion,
        input.status || "draft",
        input.createdByUserId || null,
        input.externalCustomerId,
        input.channel || null,
        input.channelAccountExternalId || null
      ]
    );
    return mapReplySuggestion(requiredRow(result.rows[0], "reply_suggestion"));
  }

  async listReplySuggestions(scope: ConversationCustomerScope): Promise<StoredReplySuggestion[]> {
    const result = await this.client.query<ReplySuggestionRow>(
      `
      /* list_reply_suggestions */
      SELECT
          r.id::text AS "id",
          s.external_account_id AS "sellerAccountExternalId",
          conv.channel AS "channel",
          ca.external_account_id AS "channelAccountExternalId",
          ca.surface AS "channelSurface",
          c.external_customer_id AS "externalCustomerId",
        conv.external_conversation_id AS "externalConversationId",
        r.prompt_version AS "promptVersion",
        r.suggestion AS "suggestion",
        r.status AS "status",
        r.created_by::text AS "createdByUserId",
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt"
      FROM reply_suggestion r
      INNER JOIN conversation conv ON conv.id = r.conversation_id
        INNER JOIN customer c ON c.id = r.customer_id
        INNER JOIN seller_account s ON s.id = conv.seller_account_id
        LEFT JOIN channel_account ca ON ca.id = conv.channel_account_id
        WHERE s.external_account_id = $1
          AND conv.external_conversation_id = $2
          AND c.external_customer_id = $3
          AND ($4::text IS NULL OR conv.channel = $4)
          AND ($5::text IS NULL OR ca.external_account_id = $5)
        ORDER BY r.created_at DESC, r.id DESC
        `,
      [
        scope.sellerAccountExternalId,
        scope.externalConversationId,
        scope.externalCustomerId,
        scope.channel || null,
        scope.channelAccountExternalId || null
      ]
    );
    return result.rows.map(mapReplySuggestion);
  }

  async createOutboundMessage(input: CreateOutboundMessageInput): Promise<StoredOutboundMessage> {
    const result = await this.client.query<OutboundMessageRow>(
      `
      /* create_outbound_message */
        WITH scoped_conversation AS (
          SELECT
            conv.id AS conversation_id,
            c.id AS customer_id,
            conv.channel,
            conv.channel_account_id,
            ca.external_account_id AS channel_account_external_id,
            ca.surface AS channel_surface
          FROM conversation conv
          INNER JOIN seller_account s ON s.id = conv.seller_account_id
          INNER JOIN customer c ON c.id = conv.customer_id
          LEFT JOIN channel_account ca ON ca.id = conv.channel_account_id
          WHERE s.external_account_id = $1
            AND c.external_customer_id = $2
            AND conv.external_conversation_id = $3
            AND ($6::text IS NULL OR conv.channel = $6 OR (conv.channel IS NULL AND $6 = 'alibaba-im'))
            AND (
              $7::text IS NULL
              OR ca.external_account_id = $7
              OR (conv.channel IS NULL AND $6 = 'alibaba-im')
            )
        )
        INSERT INTO outbound_message (seller_account_id, customer_id, conversation_id, channel_account_id, channel, content, created_by)
        SELECT s.id, customer_id, conversation_id, channel_account_id, channel, $4, $5::uuid
        FROM scoped_conversation
        INNER JOIN seller_account s ON s.external_account_id = $1
        RETURNING
          id::text AS "id",
          $1::text AS "sellerAccountExternalId",
          (SELECT channel FROM scoped_conversation) AS "channel",
          (SELECT channel_account_external_id FROM scoped_conversation) AS "channelAccountExternalId",
          (SELECT channel_surface FROM scoped_conversation) AS "channelSurface",
          $2::text AS "externalCustomerId",
        $3::text AS "externalConversationId",
        content AS "content",
        status AS "status",
        created_by::text AS "createdByUserId",
        delivered_by_device_id AS "deliveredByDeviceId",
        external_message_id AS "externalMessageId",
        error_code AS "errorCode",
        error_message AS "errorMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        delivered_at AS "deliveredAt"
      `,
      [
        input.sellerAccountExternalId,
        input.externalCustomerId,
        input.externalConversationId,
        input.content,
        input.createdByUserId || null,
        input.channel || null,
        input.channelAccountExternalId || null
      ]
    );
    return mapOutboundMessage(requiredRow(result.rows[0], "outbound_conversation"));
  }

  async listPendingOutboundMessages(input: ListPendingOutboundMessagesInput): Promise<StoredOutboundMessage[]> {
    const limit = Math.max(1, Math.min(input.limit || 20, 100));
    const result = await this.client.query<OutboundMessageRow>(
      `
      /* list_pending_outbound_messages */
      SELECT
          om.id::text AS "id",
          s.external_account_id AS "sellerAccountExternalId",
          om.channel AS "channel",
          ca.external_account_id AS "channelAccountExternalId",
          ca.surface AS "channelSurface",
          c.external_customer_id AS "externalCustomerId",
        conv.external_conversation_id AS "externalConversationId",
        om.content AS "content",
        om.status AS "status",
        om.created_by::text AS "createdByUserId",
        om.delivered_by_device_id AS "deliveredByDeviceId",
        om.external_message_id AS "externalMessageId",
        om.error_code AS "errorCode",
        om.error_message AS "errorMessage",
        om.created_at AS "createdAt",
        om.updated_at AS "updatedAt",
        om.delivered_at AS "deliveredAt",
        om.claimed_by_device_id AS "claimedByDeviceId",
        om.claim_expires_at AS "claimExpiresAt"
      FROM outbound_message om
        INNER JOIN seller_account s ON s.id = om.seller_account_id
        INNER JOIN customer c ON c.id = om.customer_id
        INNER JOIN conversation conv ON conv.id = om.conversation_id
        LEFT JOIN channel_account ca ON ca.id = om.channel_account_id
        WHERE s.external_account_id = $1
          AND om.status = 'queued'
          AND (om.claim_expires_at IS NULL OR om.claim_expires_at <= now())
          AND ($3::text IS NULL OR om.channel = $3 OR (om.channel IS NULL AND $3 = 'alibaba-im'))
          AND (
            $4::text IS NULL
            OR ca.external_account_id = $4
            OR (om.channel IS NULL AND $3 = 'alibaba-im')
          )
        ORDER BY om.created_at ASC, om.id ASC
        LIMIT $2
        `,
      [
        input.sellerAccountExternalId,
        limit,
        input.channel || null,
        input.channelAccountExternalId || null
      ]
    );
    return result.rows.map(mapOutboundMessage);
  }

  async claimPendingOutboundMessages(input: ClaimPendingOutboundMessagesInput): Promise<StoredOutboundMessage[]> {
    const limit = Math.max(1, Math.min(input.limit || 20, 100));
    const leaseMs = Math.max(30_000, Math.min(input.leaseMs || 120_000, 600_000));
    const result = await this.client.query<OutboundMessageRow>(
      `
      /* claim_pending_outbound_messages */
      WITH candidates AS (
        SELECT om.id
          FROM outbound_message om
          INNER JOIN seller_account s ON s.id = om.seller_account_id
          LEFT JOIN channel_account ca ON ca.id = om.channel_account_id
          WHERE s.external_account_id = $1
            AND om.status = 'queued'
            AND (om.claim_expires_at IS NULL OR om.claim_expires_at <= now())
            AND ($5::text IS NULL OR om.channel = $5 OR (om.channel IS NULL AND $5 = 'alibaba-im'))
            AND (
              $6::text IS NULL
              OR ca.external_account_id = $6
              OR (om.channel IS NULL AND $5 = 'alibaba-im')
            )
          ORDER BY om.created_at ASC, om.id ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      ),
      updated_message AS (
        UPDATE outbound_message om
        SET
          claimed_by_device_id = $3,
          claim_expires_at = now() + ($4::text || ' milliseconds')::interval,
          updated_at = now()
        FROM candidates
        WHERE om.id = candidates.id
        RETURNING om.*
      )
      SELECT
          om.id::text AS "id",
          s.external_account_id AS "sellerAccountExternalId",
          om.channel AS "channel",
          ca.external_account_id AS "channelAccountExternalId",
          ca.surface AS "channelSurface",
          c.external_customer_id AS "externalCustomerId",
        conv.external_conversation_id AS "externalConversationId",
        om.content AS "content",
        om.status AS "status",
        om.created_by::text AS "createdByUserId",
        om.delivered_by_device_id AS "deliveredByDeviceId",
        om.external_message_id AS "externalMessageId",
        om.error_code AS "errorCode",
        om.error_message AS "errorMessage",
        om.created_at AS "createdAt",
        om.updated_at AS "updatedAt",
        om.delivered_at AS "deliveredAt",
        om.claimed_by_device_id AS "claimedByDeviceId",
        om.claim_expires_at AS "claimExpiresAt"
      FROM updated_message om
        INNER JOIN seller_account s ON s.id = om.seller_account_id
        INNER JOIN customer c ON c.id = om.customer_id
        INNER JOIN conversation conv ON conv.id = om.conversation_id
        LEFT JOIN channel_account ca ON ca.id = om.channel_account_id
        `,
      [
        input.sellerAccountExternalId,
        limit,
        input.deviceId,
        leaseMs,
        input.channel || null,
        input.channelAccountExternalId || null
      ]
    );
    return result.rows.map(mapOutboundMessage);
  }

  async listOutboundMessages(input: ListOutboundMessagesInput): Promise<StoredOutboundMessage[]> {
    const result = await this.client.query<OutboundMessageRow>(
      `
      /* list_outbound_messages */
      SELECT
          om.id::text AS "id",
          s.external_account_id AS "sellerAccountExternalId",
          om.channel AS "channel",
          ca.external_account_id AS "channelAccountExternalId",
          ca.surface AS "channelSurface",
          c.external_customer_id AS "externalCustomerId",
        conv.external_conversation_id AS "externalConversationId",
        om.content AS "content",
        om.status AS "status",
        om.created_by::text AS "createdByUserId",
        om.delivered_by_device_id AS "deliveredByDeviceId",
        om.external_message_id AS "externalMessageId",
        om.error_code AS "errorCode",
        om.error_message AS "errorMessage",
        om.created_at AS "createdAt",
        om.updated_at AS "updatedAt",
        om.delivered_at AS "deliveredAt",
        om.claimed_by_device_id AS "claimedByDeviceId",
        om.claim_expires_at AS "claimExpiresAt"
      FROM outbound_message om
        INNER JOIN seller_account s ON s.id = om.seller_account_id
        INNER JOIN customer c ON c.id = om.customer_id
        INNER JOIN conversation conv ON conv.id = om.conversation_id
        LEFT JOIN channel_account ca ON ca.id = om.channel_account_id
        WHERE s.external_account_id = $1
          AND ($2::text IS NULL OR conv.external_conversation_id = $2)
          AND ($3::text IS NULL OR om.channel = $3 OR (om.channel IS NULL AND $3 = 'alibaba-im'))
          AND (
            $4::text IS NULL
            OR ca.external_account_id = $4
            OR (om.channel IS NULL AND $3 = 'alibaba-im')
          )
        ORDER BY om.created_at ASC, om.id ASC
        `,
      [
        input.sellerAccountExternalId,
        input.externalConversationId || null,
        input.channel || null,
        input.channelAccountExternalId || null
      ]
    );
    return result.rows.map(mapOutboundMessage);
  }

  async markOutboundMessageDelivered(input: MarkOutboundMessageDeliveredInput): Promise<StoredOutboundMessage> {
    const result = await this.client.query<OutboundMessageRow>(
      `
      /* mark_outbound_message_delivered */
      WITH updated_message AS (
        UPDATE outbound_message om
        SET
          status = $3,
          external_message_id = COALESCE($4, external_message_id),
          delivered_by_device_id = COALESCE($5, delivered_by_device_id),
          delivered_at = COALESCE($6, now()),
          error_code = $7,
          error_message = $8,
          updated_at = now()
        FROM seller_account s
        WHERE om.seller_account_id = s.id
            AND om.id = $1::uuid
            AND s.external_account_id = $2
            AND ($9::text IS NULL OR om.channel = $9 OR (om.channel IS NULL AND $9 = 'alibaba-im'))
            AND (
              $10::text IS NULL
              OR EXISTS (
                SELECT 1
                FROM channel_account ca_match
                WHERE ca_match.id = om.channel_account_id
                  AND ca_match.external_account_id = $10
              )
              OR (om.channel IS NULL AND $9 = 'alibaba-im')
            )
          RETURNING om.*
        )
        SELECT
          om.id::text AS "id",
          s.external_account_id AS "sellerAccountExternalId",
          om.channel AS "channel",
          ca.external_account_id AS "channelAccountExternalId",
          ca.surface AS "channelSurface",
          c.external_customer_id AS "externalCustomerId",
        conv.external_conversation_id AS "externalConversationId",
        om.content AS "content",
        om.status AS "status",
        om.created_by::text AS "createdByUserId",
        om.delivered_by_device_id AS "deliveredByDeviceId",
        om.external_message_id AS "externalMessageId",
        om.error_code AS "errorCode",
        om.error_message AS "errorMessage",
        om.created_at AS "createdAt",
        om.updated_at AS "updatedAt",
        om.delivered_at AS "deliveredAt",
        om.claimed_by_device_id AS "claimedByDeviceId",
        om.claim_expires_at AS "claimExpiresAt"
      FROM updated_message om
        INNER JOIN seller_account s ON s.id = om.seller_account_id
        INNER JOIN customer c ON c.id = om.customer_id
        INNER JOIN conversation conv ON conv.id = om.conversation_id
        LEFT JOIN channel_account ca ON ca.id = om.channel_account_id
        `,
      [
        input.id,
        input.sellerAccountExternalId,
        input.status,
        input.externalMessageId || null,
        input.deliveredByDeviceId || null,
        input.deliveredAt || null,
        input.errorCode || null,
        input.errorMessage || null,
        input.channel || null,
        input.channelAccountExternalId || null
      ]
    );
    return mapOutboundMessage(requiredRow(result.rows[0], "outbound_message"));
  }

  async createInternalUser(input: CreateInternalUserInput): Promise<InternalUser> {
    const roles = input.roles ?? ["sales"];
    const normalizedEmail = input.email.trim().toLowerCase();
    const result = await this.client.query<InternalUserRow>(
      `
      /* create_internal_user */
      WITH upsert_user AS (
        INSERT INTO app_user (email, display_name, password_hash, status)
        VALUES ($1, $2, $3, $5)
        ON CONFLICT (email)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          password_hash = EXCLUDED.password_hash,
          status = EXCLUDED.status,
          updated_at = now()
        RETURNING id, email, display_name, status, created_at, updated_at
      ),
      removed_roles AS (
        DELETE FROM user_role
        WHERE user_id = (SELECT id FROM upsert_user)
        RETURNING 1
      ),
      roles_removed AS (
        SELECT 1 AS ready FROM (SELECT 1 FROM removed_roles LIMIT 1) removed_any
        UNION ALL
        SELECT 1 AS ready WHERE NOT EXISTS (SELECT 1 FROM removed_roles)
      ),
      requested_roles AS (
        SELECT role_name AS name
        FROM upsert_user
        CROSS JOIN LATERAL unnest($4::text[]) AS role_name
      ),
      upsert_roles AS (
        INSERT INTO role (name)
        SELECT name FROM requested_roles
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id, name
      ),
      linked_roles AS (
        INSERT INTO user_role (user_id, role_id)
        SELECT upsert_user.id, upsert_roles.id
        FROM upsert_user
        CROSS JOIN upsert_roles
        CROSS JOIN roles_removed
        ON CONFLICT DO NOTHING
      )
      SELECT
        id::text AS "id",
        email AS "email",
        display_name AS "displayName",
        status AS "status",
        $4::text[] AS "roles",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM upsert_user
      `,
      [
        normalizedEmail,
        input.displayName,
        input.passwordHash,
        roles,
        input.status || "active"
      ]
    );
    return mapInternalUser(requiredRow(result.rows[0], "internal_user"));
  }

  async listInternalUsers(): Promise<InternalUser[]> {
    const result = await this.client.query<InternalUserRow>(
      `
      /* list_internal_users */
      SELECT
        u.id::text AS "id",
        u.email AS "email",
        u.display_name AS "displayName",
        u.status AS "status",
        COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '{}'::text[]) AS "roles",
        u.created_at AS "createdAt",
        u.updated_at AS "updatedAt"
      FROM app_user u
      LEFT JOIN user_role ur ON ur.user_id = u.id
      LEFT JOIN role r ON r.id = ur.role_id
      GROUP BY u.id
      ORDER BY u.email ASC
      `,
      []
    );
    return result.rows.map(mapInternalUser);
  }

  async getInternalUserCredentials(input: GetInternalUserCredentialsInput): Promise<InternalUserCredentials | null> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const result = await this.client.query<InternalUserCredentialsRow>(
      `
      /* get_internal_user_credentials */
      SELECT
        u.id::text AS "id",
        u.email AS "email",
        u.display_name AS "displayName",
        u.status AS "status",
        COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '{}'::text[]) AS "roles",
        u.created_at AS "createdAt",
        u.updated_at AS "updatedAt",
        u.password_hash AS "passwordHash"
      FROM app_user u
      LEFT JOIN user_role ur ON ur.user_id = u.id
      LEFT JOIN role r ON r.id = ur.role_id
      WHERE u.email = $1
      GROUP BY u.id
      `,
      [normalizedEmail]
    );
    const row = result.rows[0];
    return row ? { ...mapInternalUser(row), passwordHash: row.passwordHash } : null;
  }

  async getInternalUserCredentialsByEmail(
    input: GetInternalUserCredentialsByEmailInput
  ): Promise<InternalUserCredentials[]> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const result = await this.client.query<InternalUserCredentialsRow>(
      `
      /* get_internal_user_credentials_by_email */
      SELECT
        u.id::text AS "id",
        u.email AS "email",
        u.display_name AS "displayName",
        u.status AS "status",
        COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '{}'::text[]) AS "roles",
        u.created_at AS "createdAt",
        u.updated_at AS "updatedAt",
        u.password_hash AS "passwordHash"
      FROM app_user u
      LEFT JOIN user_role ur ON ur.user_id = u.id
      LEFT JOIN role r ON r.id = ur.role_id
      WHERE u.email = $1
        AND u.status = 'active'
      GROUP BY u.id
      ORDER BY u.email ASC
      `,
      [normalizedEmail]
    );
    return result.rows.map((row) => ({ ...mapInternalUser(row), passwordHash: row.passwordHash }));
  }

  async updateInternalUser(input: UpdateInternalUserInput): Promise<InternalUser> {
    const roles = input.roles ?? null;
    const result = await this.client.query<InternalUserRow>(
      `
      /* update_internal_user */
      WITH updated_user AS (
        UPDATE app_user
        SET
          display_name = COALESCE($2, display_name),
          password_hash = COALESCE($3, password_hash),
          status = COALESCE($5, status),
          updated_at = now()
        WHERE id = $1
        RETURNING id, email, display_name, status, created_at, updated_at
      ),
      removed_roles AS (
        DELETE FROM user_role
        WHERE user_id = $1
          AND $4::text[] IS NOT NULL
        RETURNING 1
      ),
      roles_removed AS (
        SELECT 1 AS ready FROM (SELECT 1 FROM removed_roles LIMIT 1) removed_any
        UNION ALL
        SELECT 1 AS ready WHERE NOT EXISTS (SELECT 1 FROM removed_roles)
      ),
      requested_roles AS (
        SELECT role_name AS name
        FROM updated_user
        CROSS JOIN LATERAL unnest(COALESCE($4::text[], '{}'::text[])) AS role_name
      ),
      upsert_roles AS (
        INSERT INTO role (name)
        SELECT name FROM requested_roles
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id, name
      ),
      linked_roles AS (
        INSERT INTO user_role (user_id, role_id)
        SELECT updated_user.id, upsert_roles.id
        FROM updated_user
        CROSS JOIN upsert_roles
        CROSS JOIN roles_removed
        ON CONFLICT DO NOTHING
      )
      SELECT
        u.id::text AS "id",
        u.email AS "email",
        u.display_name AS "displayName",
        u.status AS "status",
        COALESCE($4::text[], array_agg(r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '{}'::text[]) AS "roles",
        u.created_at AS "createdAt",
        u.updated_at AS "updatedAt"
      FROM updated_user u
      LEFT JOIN user_role ur ON ur.user_id = u.id
      LEFT JOIN role r ON r.id = ur.role_id
      GROUP BY u.id, u.email, u.display_name, u.status, u.created_at, u.updated_at
      `,
      [
        input.userId,
        input.displayName || null,
        input.passwordHash || null,
        roles,
        input.status || null
      ]
    );
    return mapInternalUser(requiredRow(result.rows[0], "internal_user"));
  }

  async revokeInternalSession(input: RevokeInternalSessionInput): Promise<boolean> {
    const result = await this.client.query(
      `
      /* revoke_internal_session */
      UPDATE internal_session
      SET revoked_at = now()
      WHERE token_hash = $1
        AND revoked_at IS NULL
      `,
      [hashContent(input.token)]
    );
    return result.rowCount > 0;
  }

  async createUserInvitation(input: CreateUserInvitationInput): Promise<StoredUserInvitation> {
    const token = input.token || crypto.randomBytes(32).toString("hex");
    const normalizedEmail = input.email.trim().toLowerCase();
    const expiresAt = input.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.client.query<UserInvitationRow>(
      `
      /* create_user_invitation */
      INSERT INTO user_invitation (email, display_name, roles, token_hash, created_by, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id::text AS "id",
        email AS "email",
        display_name AS "displayName",
        roles AS "roles",
        created_by::text AS "createdByUserId",
        expires_at AS "expiresAt",
        accepted_at AS "acceptedAt",
        created_at AS "createdAt"
      `,
      [
        normalizedEmail,
        input.displayName,
        input.roles,
        hashContent(token),
        input.createdByUserId || null,
        expiresAt
      ]
    );
    return { ...mapUserInvitation(requiredRow(result.rows[0], "user_invitation")), token };
  }

  async getUserInvitation(token: string): Promise<StoredUserInvitation | null> {
    const result = await this.client.query<UserInvitationRow>(
      `
      /* get_user_invitation */
      SELECT
        id::text AS "id",
        email AS "email",
        display_name AS "displayName",
        roles AS "roles",
        created_by::text AS "createdByUserId",
        expires_at AS "expiresAt",
        accepted_at AS "acceptedAt",
        created_at AS "createdAt"
      FROM user_invitation
      WHERE token_hash = $1
        AND accepted_at IS NULL
        AND expires_at > now()
      `,
      [hashContent(token)]
    );
    const row = result.rows[0];
    return row ? mapUserInvitation(row) : null;
  }

  async acceptUserInvitation(input: AcceptUserInvitationInput): Promise<AcceptUserInvitationResult> {
    const result = await this.client.query<AcceptUserInvitationRow>(
      `
      /* accept_user_invitation */
      WITH source_invitation AS (
        SELECT *
        FROM user_invitation
        WHERE token_hash = $1
      ),
      claimed_invitation AS (
        UPDATE user_invitation
        SET accepted_at = now()
        WHERE token_hash = $1
          AND accepted_at IS NULL
          AND expires_at > now()
        RETURNING id, email, display_name, roles, created_by, expires_at, accepted_at, created_at
      ),
      upsert_user AS (
        INSERT INTO app_user (email, display_name, password_hash, status)
        SELECT email, display_name, $2, 'active'
        FROM claimed_invitation
        ON CONFLICT (email)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          password_hash = EXCLUDED.password_hash,
          status = 'active',
          updated_at = now()
        RETURNING id, email, display_name, status, created_at, updated_at
      ),
      removed_roles AS (
        DELETE FROM user_role
        WHERE user_id = (SELECT id FROM upsert_user)
        RETURNING 1
      ),
      roles_removed AS (
        SELECT 1 AS ready FROM (SELECT 1 FROM removed_roles LIMIT 1) removed_any
        UNION ALL
        SELECT 1 AS ready WHERE NOT EXISTS (SELECT 1 FROM removed_roles)
      ),
      requested_roles AS (
        SELECT unnest((SELECT roles FROM claimed_invitation)) AS name
      ),
      upsert_roles AS (
        INSERT INTO role (name)
        SELECT name FROM requested_roles
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id, name
      ),
      linked_roles AS (
        INSERT INTO user_role (user_id, role_id)
        SELECT upsert_user.id, upsert_roles.id
        FROM upsert_user
        CROSS JOIN upsert_roles
        CROSS JOIN roles_removed
        ON CONFLICT DO NOTHING
      )
      SELECT
        CASE
          WHEN i.id IS NOT NULL THEN NULL
          WHEN source.id IS NULL THEN 'invitation_not_found'
          WHEN source.accepted_at IS NOT NULL THEN 'invitation_already_accepted'
          WHEN source.expires_at <= now() THEN 'invitation_expired'
          ELSE 'invitation_already_accepted'
        END AS "errorCode",
        i.id::text AS "id",
        i.email AS "email",
        i.display_name AS "displayName",
        i.roles AS "roles",
        i.created_by::text AS "createdByUserId",
        i.expires_at AS "expiresAt",
        i.accepted_at AS "acceptedAt",
        i.created_at AS "createdAt",
        u.id::text AS "userId",
        u.email AS "userEmail",
        u.display_name AS "userDisplayName",
        u.status AS "userStatus",
        i.roles AS "userRoles",
        u.created_at AS "userCreatedAt",
        u.updated_at AS "userUpdatedAt"
      FROM (SELECT 1) marker
      LEFT JOIN source_invitation source ON true
      LEFT JOIN claimed_invitation i ON true
      LEFT JOIN upsert_user u ON true
      `,
      [hashContent(input.token), input.passwordHash]
    );
    const row = requiredRow(result.rows[0], "user_invitation");
    if (row.errorCode) throw new Error(row.errorCode);
    return {
      invitation: mapUserInvitation(row),
      user: mapInternalUser({
        id: row.userId,
        email: row.userEmail,
        displayName: row.userDisplayName,
        status: row.userStatus,
        roles: row.userRoles,
        createdAt: row.userCreatedAt,
        updatedAt: row.userUpdatedAt
      })
    };
  }

  async issueInternalSession(input: IssueInternalSessionInput): Promise<InternalSession> {
    const token = input.token || crypto.randomBytes(32).toString("hex");
    const normalizedEmail = input.email.trim().toLowerCase();
    const expiresAt = input.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.client.query<InternalSessionRow>(
      `
      /* issue_internal_session */
      WITH matched_user AS (
        SELECT
          u.id,
          u.email,
          u.display_name,
          COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '{}'::text[]) AS roles
        FROM app_user u
        LEFT JOIN user_role ur ON ur.user_id = u.id
        LEFT JOIN role r ON r.id = ur.role_id
        WHERE u.email = $1
          AND u.password_hash = $2
          AND u.status = 'active'
        GROUP BY u.id
      ),
      inserted_session AS (
        INSERT INTO internal_session (user_id, token_hash, expires_at)
        SELECT id, $3, $4
        FROM matched_user
        RETURNING token_hash, created_at, expires_at
      )
      SELECT
        s.token_hash AS "tokenHash",
        u.id::text AS "userId",
        u.email AS "email",
        u.display_name AS "displayName",
        u.roles AS "roles",
        s.created_at AS "createdAt",
        s.expires_at AS "expiresAt"
      FROM matched_user u
      INNER JOIN inserted_session s ON true
      `,
      [
        normalizedEmail,
        input.passwordHash,
        hashContent(token),
        expiresAt
      ]
    );
    return mapInternalSession(requiredRow(result.rows[0], "internal_session"), token);
  }

  async getInternalSession(token: string): Promise<InternalSession | null> {
    const result = await this.client.query<InternalSessionRow>(
      `
      /* get_internal_session */
      SELECT
        s.token_hash AS "tokenHash",
        u.id::text AS "userId",
        u.email AS "email",
        u.display_name AS "displayName",
        COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '{}'::text[]) AS "roles",
        s.created_at AS "createdAt",
        s.expires_at AS "expiresAt"
      FROM internal_session s
      INNER JOIN app_user u ON u.id = s.user_id
      LEFT JOIN user_role ur ON ur.user_id = u.id
      LEFT JOIN role r ON r.id = ur.role_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.status = 'active'
      GROUP BY s.token_hash, s.created_at, s.expires_at, u.id
      `,
      [hashContent(token)]
    );
    const row = result.rows[0];
    return row ? mapInternalSession(row, token) : null;
  }


  async provisionManagedTradeMindActivation(
    input: ProvisionManagedTradeMindActivationInput
  ): Promise<ProvisionedManagedTradeMindActivation> {
    const activationToken = input.activationToken || crypto.randomBytes(32).toString("hex");
    const tokenHash = hashContent(activationToken);
    const identityKey = managedTradeMindIdentityKey(input);
    const result = await this.client.query<ManagedTradeMindActivationRow>(
      `
      /* provision_managed_trademind_activation */
      INSERT INTO managed_trademind_activation (
        identity_key,
        provider,
        workspace_id,
        user_id,
        user_email,
        user_display_name,
        channel,
        binding_token,
        activation_token_hash,
        expires_at,
        consumed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, now() + interval '15 minutes'), NULL)
      ON CONFLICT (provider, workspace_id, user_id, channel)
      DO UPDATE SET
        identity_key = EXCLUDED.identity_key,
        user_email = EXCLUDED.user_email,
        user_display_name = EXCLUDED.user_display_name,
        binding_token = EXCLUDED.binding_token,
        activation_token_hash = EXCLUDED.activation_token_hash,
        expires_at = EXCLUDED.expires_at,
        consumed_at = NULL,
        updated_at = now()
      RETURNING
        identity_key AS "identityKey",
        provider,
        workspace_id AS "workspaceId",
        user_id AS "userId",
        user_email AS "userEmail",
        user_display_name AS "userDisplayName",
        channel,
        binding_token AS "bindingToken",
        activation_token_hash AS "activationTokenHash",
        expires_at AS "expiresAt",
        consumed_at AS "consumedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      `,
      [
        identityKey,
        input.provider,
        input.workspaceId,
        input.userId,
        input.userEmail.trim().toLowerCase(),
        input.userDisplayName || null,
        input.channel,
        input.bindingToken,
        tokenHash,
        input.expiresAt || null
      ]
    );
    return {
      ...mapManagedTradeMindActivation(requiredRow(result.rows[0], "managed_trademind_activation")),
      activationToken
    };
  }

  async consumeManagedTradeMindActivation(
    input: ConsumeManagedTradeMindActivationInput
  ): Promise<ConsumedManagedTradeMindActivation | null> {
    const consumedAt = input.consumedAt || new Date().toISOString();
    const result = await this.client.query<ManagedTradeMindActivationRow>(
      `
      /* consume_managed_trademind_activation */
      UPDATE managed_trademind_activation
      SET consumed_at = $2::timestamptz,
        updated_at = $2::timestamptz
      WHERE activation_token_hash = $1
        AND consumed_at IS NULL
        AND expires_at > $2::timestamptz
      RETURNING
        identity_key AS "identityKey",
        provider,
        workspace_id AS "workspaceId",
        user_id AS "userId",
        user_email AS "userEmail",
        user_display_name AS "userDisplayName",
        channel,
        binding_token AS "bindingToken",
        activation_token_hash AS "activationTokenHash",
        expires_at AS "expiresAt",
        consumed_at AS "consumedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      `,
      [hashContent(input.activationToken), consumedAt]
    );
    const row = result.rows[0];
    if (!row) return null;
    const activation = mapManagedTradeMindActivation(row);
    return {
      bindingToken: activation.bindingToken,
      consumedAt: activation.consumedAt || consumedAt,
      expiresAt: activation.expiresAt,
      identity: managedTradeMindIdentityFromActivation(activation)
    };
  }

  async listManagedTradeMindActivations(): Promise<ProvisionedManagedTradeMindActivation[]> {
    const result = await this.client.query<ManagedTradeMindActivationRow>(
      `
      /* list_managed_trademind_activations */
      SELECT
        identity_key AS "identityKey",
        provider,
        workspace_id AS "workspaceId",
        user_id AS "userId",
        user_email AS "userEmail",
        user_display_name AS "userDisplayName",
        channel,
        binding_token AS "bindingToken",
        activation_token_hash AS "activationTokenHash",
        expires_at AS "expiresAt",
        consumed_at AS "consumedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM managed_trademind_activation
      ORDER BY updated_at DESC
      `
    );
    return result.rows.map(mapManagedTradeMindActivation);
  }

  async recordCollectorHeartbeat(input: RecordCollectorHeartbeatInput): Promise<CollectorDevice> {
    const result = await this.client.query<CollectorDeviceRow>(
      `
      /* record_collector_heartbeat */
      WITH updated_device AS (
        UPDATE collector_device
        SET last_heartbeat_at = COALESCE($2::timestamptz, now()),
          last_sync_at = COALESCE($3::timestamptz, collector_device.last_sync_at),
          last_error = $4,
          updated_at = COALESCE($2::timestamptz, now())
        WHERE id = $1::uuid
        RETURNING
          id,
          seller_account_id,
          external_device_id,
          device_name,
          trade_mind_binding_token,
          activated_by_user_id,
          activated_by_user_email,
          activated_by_user_display_name,
          activated_by_user_roles,
          status,
          last_heartbeat_at,
          last_sync_at,
          last_error,
          created_at,
          updated_at
      )
      SELECT
        d.id::text AS "id",
        d.external_device_id AS "externalDeviceId",
        s.external_account_id AS "sellerAccountExternalId",
        d.trade_mind_binding_token AS "tradeMindBindingToken",
        d.device_name AS "deviceName",
        d.activated_by_user_id AS "activatedByUserId",
        d.activated_by_user_email AS "activatedByUserEmail",
        d.activated_by_user_display_name AS "activatedByUserDisplayName",
        d.activated_by_user_roles AS "activatedByUserRoles",
        d.status AS "status",
        d.last_heartbeat_at AS "lastHeartbeatAt",
        d.last_sync_at AS "lastSyncAt",
        d.last_error AS "lastError",
        d.created_at AS "createdAt",
        d.updated_at AS "updatedAt"
      FROM updated_device d
      LEFT JOIN seller_account s ON s.id = d.seller_account_id
      `,
      [input.deviceId, input.heartbeatAt || null, input.lastSyncAt || null, input.lastError ?? null]
    );
    return mapCollectorDevice(requiredRow(result.rows[0], "collector_device"));
  }

  async registerCollectorDevice(input: RegisterCollectorDeviceInput): Promise<RegisteredCollectorDevice> {
    const token = input.token || crypto.randomBytes(32).toString("hex");
    const tokenHash = hashContent(token);
    const result = await this.client.query<CollectorDeviceRow>(
      `
      /* register_collector_device */
      WITH seller AS (
        INSERT INTO seller_account (external_account_id)
        SELECT $1::text
        WHERE $1::text IS NOT NULL
        ON CONFLICT (external_account_id)
        DO UPDATE SET updated_at = now()
        RETURNING id, external_account_id
      ),
      upsert_device AS (
        INSERT INTO collector_device (
          seller_account_id,
          external_device_id,
          device_name,
          trade_mind_binding_token,
          device_token_hash,
          status,
          activated_by_user_id,
          activated_by_user_email,
          activated_by_user_display_name,
          activated_by_user_roles
        )
        VALUES ((SELECT id FROM seller), $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::text[], '{}'::text[]))
        ON CONFLICT (external_device_id)
        DO UPDATE SET
          seller_account_id = EXCLUDED.seller_account_id,
          device_name = COALESCE(EXCLUDED.device_name, collector_device.device_name),
          trade_mind_binding_token = COALESCE(
            EXCLUDED.trade_mind_binding_token,
            collector_device.trade_mind_binding_token
          ),
          device_token_hash = EXCLUDED.device_token_hash,
          status = EXCLUDED.status,
          activated_by_user_id = COALESCE(EXCLUDED.activated_by_user_id, collector_device.activated_by_user_id),
          activated_by_user_email = COALESCE(EXCLUDED.activated_by_user_email, collector_device.activated_by_user_email),
          activated_by_user_display_name = COALESCE(
            EXCLUDED.activated_by_user_display_name,
            collector_device.activated_by_user_display_name
          ),
          activated_by_user_roles = CASE
            WHEN EXCLUDED.activated_by_user_email IS NOT NULL THEN EXCLUDED.activated_by_user_roles
            ELSE collector_device.activated_by_user_roles
          END,
          updated_at = now()
        RETURNING
          id,
          seller_account_id,
          external_device_id,
          device_name,
          trade_mind_binding_token,
          device_token_hash,
          activated_by_user_id,
          activated_by_user_email,
          activated_by_user_display_name,
          activated_by_user_roles,
          status,
          last_heartbeat_at,
          last_sync_at,
          last_error,
          created_at,
          updated_at
      )
      SELECT
        d.id::text AS "id",
        d.external_device_id AS "externalDeviceId",
        COALESCE(s.external_account_id, $1) AS "sellerAccountExternalId",
        d.trade_mind_binding_token AS "tradeMindBindingToken",
        d.device_name AS "deviceName",
        d.activated_by_user_id AS "activatedByUserId",
        d.activated_by_user_email AS "activatedByUserEmail",
        d.activated_by_user_display_name AS "activatedByUserDisplayName",
        d.activated_by_user_roles AS "activatedByUserRoles",
        d.status AS "status",
        d.device_token_hash AS "tokenHash",
        d.last_heartbeat_at AS "lastHeartbeatAt",
        d.last_sync_at AS "lastSyncAt",
        d.last_error AS "lastError",
        d.created_at AS "createdAt",
        d.updated_at AS "updatedAt"
      FROM upsert_device d
      LEFT JOIN seller s ON s.id = d.seller_account_id
      `,
      [
        input.sellerAccountExternalId || null,
        input.externalDeviceId || null,
        input.deviceName || null,
        input.tradeMindBindingToken || null,
        tokenHash,
        input.status || "active",
        input.activatedByUserId || null,
        input.activatedByUserEmail || null,
        input.activatedByUserDisplayName || null,
        input.activatedByUserRoles || null
      ]
    );
    return {
      ...mapCollectorDevice(requiredRow(result.rows[0], "collector_device")),
      token,
      tokenHash: requiredRow(result.rows[0], "collector_device").tokenHash || tokenHash
    };
  }

  async listCollectorDevices(): Promise<CollectorDevice[]> {
    const result = await this.client.query<CollectorDeviceRow>(
      `
      /* list_collector_devices */
      SELECT
        d.id::text AS "id",
        d.external_device_id AS "externalDeviceId",
        s.external_account_id AS "sellerAccountExternalId",
        d.trade_mind_binding_token AS "tradeMindBindingToken",
        d.device_name AS "deviceName",
        d.activated_by_user_id AS "activatedByUserId",
        d.activated_by_user_email AS "activatedByUserEmail",
        d.activated_by_user_display_name AS "activatedByUserDisplayName",
        d.activated_by_user_roles AS "activatedByUserRoles",
        d.status AS "status",
        d.last_heartbeat_at AS "lastHeartbeatAt",
        d.last_sync_at AS "lastSyncAt",
        d.last_error AS "lastError",
        d.created_at AS "createdAt",
        d.updated_at AS "updatedAt"
      FROM collector_device d
      LEFT JOIN seller_account s ON s.id = d.seller_account_id
      ORDER BY d.created_at DESC
      `,
      []
    );
    return result.rows.map(mapCollectorDevice);
  }

  async revokeCollectorDevice(input: RevokeCollectorDeviceInput): Promise<CollectorDevice> {
    const result = await this.client.query<CollectorDeviceRow>(
      `
      /* revoke_collector_device */
      WITH revoked_device AS (
        UPDATE collector_device
        SET status = 'revoked',
          updated_at = now()
        WHERE id = $1
        RETURNING
          id,
          seller_account_id,
          external_device_id,
          device_name,
          trade_mind_binding_token,
          activated_by_user_id,
          activated_by_user_email,
          activated_by_user_display_name,
          activated_by_user_roles,
          status,
          last_heartbeat_at,
          last_sync_at,
          last_error,
          created_at,
          updated_at
      )
      SELECT
        d.id::text AS "id",
        d.external_device_id AS "externalDeviceId",
        s.external_account_id AS "sellerAccountExternalId",
        d.trade_mind_binding_token AS "tradeMindBindingToken",
        d.device_name AS "deviceName",
        d.activated_by_user_id AS "activatedByUserId",
        d.activated_by_user_email AS "activatedByUserEmail",
        d.activated_by_user_display_name AS "activatedByUserDisplayName",
        d.activated_by_user_roles AS "activatedByUserRoles",
        d.status AS "status",
        d.last_heartbeat_at AS "lastHeartbeatAt",
        d.last_sync_at AS "lastSyncAt",
        d.last_error AS "lastError",
        d.created_at AS "createdAt",
        d.updated_at AS "updatedAt"
      FROM revoked_device d
      LEFT JOIN seller_account s ON s.id = d.seller_account_id
      `,
      [input.deviceId]
    );
    return mapCollectorDevice(requiredRow(result.rows[0], "collector_device"));
  }

  async authenticateCollectorDevice(token: string): Promise<CollectorDevice | null> {
    const result = await this.client.query<CollectorDeviceRow>(
      `
      /* authenticate_collector_device */
      WITH authenticated_device AS (
        UPDATE collector_device
        SET last_heartbeat_at = now(),
          updated_at = now()
        WHERE device_token_hash = $1
          AND status = 'active'
        RETURNING
          id,
          seller_account_id,
          external_device_id,
          device_name,
          trade_mind_binding_token,
          activated_by_user_id,
          activated_by_user_email,
          activated_by_user_display_name,
          activated_by_user_roles,
          status,
          last_heartbeat_at,
          last_sync_at,
          last_error,
          created_at,
          updated_at
      )
      SELECT
        d.id::text AS "id",
        d.external_device_id AS "externalDeviceId",
        s.external_account_id AS "sellerAccountExternalId",
        d.trade_mind_binding_token AS "tradeMindBindingToken",
        d.device_name AS "deviceName",
        d.activated_by_user_id AS "activatedByUserId",
        d.activated_by_user_email AS "activatedByUserEmail",
        d.activated_by_user_display_name AS "activatedByUserDisplayName",
        d.activated_by_user_roles AS "activatedByUserRoles",
        d.status AS "status",
        d.last_heartbeat_at AS "lastHeartbeatAt",
        d.last_sync_at AS "lastSyncAt",
        d.last_error AS "lastError",
        d.created_at AS "createdAt",
        d.updated_at AS "updatedAt"
      FROM authenticated_device d
      LEFT JOIN seller_account s ON s.id = d.seller_account_id
      `,
      [hashContent(token)]
    );
    const row = result.rows[0];
    return row ? mapCollectorDevice(row) : null;
  }

  private async upsertSellerAccount(batch: SyncBatch): Promise<string> {
    const result = await this.client.query<IdRow>(
      `
      /* upsert_seller_account */
      INSERT INTO seller_account (external_account_id, display_name, last_seen_at, status)
      VALUES ($1, $2, $3, COALESCE($4, 'active'))
      ON CONFLICT (external_account_id)
      DO UPDATE SET
        display_name = COALESCE(EXCLUDED.display_name, seller_account.display_name),
        last_seen_at = COALESCE(EXCLUDED.last_seen_at, seller_account.last_seen_at),
        status = EXCLUDED.status,
        updated_at = now()
      RETURNING id
      `,
      [
        batch.sellerAccount.externalAccountId,
        batch.sellerAccount.displayName || null,
        sourceTime(batch),
        batch.sellerAccount.status || null
      ]
    );
    return requiredId(result.rows[0], "seller_account");
  }

  private async upsertCollectorDevice(batch: SyncBatch, sellerAccountId: string): Promise<string> {
    const result = await this.client.query<IdRow>(
      `
      /* upsert_collector_device */
      INSERT INTO collector_device (seller_account_id, external_device_id, device_name, last_heartbeat_at, status)
      VALUES ($1, $2, $3, $4, 'active')
      ON CONFLICT (external_device_id)
      DO UPDATE SET
        seller_account_id = EXCLUDED.seller_account_id,
        device_name = COALESCE(EXCLUDED.device_name, collector_device.device_name),
        last_heartbeat_at = EXCLUDED.last_heartbeat_at,
        updated_at = now()
      RETURNING id
      `,
      [
        sellerAccountId,
        batch.device.deviceId,
        batch.device.deviceName || null,
        sourceTime(batch)
      ]
    );
    return requiredId(result.rows[0], "collector_device");
  }

  private async upsertChannelAccount(
    batch: SyncBatch,
    sellerAccountId: string,
    scope: SyncChannelScope
  ): Promise<string> {
    const result = await this.client.query<IdRow>(
      `
      /* upsert_channel_account */
      INSERT INTO channel_account (
        seller_account_id,
        channel,
        external_account_id,
        display_name,
        surface,
        last_seen_at,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'active')
      ON CONFLICT (seller_account_id, channel, external_account_id)
      DO UPDATE SET
        display_name = COALESCE(EXCLUDED.display_name, channel_account.display_name),
        surface = COALESCE(EXCLUDED.surface, channel_account.surface),
        last_seen_at = COALESCE(EXCLUDED.last_seen_at, channel_account.last_seen_at),
        status = EXCLUDED.status,
        updated_at = now()
      RETURNING id
      `,
      [
        sellerAccountId,
        scope.channel,
        scope.channelAccountExternalId,
        batch.channelAccount?.displayName || null,
        scope.surface || null,
        sourceTime(batch)
      ]
    );
    return requiredId(result.rows[0], "channel_account");
  }

  private async upsertCustomer(
    batch: SyncBatch,
    sellerAccountId: string,
    channelAccountId: string,
    scope: SyncChannelScope,
    externalCustomerId: string
  ): Promise<string> {
    const customer = (batch.customers || []).find((item) => item.externalCustomerId === externalCustomerId);
    const result = await this.client.query<IdRow>(
      `
      /* upsert_customer */
      INSERT INTO customer (
        seller_account_id,
        channel_account_id,
        channel,
        external_customer_id,
        login_id,
        login_id_encrypt,
        display_name,
        company_name,
        avatar_url,
        country,
        current_time_zone,
        account_id,
        account_id_encrypt,
        ali_id,
        ali_id_encrypt,
        stage
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (seller_account_id, channel, channel_account_id, external_customer_id)
      DO UPDATE SET
        login_id = COALESCE(EXCLUDED.login_id, customer.login_id),
        login_id_encrypt = COALESCE(EXCLUDED.login_id_encrypt, customer.login_id_encrypt),
        display_name = COALESCE(EXCLUDED.display_name, customer.display_name),
        company_name = COALESCE(EXCLUDED.company_name, customer.company_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, customer.avatar_url),
        country = COALESCE(EXCLUDED.country, customer.country),
        current_time_zone = COALESCE(EXCLUDED.current_time_zone, customer.current_time_zone),
        account_id = COALESCE(EXCLUDED.account_id, customer.account_id),
        account_id_encrypt = COALESCE(EXCLUDED.account_id_encrypt, customer.account_id_encrypt),
        ali_id = COALESCE(EXCLUDED.ali_id, customer.ali_id),
        ali_id_encrypt = COALESCE(EXCLUDED.ali_id_encrypt, customer.ali_id_encrypt),
        stage = COALESCE(EXCLUDED.stage, customer.stage),
        updated_at = now()
      RETURNING id
      `,
      [
        sellerAccountId,
        channelAccountId,
        scope.channel,
        externalCustomerId,
        customer?.loginId || null,
        customer?.loginIdEncrypt || null,
        customer?.displayName || null,
        customer?.companyName || null,
        customer?.avatarUrl || null,
        customer?.country || null,
        customer?.currentTimeZone || null,
        customer?.accountId || null,
        customer?.accountIdEncrypt || null,
        customer?.aliId || null,
        customer?.aliIdEncrypt || null,
        customer?.stage || null
      ]
    );
    return requiredId(result.rows[0], "customer");
  }

  private async upsertConversation(
    batch: SyncBatch,
    sellerAccountId: string,
    channelAccountId: string,
    scope: SyncChannelScope,
    externalConversationId: string,
    customerId: string | null
  ): Promise<string> {
    const conversation = (batch.conversations || []).find((item) => item.externalConversationId === externalConversationId);
    const result = await this.client.query<IdRow>(
      `
      /* upsert_conversation */
      INSERT INTO conversation (
        seller_account_id,
        channel_account_id,
        channel,
        customer_id,
        external_conversation_id,
        last_message_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (seller_account_id, channel, channel_account_id, external_conversation_id)
      DO UPDATE SET
        customer_id = COALESCE(EXCLUDED.customer_id, conversation.customer_id),
        last_message_at = COALESCE(EXCLUDED.last_message_at, conversation.last_message_at),
        updated_at = now()
      RETURNING id
      `,
      [
        sellerAccountId,
        channelAccountId,
        scope.channel,
        customerId,
        externalConversationId,
        conversation?.lastMessageAt || null
      ]
    );
    return requiredId(result.rows[0], "conversation");
  }

  private async insertSyncBatch(
    batch: SyncBatch,
    sellerAccountId: string,
    deviceId: string,
    channelAccountId: string,
    scope: SyncChannelScope
  ): Promise<void> {
    await this.client.query(
      `
      /* insert_sync_batch */
      INSERT INTO sync_batch (
        seller_account_id,
        collector_device_id,
        channel_account_id,
        channel,
        source_batch_key,
        cursor,
        source_meta
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (seller_account_id, channel, channel_account_id, source_batch_key) DO NOTHING
      `,
      [
        sellerAccountId,
        deviceId,
        channelAccountId,
        scope.channel,
        sourceBatchKey(batch),
        batch.cursor || null,
        batch.sourceMeta || null
      ]
    );
  }

  private async updateSyncBatchResult(
    batch: SyncBatch,
    sellerAccountId: string,
    channelAccountId: string,
    scope: SyncChannelScope,
    result: SyncBatchResult
  ): Promise<void> {
    await this.client.query(
      `
      /* update_sync_batch_result */
      UPDATE sync_batch
      SET
        accepted_count = $1,
        rejected_count = $2,
        warnings = $3
      WHERE seller_account_id = $4
        AND channel_account_id = $5
        AND channel = $6
        AND source_batch_key = $7
      `,
      [
        result.acceptedCount,
        result.rejectedCount,
        result.warnings,
        sellerAccountId,
        channelAccountId,
        scope.channel,
        sourceBatchKey(batch)
      ]
    );
  }

  private async insertMessage(
    batch: SyncBatch,
    sellerAccountId: string,
    channelAccountId: string,
    scope: SyncChannelScope,
    conversationId: string,
    message: SyncMessageInput
  ): Promise<number> {
    const contentHash = hashContent(message.content || "");
    const result = await this.client.query<IdRow>(
      `
      /* insert_message */
      INSERT INTO message (
        seller_account_id,
        channel_account_id,
        channel,
        conversation_id,
        external_message_id,
        direction,
        message_type,
        content,
        sent_at,
        content_hash,
        raw_sanitized
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT DO NOTHING
      RETURNING id
      `,
      [
        sellerAccountId,
        channelAccountId,
        scope.channel,
        conversationId,
        message.externalMessageId || null,
        message.direction,
        message.messageType == null ? null : String(message.messageType),
        message.content || null,
        message.sentAt || null,
        contentHash,
        message.rawSanitized || null
      ]
    );
    return result.rowCount;
  }
}

function requiredId(row: IdRow | undefined, source: string): string {
  if (!row?.id) throw new Error(`${source}_upsert_failed`);
  return row.id;
}

function requiredRow<T>(row: T | undefined, source: string): T {
  if (!row) throw new Error(`${source}_not_found`);
  return row;
}

function hashContent(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sourceTime(batch: SyncBatch): string | null {
  const collectedAt = batch.sourceMeta?.collectedAt;
  return typeof collectedAt === "string" ? collectedAt : null;
}

interface SyncChannelScope {
  channel: string;
  channelAccountExternalId: string;
  surface?: string;
}

function syncChannelScope(batch: SyncBatch): SyncChannelScope {
  const channel = batch.channelAccount?.channel || batch.channel || "alibaba-im";
  return {
    channel,
    channelAccountExternalId: batch.channelAccount?.externalAccountId || batch.sellerAccount.externalAccountId,
    surface: batch.channelAccount?.surface || (typeof batch.sourceMeta?.surface === "string" ? batch.sourceMeta.surface : undefined)
  };
}

function sourceBatchKey(batch: SyncBatch): string {
  const explicit = batch.sourceMeta?.sourceBatchKey;
  if (typeof explicit === "string" && explicit) return explicit;
  return hashContent(
    JSON.stringify({
      seller: batch.sellerAccount.externalAccountId,
      channel: syncChannelScope(batch),
      device: batch.device.deviceId,
      cursor: batch.cursor || null,
      messageCount: batch.messages?.length || 0
    })
  );
}

function maxIso(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

function isoString(value: string | Date | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function optionalProps<T extends Record<string, unknown>>(
  source: T
): { [Key in keyof T]?: Exclude<T[Key], null | undefined> } {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== null && value !== undefined)) as {
    [Key in keyof T]?: Exclude<T[Key], null | undefined>;
  };
}

function customerScopeParams(scope: CustomerScope): [string, string, string | null, string | null] {
  return [
    scope.sellerAccountExternalId,
    scope.externalCustomerId,
    scope.channel || null,
    scope.channelAccountExternalId || null
  ];
}

function mapCustomerNote(row: CustomerNoteRow): StoredCustomerNote {
  return {
    id: row.id,
    sellerAccountExternalId: row.sellerAccountExternalId,
    externalCustomerId: row.externalCustomerId,
    body: row.body,
    createdAt: isoString(row.createdAt) || "",
    updatedAt: isoString(row.updatedAt) || "",
    ...optionalProps({
      channel: row.channel,
      channelAccountExternalId: row.channelAccountExternalId,
      channelSurface: row.channelSurface,
      createdByUserId: row.createdByUserId
    })
  };
}

function mapCustomerTag(row: CustomerTagRow): StoredCustomerTag {
  return {
    id: row.id,
    sellerAccountExternalId: row.sellerAccountExternalId,
    externalCustomerId: row.externalCustomerId,
    tag: row.tag,
    createdAt: isoString(row.createdAt) || "",
    ...optionalProps({
      channel: row.channel,
      channelAccountExternalId: row.channelAccountExternalId,
      channelSurface: row.channelSurface,
      createdByUserId: row.createdByUserId
    })
  };
}

function mapFollowUpTask(row: FollowUpTaskRow): StoredFollowUpTask {
  return {
    id: row.id,
    sellerAccountExternalId: row.sellerAccountExternalId,
    externalCustomerId: row.externalCustomerId,
    title: row.title,
    status: row.status,
    createdAt: isoString(row.createdAt) || "",
    updatedAt: isoString(row.updatedAt) || "",
    ...optionalProps({
      channel: row.channel,
      channelAccountExternalId: row.channelAccountExternalId,
      channelSurface: row.channelSurface,
      assignedToUserId: row.assignedToUserId,
      dueAt: isoString(row.dueAt)
    })
  };
}

function mapCustomerAssignment(row: CustomerAssignmentRow): StoredCustomerAssignment {
  return {
    id: row.id,
    sellerAccountExternalId: row.sellerAccountExternalId,
    externalCustomerId: row.externalCustomerId,
    assignedToUserId: row.assignedToUserId,
    assignedAt: isoString(row.assignedAt) || "",
    updatedAt: isoString(row.updatedAt) || "",
    ...optionalProps({
      channel: row.channel,
      channelAccountExternalId: row.channelAccountExternalId,
      channelSurface: row.channelSurface,
      assignedByUserId: row.assignedByUserId
    })
  };
}

function mapAuditLog(row: AuditLogRow): StoredAuditLog {
  return {
    id: row.id,
    action: row.action,
    targetType: row.targetType,
    createdAt: isoString(row.createdAt) || "",
    ...optionalProps({
      actorUserId: row.actorUserId,
      targetId: row.targetId,
      metadata: row.metadata
    })
  };
}

function mapAiSummary(row: AiSummaryRow): StoredAiSummary {
  return {
    id: row.id,
    sellerAccountExternalId: row.sellerAccountExternalId,
    externalCustomerId: row.externalCustomerId,
    promptVersion: row.promptVersion,
    summary: row.summary,
    createdAt: isoString(row.createdAt) || "",
    ...optionalProps({
      channel: row.channel,
      channelAccountExternalId: row.channelAccountExternalId,
      channelSurface: row.channelSurface,
      intentLevel: row.intentLevel,
      nextAction: row.nextAction,
      sourceMessageStartAt: isoString(row.sourceMessageStartAt),
      sourceMessageEndAt: isoString(row.sourceMessageEndAt)
    })
  };
}

function mapReplySuggestion(row: ReplySuggestionRow): StoredReplySuggestion {
  return {
    id: row.id,
    sellerAccountExternalId: row.sellerAccountExternalId,
    externalCustomerId: row.externalCustomerId,
    externalConversationId: row.externalConversationId,
    promptVersion: row.promptVersion,
    suggestion: row.suggestion,
    status: row.status,
    createdAt: isoString(row.createdAt) || "",
    updatedAt: isoString(row.updatedAt) || "",
    ...optionalProps({
      channel: row.channel,
      channelAccountExternalId: row.channelAccountExternalId,
      channelSurface: row.channelSurface,
      createdByUserId: row.createdByUserId
    })
  };
}

function mapOutboundMessage(row: OutboundMessageRow): StoredOutboundMessage {
  return {
    id: row.id,
    sellerAccountExternalId: row.sellerAccountExternalId,
    externalCustomerId: row.externalCustomerId,
    externalConversationId: row.externalConversationId,
    content: row.content,
    status: row.status,
    createdAt: isoString(row.createdAt) || "",
    updatedAt: isoString(row.updatedAt) || "",
    ...optionalProps({
      channel: row.channel,
      channelAccountExternalId: row.channelAccountExternalId,
      channelSurface: row.channelSurface,
      createdByUserId: row.createdByUserId,
      deliveredByDeviceId: row.deliveredByDeviceId,
      externalMessageId: row.externalMessageId,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      deliveredAt: isoString(row.deliveredAt),
      claimedByDeviceId: row.claimedByDeviceId,
      claimExpiresAt: isoString(row.claimExpiresAt ?? null)
    })
  };
}

function mapManagedTradeMindActivation(row: ManagedTradeMindActivationRow): ProvisionedManagedTradeMindActivation {
  return {
    identityKey: row.identityKey,
    provider: row.provider,
    workspaceId: row.workspaceId,
    userId: row.userId,
    userEmail: row.userEmail,
    userDisplayName: row.userDisplayName ?? undefined,
    channel: row.channel,
    bindingToken: row.bindingToken,
    activationToken: "",
    activationTokenHash: row.activationTokenHash,
    expiresAt: isoString(row.expiresAt) || "",
    consumedAt: isoString(row.consumedAt),
    createdAt: isoString(row.createdAt) || "",
    updatedAt: isoString(row.updatedAt) || ""
  };
}

function managedTradeMindIdentityKey(input: {
  provider: string;
  workspaceId: string;
  userId: string;
  channel: string;
}): string {
  return [input.provider, input.workspaceId, input.userId, input.channel].map((value) => value.trim()).join(":");
}

function managedTradeMindIdentityFromActivation(
  activation: ProvisionedManagedTradeMindActivation
): ManagedTradeMindIdentity {
  return {
    identityKey: activation.identityKey,
    provider: activation.provider,
    workspaceId: activation.workspaceId,
    userId: activation.userId,
    userEmail: activation.userEmail,
    userDisplayName: activation.userDisplayName,
    channel: activation.channel,
    createdAt: activation.createdAt,
    updatedAt: activation.updatedAt
  };
}

function mapCollectorDevice(row: CollectorDeviceRow): CollectorDevice {
  const activatedByUserRoles = normalizeRoles(row.activatedByUserRoles ?? []);
  return {
    id: row.id,
    externalDeviceId: row.externalDeviceId ?? undefined,
    sellerAccountExternalId: row.sellerAccountExternalId ?? undefined,
    deviceName: row.deviceName ?? undefined,
    status: row.status,
    lastHeartbeatAt: isoString(row.lastHeartbeatAt),
    lastSyncAt: isoString(row.lastSyncAt),
    lastError: row.lastError ?? undefined,
    createdAt: isoString(row.createdAt) || "",
    updatedAt: isoString(row.updatedAt) || "",
    ...optionalProps({
      tradeMindBindingToken: row.tradeMindBindingToken,
      activatedByUserId: row.activatedByUserId,
      activatedByUserEmail: row.activatedByUserEmail,
      activatedByUserDisplayName: row.activatedByUserDisplayName,
      activatedByUserRoles: activatedByUserRoles.length ? activatedByUserRoles : undefined
    })
  };
}

function mapInternalUser(row: InternalUserRow): InternalUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    roles: normalizeRoles(row.roles),
    createdAt: isoString(row.createdAt) || "",
    updatedAt: isoString(row.updatedAt) || ""
  };
}

function mapInternalSession(row: InternalSessionRow, token: string): InternalSession {
  return {
    token,
    tokenHash: row.tokenHash,
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    roles: normalizeRoles(row.roles),
    createdAt: isoString(row.createdAt) || "",
    expiresAt: isoString(row.expiresAt) || ""
  };
}

function mapUserInvitation(row: UserInvitationRow): StoredUserInvitation {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    roles: normalizeRoles(row.roles),
    expiresAt: isoString(row.expiresAt) || "",
    createdAt: isoString(row.createdAt) || "",
    ...optionalProps({
      createdByUserId: row.createdByUserId,
      acceptedAt: isoString(row.acceptedAt)
    })
  };
}

function normalizeRoles(value: InternalRole[] | string): InternalRole[] {
  if (Array.isArray(value)) return value;
  return value
    .replace(/[{}]/g, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as InternalRole[];
}
