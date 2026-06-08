import { mapWebliteToSyncBatch, type WebliteData } from "@wangwang/onetalk-adapter/browser";
import { assertNoSensitiveFields, sanitizeForUpload } from "./sanitizer.js";
import { validateConfig } from "./storage.js";
import type {
  ExtensionConfig,
  ExtensionStatus,
  MessageRequestDiagnostic,
  SyncBatch,
  SyncBatchResult,
  SyncDiagnostics
} from "../shared/sync-types.js";

export interface SyncStateStore {
  getConfig(): Promise<ExtensionConfig | null>;
  getStatus(): Promise<ExtensionStatus>;
  saveStatus(status: ExtensionStatus): Promise<void>;
}

export interface SyncOnetalkClient {
  fetchWeblite(): Promise<WebliteData>;
}

export interface SyncMessageSource {
  read(): Promise<Record<string, Record<string, unknown>[]>>;
  acknowledge(uploaded: Record<string, Record<string, unknown>[]>): Promise<void>;
}

export interface SyncHistoryMessageSource {
  read(
    conversations: Record<string, unknown>[],
    config: ExtensionConfig
  ): Promise<Record<string, Record<string, unknown>[]>>;
}

export interface RunSyncOnceOptions {
  stateStore: SyncStateStore;
  onetalkClient: SyncOnetalkClient;
  messageSource: SyncMessageSource;
  historyMessageSource?: SyncHistoryMessageSource;
  uploadSyncBatch(options: { serverUrl: string; collectorToken: string; batch: SyncBatch }): Promise<SyncBatchResult>;
  now?: () => Date;
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
  const previousStatus = await options.stateStore.getStatus();

  try {
    const config = await options.stateStore.getConfig();
    validateConfig(config);

    const weblite = await options.onetalkClient.fetchWeblite();
    const liveMessagesByConversationId = await options.messageSource.read();
    const historyMessagesByConversationId =
      (await options.historyMessageSource?.read(weblite.conversations.filter(isRecord), config)) || {};
    const messagesByConversationId = mergeMessagesByConversationId(
      liveMessagesByConversationId,
      historyMessagesByConversationId
    );
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
      previousCursor: null,
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

    // Upload succeeded — remove exactly the uploaded messages from the buffer.
    // Messages that arrived after read() and any future ones stay buffered.
    await options.messageSource.acknowledge(liveMessagesByConversationId);

    await options.stateStore.saveStatus({
      lastSyncedAt: now().toISOString(),
      nextCursor: uploadResult.nextCursor,
      lastDiagnostics: diagnosticsFromMessages(weblite, liveMessagesByConversationId, historyMessagesByConversationId),
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

function diagnosticsFromMessages(
  weblite: WebliteData,
  liveMessagesByConversationId: Record<string, Record<string, unknown>[]>,
  historyMessagesByConversationId: Record<string, Record<string, unknown>[]> = {}
): SyncDiagnostics {
  const liveRequests = diagnosticsForSource(liveMessagesByConversationId, "page-socket-tap");
  const historyRequests = diagnosticsForSource(historyMessagesByConversationId, "page-sdk-history");
  const messageRequests: MessageRequestDiagnostic[] = [...liveRequests, ...historyRequests];
  const routeTotals = new Map<string, number>();
  for (const item of messageRequests) {
    routeTotals.set(item.listPath || "unknown", (routeTotals.get(item.listPath || "unknown") || 0) + item.listLength);
  }
  return {
    conversations: weblite.conversations.filter(isRecord).length,
    messageRequests,
    lwpRoutes: Array.from(routeTotals.entries()).map(([route, listLength]) => ({
      route,
      status: 200,
      listLength
    }))
  };
}

function diagnosticsForSource(
  messagesByConversationId: Record<string, Record<string, unknown>[]>,
  listPath: string
): MessageRequestDiagnostic[] {
  return Object.entries(messagesByConversationId).map(([conversationId, messages]) => ({
      conversationId,
      status: 200,
      code: 200,
      contentType: "application/lwp+json",
      listLength: messages.length,
      listPath,
      topLevelKeys: [],
      dataKeys: []
    }));
}

function mergeMessagesByConversationId(
  primary: Record<string, Record<string, unknown>[]>,
  secondary: Record<string, Record<string, unknown>[]>
): Record<string, Record<string, unknown>[]> {
  const output: Record<string, Record<string, unknown>[]> = {};
  const conversationIds = new Set([...Object.keys(primary), ...Object.keys(secondary)]);
  for (const conversationId of conversationIds) {
    output[conversationId] = dedupeMessages([...(primary[conversationId] || []), ...(secondary[conversationId] || [])]);
  }
  return output;
}

function dedupeMessages(messages: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const output: Record<string, unknown>[] = [];
  for (const message of messages) {
    const id = messageId(message);
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    output.push(message);
  }
  return output;
}

function messageId(message: Record<string, unknown>): string | undefined {
  const body = isRecord(message.message) ? message.message : message;
  for (const key of ["messageId", "msgId", "messageID", "msgIdStr", "uuid", "id"]) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
