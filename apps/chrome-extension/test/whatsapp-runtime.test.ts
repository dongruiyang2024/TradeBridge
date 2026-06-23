import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveWhatsAppRuntime, sanitizeRuntimeMessage } from "../src/channels/whatsapp-web/whatsapp-runtime.js";
import { installWhatsAppMessageTap } from "../src/channels/whatsapp-web/whatsapp-message-tap.js";

test("resolveWhatsAppRuntime adapts a Store-like WhatsApp Web runtime", async () => {
  const listeners = new Map<string, (message: unknown) => void>();
  const chat = { id: { _serialized: "12025550123@c.us" } };
  const win = fakeWindow({
    Store: {
      Conn: { wid: { _serialized: "15551234567@c.us" } },
      Chat: {
        get: (chatId: string) => (chatId === "12025550123@c.us" ? chat : null)
      },
      Msg: {
        models: [
          {
            id: { _serialized: "msg-1" },
            chat: { id: { _serialized: "12025550123@c.us" } },
            fromMe: false,
            t: 1_782_000_000,
            body: "hello",
            type: "chat"
          }
        ],
        on: (eventName: string, listener: (message: unknown) => void) => {
          listeners.set(eventName, listener);
        },
        off: (eventName: string) => {
          listeners.delete(eventName);
        }
      },
      SendTextMsgToChat: async (chatRecord: typeof chat, text: string) => {
        assert.equal(chatRecord, chat);
        assert.equal(text, "hi there");
        return { id: { _serialized: "msg-out-1" } };
      }
    }
  });

  const runtime = resolveWhatsAppRuntime(win);

  assert.ok(runtime);
  assert.equal(runtime.getAccountId?.(), "15551234567@c.us");
  assert.deepEqual(runtime.getLoadedMessages?.(), [
    {
      id: "msg-1",
      chatId: "12025550123@c.us",
      fromMe: false,
      timestamp: 1_782_000_000,
      body: "hello",
      type: "chat"
    }
  ]);
  assert.deepEqual(await runtime.sendText?.({ chatId: "12025550123@c.us", text: "hi there" }), { id: "msg-out-1" });

  const observed: unknown[] = [];
  const unsubscribe = runtime.onMessage?.((message) => observed.push(message));
  listeners.get("add")?.({
    id: { _serialized: "msg-2" },
    chatId: { _serialized: "12025550123@c.us" },
    fromMe: true,
    timestamp: 1_782_000_001,
    body: "reply",
    type: "chat"
  });
  unsubscribe?.();

  assert.deepEqual(observed, [
    {
      id: "msg-2",
      chatId: "12025550123@c.us",
      fromMe: true,
      timestamp: 1_782_000_001,
      body: "reply",
      type: "chat"
    }
  ]);
  assert.equal(listeners.has("add"), false);
});

test("installWhatsAppMessageTap emits sanitized loaded and live runtime messages", () => {
  const posts: Array<Record<string, unknown>> = [];
  const listeners: Array<(message: unknown) => void> = [];
  const win = fakeWindow({
    __tradeBridgeWhatsAppRuntime: {
      getAccountId: () => "15551234567@c.us",
      getLoadedMessages: () => [
        {
          id: "msg-1",
          chatId: "12025550123@c.us",
          fromMe: false,
          timestamp: 1_782_000_000,
          body: "hello",
          type: "chat"
        }
      ],
      onMessage: (listener: (message: unknown) => void) => {
        listeners.push(listener);
      }
    },
    postMessage: (message: Record<string, unknown>) => posts.push(message)
  });

  installWhatsAppMessageTap(win);
  listeners[0]({
    id: "msg-2",
    chatId: "12025550123@c.us",
    fromMe: true,
    timestamp: 1_782_000_001,
    body: "reply",
    type: "chat"
  });

  assert.equal(posts[0].type, "whatsapp-web-account-observed");
  assert.equal(posts[0].accountId, "15551234567@c.us");
  assert.equal(posts[1].type, "whatsapp-web-messages-observed");
  assert.equal(posts[2].type, "whatsapp-web-messages-observed");
  assert.deepEqual((posts[2].messages as Record<string, unknown>[])[0], {
    externalConversationId: "12025550123@c.us",
    externalCustomerId: "12025550123@c.us",
    externalMessageId: "msg-2",
    direction: "sent",
    messageType: "chat",
    content: "reply",
    sentAt: new Date(1_782_000_001 * 1000).toISOString(),
    rawSanitized: {
      hasId: true,
      hasTimestamp: true,
      type: "chat"
    }
  });
});

test("sanitizeRuntimeMessage drops messages without chat id or text", () => {
  assert.equal(sanitizeRuntimeMessage({ chatId: "chat-1", body: "" }), null);
  assert.equal(sanitizeRuntimeMessage({ body: "hello" }), null);
});

function fakeWindow(fields: Record<string, unknown>): Window {
  const win = {
    location: { origin: "https://web.whatsapp.com" },
    postMessage: () => undefined,
    ...fields
  };
  return win as unknown as Window;
}
