import { sendMessageToAllOneTalkTabs } from "./onetalk-tab-messaging.js";
import type { ChromeApi } from "../shared/chrome-api.js";

export interface OneTalkConversationPage {
  conversations: Record<string, unknown>[];
  nextCursor?: string | number;
  hasMore: boolean;
}

export interface RequestOneTalkConversationsOptions {
  chromeApi: ChromeApi;
  cursor: number;
  count: number;
}

export async function requestOneTalkConversations(
  options: RequestOneTalkConversationsOptions
): Promise<OneTalkConversationPage> {
  const responses = await sendMessageToAllOneTalkTabs(options.chromeApi, {
    type: "get-onetalk-conversations",
    cursor: options.cursor,
    count: options.count
  });
  for (const response of responses) {
    const page = conversationsFromResponse(response);
    if (page) return page;
  }
  return { conversations: [], hasMore: false };
}

function conversationsFromResponse(response: unknown): OneTalkConversationPage | null {
  if (!isRecord(response) || response.ok !== true || !Array.isArray(response.conversations)) return null;
  return {
    conversations: response.conversations.filter(isRecord),
    nextCursor: cursorValue(response.nextCursor),
    hasMore: response.hasMore === true
  };
}

function cursorValue(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
