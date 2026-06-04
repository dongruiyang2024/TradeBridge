import { requestCustomerProfilesFromPageRuntime } from "./onetalk-customer-profile.js";
import { requestConversationsFromPageRuntime } from "./onetalk-conversation.js";
import { installOneTalkMessageTap } from "./onetalk-message-tap.js";
import type { OneTalkCustomerProfileContact } from "../../shared/extension-messages.js";
import type { OutboundMessage } from "../../shared/sync-types.js";

interface PageBridgeWindow extends Window {
  IcbuIM?: {
    IMBaaSSDK?: {
      default?: {
        getMessageService?: () => OneTalkMessageService;
      };
    };
  };
  __tradeBridgeOneTalkPageBridgeInstalled?: boolean;
}

interface OneTalkMessageService {
  sendUIMessages?: (payload: unknown) => Promise<unknown> | unknown;
  sendMessage?: (payload: unknown) => Promise<unknown> | unknown;
  send?: (payload: unknown) => Promise<unknown> | unknown;
}

const pageWindow = window as PageBridgeWindow;

if (!pageWindow.__tradeBridgeOneTalkPageBridgeInstalled) {
  pageWindow.__tradeBridgeOneTalkPageBridgeInstalled = true;
  installOneTalkMessageTap(window);
  window.addEventListener("message", (event) => {
    if (event.source !== window || !isRecord(event.data)) return;
    if (event.data.source !== "tradebridge-extension") return;
    if (event.data.type === "send-onetalk-message") {
      void handleSendRequest(event.data);
      return;
    }
    if (event.data.type === "get-onetalk-customer-profiles") {
      void handleCustomerProfilesRequest(event.data);
      return;
    }
    if (event.data.type === "get-onetalk-conversations") {
      void handleConversationsRequest(event.data);
    }
  });
}

async function handleSendRequest(data: Record<string, unknown>): Promise<void> {
  const requestId = typeof data.requestId === "string" ? data.requestId : "";
  const message = data.message;
  if (!requestId || !isOutboundMessage(message)) {
    publishResult(requestId, false, undefined, "invalid_outbound_message");
    return;
  }

  try {
    const result = await sendTextMessage(message);
    publishResult(requestId, true, externalMessageIdFromResult(result));
  } catch (error) {
    publishResult(requestId, false, undefined, error instanceof Error ? error.message : "onetalk_send_failed");
  }
}

async function handleCustomerProfilesRequest(data: Record<string, unknown>): Promise<void> {
  const requestId = typeof data.requestId === "string" ? data.requestId : "";
  const contacts = Array.isArray(data.contacts) ? data.contacts.filter(isCustomerProfileContact) : [];
  if (!requestId || !contacts.length) {
    publishCustomerProfilesResult(requestId, false, [], "invalid_customer_profile_request");
    return;
  }

  try {
    const profiles = await requestCustomerProfilesFromPageRuntime(pageWindow, contacts);
    publishCustomerProfilesResult(requestId, true, profiles);
  } catch (error) {
    publishCustomerProfilesResult(
      requestId,
      false,
      [],
      error instanceof Error ? error.message : "onetalk_customer_profile_failed"
    );
  }
}

async function handleConversationsRequest(data: Record<string, unknown>): Promise<void> {
  const requestId = typeof data.requestId === "string" ? data.requestId : "";
  const cursor = numericValue(data.cursor) || Date.now();
  const count = numericValue(data.count) || 20;
  if (!requestId) {
    publishConversationsResult(requestId, false, [], undefined, false, "invalid_conversation_request");
    return;
  }

  try {
    const page = await requestConversationsFromPageRuntime(pageWindow, { cursor, count });
    publishConversationsResult(requestId, true, page.conversations, page.nextCursor, page.hasMore);
  } catch (error) {
    publishConversationsResult(
      requestId,
      false,
      [],
      undefined,
      false,
      error instanceof Error ? error.message : "onetalk_conversation_fetch_failed"
    );
  }
}

function publishCustomerProfilesResult(
  requestId: string,
  ok: boolean,
  profiles: Record<string, unknown>[],
  error?: string
): void {
  window.postMessage(
    {
      source: "tradebridge-onetalk-page",
      type: "get-onetalk-customer-profiles-result",
      requestId,
      ok,
      profiles,
      error
    },
    window.location.origin
  );
}

function publishConversationsResult(
  requestId: string,
  ok: boolean,
  conversations: Record<string, unknown>[],
  nextCursor?: string | number,
  hasMore = false,
  error?: string
): void {
  window.postMessage(
    {
      source: "tradebridge-onetalk-page",
      type: "get-onetalk-conversations-result",
      requestId,
      ok,
      conversations,
      nextCursor,
      hasMore,
      error
    },
    window.location.origin
  );
}

async function sendTextMessage(message: OutboundMessage): Promise<unknown> {
  const messageService = pageWindow.IcbuIM?.IMBaaSSDK?.default?.getMessageService?.();
  const send =
    messageService?.sendUIMessages?.bind(messageService) ||
    messageService?.sendMessage?.bind(messageService) ||
    messageService?.send?.bind(messageService);
  if (!send) throw new Error("onetalk_send_unavailable");

  // Send only the fields a native OneTalk message carries. Do NOT attach any
  // custom ext marker — it would travel upstream and identify the message as
  // tool-sent. Receipt reconciliation uses the background-side request id
  // (message.id) paired with the returned external message id, not the payload.
  return send({
    conversationCode: message.externalConversationId,
    cid: message.externalConversationId,
    content: message.content,
    text: message.content,
    messageType: "text"
  });
}

function publishResult(requestId: string, ok: boolean, externalMessageId?: string, error?: string): void {
  window.postMessage(
    {
      source: "tradebridge-onetalk-page",
      type: "send-onetalk-message-result",
      requestId,
      ok,
      externalMessageId,
      error
    },
    window.location.origin
  );
}

function externalMessageIdFromResult(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return firstString(value, ["messageId", "msgId", "id", "externalMessageId", "clientMessageId"]);
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function isOutboundMessage(value: unknown): value is OutboundMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.externalConversationId === "string" &&
    typeof value.content === "string" &&
    value.content.trim().length > 0
  );
}

function isCustomerProfileContact(value: unknown): value is OneTalkCustomerProfileContact {
  return (
    isRecord(value) &&
    typeof value.buyerAccountId === "string" &&
    value.buyerAccountId.trim().length > 0 &&
    (value.buyerLoginId === undefined || typeof value.buyerLoginId === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
