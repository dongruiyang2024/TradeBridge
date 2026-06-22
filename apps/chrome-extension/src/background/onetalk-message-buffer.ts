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
  storageKey?: string;
  maxMessagesPerConversation?: number;
  maxConversations?: number;
}

export class OneTalkMessageBuffer {
  private cache: BufferShape | null = null;
  private loadPromise: Promise<BufferShape> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly storageKey: string;
  private readonly maxPerConversation: number;
  private readonly maxConversations: number;

  constructor(
    private readonly storage: ChromeStorageArea,
    options: OneTalkMessageBufferOptions = {}
  ) {
    this.storageKey = options.storageKey ?? BUFFER_KEY;
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

  // Returns the buffered messages without clearing them. Sync uploads this
  // snapshot, then calls acknowledge() with it on success.
  async read(): Promise<Record<string, Record<string, unknown>[]>> {
    const buffer = await this.load();
    return cloneByConversationId(buffer.byConversationId);
  }

  // Remove exactly the messages that were successfully uploaded (matched by
  // message id), leaving any messages that arrived after the read snapshot and
  // anything that could not be id-matched. Called only after a confirmed
  // upload, so a failed upload keeps everything buffered for retry.
  async acknowledge(uploaded: Record<string, Record<string, unknown>[]>): Promise<void> {
    const buffer = await this.load();
    let changed = false;
    for (const [conversationId, uploadedMessages] of Object.entries(uploaded)) {
      const current = buffer.byConversationId[conversationId];
      if (!current || !uploadedMessages.length) continue;
      const uploadedIds = new Set<string>();
      for (const message of uploadedMessages) {
        const id = messageId(message);
        if (id) uploadedIds.add(id);
      }
      if (!uploadedIds.size) continue;
      const remaining = current.filter((message) => {
        const id = messageId(message);
        return !id || !uploadedIds.has(id);
      });
      if (remaining.length === current.length) continue;
      changed = true;
      if (remaining.length) buffer.byConversationId[conversationId] = remaining;
      else delete buffer.byConversationId[conversationId];
    }
    if (changed) await this.flush();
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

  // Concurrent callers share a single in-flight storage.get so a cold start
  // (cache null) cannot trigger two parallel loads that overwrite each other.
  private load(): Promise<BufferShape> {
    if (this.cache) return Promise.resolve(this.cache);
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.storage
      .get(this.storageKey)
      .then((data) => {
        if (!this.cache) this.cache = normalizeBuffer(data[this.storageKey]);
        return this.cache;
      })
      .finally(() => {
        this.loadPromise = null;
      });
    return this.loadPromise;
  }

  private flush(): Promise<void> {
    const buffer = this.cache;
    if (!buffer) return Promise.resolve();
    this.writeChain = this.writeChain.then(() => this.storage.set({ [this.storageKey]: buffer })).catch(() => undefined);
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
