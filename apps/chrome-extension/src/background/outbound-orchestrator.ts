import { sendMessageToOneTalkTab } from "./onetalk-tab-messaging.js";
import { OutboundPacer } from "./outbound-pacer.js";
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
  pacer?: OutboundPacer;
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

export interface OutboundDeliveryReport {
  outboundMessageId: string;
  status: "sent" | "failed";
  externalMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
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

    const reports = await sendOutboundMessagesViaOneTalk({ chromeApi: options.chromeApi, messages, pacer: options.pacer });
    for (const report of reports) {
      await options.markOutboundMessageDelivered({
        serverUrl: config.serverUrl,
        collectorToken: config.collectorToken,
        outboundMessageId: report.outboundMessageId,
        status: report.status,
        externalMessageId: report.externalMessageId,
        errorCode: report.errorCode,
        errorMessage: report.errorMessage,
        deliveredAt: new Date().toISOString()
      });
      if (report.status === "sent") sentCount += 1;
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

export async function sendOutboundMessagesViaOneTalk(options: {
  chromeApi: ChromeApi;
  messages: OutboundMessage[];
  pacer?: OutboundPacer;
}): Promise<OutboundDeliveryReport[]> {
  const pacer = options.pacer ?? new OutboundPacer();
  pacer.beginBatch();
  const reports: OutboundDeliveryReport[] = [];
  for (const message of options.messages) {
    // Pace sends so the cadence does not look automated. On defer (rate cap or
    // batch budget), stop here — undelivered messages have no report, so they
    // stay queued and are retried on the next delivery cycle.
    const decision = pacer.next();
    if (decision.kind === "defer") break;
    await pacer.waitAndRecord(decision.waitMs);

    const result = await sendViaOneTalkTab(options.chromeApi, message);
    if (result.ok) {
      const report: OutboundDeliveryReport = {
        outboundMessageId: message.id,
        status: "sent"
      };
      if (result.externalMessageId) report.externalMessageId = result.externalMessageId;
      reports.push(report);
    } else {
      reports.push({
        outboundMessageId: message.id,
        status: "failed",
        errorCode: result.error || "onetalk_send_failed",
        errorMessage: result.error || "OneTalk send failed"
      });
    }
  }
  return reports;
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
