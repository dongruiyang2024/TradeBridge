import { requestOneTalkHistoryMessages } from "./onetalk-history-message-client.js";
import type { ChromeApi } from "../shared/chrome-api.js";
import type { ExtensionConfig } from "../shared/sync-types.js";

const DEFAULT_HISTORY_MESSAGES_PER_CONVERSATION = 20;
const MAX_HISTORY_MESSAGES_PER_CONVERSATION = 100;

export interface RequestHistoryMessagesOptions {
  chromeApi: ChromeApi;
  conversations: Record<string, unknown>[];
  count: number;
}

export interface OneTalkHistoryMessageSourceOptions {
  chromeApi: ChromeApi;
  count?: number;
  requestHistoryMessages?: (
    options: RequestHistoryMessagesOptions
  ) => Promise<Record<string, Record<string, unknown>[]>>;
}

export class OneTalkHistoryMessageSource {
  constructor(private readonly options: OneTalkHistoryMessageSourceOptions) {}

  async read(
    conversations: Record<string, unknown>[],
    config?: ExtensionConfig
  ): Promise<Record<string, Record<string, unknown>[]>> {
    if (config?.historyBackfillEnabled === false) return {};
    try {
      const requestHistoryMessages = this.options.requestHistoryMessages || requestOneTalkHistoryMessages;
      return await requestHistoryMessages({
        chromeApi: this.options.chromeApi,
        conversations,
        count: historyMessageCount(config, this.options.count)
      });
    } catch {
      // Historical backfill is best-effort. Realtime tapped messages must keep
      // syncing even if OneTalk's history SDK rejects a request shape.
      return {};
    }
  }
}

function historyMessageCount(config: ExtensionConfig | undefined, fallback: number | undefined): number {
  const configured = config?.historyMessagesPerConversation ?? fallback ?? DEFAULT_HISTORY_MESSAGES_PER_CONVERSATION;
  if (!Number.isFinite(configured)) return DEFAULT_HISTORY_MESSAGES_PER_CONVERSATION;
  return Math.min(MAX_HISTORY_MESSAGES_PER_CONVERSATION, Math.max(1, Math.trunc(configured)));
}
