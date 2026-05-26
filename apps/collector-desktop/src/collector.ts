import {
  detectSession,
  fetchConversations,
  fetchMessages,
  type ChatMessageResponse,
  type DetectedSession,
  type FetchMessagesOptions,
  type WebliteData
} from "@wangwang/onetalk-adapter";
import type {
  MessageDirection,
  SyncBatch,
  SyncBatchResult,
  SyncConversationInput,
  SyncCustomerInput,
  SyncMessageInput,
  SyncSellerAccountInput,
  SyncDeviceInput
} from "@wangwang/database";
import type { CollectorStateStore } from "./local-state.js";
import { uploadSyncBatch } from "./uploader.js";

export interface CollectorAdapter {
  detectSession(): DetectedSession | Promise<DetectedSession>;
  fetchConversations(options: { cookies?: DetectedSession["cookies"] }): Promise<WebliteData>;
  fetchMessages(options: FetchMessagesOptions): Promise<ChatMessageResponse>;
}

export interface CollectOnceOptions {
  sellerAccount: SyncSellerAccountInput;
  device: SyncDeviceInput;
  state: CollectorStateStore;
  adapter?: CollectorAdapter;
  uploadBatch?: (batch: SyncBatch) => Promise<SyncBatchResult>;
  serverUrl?: string;
  collectorToken?: string;
  pageSize?: number;
  maxPagesPerConversation?: number;
  collectedAt?: string;
}

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 5;

const defaultAdapter: CollectorAdapter = {
  detectSession,
  fetchConversations,
  fetchMessages
};

export async function collectOnce(options: CollectOnceOptions): Promise<SyncBatchResult> {
  const adapter = options.adapter || defaultAdapter;
  const uploadBatch = options.uploadBatch || defaultUploader(options);
  const pageSize = options.pageSize || DEFAULT_PAGE_SIZE;
  const maxPages = options.maxPagesPerConversation || DEFAULT_MAX_PAGES;
  const session = await adapter.detectSession();
  const previousCursor = await options.state.getCursor(options.sellerAccount.externalAccountId);
  const weblite = await adapter.fetchConversations({ cookies: session.cookies });
  const mapped = await mapWebliteToSyncBatch({
    adapter,
    cookies: session.cookies,
    weblite,
    previousCursor,
    pageSize,
    maxPages,
    sellerAccount: options.sellerAccount,
    device: options.device,
    collectedAt: options.collectedAt || new Date().toISOString()
  });

  try {
    const result = await uploadBatch(mapped);
    if (result.nextCursor) {
      await options.state.saveCursor(options.sellerAccount.externalAccountId, result.nextCursor);
    }
    await options.state.clearLastError();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await options.state.recordFailedBatch(mapped, message);
    await options.state.setLastError({ code: "upload_failed", message });
    throw error;
  }
}

interface MapBatchOptions {
  adapter: CollectorAdapter;
  cookies: DetectedSession["cookies"];
  weblite: WebliteData;
  previousCursor: string | null;
  pageSize: number;
  maxPages: number;
  sellerAccount: SyncSellerAccountInput;
  device: SyncDeviceInput;
  collectedAt: string;
}

async function mapWebliteToSyncBatch(options: MapBatchOptions): Promise<SyncBatch> {
  const customers = new Map<string, SyncCustomerInput>();
  const conversations: SyncConversationInput[] = [];
  const messages: SyncMessageInput[] = [];

  for (const conversation of options.weblite.conversations.filter(isRecord)) {
    const externalConversationId = firstString(conversation, ["cid", "conversationCode", "conversationId", "id"]);
    const externalCustomerId = firstString(conversation, [
      "contactAccountId",
      "contactAccountIdEncrypt",
      "buyerAccountId",
      "contactAliId"
    ]);
    if (!externalConversationId || !externalCustomerId) continue;

    customers.set(
      externalCustomerId,
      compact({
        externalCustomerId,
        loginId: firstString(conversation, ["loginId", "contactLoginId"]),
        displayName: firstString(conversation, ["contactNick", "displayName", "nick", "contactName"]),
        country: firstString(conversation, ["country"])
      })
    );
    conversations.push(
      compact({
        externalConversationId,
        externalCustomerId,
        lastMessageAt: isoTime(firstValue(conversation, ["lastMessageTime", "lastMessageAt", "lastMsgTime"]))
      })
    );

    const pageMessages = await fetchPagedMessages({
      adapter: options.adapter,
      cookies: options.cookies,
      conversation,
      bootstrap: options.weblite.bootstrap,
      externalConversationId,
      previousCursor: options.previousCursor,
      pageSize: options.pageSize,
      maxPages: options.maxPages
    });
    messages.push(...pageMessages);
  }

  return compact({
    sellerAccount: options.sellerAccount,
    device: options.device,
    cursor: options.previousCursor ? { previousCursor: options.previousCursor } : undefined,
    sourceMeta: {
      source: "collector-desktop",
      collectedAt: options.collectedAt,
      sourceBatchKey: `${options.sellerAccount.externalAccountId}:${options.collectedAt}`
    },
    customers: Array.from(customers.values()),
    conversations,
    messages
  });
}

