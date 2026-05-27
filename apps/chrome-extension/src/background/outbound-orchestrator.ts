import { sendMessageToOneTalkTab } from "./onetalk-tab-messaging.js";
import { validateConfig } from "./storage.js";
import type { ChromeApi } from "../shared/chrome-api.js";
import type { ExtensionConfig, ExtensionStatus, OutboundMessage } from "../shared/sync-types.js";

export interface OutboundStateStore {
  getConfig(): Promise<ExtensionConfig | null>;
  getStatus(): Promise<ExtensionStatus>;
  saveStatus(status: ExtensionStatus): Promise<void>;
}

export interface RunOutboundDeliveryOptions {
  stateStore: OutboundStateStore;
  chromeApi: ChromeApi;
  listOutboundMessages(options: { serverUrl: string; collectorToken: string }): Promise<OutboundMessage[]>;
  markOutboundMessageDelivered(options: {
    serverUrl: string;
    collectorToken: string;
    outboundMessageId: string;
    status: "sent" | "failed";
    externalMessageId?: string;
    errorCode?: string;
    errorMessage?: string;
    deliveredAt?: string;
  }): Promise<OutboundMessage>;
}

export interface RunOutboundDeliveryResult {
  ok: boolean;
  sentCount?: number;
  failedCount?: number;
  error?: string;
}

interface PageSendResponse {
  ok: boolean;
  externalMessageId?: string;
  error?: string;
}

export async function runOutboundDelivery(options: RunOutboundDeliveryOptions): Promise<RunOutboundDeliveryResult> {
  const previousStatus = await options.stateStore.getStatus();

  try {
    const config = await options.stateStore.getConfig();
    validateConfig(config);

    const messages = await options.listOutboundMessages({
      serverUrl: config.serverUrl,
      collectorToken: config.collectorToken
    });
    let sentCount = 0;
    let failedCount = 0;

    for (const message of messages) {
      const result = await sendViaOneTalkTab(options.chromeApi, message);
      await options.markOutboundMessageDelivered({
        serverUrl: config.serverUrl,
        collectorToken: config.collectorToken,
        outboundMessageId: message.id,
        status: result.ok ? "sent" : "failed",
        externalMessageId: result.externalMessageId,
        errorCode: result.ok ? undefined : result.error || "onetalk_send_failed",
        errorMessage: result.ok ? undefined : result.error || "OneTalk send failed",
        deliveredAt: new Date().toISOString()
      });
      if (result.ok) sentCount += 1;
      else failedCount += 1;
    }

    await options.stateStore.saveStatus({
      ...previousStatus,
      lastError: failedCount ? { code: "outbound_send_partial_failed", message: "outbound_send_partial_failed" } : undefined
    });
    return { ok: failedCount === 0, sentCount, failedCount };
  } catch (error) {
    const code = error instanceof Error ? error.message : "outbound_delivery_failed";
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

async function sendViaOneTalkTab(chromeApi: ChromeApi, message: OutboundMessage): Promise<PageSendResponse> {
  try {
    const response = await sendMessageToOneTalkTab(chromeApi, {
      type: "send-onetalk-message",
      message
    });
    return isPageSendResponse(response) ? response : { ok: false, error: "onetalk_send_response_invalid" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "onetalk_send_failed" };
  }
}

function isPageSendResponse(value: unknown): value is PageSendResponse {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    (value.externalMessageId === undefined || typeof value.externalMessageId === "string") &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
