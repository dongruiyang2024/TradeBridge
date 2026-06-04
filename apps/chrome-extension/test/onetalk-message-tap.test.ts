import assert from "node:assert/strict";
import { test } from "node:test";
import { installOneTalkMessageTap } from "../src/channels/alibaba-im/onetalk-message-tap.js";

interface PostedMessage {
  source: string;
  type: string;
  externalConversationId: string;
  messages: Record<string, unknown>[];
}

// Minimal fake socket that records send() calls and lets the test push inbound
// frames through the listener the tap attaches.
class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  sent: unknown[] = [];
  private listeners: Array<(event: { data: unknown }) => void> = [];
  constructor(public url: string) {}
  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    if (type === "message") this.listeners.push(listener);
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  emit(data: unknown) {
    for (const listener of this.listeners) listener({ data });
  }
}

function createFakeWindow() {
  const posted: PostedMessage[] = [];
  const fakeWindow = {
    location: { origin: "https://onetalk.alibaba.com" },
    WebSocket: FakeSocket as unknown as typeof WebSocket,
    postMessage(message: PostedMessage) {
      posted.push(message);
    }
  };
  return { fakeWindow, posted };
}

function messagesFrame(cid: string, messageIds: string[]): string {
  return JSON.stringify({
    lwp: "/r/MessageManager/listUserMessages",
    code: 200,
    headers: { mid: "x" },
    body: {
      hasMore: false,
      nextCursor: 0,
      userMessageModels: messageIds.map((id) => ({
        message: { messageId: id, cid, content: "body", createAt: 1779706200000 }
      }))
    }
  });
}

test("message tap extracts message bodies from inbound LWP frames grouped by conversation", () => {
  const { fakeWindow, posted } = createFakeWindow();
  installOneTalkMessageTap(fakeWindow as unknown as Window);

  const socket = new (fakeWindow.WebSocket as unknown as typeof FakeSocket)("wss://wss-icbu.dingtalk.com/");
  // The constructor wrap attaches the inbound listener on creation.
  socket.emit(messagesFrame("conv-1", ["m1", "m2"]));

  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, "onetalk-messages-observed");
  assert.equal(posted[0].externalConversationId, "conv-1");
  assert.equal(posted[0].messages.length, 2);
  assert.equal(posted[0].source, "tradebridge-onetalk-page");
});

test("message tap ignores non-message frames and never sends", () => {
  const { fakeWindow, posted } = createFakeWindow();
  installOneTalkMessageTap(fakeWindow as unknown as Window);

  const socket = new (fakeWindow.WebSocket as unknown as typeof FakeSocket)("wss://wss-icbu.dingtalk.com/");
  socket.emit(JSON.stringify({ lwp: "/r/SyncStatus/getState", code: 200, headers: {}, body: { topic: "sync" } }));
  socket.emit(JSON.stringify({ lwp: "/!", headers: { mid: "1" } }));

  assert.equal(posted.length, 0);
  assert.equal(socket.sent.length, 0);
});

test("message tap tolerates malformed frames without throwing", () => {
  const { fakeWindow, posted } = createFakeWindow();
  installOneTalkMessageTap(fakeWindow as unknown as Window);

  const socket = new (fakeWindow.WebSocket as unknown as typeof FakeSocket)("wss://wss-icbu.dingtalk.com/");
  assert.doesNotThrow(() => {
    socket.emit("not json");
    socket.emit("{ broken");
    socket.emit(12345);
  });
  assert.equal(posted.length, 0);
});

test("message tap only attaches to IM sockets, not unrelated ones", () => {
  const { fakeWindow, posted } = createFakeWindow();
  installOneTalkMessageTap(fakeWindow as unknown as Window);

  const unrelated = new (fakeWindow.WebSocket as unknown as typeof FakeSocket)("wss://analytics.example.com/");
  unrelated.emit(messagesFrame("conv-1", ["m1"]));

  assert.equal(posted.length, 0);
});

test("message tap attaches inbound listener to a pre-existing socket on first send", () => {
  const { fakeWindow, posted } = createFakeWindow();
  const NativeWebSocket = fakeWindow.WebSocket as unknown as typeof FakeSocket;
  // Socket created BEFORE the tap installs (constructor wrap can't see it).
  const preExisting = new NativeWebSocket("wss://wss-icbu.dingtalk.com/");

  installOneTalkMessageTap(fakeWindow as unknown as Window);

  // Before any send, inbound is not tapped.
  preExisting.emit(messagesFrame("conv-1", ["m0"]));
  assert.equal(posted.length, 0);

  // First send triggers the prototype.send patch, which attaches inbound.
  preExisting.send("heartbeat");
  preExisting.emit(messagesFrame("conv-1", ["m1"]));

  assert.equal(posted.length, 1);
  assert.equal(posted[0].externalConversationId, "conv-1");
});
