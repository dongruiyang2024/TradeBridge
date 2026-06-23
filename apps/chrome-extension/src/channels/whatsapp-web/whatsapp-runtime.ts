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
  if (runtime && typeof runtime === "object") return runtime;
  return resolveStoreRuntime((win as unknown as { Store?: unknown }).Store);
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

function resolveStoreRuntime(storeValue: unknown): WhatsAppRuntime | null {
  if (!isRecord(storeValue)) return null;
  const messageStore = isRecord(storeValue.Msg) ? storeValue.Msg : null;
  const sendText = functionField(storeValue, "SendTextMsgToChat") || functionField(storeValue, "sendTextMsgToChat");
  const runtime: WhatsAppRuntime = {};

  const accountId = serializedId(readPath(storeValue, ["Conn", "wid"])) || stringValue(readPath(storeValue, ["Conn", "me"]));
  if (accountId) runtime.getAccountId = () => accountId;

  const loadedMessages = messageStore ? storeMessages(messageStore) : [];
  if (messageStore) {
    runtime.getLoadedMessages = () => loadedMessages.map(normalizeStoreMessage).filter(isRuntimeMessage);
  }

  const onMessage = messageStore ? functionField(messageStore, "on") : null;
  if (messageStore && onMessage) {
    runtime.onMessage = (listener) => {
      const wrapped = (message: unknown) => {
        const normalized = normalizeStoreMessage(message);
        if (normalized) listener(normalized);
      };
      const unsubscribe = onMessage.call(messageStore, "add", wrapped);
      return () => {
        if (typeof unsubscribe === "function") {
          unsubscribe();
          return;
        }
        functionField(messageStore, "off")?.call(messageStore, "add", wrapped);
      };
    };
  }

  if (sendText) {
    runtime.sendText = async ({ chatId, text }) => {
      const chat = resolveStoreChat(storeValue, chatId) || chatId;
      const result = await sendText.call(storeValue, chat, text);
      const id = serializedId(isRecord(result) ? result.id : result);
      return id ? { id } : (result as { id?: string } | string | void);
    };
  }

  return Object.keys(runtime).length ? runtime : null;
}

function storeMessages(messageStore: Record<string, unknown>): unknown[] {
  if (Array.isArray(messageStore.models)) return messageStore.models;
  const toArray = functionField(messageStore, "toArray");
  if (toArray) {
    const result = toArray.call(messageStore);
    if (Array.isArray(result)) return result;
  }
  const getModelsArray = functionField(messageStore, "getModelsArray");
  if (getModelsArray) {
    const result = getModelsArray.call(messageStore);
    if (Array.isArray(result)) return result;
  }
  return [];
}

function resolveStoreChat(store: Record<string, unknown>, chatId: string): unknown {
  const chatStore = isRecord(store.Chat) ? store.Chat : null;
  const get = chatStore ? functionField(chatStore, "get") : null;
  return get ? get.call(chatStore, chatId) : null;
}

function normalizeStoreMessage(message: unknown): WhatsAppRuntimeMessage | null {
  if (!isRecord(message)) return null;
  const id = serializedId(message.id);
  const chatId =
    serializedId(message.chatId) ||
    serializedId(readPath(message, ["chat", "id"])) ||
    serializedId(readPath(message, ["id", "remote"])) ||
    stringValue(message.chatId);
  const body =
    stringValue(message.body) ||
    stringValue(message.caption) ||
    stringValue(message.text) ||
    stringValue(message.content);
  if (!chatId || !body) return null;
  return {
    id,
    chatId,
    fromMe: message.fromMe === true,
    timestamp: runtimeTimestamp(message.timestamp || message.t || message.time),
    body,
    type: stringValue(message.type) || "text"
  };
}

function isRuntimeMessage(value: WhatsAppRuntimeMessage | null): value is WhatsAppRuntimeMessage {
  return value !== null;
}

function serializedId(value: unknown): string | undefined {
  if (typeof value === "string") return stringValue(value);
  if (!isRecord(value)) return undefined;
  return (
    stringValue(value._serialized) ||
    stringValue(value.serialized) ||
    stringValue(value.id) ||
    stringValue(value.user)
  );
}

function runtimeTimestamp(value: unknown): WhatsAppRuntimeMessage["timestamp"] {
  return typeof value === "string" || typeof value === "number" || value instanceof Date ? value : undefined;
}

function readPath(source: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function functionField(source: Record<string, unknown>, field: string): ((...args: unknown[]) => unknown) | null {
  const value = source[field];
  return typeof value === "function" ? value as (...args: unknown[]) => unknown : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
