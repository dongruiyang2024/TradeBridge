import assert from "node:assert/strict";
import { test } from "node:test";
import { installOneTalkMessageTap } from "../src/channels/alibaba-im/onetalk-message-tap.js";

interface PostedMessage {
  source: string;
  type: string;
  externalConversationId: string;
  messages: Record<string, unknown>[];
}

// Fake SDK event emitter + window. installOneTalkMessageTap wraps emitter.emit;
// tests drive emit() with payloads and assert what gets postMessage'd. The tap
// also posts "onetalk-capture-diagnostics" for newly seen event names; tests
// look only at "onetalk-messages-observed" posts via observedOf().
class FakeEmitter {
  emit(_eventName: string, _payload: unknown): string {
    return "original-return";
  }
}

function observedOf(posted: PostedMessage[]): PostedMessage[] {
  return posted.filter((message) => message.type === "onetalk-messages-observed");
}

function createFakeWindow(emitter: FakeEmitter) {
  const posted: PostedMessage[] = [];
  const timers: Array<() => void> = [];
  const fakeWindow = {
    location: { origin: "https://onetalk.alibaba.com" },
    IcbuIM: { IMBaaSSDK: { IcbuEventServiceImpl: { instance: { emitter } } } },
    postMessage(message: PostedMessage) {
      posted.push(message);
    },
    setInterval(fn: () => void) {
      timers.push(fn);
      return timers.length;
    },
    clearInterval() {}
  };
  return { fakeWindow, posted };
}

test("tap extracts a received message (BaaSMessageNew) with direction", () => {
  const emitter = new FakeEmitter();
  const { fakeWindow, posted } = createFakeWindow(emitter);
  installOneTalkMessageTap(fakeWindow as unknown as Window);

  const ret = emitter.emit("BaaSMessageNew", {
    messageModel: {
      cid: "conv-1",
      messageId: "m1",
      content: { contentType: "text", text: { content: "hello" } },
      createAt: 1779706200000,
      sender: { uid: "buyer-ali" }
    }
  });

  assert.equal(ret, "original-return", "emit must pass through");
  const observed = observedOf(posted);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].type, "onetalk-messages-observed");
  assert.equal(observed[0].externalConversationId, "conv-1");
  const message = observed[0].messages[0].message as Record<string, unknown>;
  assert.equal(message.messageId, "m1");
  assert.equal(message.content, "hello");
  assert.equal(message.sendTime, 1779706200000);
  assert.equal(message.sender, "buyer-ali");
  assert.equal(message.direction, "received");
});

test("tap extracts a sent message (BaaSMessageSendCallback) with direction and contact", () => {
  const emitter = new FakeEmitter();
  const { fakeWindow, posted } = createFakeWindow(emitter);
  installOneTalkMessageTap(fakeWindow as unknown as Window);

  emitter.emit("BaaSMessageSendCallback", {
    conversationCode: "conv-2",
    messageId: "m2",
    content: { contentType: "text", text: { content: "hi there" } },
    msgType: "text",
    sendTime: 1779706300000,
    sender: { targetId: "seller-self" },
    contact: { name: "Buyer Two", loginId: "buyer-login", accountIdEncrypt: "acc-enc" }
  });

  const observed = observedOf(posted);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].externalConversationId, "conv-2");
  const record = observed[0].messages[0];
  const message = record.message as Record<string, unknown>;
  assert.equal(message.messageId, "m2");
  assert.equal(message.content, "hi there");
  assert.equal(message.sender, "seller-self");
  assert.equal(message.direction, "sent");
  const contact = record.contact as Record<string, unknown>;
  assert.equal(contact.name, "Buyer Two");
});

test("tap ignores non-message events (typing / read receipt / changed)", () => {
  const emitter = new FakeEmitter();
  const { fakeWindow, posted } = createFakeWindow(emitter);
  installOneTalkMessageTap(fakeWindow as unknown as Window);

  // Real noise event names observed in production — all must be ignored.
  emitter.emit("paas.conversation.typingChange", { conversationCode: "conv-3", typing: true });
  emitter.emit("BaaSMessageReadToSenderList", { conversationCode: "conv-3", messageId: "r1", content: "x" });
  emitter.emit("paas.message.changed", { messageModel: { cid: "conv-3", messageId: "c1" } });

  assert.equal(observedOf(posted).length, 0);
});

test("tap tolerates malformed payloads and still passes through emit", () => {
  const emitter = new FakeEmitter();
  const { fakeWindow, posted } = createFakeWindow(emitter);
  installOneTalkMessageTap(fakeWindow as unknown as Window);

  assert.doesNotThrow(() => {
    emitter.emit("x", null as unknown as Record<string, unknown>);
    emitter.emit("y", 12345 as unknown as Record<string, unknown>);
    emitter.emit("z", "a string" as unknown as Record<string, unknown>);
  });
  assert.equal(observedOf(posted).length, 0);
});

test("tap wraps the emitter only once (idempotent install)", () => {
  const emitter = new FakeEmitter();
  const { fakeWindow, posted } = createFakeWindow(emitter);
  installOneTalkMessageTap(fakeWindow as unknown as Window);
  installOneTalkMessageTap(fakeWindow as unknown as Window);

  emitter.emit("BaaSMessageNew", {
    messageModel: { cid: "conv-1", messageId: "m1", content: { text: { content: "once" } } }
  });

  // If double-wrapped, this would post twice.
  assert.equal(observedOf(posted).length, 1);
});

test("tap reports newly seen event names as capture diagnostics", () => {
  const emitter = new FakeEmitter();
  const { fakeWindow, posted } = createFakeWindow(emitter);
  installOneTalkMessageTap(fakeWindow as unknown as Window);

  emitter.emit("typingStatus", { conversationCode: "conv-3", typing: true });
  emitter.emit("typingStatus", { conversationCode: "conv-3", typing: false }); // duplicate name

  const diagnostics = posted.filter((m) => m.type === "onetalk-capture-diagnostics");
  assert.ok(diagnostics.length >= 1, "should emit diagnostics for a new event name");
  const seen = (diagnostics[diagnostics.length - 1] as unknown as { seenEventNames: string[] }).seenEventNames;
  assert.deepEqual(seen, ["typingStatus"], "duplicate event names are not re-recorded");
});

test("tap polls until the emitter appears (delayed SDK init)", () => {
  const posted: PostedMessage[] = [];
  const scheduled: Array<() => void> = [];
  const lateEmitter = new FakeEmitter();
  const sdkHolder: { instance?: { emitter: FakeEmitter } } = {};
  const fakeWindow = {
    location: { origin: "https://onetalk.alibaba.com" },
    IcbuIM: { IMBaaSSDK: { IcbuEventServiceImpl: sdkHolder } },
    postMessage: (m: PostedMessage) => posted.push(m),
    setInterval: (fn: () => void) => {
      scheduled.push(fn);
      return scheduled.length;
    },
    clearInterval: () => {}
  };

  installOneTalkMessageTap(fakeWindow as unknown as Window);
  // Emitter not present yet → install scheduled a poll.
  assert.equal(scheduled.length, 1, "should schedule a poll when emitter is absent");

  // SDK finishes initializing; next poll tick wraps it.
  sdkHolder.instance = { emitter: lateEmitter };
  scheduled[0]();

  lateEmitter.emit("BaaSMessageNew", {
    messageModel: { cid: "conv-9", messageId: "m9", content: { text: { content: "late" } } }
  });
  const observed = observedOf(posted);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].externalConversationId, "conv-9");
});
