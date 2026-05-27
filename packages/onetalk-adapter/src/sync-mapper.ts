import {
  countryFromProfile,
  customerProfileFor,
  displayNameFromProfile,
  loginIdFromProfile,
  lwpCustomerIdentity
} from "./customer-profile.js";
import type { WebliteData } from "./onetalk-client.js";

export type MessageDirection = "received" | "sent" | "unknown";

export interface BrowserSyncSellerAccountInput {
  externalAccountId: string;
  displayName?: string;
  status?: string;
}

export interface BrowserSyncDeviceInput {
  deviceId: string;
  deviceName?: string;
}

export interface BrowserSyncCustomerInput {
  externalCustomerId: string;
  loginId?: string;
  displayName?: string;
  country?: string;
  ownerUserId?: string;
  stage?: string;
}

export interface BrowserSyncConversationInput {
  externalConversationId: string;
  externalCustomerId?: string;
  lastMessageAt?: string;
}

export interface BrowserSyncMessageInput {
  externalConversationId: string;
  externalMessageId?: string;
  direction: MessageDirection;
  messageType?: string | number;
  content?: string;
  sentAt?: string;
  rawSanitized?: Record<string, unknown>;
}

export interface BrowserSyncBatch {
  sellerAccount: BrowserSyncSellerAccountInput;
  device: BrowserSyncDeviceInput;
  cursor?: Record<string, unknown>;
  sourceMeta?: Record<string, unknown>;
  customers?: BrowserSyncCustomerInput[];
  conversations?: BrowserSyncConversationInput[];
  messages?: BrowserSyncMessageInput[];
}

export interface MapWebliteToSyncBatchOptions {
  sellerAccount: BrowserSyncSellerAccountInput;
  device: BrowserSyncDeviceInput;
  collectedAt: string;
  source: string;
  previousCursor: string | null;
  weblite: WebliteData;
  messagesByConversationId: Record<string, Record<string, unknown>[]>;
}

export function mapWebliteToSyncBatch(options: MapWebliteToSyncBatchOptions): BrowserSyncBatch {
  const customers = new Map<string, BrowserSyncCustomerInput>();
  const conversations: BrowserSyncConversationInput[] = [];
  const messages: BrowserSyncMessageInput[] = [];

  const rawConversations = options.weblite.conversations.filter(isRecord);
  for (let index = 0; index < rawConversations.length; index += 1) {
    const conversation = rawConversations[index];
    const lwpConversation = lwpSingleChatConversation(conversation);
    const pairCustomerId = lwpCustomerId(lwpConversation, options.weblite.bootstrap);
    const lwpIdentity = lwpCustomerIdentity(conversation, pairCustomerId);
    const externalConversationId =
      firstString(conversation, ["cid", "conversationCode", "conversationId", "id"]) ||
      firstString(lwpConversation, ["cid"]);
    const externalCustomerId =
      firstString(conversation, [
        "contactAccountId",
        "contactAccountIdEncrypt",
        "buyerAccountId",
        "contactAliId"
      ]) ||
      lwpIdentity.accountIdEncrypt ||
      lwpIdentity.accountId ||
      lwpIdentity.aliIdEncrypt ||
      lwpIdentity.pairCustomerId;
    if (!externalConversationId || !externalCustomerId) continue;
    const customerProfile = customerProfileFor(options.weblite.customerProfiles, {
      externalCustomerId,
      conversation,
      lwpIdentity
    });

    customers.set(
      externalCustomerId,
      compact({
        externalCustomerId,
        loginId:
          firstString(conversation, ["loginId", "contactLoginId"]) ||
          loginIdFromProfile(customerProfile),
        displayName:
          firstString(conversation, [
            "contactNick",
            "contactName",
            "contactDisplayName",
            "buyerName",
            "buyerNick",
            "nickName",
            "displayName",
            "nick",
            "name"
          ]) ||
          displayNameFromProfile(customerProfile),
        country:
          firstString(conversation, ["country"]) ||
          countryFromProfile(customerProfile)
      })
    );

    conversations.push(
      compact({
        externalConversationId,
        externalCustomerId,
        lastMessageAt: isoTime(firstMessageTime(conversation))
      })
    );

    for (const rawMessage of options.messagesByConversationId[externalConversationId] || []) {
      const message = mapMessage(rawMessage, externalConversationId, options.weblite.bootstrap, conversation);
      if (message && isAfterCursor(message.sentAt, options.previousCursor)) {
        messages.push(message);
      }
    }
  }

  return compact({
    sellerAccount: options.sellerAccount,
    device: options.device,
    cursor: options.previousCursor ? { previousCursor: options.previousCursor } : undefined,
    sourceMeta: {
      source: options.source,
      collectedAt: options.collectedAt,
      sourceBatchKey: `${options.sellerAccount.externalAccountId}:${options.device.deviceId}:${options.collectedAt}`
    },
    customers: Array.from(customers.values()),
    conversations,
    messages
  });
}

