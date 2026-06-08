import { sendMessageToAllOneTalkTabs } from "./onetalk-tab-messaging.js";
import type { ChromeApi } from "../shared/chrome-api.js";

export interface RequestOneTalkHistoryMessagesOptions {
  chromeApi: ChromeApi;
  conversations: Record<string, unknown>[];
  count: number;
}

export async function requestOneTalkHistoryMessages(
  options: RequestOneTalkHistoryMessagesOptions
): Promise<Record<string, Record<string, unknown>[]>> {
  if (!options.conversations.length) return {};
  const responses = await sendMessageToAllOneTalkTabs(options.chromeApi, {
    type: "get-onetalk-history-messages",
    conversations: options.conversations,
    count: options.count
  });
  for (const response of responses) {
    const messages = messagesFromResponse(response);
    if (messages) return messages;
  }
  return {};
}

function messagesFromResponse(response: unknown): Record<string, Record<string, unknown>[]> | null {
  if (!isRecord(response) || response.ok !== true || !isRecord(response.messagesByConversationId)) return null;
  const output: Record<string, Record<string, unknown>[]> = {};
  for (const [conversationId, messages] of Object.entries(response.messagesByConversationId)) {
    if (Array.isArray(messages)) output[conversationId] = messages.filter(isRecord);
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
