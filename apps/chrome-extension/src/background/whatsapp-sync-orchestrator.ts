import { assertNoSensitiveFields, sanitizeForUpload } from "./sanitizer.js";
import { validateConfig } from "./storage.js";
import type {
  ExtensionConfig,
  ExtensionStatus,
  SyncBatch,
  SyncBatchResult
} from "../shared/sync-types.js";

export interface WhatsAppSyncStateStore {
  getConfig(): Promise<ExtensionConfig | null>;
  getStatus(): Promise<ExtensionStatus>;
  saveStatus(status: ExtensionStatus): Promise<void>;
}

export interface WhatsAppMessageSource {
  read(): Promise<Record<string, Record<string, unknown>[]>>;
  acknowledge(uploaded: Record<string, Record<string, unknown>[]>): Promise<void>;
}

export interface RunWhatsAppSyncOnceOptions {
  stateStore: WhatsAppSyncStateStore;
  messageSource: WhatsAppMessageSource;
  uploadSyncBatch(options: { serverUrl: string; collectorToken: string; batch: SyncBatch }): Promise<SyncBatchResult>;
  now?: () => Date;
}

export async function runWhatsAppSyncOnce(options: RunWhatsAppSyncOnceOptions): Promise<SyncBatchResult | null> {
  const now = options.now || (() => new Date());
  const previousStatus = await options.stateStore.getStatus();

  try {
    const config = await options.stateStore.getConfig();
    validateConfig(config);

    const messagesByConversationId = await options.messageSource.read();
    const batch = mapBufferedWhatsAppMessagesToSyncBatch(messagesByConversationId, config, now().toISOString());
    if (!batch.messages?.length) return null;

    const sanitized = sanitizeForUpload(batch);
    assertNoSensitiveFields(sanitized);
    const result = await options.uploadSyncBatch({
      serverUrl: config.serverUrl,
      collectorToken: config.collectorToken,
      batch: sanitized
    });
    await options.messageSource.acknowledge(messagesByConversationId);
    return result;
  } catch (error) {
    await options.stateStore.saveStatus({
      ...previousStatus,
      lastError: {
        code: error instanceof Error ? error.message : "whatsapp_web_sync_failed",
        message: error instanceof Error ? error.message : "whatsapp_web_sync_failed"
      }
    });
    throw error;
  }
}

export function mapBufferedWhatsAppMessagesToSyncBatch(
  messagesByConversationId: Record<string, Record<string, unknown>[]>,
  config: ExtensionConfig,
  collectedAt: string
): SyncBatch {
  const channelAccountExternalId = config.whatsappChannelAccountExternalId || config.channelAccountExternalId || config.sellerAccountExternalId;
  const customers = new Map<string, { externalCustomerId: string; displayName?: string }>();
  const conversations = new Map<string, { externalConversationId: string; externalCustomerId: string; lastMessageAt?: string }>();
  const messages = [];

  for (const [conversationId, rawMessages] of Object.entries(messagesByConversationId)) {
    const externalConversationId = conversationId.trim();
    if (!externalConversationId) continue;
    const externalCustomerId = externalConversationId;
    customers.set(externalCustomerId, { externalCustomerId });
    let lastMessageAt: string | undefined;
    for (const raw of rawMessages) {
      const content = stringField(raw, "content");
      if (!content) continue;
      const sentAt = stringField(raw, "sentAt");
      if (sentAt && (!lastMessageAt || Date.parse(sentAt) > Date.parse(lastMessageAt))) lastMessageAt = sentAt;
      messages.push({
        externalConversationId,
        externalMessageId: stringField(raw, "externalMessageId"),
        direction: directionField(raw.direction),
        messageType: stringField(raw, "messageType") || "text",
        content,
        sentAt,
        rawSanitized: isRecord(raw.rawSanitized) ? raw.rawSanitized : undefined
      });
    }
    conversations.set(externalConversationId, { externalConversationId, externalCustomerId, lastMessageAt });
  }

  return {
    channel: "whatsapp-web",
    channelAccount: {
      channel: "whatsapp-web",
      externalAccountId: channelAccountExternalId,
      surface: "whatsapp-web"
    },
    sellerAccount: {
      externalAccountId: config.sellerAccountExternalId,
      displayName: config.sellerAccountDisplayName
    },
    device: {
      deviceId: config.deviceId,
      deviceName: config.deviceName
    },
    sourceMeta: {
      source: "chrome-extension",
      surface: "whatsapp-web",
      collectedAt
    },
    customers: Array.from(customers.values()),
    conversations: Array.from(conversations.values()),
    messages
  };
}

function stringField(source: Record<string, unknown>, field: string): string | undefined {
  const value = source[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function directionField(value: unknown): "received" | "sent" | "unknown" {
  return value === "received" || value === "sent" || value === "unknown" ? value : "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