function firstMessageTime(conversation: Record<string, unknown>): unknown {
  return firstValue(conversation, [
    "lastMessageTime",
    "lastMessageAt",
    "lastMsgTime",
    "latestMessage.sendTime",
    "latestMessage.time",
    "latestMessage.gmtCreate",
    "latestMessage.createdAt",
    "lastMessage.sendTime",
    "lastMessage.time",
    "lastMessage.gmtCreate",
    "lastMessage.createdAt",
    "singleChatUserConversation.lastMessage.message.createAt",
    "singleChatUserConversation.modifyTime"
  ]);
}

function mapMessage(
  raw: Record<string, unknown>,
  externalConversationId: string,
  bootstrap: Record<string, string>,
  conversation: Record<string, unknown>
): BrowserSyncMessageInput | null {
  const message = lwpMessage(raw) || raw;
  const sentAt = isoTime(firstValue(message, ["sendTime", "sentAt", "time", "gmtCreate", "createdAt", "createAt"]));
  return compact({
    externalConversationId,
    externalMessageId: firstString(message, ["messageId", "msgId", "messageID", "msgIdStr", "id"]),
    direction: directionOf(message, bootstrap, conversation),
    messageType: firstString(message, ["messageType", "type", "msgType", "content.contentType", "displayStyle"]) || "text",
    content: firstString(message, [
      "content",
      "text",
      "message",
      "summary",
      "messageContent",
      "textContent",
      "showText",
      "plainText",
      "content.text.content",
      "searchableContent.summary"
    ]),
    sentAt,
    rawSanitized: raw
  });
}

function directionOf(
  message: Record<string, unknown>,
  bootstrap: Record<string, string>,
  conversation: Record<string, unknown>
): MessageDirection {
  const explicit = firstString(message, ["direction"]);
  if (explicit === "sent" || explicit === "received" || explicit === "unknown") return explicit;
  const sender = firstString(message, ["senderAliId", "fromAliId", "senderId", "fromId", "sender.uid"]);
  const self =
    firstString(conversation, ["selfAliId"]) ||
    firstString(lwpSingleChatConversation(conversation), ["pairFirst"]) ||
    bootstrap.aliId;
  if (!sender || !self) return "unknown";
  return sender === self ? "sent" : "received";
}

function isAfterCursor(sentAt: string | undefined, cursor: string | null): boolean {
  if (!cursor || !sentAt) return true;
  return Date.parse(sentAt) > Date.parse(cursor);
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = key.includes(".") ? valueAtPath(source, key.split(".")) : source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function firstValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = key.includes(".") ? valueAtPath(source, key.split(".")) : source[key];
    if (value != null && value !== "") return value;
  }
  return undefined;
}

function valueAtPath(source: unknown, path: string[]): unknown {
  let current = source;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isoTime(value: unknown): string | undefined {
  const numeric = numericTime(value);
  if (numeric != null) return new Date(numeric).toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return undefined;
}

function numericTime(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;
  if (raw == null || !Number.isFinite(raw)) return null;
  return raw < 10_000_000_000 ? raw * 1000 : raw;
}

function compact<T extends Record<string, unknown>>(source: T): T {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== null)) as T;
}

function lwpSingleChatConversation(conversation: Record<string, unknown>): Record<string, unknown> {
  const wrapper = valueAtPath(conversation, ["singleChatUserConversation", "singleChatConversation"]);
  return isRecord(wrapper) ? wrapper : {};
}

function lwpCustomerId(lwpConversation: Record<string, unknown>, bootstrap: Record<string, string>): string | undefined {
  const pairFirst = firstString(lwpConversation, ["pairFirst"]);
  const pairSecond = firstString(lwpConversation, ["pairSecond"]);
  const self = bootstrap.aliId;
  if (self && pairFirst === self) return pairSecond;
  if (self && pairSecond === self) return pairFirst;
  return pairSecond || pairFirst;
}

function lwpMessage(raw: Record<string, unknown>): Record<string, unknown> | null {
  const value = raw.message;
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
