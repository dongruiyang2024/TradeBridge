import assert from "node:assert/strict";
import { test } from "node:test";
import { OneTalkMessageBuffer } from "../src/background/onetalk-message-buffer.js";
import type { ChromeStorageArea } from "../src/shared/chrome-api.js";

class MemoryStorage implements ChromeStorageArea {
  store: Record<string, unknown> = {};
  async get(keys?: string[] | Record<string, unknown> | string | null) {
    if (typeof keys === "string") return { [keys]: this.store[keys] };
    return { ...this.store };
  }
  async set(items: Record<string, unknown>) {
    Object.assign(this.store, items);
  }
}

test("OneTalkMessageBuffer accumulates messages by conversation and reads them back", async () => {
  const storage = new MemoryStorage();
  const buffer = new OneTalkMessageBuffer(storage);

  await buffer.add("conv-1", [{ message: { messageId: "m1", content: "a" } }]);
  await buffer.add("conv-1", [{ message: { messageId: "m2", content: "b" } }]);
  await buffer.add("conv-2", [{ message: { messageId: "m3", content: "c" } }]);

  const read = await buffer.read();
  assert.equal(read["conv-1"].length, 2);
  assert.equal(read["conv-2"].length, 1);
});

test("OneTalkMessageBuffer dedupes by message id", async () => {
  const storage = new MemoryStorage();
  const buffer = new OneTalkMessageBuffer(storage);

  await buffer.add("conv-1", [{ message: { messageId: "dup", content: "a" } }]);
  await buffer.add("conv-1", [{ message: { messageId: "dup", content: "a-again" } }]);

  const read = await buffer.read();
  assert.equal(read["conv-1"].length, 1);
});

test("OneTalkMessageBuffer caps messages per conversation, keeping the newest", async () => {
  const storage = new MemoryStorage();
  const buffer = new OneTalkMessageBuffer(storage, { maxMessagesPerConversation: 3 });

  for (let i = 0; i < 6; i += 1) {
    await buffer.add("conv-1", [{ message: { messageId: `m${i}`, content: String(i) } }]);
  }

  const read = await buffer.read();
  const ids = read["conv-1"].map((m) => (m.message as { messageId: string }).messageId);
  assert.deepEqual(ids, ["m3", "m4", "m5"]);
});

test("OneTalkMessageBuffer caps number of conversations, evicting the oldest", async () => {
  const storage = new MemoryStorage();
  const buffer = new OneTalkMessageBuffer(storage, { maxConversations: 2 });

  await buffer.add("conv-1", [{ message: { messageId: "m1" } }]);
  await buffer.add("conv-2", [{ message: { messageId: "m2" } }]);
  await buffer.add("conv-3", [{ message: { messageId: "m3" } }]);

  const read = await buffer.read();
  assert.deepEqual(Object.keys(read).sort(), ["conv-2", "conv-3"]);
});

test("OneTalkMessageBuffer drain returns and clears the buffer", async () => {
  const storage = new MemoryStorage();
  const buffer = new OneTalkMessageBuffer(storage);

  await buffer.add("conv-1", [{ message: { messageId: "m1" } }]);
  const drained = await buffer.drain();
  assert.equal(drained["conv-1"].length, 1);

  const afterDrain = await buffer.read();
  assert.deepEqual(afterDrain, {});
});

test("OneTalkMessageBuffer persists across instances via storage", async () => {
  const storage = new MemoryStorage();
  const first = new OneTalkMessageBuffer(storage);
  await first.add("conv-1", [{ message: { messageId: "m1", content: "persisted" } }]);

  const second = new OneTalkMessageBuffer(storage);
  const read = await second.read();
  assert.equal(read["conv-1"]?.length, 1);
});

test("OneTalkMessageBuffer ignores empty input", async () => {
  const storage = new MemoryStorage();
  const buffer = new OneTalkMessageBuffer(storage);
  await buffer.add("", [{ message: { messageId: "m1" } }]);
  await buffer.add("conv-1", []);
  const read = await buffer.read();
  assert.deepEqual(read, {});
});
