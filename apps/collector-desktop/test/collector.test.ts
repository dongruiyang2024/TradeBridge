import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { SyncBatch } from "@wangwang/database";
import { collectOnce } from "../src/collector.js";
import { JsonLocalStateStore } from "../src/local-state.js";
import { uploadSyncBatch } from "../src/uploader.js";

const tempRoots: string[] = [];
const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tempFile(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "collector-desktop-test-"));
  tempRoots.push(root);
  return path.join(root, name);
}

test("collectOnce maps OneTalk conversations and paged messages into one sync batch", async () => {
  const uploaded: SyncBatch[] = [];
  const state = new JsonLocalStateStore(tempFile("state.json"));
  const adapter = {
    detectSession: () => ({
      cookies: { cookie2: "cookie-value" },
      cookieNames: ["cookie2"],
      hasCtoken: false,
      hasTbToken: false,
      hasCookie2: true,
      hasSgcookie: false,
      logPaths: [],
      cookieDbPaths: [],
      tokenCachePaths: []
    }),
    fetchConversations: async () => ({
      html: "<html></html>",
      bootstrap: { aliId: "self-ali" },
      conversations: [
        {
          cid: "conv-1",
          contactAccountId: "customer-1",
          contactNick: "Buyer One",
          lastMessageTime: 1779706200000
        }
      ]
    }),
    fetchMessages: async (options: { before?: number | null }) => ({
      status: 200,
      contentType: "application/json",
      code: 200,
      raw: {},
      messages:
        options.before == null
          ? [
              {
                messageId: "msg-3",
                senderAliId: "self-ali",
                messageType: "text",
                content: "I can ship tomorrow",
                sendTime: 1779706140000
              },
              {
                messageId: "msg-2",
                senderAliId: "buyer-ali",
                messageType: "text",
                content: "Any update?",
                sendTime: 1779706080000
              }
            ]
          : [
              {
                messageId: "msg-1",
                senderAliId: "buyer-ali",
                messageType: "text",
                content: "Hello",
                sendTime: 1779706020000
              }
            ]
    })
  };

  const result = await collectOnce({
    sellerAccount: { externalAccountId: "seller-1", displayName: "Seller One" },
    device: { deviceId: "device-1", deviceName: "MacBook" },
    pageSize: 2,
    state,
    adapter,
    uploadBatch: async (batch) => {
      uploaded.push(batch);
      return {
        acceptedCount: batch.messages?.length || 0,
        rejectedCount: 0,
        nextCursor: "2026-05-25T10:49:00.000Z",
        warnings: []
      };
    }
  });

  assert.equal(result.acceptedCount, 3);
  assert.equal(uploaded.length, 1);
  assert.equal(Object.hasOwn(uploaded[0], ["org", "Id"].join("")), false);
  assert.deepEqual(uploaded[0].customers, [
    {
      externalCustomerId: "customer-1",
      displayName: "Buyer One"
    }
  ]);
  assert.deepEqual(uploaded[0].conversations, [
    {
      externalConversationId: "conv-1",
      externalCustomerId: "customer-1",
      lastMessageAt: "2026-05-25T10:50:00.000Z"
    }
  ]);
  assert.deepEqual(uploaded[0].messages?.map((message) => [message.externalMessageId, message.direction]), [
    ["msg-3", "sent"],
    ["msg-2", "received"],
    ["msg-1", "received"]
  ]);
  assert.equal(uploaded[0].messages?.[0].sentAt, "2026-05-25T10:49:00.000Z");
  assert.equal(await state.getCursor("seller-1"), "2026-05-25T10:49:00.000Z");
});

test("JsonLocalStateStore persists cursors, failed batches, and last errors", async () => {
  const statePath = tempFile("state.json");
  const store = new JsonLocalStateStore(statePath);
  const batch = {
    sellerAccount: { externalAccountId: "seller-1" },
    device: { deviceId: "device-1" }
  };

  await store.saveCursor("seller-1", "2026-05-25T10:49:00.000Z");
  const failed = await store.recordFailedBatch(batch, "network unavailable");
  await store.setLastError({ code: "upload_failed", message: "network unavailable" });

  const reloaded = new JsonLocalStateStore(statePath);
  assert.equal(await reloaded.getCursor("seller-1"), "2026-05-25T10:49:00.000Z");
  assert.deepEqual((await reloaded.listFailedBatches()).map((item) => item.id), [failed.id]);
  assert.deepEqual((await reloaded.read()).lastError, {
    code: "upload_failed",
    message: "network unavailable"
  });

  await reloaded.clearFailedBatch(failed.id);
  await reloaded.clearLastError();
  assert.deepEqual(await reloaded.listFailedBatches(), []);
  assert.equal((await reloaded.read()).lastError, undefined);
});

test("uploadSyncBatch posts collector batches with bearer auth", async () => {
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({
      ok: true,
      acceptedCount: 1,
      rejectedCount: 0,
      nextCursor: "2026-05-25T10:49:00.000Z",
      warnings: []
    });
  };

  const result = await uploadSyncBatch({
    serverUrl: "http://127.0.0.1:5032/",
    token: "collector-token",
    batch: {
      sellerAccount: { externalAccountId: "seller-1" },
      device: { deviceId: "device-1" }
    }
  });

  assert.equal(result.acceptedCount, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://127.0.0.1:5032/collector/v1/sync-batches");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].headers.get("authorization"), "Bearer collector-token");
  assert.equal(requests[0].headers.get("content-type"), "application/json");
  assert.equal(Object.hasOwn(await requests[0].json(), ["org", "Id"].join("")), false);
});
