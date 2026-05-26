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
        conversations: [{ cid: "conv-1", contactAccountId: "buyer-1", contactNick: "Buyer One" }]
      }),
      getChatMessages: async () => ({
        status: 200,
        contentType: "application/json",
        code: 200,
        raw: {},
        messages: [
          {
            messageId: "m1",
            senderAliId: "buyer-ali",
            messageType: "text",
            content: "hello",
            sendTime: 1779706200000
          }
        ]
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
});

test("runSyncOnce stores config_required errors", async () => {
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
  assert.equal(result.error, "config_required");
  assert.equal(store.status.lastError?.code, "config_required");
});