interface FetchPagedMessagesOptions {
  adapter: CollectorAdapter;
  cookies: DetectedSession["cookies"];
  conversation: Record<string, unknown>;
  bootstrap: Record<string, string>;
  externalConversationId: string;
  previousCursor: string | null;
  pageSize: number;
  maxPages: number;
}

async function fetchPagedMessages(options: FetchPagedMessagesOptions): Promise<SyncMessageInput[]> {
  const messages: SyncMessageInput[] = [];
  let before: number | null = null;

  for (let page = 0; page < options.maxPages; page += 1) {
    const response = await options.adapter.fetchMessages({
      cookies: options.cookies,
      conversation: options.conversation,
      bootstrap: options.bootstrap,
      before,
      pageSize: options.pageSize
    });
    const records = response.messages.filter(isRecord);
    for (const record of records) {
      const message = mapMessage(record, options.externalConversationId, options.bootstrap, options.conversation);
      if (message && isAfterCursor(message.sentAt, options.previousCursor)) {
        messages.push(message);
      }
    }

    if (records.length < options.pageSize) break;
    const oldest = oldestTimestamp(records);
    if (oldest == null) break;
    before = oldest - 1;
  }

  return messages;
}

function mapMessage(
  message: Record<string, unknown>,
  externalConversationId: string,
  bootstrap: Record<string, string>,
  conversation: Record<string, unknown>
): SyncMessageInput | null {
  const sentAt = isoTime(firstValue(message, ["sendTime", "sentAt", "time", "gmtCreate", "createdAt"]));
  return compact({
    externalConversationId,
    externalMessageId: firstString(message, ["messageId", "msgId", "id"]),
    direction: directionOf(message, bootstrap, conversation),
    messageType: firstString(message, ["messageType", "type", "msgType"]) || "text",
    content: firstString(message, ["content", "text", "message", "summary"]),
    sentAt,
    rawSanitized: message
  });
}

function directionOf(
  message: Record<string, unknown>,
  bootstrap: Record<string, string>,
  conversation: Record<string, unknown>
): MessageDirection {
  const explicit = firstString(message, ["direction"]);
  if (explicit === "sent" || explicit === "received" || explicit === "unknown") return explicit;
  const sender = firstString(message, ["senderAliId", "fromAliId", "senderId", "fromId"]);
  const self = firstString(conversation, ["selfAliId"]) || bootstrap.aliId;
  if (!sender || !self) return "unknown";
  return sender === self ? "sent" : "received";
}

function oldestTimestamp(records: Record<string, unknown>[]): number | null {
  const times = records
    .map((record) => numericTime(firstValue(record, ["sendTime", "sentAt", "time", "gmtCreate", "createdAt"])))
    .filter((value): value is number => value != null);
  if (!times.length) return null;
  return Math.min(...times);
}

function isAfterCursor(sentAt: string | undefined, cursor: string | null): boolean {
  if (!cursor || !sentAt) return true;
  return Date.parse(sentAt) > Date.parse(cursor);
}

function defaultUploader(options: CollectOnceOptions): (batch: SyncBatch) => Promise<SyncBatchResult> {
  if (!options.serverUrl || !options.collectorToken) {
    throw new Error("collector_upload_target_required");
  }
  return (batch) => uploadSyncBatch({ serverUrl: options.serverUrl || "", token: options.collectorToken || "", batch });
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  const value = firstValue(source, keys);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function firstValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value != null && value !== "") return value;
  }
  return undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
