import type { ChromeStorageArea } from "../shared/chrome-api.js";

// Buffers OneTalk messages observed passively from the page socket, keyed by
// conversation id, until the next sync drains them into an upload batch.
//
// The service worker can be evicted at any time, so the buffer is persisted to
// chrome.storage.local. Writes are debounced to avoid thrashing storage on
// bursty message traffic.

const BUFFER_KEY = "tradebridgeObservedMessages";
const DEFAULT_MAX_MESSAGES_PER_CONVERSATION = 500;
const DEFAULT_MAX_CONVERSATIONS = 200;

interface BufferShape {
  byConversationId: Record<string, Record<string, unknown>[]>;
}

export interface OneTalkMessageBufferOptions {
  maxMessagesPerConversation?: number;
  maxConversations?: number;
}

export class OneTalkMessageBuffer {
  private cache: BufferShape | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly maxPerConversation: number;
  private readonly maxConversations: number;

  constructor(
    private readonly storage: ChromeStorageArea,
    options: OneTalkMessageBufferOptions = {}
  ) {
    this.maxPerConversation = options.maxMessagesPerConversation ?? DEFAULT_MAX_MESSAGES_PER_CONVERSATION;
    this.maxConversations = options.maxConversations ?? DEFAULT_MAX_CONVERSATIONS;
  }

  // The service worker can be evicted at any time, so each add() persists
  // write-through. Writes are serialized to coalesce bursty traffic safely.
  async add(externalConversationId: string, messages: Record<string, unknown>[]): Promise<void> {
    if (!externalConversationId || !messages.length) return;
    const buffer = await this.load();
    const existing = buffer.byConversationId[externalConversationId] || [];
    const merged = dedupeMessages([...existing, ...messages]);
    const trimmed = merged.length > this.maxPerConversation ? merged.slice(merged.length - this.maxPerConversation) : merged;
    buffer.byConversationId[externalConversationId] = trimmed;
    this.evictConversations(buffer);
    await this.flush();
  }

  // Returns the buffered messages without clearing them. Sync maps these into a
  // batch; messages are only removed by drain() after a confirmed upload.
  async read(): Promise<Record<string, Record<string, unknown>[]>> {
    const buffer = await this.load();
    return cloneByConversationId(buffer.byConversationId);
  }

  async drain(): Promise<Record<string, Record<string, unknown>[]>> {
    const buffer = await this.load();
    const snapshot = cloneByConversationId(buffer.byConversationId);
    buffer.byConversationId = {};
    await this.flush();
    return snapshot;
  }

  private evictConversations(buffer: BufferShape): void {
    const ids = Object.keys(buffer.byConversationId);
    if (ids.length <= this.maxConversations) return;
    // Drop the oldest-inserted conversations (insertion order is preserved by
    // object key order) until back under the cap.
    for (const id of ids.slice(0, ids.length - this.maxConversations)) {
      delete buffer.byConversationId[id];
    }
  }

  private async load(): Promise<BufferShape> {
    if (this.cache) return this.cache;
    const data = await this.storage.get(BUFFER_KEY);
    this.cache = normalizeBuffer(data[BUFFER_KEY]);
    return this.cache;
  }

  private flush(): Promise<void> {
    const buffer = this.cache;
    if (!buffer) return Promise.resolve();
    this.writeChain = this.writeChain.then(() => this.storage.set({ [BUFFER_KEY]: buffer })).catch(() => undefined);
    return this.writeChain;
  }
}

function dedupeMessages(messages: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const output: Record<string, unknown>[] = [];
  for (const message of messages) {
    const id = messageId(message);
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    output.push(message);
  }
  return output;
}

function messageId(message: Record<string, unknown>): string | undefined {
  const body = isRecord(message.message) ? message.message : message;
  for (const key of ["messageId", "msgId", "messageID", "msgIdStr", "uuid", "id"]) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function normalizeBuffer(value: unknown): BufferShape {
  if (!isRecord(value) || !isRecord(value.byConversationId)) return { byConversationId: {} };
  const byConversationId: Record<string, Record<string, unknown>[]> = {};
  for (const [key, list] of Object.entries(value.byConversationId)) {
    if (Array.isArray(list)) byConversationId[key] = list.filter(isRecord);
  }
  return { byConversationId };
}

function cloneByConversationId(
  source: Record<string, Record<string, unknown>[]>
): Record<string, Record<string, unknown>[]> {
  const output: Record<string, Record<string, unknown>[]> = {};
  for (const [key, list] of Object.entries(source)) {
    output[key] = list.slice();
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
