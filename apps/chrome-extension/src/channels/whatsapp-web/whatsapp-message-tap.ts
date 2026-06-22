import { resolveWhatsAppRuntime, sanitizeRuntimeMessage, type WhatsAppRuntimeMessage } from "./whatsapp-runtime.js";

interface TapWindow extends Window {
  __tradeBridgeWhatsAppTapInstalled?: boolean;
}

const PAGE_SOURCE = "tradebridge-whatsapp-web-page";

export function installWhatsAppMessageTap(win: Window): void {
  const tapWindow = win as TapWindow;
  if (tapWindow.__tradeBridgeWhatsAppTapInstalled) return;
  tapWindow.__tradeBridgeWhatsAppTapInstalled = true;

  const runtime = resolveWhatsAppRuntime(win);
  if (!runtime) {
    postPageMessage(win, { type: "whatsapp-web-runtime-unavailable", error: "whatsapp_web_runtime_unavailable" });
    return;
  }

  const accountId = runtime.getAccountId?.();
  if (accountId) {
    postPageMessage(win, { type: "whatsapp-web-account-observed", accountId });
  }

  const loadedMessages = runtime.getLoadedMessages?.() || [];
  emitMessages(win, loadedMessages);

  runtime.onMessage?.((message) => emitMessages(win, [message]));
}

export function emitMessages(win: Window, messages: unknown[]): void {
  const sanitized = messages.map((message) => sanitizeRuntimeMessage(message as WhatsAppRuntimeMessage)).filter(isRecord);
  const byConversation = new Map<string, Record<string, unknown>[]>();
  for (const message of sanitized) {
    const externalConversationId = typeof message.externalConversationId === "string" ? message.externalConversationId : "";
    if (!externalConversationId) continue;
    const current = byConversation.get(externalConversationId) || [];
    current.push(message);
    byConversation.set(externalConversationId, current);
  }
  for (const [externalConversationId, conversationMessages] of byConversation.entries()) {
    postPageMessage(win, {
      type: "whatsapp-web-messages-observed",
      externalConversationId,
      messages: conversationMessages
    });
  }
}

function postPageMessage(win: Window, payload: Record<string, unknown>): void {
  win.postMessage({ source: PAGE_SOURCE, ...payload }, win.location.origin);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
