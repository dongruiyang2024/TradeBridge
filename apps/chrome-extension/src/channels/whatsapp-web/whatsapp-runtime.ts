export interface WhatsAppRuntimeMessage {
  id?: string;
  chatId?: string;
  fromMe?: boolean;
  timestamp?: number | string | Date;
  body?: string;
  type?: string;
}

export interface WhatsAppRuntime {
  getAccountId?(): string | null | undefined;
  getLoadedMessages?(): WhatsAppRuntimeMessage[];
  onMessage?(listener: (message: WhatsAppRuntimeMessage) => void): () => void;
  sendText?(input: { chatId: string; text: string }): Promise<{ id?: string } | string | void> | { id?: string } | string | void;
}

export interface WhatsAppRuntimeWindow extends Window {
  __tradeBridgeWhatsAppRuntime?: WhatsAppRuntime;
}

export function resolveWhatsAppRuntime(win: Window): WhatsAppRuntime | null {
  const runtime = (win as WhatsAppRuntimeWindow).__tradeBridgeWhatsAppRuntime;
  return runtime && typeof runtime === "object" ? runtime : null;
}

export function sanitizeRuntimeMessage(message: WhatsAppRuntimeMessage): Record<string, unknown> | null {
  const externalConversationId = stringValue(message.chatId);
  const content = stringValue(message.body);
  if (!externalConversationId || !content) return null;
  return {
    externalConversationId,
    externalCustomerId: externalConversationId,
    externalMessageId: stringValue(message.id),
    direction: message.fromMe === true ? "sent" : "received",
    messageType: stringValue(message.type) || "text",
    content,
    sentAt: isoTimestamp(message.timestamp),
    rawSanitized: {
      hasId: Boolean(message.id),
      hasTimestamp: Boolean(message.timestamp),
      type: stringValue(message.type) || "text"
    }
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isoTimestamp(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  if (typeof value === "string" && value.trim()) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
  }
  return undefined;
}
