import assert from "node:assert/strict";
import { test } from "node:test";
import { runSyncOnce } from "../src/background/sync-orchestrator.js";
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

test("runSyncOnce fetches OneTalk data, sanitizes it, uploads batch, and saves cursor", async () => {
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
      }),
      getChatMessages: async () => ({
        status: 200,
        contentType: "application/lwp+json",
        code: 200,
        raw: {},
        messages: [
          {
            message: {
              messageId: "m1",
              cid: "conv-1",
              sender: { uid: "buyer-ali" },
              content: { text: { content: "hello" } },
              createAt: 1779706200000
            }
          }
        ],
        diagnostics: {
          status: 200,
          contentType: "application/lwp+json",
          code: 200,
          listLength: 1,
          listPath: "body.userMessageModels",
          topLevelKeys: ["body", "code", "headers"],
          dataKeys: ["hasMore", "nextCursor", "userMessageModels"]
        }
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
  assert.equal(uploaded.length, 1);
  assert.equal(Object.hasOwn(uploaded[0], ["org", "Id"].join("")), false);
  assert.equal(uploaded[0].sourceMeta?.source, "chrome-extension");
  assert.equal(uploaded[0].messages?.[0].content, "hello");
  assert.equal(store.status.nextCursor, "2026-05-25T10:50:00.000Z");
  assert.equal(store.status.lastError, undefined);
  assert.equal(store.status.lastDiagnostics?.conversations, 1);
  assert.deepEqual(store.status.lastDiagnostics?.messageRequests.map((item) => [item.conversationId, item.status, item.listLength]), [
    ["conv-1", 200, 1]
  ]);
  assert.deepEqual(store.status.lastDiagnostics?.lwpRoutes?.map((item) => item.route), [
    "/r/Conversation/listNewestPagination",
    "/r/MessageManager/listUserMessages"
  ]);
});

test("runSyncOnce stores collector_activation_required errors", async () => {
  const store = new MemoryStateStore();
  store.config = null;

  const result = await runSyncOnce({
    stateStore: store,
    onetalkClient: {
      fetchWeblite: async () => {
        throw new Error("should not fetch");
      },
      getChatMessages: async () => {
        throw new Error("should not fetch");
      }
    },
    uploadSyncBatch: async () => {
      throw new Error("should not upload");
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "collector_activation_required");
  assert.equal(store.status.lastError?.code, "collector_activation_required");
});

test("runSyncOnce records per-conversation message failures and continues upload", async () => {
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
              singleChatConversation: { cid: "conv-timeout", pairFirst: "self-ali", pairSecond: "buyer-1" }
            }
          },
          {
            singleChatUserConversation: {
              singleChatConversation: { cid: "conv-ok", pairFirst: "self-ali", pairSecond: "buyer-2" }
            }
          }
        ]
      }),
      getChatMessages: async ({ conversation }) => {
        const cid = (conversation.singleChatUserConversation as { singleChatConversation: { cid: string } })
          .singleChatConversation.cid;
        if (cid === "conv-timeout") throw new Error("lwp_request_timeout:/r/MessageManager/listUserMessages");
        return {
          status: 200,
          contentType: "application/lwp+json",
          code: 200,
          raw: {},
          messages: [],
          diagnostics: {
            status: 200,
            contentType: "application/lwp+json",
            code: 200,
            listLength: 0,
            listPath: "body.userMessageModels",
            topLevelKeys: ["body", "code", "headers"],
            dataKeys: ["userMessageModels"]
          }
        };
      }
    },
    uploadSyncBatch: async (options) => {
      uploaded.push(options.batch);
      return { acceptedCount: 0, rejectedCount: 0, nextCursor: null, warnings: [] };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(uploaded.length, 1);
  assert.deepEqual(store.status.lastDiagnostics?.messageRequests.map((item) => [item.conversationId, item.status, item.code]), [
    ["conv-timeout", 0, "lwp_request_timeout:/r/MessageManager/listUserMessages"],
    ["conv-ok", 200, 200]
  ]);
});
