import assert from "node:assert/strict";
import { test } from "node:test";
import { runSyncOnce, type SyncMessageSource } from "../src/background/sync-orchestrator.js";
import type { ExtensionConfig, ExtensionStatus, SyncBatch } from "../src/shared/sync-types.js";

class MemoryStateStore {
  config: ExtensionConfig | null = {
    serverUrl: "http://127.0.0.1:5032",
    collectorToken: "collector-token",
    sellerAccountExternalId: "seller-demo",
    sellerAccountDisplayName: "Seller Demo",
    deviceId: "chrome-extension-demo",
    deviceName: "Chrome Extension"
  };
  status: ExtensionStatus = {};

  async getConfig() {
    return this.config;
  }

  async getStatus() {
    return this.status;
  }

  async saveStatus(status: ExtensionStatus) {
    this.status = status;
  }
}

function staticMessageSource(byConversationId: Record<string, Record<string, unknown>[]>): SyncMessageSource {
  return { read: async () => byConversationId, acknowledge: async () => undefined };
}

function message(messageId: string, content: string): Record<string, unknown> {
  return {
    message: {
      messageId,
      cid: "conv-1",
      sender: { uid: "buyer-ali" },
      content: { text: { content } },
      createAt: 1779706200000
    }
  };
}

test("runSyncOnce maps buffered messages with page-SDK conversations, sanitizes, uploads, and saves cursor", async () => {
  const store = new MemoryStateStore();
  const uploaded: SyncBatch[] = [];

  const result = await runSyncOnce({
    now: () => new Date("2026-05-26T08:10:00.000Z"),
    stateStore: store,
    onetalkClient: {
      fetchWeblite: async () => ({
        html: "",
        bootstrap: { aliId: "self-ali" },
        conversations: [
          {
            singleChatUserConversation: {
              singleChatConversation: { cid: "conv-1", pairFirst: "self-ali", pairSecond: "buyer-ali" }
            }
          }
        ]
      })
    },
    messageSource: staticMessageSource({
      "conv-1": [
        {
          message: {
            messageId: "m1",
            cid: "conv-1",
            sender: { uid: "buyer-ali" },
            content: { text: { content: "hello" } },
            createAt: 1779706200000
          }
        }
      ]
    }),
    uploadSyncBatch: async (options) => {
      uploaded.push(options.batch);
      return {
        acceptedCount: options.batch.messages?.length || 0,
        rejectedCount: 0,
        nextCursor: "2026-05-25T10:50:00.000Z",
        warnings: []
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(uploaded.length, 1);
  assert.equal(Object.hasOwn(uploaded[0], ["org", "Id"].join("")), false);
  assert.equal(uploaded[0].sourceMeta?.source, "chrome-extension");
  assert.equal(uploaded[0].messages?.[0].content, "hello");
  assert.equal(store.status.nextCursor, "2026-05-25T10:50:00.000Z");
  assert.equal(store.status.lastError, undefined);
  assert.equal(store.status.lastDiagnostics?.conversations, 1);
  assert.deepEqual(
    store.status.lastDiagnostics?.messageRequests.map((item) => [item.conversationId, item.status, item.listLength]),
    [["conv-1", 200, 1]]
  );
  assert.deepEqual(store.status.lastDiagnostics?.lwpRoutes?.map((item) => item.route), ["page-socket-tap"]);
});

test("runSyncOnce merges live buffer messages with SDK history messages without acknowledging history", async () => {
  const store = new MemoryStateStore();
  const uploaded: SyncBatch[] = [];
  const liveMessages = {
    "conv-1": [message("m-live", "live message"), message("m-dup", "live wins")]
  };
  let acknowledged: Record<string, Record<string, unknown>[]> | null = null;

  const result = await runSyncOnce({
    now: () => new Date("2026-05-26T08:10:00.000Z"),
    stateStore: store,
    onetalkClient: {
      fetchWeblite: async () => ({
        html: "",
        bootstrap: { aliId: "self-ali" },
        conversations: [
          {
            singleChatUserConversation: {
              singleChatConversation: { cid: "conv-1", pairFirst: "self-ali", pairSecond: "buyer-ali" }
            }
          }
        ]
      })
    },
    messageSource: {
      read: async () => liveMessages,
      acknowledge: async (snapshot) => {
        acknowledged = snapshot;
      }
    },
    historyMessageSource: {
      read: async () => ({
        "conv-1": [message("m-dup", "history duplicate"), message("m-history", "older history")]
      })
    },
    uploadSyncBatch: async (options) => {
      uploaded.push(options.batch);
      return {
        acceptedCount: options.batch.messages?.length || 0,
        rejectedCount: 0,
        nextCursor: "2026-05-25T10:50:00.000Z",
        warnings: []
      };
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    uploaded[0].messages?.map((item) => [item.externalMessageId, item.content]),
    [
      ["m-live", "live message"],
      ["m-dup", "live wins"],
      ["m-history", "older history"]
    ]
  );
  assert.equal(acknowledged, liveMessages);
  assert.deepEqual(store.status.lastDiagnostics?.lwpRoutes?.map((item) => [item.route, item.listLength]), [
    ["page-socket-tap", 2],
    ["page-sdk-history", 2]
  ]);
});

test("runSyncOnce uploads buffered messages even when local status has an old cursor", async () => {
  const store = new MemoryStateStore();
  store.status = { nextCursor: "2026-05-28T08:00:00.000Z" };
  const uploaded: SyncBatch[] = [];

  const result = await runSyncOnce({
    now: () => new Date("2026-05-28T08:10:00.000Z"),
    stateStore: store,
    onetalkClient: {
      fetchWeblite: async () => ({
        html: "",
        bootstrap: { aliId: "self-ali" },
        conversations: [
          {
            singleChatUserConversation: {
              singleChatConversation: { cid: "conv-1", pairFirst: "self-ali", pairSecond: "buyer-ali" }
            }
          }
        ]
      })
    },
    messageSource: staticMessageSource({
      "conv-1": [
        {
          message: {
            messageId: "m-old-local-cursor",
            cid: "conv-1",
            sender: { uid: "buyer-ali" },
            content: { text: { content: "existing recent message" } },
            createAt: 1779706200000
          }
        }
      ]
    }),
    uploadSyncBatch: async (options) => {
      uploaded.push(options.batch);
      return {
        acceptedCount: options.batch.messages?.length || 0,
        rejectedCount: 0,
        nextCursor: "2026-05-25T10:50:00.000Z",
        warnings: []
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].messages?.length, 1);
  assert.equal(uploaded[0].messages?.[0].externalMessageId, "m-old-local-cursor");
});

test("runSyncOnce stores collector_activation_required errors", async () => {
  const store = new MemoryStateStore();
  store.config = null;

  const result = await runSyncOnce({
    stateStore: store,
    onetalkClient: {
      fetchWeblite: async () => {
        throw new Error("should not fetch");
      }
    },
    messageSource: {
      read: async () => {
        throw new Error("should not read");
      },
      acknowledge: async () => undefined
    },
    uploadSyncBatch: async () => {
      throw new Error("should not upload");
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "collector_activation_required");
  assert.equal(store.status.lastError?.code, "collector_activation_required");
});

test("runSyncOnce records per-conversation diagnostics for buffered conversations", async () => {
  const store = new MemoryStateStore();
  const uploaded: SyncBatch[] = [];

  const result = await runSyncOnce({
    now: () => new Date("2026-05-26T08:10:00.000Z"),
    stateStore: store,
    onetalkClient: {
      fetchWeblite: async () => ({
        html: "",
        bootstrap: { aliId: "self-ali" },
        conversations: [
          {
            singleChatUserConversation: {
              singleChatConversation: { cid: "conv-empty", pairFirst: "self-ali", pairSecond: "buyer-1" }
            }
          },
          {
            singleChatUserConversation: {
              singleChatConversation: { cid: "conv-ok", pairFirst: "self-ali", pairSecond: "buyer-2" }
            }
          }
        ]
      })
    },
    messageSource: staticMessageSource({
      "conv-ok": [
        {
          message: {
            messageId: "m-ok",
            cid: "conv-ok",
            sender: { uid: "buyer-2" },
            content: { text: { content: "hi" } },
            createAt: 1779706200000
          }
        }
      ]
    }),
    uploadSyncBatch: async (options) => {
      uploaded.push(options.batch);
      return { acceptedCount: 0, rejectedCount: 0, nextCursor: null, warnings: [] };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(uploaded.length, 1);
  assert.deepEqual(
    store.status.lastDiagnostics?.messageRequests.map((item) => [item.conversationId, item.status, item.listLength]),
    [["conv-ok", 200, 1]]
  );
});
