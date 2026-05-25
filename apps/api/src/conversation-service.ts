import type {
  ConversationListItem,
  CustomerChatSummary,
  CustomerInfoResponse,
  MessageItem,
  MessagesResponse
} from "@wangwang/shared";
import {
  OnetalkClient,
  detectSession,
  fetchConversations as fetchOnetalkConversations,
  fetchMessages as fetchOnetalkMessages
} from "@wangwang/onetalk-adapter";
import { COOKIE_DB_PATHS, LOG_PATHS } from "./config.js";
import { sanitizeValue, shortHash } from "./redact.js";
import { CustomerLogIndex } from "./customer-log-index.js";

interface CachedState {
  bootstrap: Record<string, string>;
  rawConversations: Record<string, unknown>[];
  byId: Map<string, Record<string, unknown>>;
  loadedAt: number;
}

export class ConversationService {
  private state: CachedState | null = null;

  async list(refresh = false): Promise<{ cacheCount: number; conversations: ConversationListItem[] }> {
    const state = await this.ensureState(refresh);
    return {
      cacheCount: state.rawConversations.length,
      conversations: state.rawConversations.map((conversation, index) => this.toListItem(conversation, index))
    };
  }

  async messages(conversationId: string, before: number | null, pageSize: number): Promise<MessagesResponse> {
    const state = await this.ensureState(false);
    const conversation = state.byId.get(conversationId);
    if (!conversation) {
      throw new Error("conversation_not_found");
    }
    const response = await fetchOnetalkMessages({
      cookies: extractAliCookies(),
      conversation,
      bootstrap: state.bootstrap,
      before: before ?? Date.now(),
      pageSize
    });
    const messages = response.messages.map((message) => this.toMessageItem(conversationId, message));
    const sendTimes = messages
      .map((message) => message.sendTime)
      .filter((value): value is number => typeof value === "number");
    return {
      ok: true,
      conversationId,
      messages,
      nextBefore: sendTimes.length ? Math.min(...sendTimes) - 1 : null,
      page: {
        status: response.status,
        code: response.code,
        count: messages.length
      }
    };
  }

  async customer(conversationId: string): Promise<CustomerInfoResponse> {
    const state = await this.ensureState(false);
    const conversation = state.byId.get(conversationId);
    if (!conversation) {
      throw new Error("conversation_not_found");
    }

    const logIndex = CustomerLogIndex.fromDefaultLogs();
    const contactAccountIdEncrypt = firstString(conversation.encryptContactAccountId, conversation.contactAccountIdEncrypt);
    const contactAliId = firstString(conversation.contactAliId);
    const accountTokenProfile = logIndex.findAccount({
      accountIdEncrypted: contactAccountIdEncrypt,
      targetAliId: contactAliId
    });
    const contactExtInfo = logIndex.findContactExt({
      accountIdEncrypt: contactAccountIdEncrypt,
      aliId: contactAliId,
      loginId: accountTokenProfile?.targetLoginId
    });
    const alicrmContext = logIndex.findAlicrmContext({
      contactAccountIdEncrypt,
      buyerLoginId: accountTokenProfile?.targetLoginId || contactExtInfo?.loginId
    });
    const buyerLoginId = firstString(
      accountTokenProfile?.targetLoginId,
      contactExtInfo?.loginId,
      alicrmContext?.buyerLoginId,
      alicrmContext?.chatLoginId
    );
    const mtopProfile = logIndex.findUser({
      aliId: contactAliId,
      loginId: buyerLoginId
    });
    const matchedSources = ["conversation_cache"];
    if (accountTokenProfile) matchedSources.push("app_log_get_account_info_by_token");
    if (contactExtInfo) matchedSources.push("app_log_contact_extinfo_get");
    if (mtopProfile) matchedSources.push("app_log_get_user_info_by_params");
    if (alicrmContext) matchedSources.push("app_log_alicrm_context");

    const chatSummary = await this.chatSummary(conversation, state.bootstrap, alicrmContext?.ownerAccountIdEncrypt);
    if (chatSummary) matchedSources.push("chat_manager_summary");

    return {
      ok: true,
      conversationId,
      identity: {
        conversationId,
        displayName: contactDisplayName(contactExtInfo) || displayName(conversation),
        contactAccountId: firstString(conversation.contactAccountId),
        contactAccountIdEncrypt,
        contactAliId,
        contactAliIdEncrypt: firstString(conversation.encryptContactAliId, conversation.aliIdEncrypt),
        buyerLoginId
      },
      mtopProfile,
      accountTokenProfile,
      contactExtInfo,
      chatSummary,
      detailStatus: {
        available: false,
        source: "alicrm_jsonp",
        reason: "direct_jsonp_requires_full_alicrm_runtime_or_additional_cookie_context"
      },
      matchedSources
    };
  }

  async exportMessages(options: { conversationIds?: string[]; maxPages: number; pageSize: number }) {
    const state = await this.ensureState(false);
    const ids = options.conversationIds?.length ? options.conversationIds : Array.from(state.byId.keys());
    const conversations = [];
    for (const id of ids) {
      const listItem = state.rawConversations.find((item, index) => this.localId(item, index) === id);
      if (!listItem) continue;
      let before: number | null = Date.now();
      const all = new Map<string, MessageItem>();
      const pages = [];
      for (let page = 0; page < options.maxPages; page += 1) {
        const result = await this.messages(id, before, options.pageSize);
        pages.push(result.page);
        for (const message of result.messages) {
          all.set(message.id, message);
        }
        if (!result.nextBefore || result.messages.length === 0) break;
        before = result.nextBefore;
      }
      const messages = Array.from(all.values()).sort((a, b) => (a.sendTime || 0) - (b.sendTime || 0));
      conversations.push({
        id,
        conversation: sanitizeValue(listItem),
        messageCount: messages.length,
        messages,
        pages
      });
    }
    return conversations;
  }

