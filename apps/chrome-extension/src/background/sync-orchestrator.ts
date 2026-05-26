import { mapWebliteToSyncBatch, type ChatMessageResponse, type WebliteData } from "@wangwang/onetalk-adapter/browser";
import { assertNoSensitiveFields, sanitizeForUpload } from "./sanitizer.js";
import { validateConfig } from "./storage.js";
import type { ExtensionConfig, ExtensionStatus, SyncBatch, SyncBatchResult } from "../shared/sync-types.js";

export interface SyncStateStore {
  getConfig(): Promise<ExtensionConfig | null>;
  getStatus(): Promise<ExtensionStatus>;
  saveStatus(status: ExtensionStatus): Promise<void>;
}

export interface SyncOnetalkClient {
  fetchWeblite(): Promise<WebliteData>;
  getChatMessages(options: {
    conversation: Record<string, unknown>;
    bootstrap: Record<string, string>;
    before: number | null;
    pageSize: number;
  }): Promise<ChatMessageResponse>;
}

export interface RunSyncOnceOptions {
  stateStore: SyncStateStore;
  onetalkClient: SyncOnetalkClient;
  uploadSyncBatch(options: { serverUrl: string; collectorToken: string; batch: SyncBatch }): Promise<SyncBatchResult>;
  now?: () => Date;
  pageSize?: number;
  maxPagesPerConversation?: number;
}

export interface RunSyncResult {
  ok: boolean;
  acceptedCount?: number;
  rejectedCount?: number;
  nextCursor?: string | null;
  error?: string;
}

export async function runSyncOnce(options: RunSyncOnceOptions): Promise<RunSyncResult> {
  const now = options.now || (() => new Date());
  const pageSize = options.pageSize || 50;
  const maxPages = options.maxPagesPerConversation || 1;
  const previousStatus = await options.stateStore.getStatus();

  try {
    const config = await options.stateStore.getConfig();
    validateConfig(config);

    const weblite = await options.onetalkClient.fetchWeblite();
    const messagesByConversationId = await fetchMessagesByConversation({
      client: options.onetalkClient,
      weblite,
      pageSize,
      maxPages
    });
    const mapped = mapWebliteToSyncBatch({
      sellerAccount: {
        externalAccountId: config.sellerAccountExternalId,
        displayName: config.sellerAccountDisplayName
      },
      device: {
        deviceId: config.deviceId,
        deviceName: config.deviceName
      },
      collectedAt: now().toISOString(),
      source: "chrome-extension",
      previousCursor: previousStatus.nextCursor || null,
      weblite,
      messagesByConversationId
    });

    const sanitized = sanitizeForUpload(mapped);
    assertNoSensitiveFields(sanitized);
    const uploadResult = await options.uploadSyncBatch({
      serverUrl: config.serverUrl,
      collectorToken: config.collectorToken,
      batch: sanitized
    });

    await options.stateStore.saveStatus({
      lastSyncedAt: now().toISOString(),
      nextCursor: uploadResult.nextCursor,
      lastError: undefined
    });

    return {
      ok: true,
      acceptedCount: uploadResult.acceptedCount,
      rejectedCount: uploadResult.rejectedCount,
      nextCursor: uploadResult.nextCursor
    };
  } catch (error) {
    const code = error instanceof Error ? error.message : "sync_failed";
    await options.stateStore.saveStatus({
      ...previousStatus,
      lastError: {
        code,
        message: code
      }
    });
    return { ok: false, error: code };
  }
}

async function fetchMessagesByConversation(options: {
  client: SyncOnetalkClient;
  weblite: WebliteData;
  pageSize: number;
  maxPages: number;
}): Promise<Record<string, Record<string, unknown>[]>> {
  const output: Record<string, Record<string, unknown>[]> = {};

  for (const conversation of options.weblite.conversations.filter(isRecord)) {
    const conversationId = firstString(conversation, ["cid", "conversationCode", "conversationId", "id"]);
    if (!conversationId) continue;
    const messages: Record<string, unknown>[] = [];
    let before: number | null = null;

    for (let page = 0; page < options.maxPages; page += 1) {
      const result = await options.client.getChatMessages({
        conversation,
        bootstrap: options.weblite.bootstrap,
        before,
        pageSize: options.pageSize
      });
      const records = result.messages.filter(isRecord);
      messages.push(...records);
      if (records.length < options.pageSize) break;
      const oldest = oldestTimestamp(records);
      if (oldest == null) break;
      before = oldest - 1;
    }

    output[conversationId] = messages;
  }

  return output;
}

function oldestTimestamp(records: Record<string, unknown>[]): number | null {
  const times = records
    .map((record) => numericTime(firstValue(record, ["sendTime", "sentAt", "time", "gmtCreate", "createdAt"])))
    .filter((value): value is number => value != null);
  return times.length ? Math.min(...times) : null;
}

function numericTime(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;
  if (raw == null || !Number.isFinite(raw)) return null;
  return raw < 10_000_000_000 ? raw * 1000 : raw;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
