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
}

export interface RunSyncOnceOptions {
  stateStore: SyncStateStore;
  onetalkClient: SyncOnetalkClient;
  messageSource: SyncMessageSource;
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
    const messagesByConversationId = await options.messageSource.read();
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

    await options.stateStore.saveStatus({
      lastSyncedAt: now().toISOString(),
      nextCursor: uploadResult.nextCursor,
      lastDiagnostics: diagnosticsFromMessages(weblite, messagesByConversationId),
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
  messagesByConversationId: Record<string, Record<string, unknown>[]>
): SyncDiagnostics {
  const messageRequests: MessageRequestDiagnostic[] = Object.entries(messagesByConversationId).map(
    ([conversationId, messages]) => ({
      conversationId,
      status: 200,
      code: 200,
      contentType: "application/lwp+json",
      listLength: messages.length,
      listPath: "page-socket-tap",
      topLevelKeys: [],
      dataKeys: []
    })
  );
  return {
    conversations: weblite.conversations.filter(isRecord).length,
    messageRequests,
    lwpRoutes: [
      {
        route: "page-socket-tap",
        status: 200,
        listLength: messageRequests.reduce((total, item) => total + item.listLength, 0)
      }
    ]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

