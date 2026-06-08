import { requestOneTalkHistoryMessages } from "./onetalk-history-message-client.js";
import type { ChromeApi } from "../shared/chrome-api.js";

export interface OneTalkHistoryMessageSourceOptions {
  chromeApi: ChromeApi;
  count?: number;
}

export class OneTalkHistoryMessageSource {
  constructor(private readonly options: OneTalkHistoryMessageSourceOptions) {}

  async read(conversations: Record<string, unknown>[]): Promise<Record<string, Record<string, unknown>[]>> {
    try {
      return await requestOneTalkHistoryMessages({
        chromeApi: this.options.chromeApi,
        conversations,
        count: this.options.count ?? 20
      });
    } catch {
      // Historical backfill is best-effort. Realtime tapped messages must keep
      // syncing even if OneTalk's history SDK rejects a request shape.
      return {};
    }
  }
}
