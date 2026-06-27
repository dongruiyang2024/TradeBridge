import { sendMessageToOneTalkTab } from "./onetalk-tab-messaging.js";
import type { ChromeApi } from "../shared/chrome-api.js";
import type { ExtensionConfig, OutboundMessage } from "../shared/sync-types.js";

const ONE_TALK_CHANNEL = "alibaba-im";
const ONE_TALK_SURFACE = "onetalk-web";

export interface BrowserChannelAccount {
  channel: string;
  externalAccountId: string;
  displayName?: string;
  surface?: string;
}

export interface BrowserChannelSendResponse {
  ok: boolean;
  externalMessageId?: string;
  error?: string;
}

export interface BrowserChannelAdapter {
  channel: string;
  surface: string;
  channelAccount(config: ExtensionConfig): BrowserChannelAccount;
  send(chromeApi: ChromeApi, message: OutboundMessage): Promise<BrowserChannelSendResponse>;
}

export const oneTalkBrowserChannelAdapter: BrowserChannelAdapter = {
  channel: ONE_TALK_CHANNEL,
  surface: ONE_TALK_SURFACE,
  channelAccount(config) {
    return {
      channel: ONE_TALK_CHANNEL,
      externalAccountId: config.channelAccountExternalId || config.sellerAccountExternalId,
      surface: ONE_TALK_SURFACE
    };
  },
  async send(chromeApi, message) {
    try {
      const response = await sendMessageToOneTalkTab(chromeApi, {
        type: "send-onetalk-message",
        message
      });
      return isBrowserChannelSendResponse(response)
        ? response
        : { ok: false, error: "onetalk_send_response_invalid" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "onetalk_send_failed" };
    }
  }
};

export const defaultBrowserChannelAdapters: readonly BrowserChannelAdapter[] = [oneTalkBrowserChannelAdapter];

export function browserChannelAccounts(
  config: ExtensionConfig,
  adapters: readonly BrowserChannelAdapter[] = defaultBrowserChannelAdapters
): BrowserChannelAccount[] {
  return adapters.map((adapter) => adapter.channelAccount(config));
}

export function browserChannelCapabilities(
  adapters: readonly BrowserChannelAdapter[] = defaultBrowserChannelAdapters
): string[] {
  return Array.from(new Set(adapters.map((adapter) => `channel:${adapter.channel}`)));
}

export function findBrowserChannelAdapter(
  channel: string,
  adapters: readonly BrowserChannelAdapter[] = defaultBrowserChannelAdapters
): BrowserChannelAdapter | null {
  return adapters.find((adapter) => adapter.channel === channel) || null;
}

function isBrowserChannelSendResponse(value: unknown): value is BrowserChannelSendResponse {
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
