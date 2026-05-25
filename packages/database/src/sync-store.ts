import crypto from "node:crypto";
import type {
  StoredConversation,
  StoredCustomer,
  StoredMessage,
  StoredSellerAccount,
  SyncBatch,
  SyncBatchResult,
  SyncConversationInput,
  SyncCustomerInput,
  SyncMessageInput
} from "./sync-types.js";

export class InMemorySyncStore {
  private readonly sellerAccounts = new Map<string, StoredSellerAccount>();
  private readonly customers = new Map<string, StoredCustomer>();
  private readonly conversations = new Map<string, StoredConversation>();
  private readonly messages = new Map<string, StoredMessage>();

  async acceptSyncBatch(batch: SyncBatch): Promise<SyncBatchResult> {
    const warnings: string[] = [];
    let acceptedCount = 0;
    let rejectedCount = 0;

    const sellerKey = sellerAccountKey(batch.orgId, batch.sellerAccount.externalAccountId);
    this.sellerAccounts.set(sellerKey, {
      orgId: batch.orgId,
      ...batch.sellerAccount,
      lastSeenAt: sourceTime(batch)
    });

    for (const customer of batch.customers || []) {
      this.customers.set(customerKey(batch.orgId, batch.sellerAccount.externalAccountId, customer.externalCustomerId), {
        orgId: batch.orgId,
        sellerAccountExternalId: batch.sellerAccount.externalAccountId,
        ...customer
      });
    }

    for (const conversation of batch.conversations || []) {
      this.conversations.set(
        conversationKey(batch.orgId, batch.sellerAccount.externalAccountId, conversation.externalConversationId),
        {
          orgId: batch.orgId,
          sellerAccountExternalId: batch.sellerAccount.externalAccountId,
          ...conversation
        }
      );
    }

    let nextCursor: string | null = null;
    for (const message of batch.messages || []) {
      const convKey = conversationKey(batch.orgId, batch.sellerAccount.externalAccountId, message.externalConversationId);
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
        orgId: batch.orgId,
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

  listSellerAccounts(orgId: string): StoredSellerAccount[] {
    return Array.from(this.sellerAccounts.values()).filter((item) => item.orgId === orgId);
  }

  listCustomers(orgId: string): StoredCustomer[] {
    return Array.from(this.customers.values()).filter((item) => item.orgId === orgId);
  }

  listConversations(orgId: string): StoredConversation[] {
    return Array.from(this.conversations.values()).filter((item) => item.orgId === orgId);
  }

  listMessages(orgId: string): StoredMessage[] {
    return Array.from(this.messages.values()).filter((item) => item.orgId === orgId);
  }
}

function sellerAccountKey(orgId: string, sellerAccountExternalId: string): string {
  return [orgId, sellerAccountExternalId].join(":");
}

function customerKey(orgId: string, sellerAccountExternalId: string, externalCustomerId: string): string {
  return [orgId, sellerAccountExternalId, externalCustomerId].join(":");
}

function conversationKey(orgId: string, sellerAccountExternalId: string, externalConversationId: string): string {
  return [orgId, sellerAccountExternalId, externalConversationId].join(":");
}

function messageUniqueKey(batch: SyncBatch, message: SyncMessageInput, contentHash: string): string {
  const prefix = conversationKey(batch.orgId, batch.sellerAccount.externalAccountId, message.externalConversationId);
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