  private async chatSummary(
    conversation: Record<string, unknown>,
    bootstrap: Record<string, string>,
    ownerAccountIdEncrypt?: string
  ): Promise<CustomerChatSummary | null> {
    const secContactAccountId = firstString(conversation.encryptContactAccountId, conversation.contactAccountIdEncrypt);
    const secOwnerAccountId = firstString(ownerAccountIdEncrypt, bootstrap.currentUserAccountIdEncry);
    if (!secContactAccountId || !secOwnerAccountId) return null;
    try {
      const client = new OnetalkClient(extractAliCookies());
      const response = await client.getChatDataSummary({ secContactAccountId, secOwnerAccountId });
      if (response.status !== 200 || String(response.code) !== "200" || !response.data) return null;
      return pickChatSummary(response.data);
    } catch {
      return null;
    }
  }

  private async ensureState(refresh: boolean): Promise<CachedState> {
    if (this.state && !refresh) return this.state;
    const cookies = extractAliCookies();
    const webLite = await fetchOnetalkConversations({ cookies });
    const rawConversations = webLite.conversations.filter(isProbeableConversation);
    const byId = new Map<string, Record<string, unknown>>();
    rawConversations.forEach((conversation, index) => byId.set(this.localId(conversation, index), conversation));
    this.state = {
      bootstrap: webLite.bootstrap,
      rawConversations,
      byId,
      loadedAt: Date.now()
    };
    return this.state;
  }

  private toListItem(conversation: Record<string, unknown>, index: number): ConversationListItem {
    const latest = isRecord(conversation.latestMessage) ? conversation.latestMessage : {};
    const preview = typeof latest.content === "string" ? latest.content : "";
    const sendTime = typeof latest.sendTime === "number" ? latest.sendTime : null;
    return {
      id: this.localId(conversation, index),
      source: "vmfs_cache",
      index: index + 1,
      displayName: displayName(conversation),
      lastMessagePreview: preview,
      lastMessageTime: sendTime,
      unreadCount: typeof conversation.unreadCount === "number" ? conversation.unreadCount : 0,
      hasLatestMessage: Object.keys(latest).length > 0
    };
  }

  private toMessageItem(conversationId: string, message: Record<string, unknown>): MessageItem {
    const remoteId = firstString(message.messageId, message.uuid, message.requestMessageId);
    const sendTime = typeof message.sendTime === "number" ? message.sendTime : undefined;
    const direction = message.messageType === "rec" || message.messageSendType === "rec" ? "received" : message.messageType === "send" ? "sent" : "unknown";
    return {
      id: `${conversationId}:${remoteId || shortHash(JSON.stringify(message))}`,
      conversationId,
      remoteMessageId: remoteId,
      sendTime,
      sendTimeUtc: sendTime ? new Date(sendTime).toISOString() : undefined,
      direction,
      messageType: message.messageType as string | number | undefined,
      subType: message.subType as string | number | undefined,
      content: typeof message.content === "string" ? message.content : "",
      raw: sanitizeValue(message) as Record<string, unknown>
    };
  }

  private localId(conversation: Record<string, unknown>, index: number): string {
    const material = firstString(conversation.cid, conversation.contactAccountId, conversation.contactAliId) || String(index);
    return `conv_${shortHash(material)}`;
  }
}

function extractAliCookies() {
  return detectSession({
    logPaths: LOG_PATHS,
    cookieDbPaths: COOKIE_DB_PATHS.length ? COOKIE_DB_PATHS : undefined
  }).cookies;
}

function isProbeableConversation(value: Record<string, unknown>): boolean {
  return Boolean(
    value.contactAccountId &&
      (value.encryptContactAccountId || value.contactAccountIdEncrypt) &&
      value.contactAliId &&
      (value.encryptContactAliId || value.aliIdEncrypt)
  );
}

function displayName(conversation: Record<string, unknown>): string {
  const latest = isRecord(conversation.latestMessage) ? conversation.latestMessage : {};
  const contact = isRecord(latest.contact) ? latest.contact : {};
  return firstString(contact.name, contact.displayName, conversation.contactAliId, conversation.contactAccountId) || "Unknown";
}

function contactDisplayName(contact: { firstName?: unknown; lastName?: unknown; loginId?: unknown } | null): string {
  if (!contact) return "";
  return [firstString(contact.firstName), firstString(contact.lastName)].filter(Boolean).join(" ") || firstString(contact.loginId);
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value) return value;
    if (typeof value === "number") return String(value);
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function pickChatSummary(value: Record<string, unknown>): CustomerChatSummary {
  return {
    productCardNum: numberValue(value.productCardNum),
    inquiryCardNum: numberValue(value.inquiryCardNum),
    quotationCardNum: numberValue(value.quotationCardNum),
    unPayOrderNum: numberValue(value.unPayOrderNum),
    unshippedOrderNum: numberValue(value.unshippedOrderNum),
    unConfirmShipmentOrderNum: numberValue(value.unConfirmShipmentOrderNum)
  };
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}
