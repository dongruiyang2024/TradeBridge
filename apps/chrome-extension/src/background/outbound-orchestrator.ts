import {
  defaultBrowserChannelAdapters,
  findBrowserChannelAdapter,
  oneTalkBrowserChannelAdapter,
  type BrowserChannelAdapter
} from "./browser-channel-adapters.js";
import { OutboundPacer } from "./outbound-pacer.js";
import { validateConfig } from "./storage.js";
import type { ChromeApi } from "../shared/chrome-api.js";
import type { ExtensionConfig, ExtensionStatus, OutboundMessage } from "../shared/sync-types.js";

const LEGACY_DEFAULT_CHANNEL = "alibaba-im";

export interface OutboundStateStore {
  getConfig(): Promise<ExtensionConfig | null>;
  getStatus(): Promise<ExtensionStatus>;
  saveStatus(status: ExtensionStatus): Promise<void>;
}

export interface RunOutboundDeliveryOptions {
  stateStore: OutboundStateStore;
  chromeApi: ChromeApi;
  pacer?: OutboundPacer;
  adapters?: readonly BrowserChannelAdapter[];
  listOutboundMessages(options: {
    serverUrl: string;
    collectorToken: string;
    channel?: string;
    channelAccountExternalId?: string;
  }): Promise<OutboundMessage[]>;
  markOutboundMessageDelivered(options: {
    serverUrl: string;
    collectorToken: string;
    outboundMessageId: string;
    channel?: string;
    channelAccountExternalId?: string;
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
  channel?: string;
  channelAccountExternalId?: string;
  externalMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export async function runOutboundDelivery(options: RunOutboundDeliveryOptions): Promise<RunOutboundDeliveryResult> {
  const previousStatus = await options.stateStore.getStatus();

  try {
    const config = await options.stateStore.getConfig();
    validateConfig(config);

    const adapters = options.adapters ?? defaultBrowserChannelAdapters;
    let sentCount = 0;
    let failedCount = 0;

    for (const adapter of adapters) {
      const account = adapter.channelAccount(config);
      const messages = await options.listOutboundMessages({
        serverUrl: config.serverUrl,
        collectorToken: config.collectorToken,
        channel: account.channel,
        channelAccountExternalId: account.externalAccountId
      });

      const reports = await sendOutboundMessagesViaBrowserChannels({
        chromeApi: options.chromeApi,
        messages,
        pacer: options.pacer,
        adapters: [adapter]
      });
      for (const report of reports) {
        await options.markOutboundMessageDelivered({
          serverUrl: config.serverUrl,
          collectorToken: config.collectorToken,
          outboundMessageId: report.outboundMessageId,
          channel: report.channel,
          channelAccountExternalId: report.channelAccountExternalId,
          status: report.status,
          externalMessageId: report.externalMessageId,
          errorCode: report.errorCode,
          errorMessage: report.errorMessage,
          deliveredAt: new Date().toISOString()
        });
        if (report.status === "sent") sentCount += 1;
        else failedCount += 1;
      }
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
  return sendOutboundMessagesViaBrowserChannels({
    ...options,
    adapters: [oneTalkBrowserChannelAdapter]
  });
}

export async function sendOutboundMessagesViaBrowserChannels(options: {
  chromeApi: ChromeApi;
  messages: OutboundMessage[];
  pacer?: OutboundPacer;
  adapters?: readonly BrowserChannelAdapter[];
}): Promise<OutboundDeliveryReport[]> {
  const pacer = options.pacer ?? new OutboundPacer();
  const adapters = options.adapters ?? defaultBrowserChannelAdapters;
  pacer.beginBatch();
  const reports: OutboundDeliveryReport[] = [];
  for (const message of options.messages) {
    // Pace sends so the cadence does not look automated. On defer (rate cap or
    // batch budget), stop here — undelivered messages have no report, so they
    // stay queued and are retried on the next delivery cycle.
    const decision = pacer.next();
    if (decision.kind === "defer") break;
    await pacer.waitAndRecord(decision.waitMs);

    const channel = message.channel || LEGACY_DEFAULT_CHANNEL;
    const adapter = findBrowserChannelAdapter(channel, adapters);
    if (!adapter) {
      reports.push({
        outboundMessageId: message.id,
        status: "failed",
        channel: message.channel,
        channelAccountExternalId: message.channelAccountExternalId,
        errorCode: "channel_not_supported_by_collector",
        errorMessage: "Channel not supported by collector"
      });
      continue;
    }

    const result = await adapter.send(options.chromeApi, message);
    const scope = {
      channel,
      ...(message.channelAccountExternalId ? { channelAccountExternalId: message.channelAccountExternalId } : {})
    };
    if (result.ok) {
      const report: OutboundDeliveryReport = {
        outboundMessageId: message.id,
        status: "sent",
        ...scope
      };
      if (result.externalMessageId) report.externalMessageId = result.externalMessageId;
      reports.push(report);
    } else {
      reports.push({
        outboundMessageId: message.id,
        status: "failed",
        ...scope,
        errorCode: result.error || "channel_send_failed",
        errorMessage: result.error || "Channel send failed"
      });
    }
  }
  return reports;
}
