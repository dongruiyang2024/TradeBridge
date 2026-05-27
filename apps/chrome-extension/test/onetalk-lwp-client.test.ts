import assert from "node:assert/strict";
import { test } from "node:test";
import { LWP_ROUTES, parseLwpFrame } from "@wangwang/onetalk-adapter/browser";
import { BrowserOnetalkLwpClient } from "../src/background/onetalk-lwp-client.js";

test("BrowserOnetalkLwpClient fetchWeblite registers and loads LWP conversations", async () => {
  const requests: Array<{ route: string; body: unknown }> = [];
  const client = new BrowserOnetalkLwpClient({
    appKey: "12574478",
    deviceId: "chrome-extension-demo",
    userAgent: "Mozilla/5.0",
    tokenProvider: async () => ({ accessToken: "access-token", expiresInMs: 3600000 }),
    rpcFactory: () =>
      fakeRpc(requests, {
        [LWP_ROUTES.register]: { code: 200, headers: { mid: "reg", "reg-uid": "seller-ali" }, body: { unitName: "icbu" } },
        [LWP_ROUTES.getState]: { code: 200, headers: { mid: "state" }, body: { topic: "sync", pts: 1 } },
        [LWP_ROUTES.conversations]: {
          code: 200,
          headers: { mid: "conv" },
          body: {
            hasMore: false,
            nextCursor: 1779862804000,
            userConvs: [
              {
                singleChatUserConversation: {
                  singleChatConversation: { cid: "conv-1", pairFirst: "seller-ali", pairSecond: "buyer-ali" }
                }
              }
            ]
          }
        },
        [LWP_ROUTES.ackDiff]: { code: 200, headers: { mid: "ack" } }
      })
  });

  const result = await client.fetchWeblite();

  assert.equal(result.bootstrap.aliId, "seller-ali");
  assert.equal(result.conversations.length, 1);
  const wrapper = result.conversations[0].singleChatUserConversation as Record<string, unknown>;
  const conversation = wrapper.singleChatConversation as Record<string, unknown>;
  assert.equal(conversation.cid, "conv-1");
  assert.deepEqual(
    requests.map((item) => item.route),
    ["/reg", "/r/SyncStatus/getState", "/r/Conversation/listNewestPagination", "/r/SyncStatus/ackDiff"]
  );
});

test("BrowserOnetalkLwpClient getChatMessages loads messages for a conversation", async () => {
  const requests: Array<{ route: string; body: unknown }> = [];
  const client = new BrowserOnetalkLwpClient({
    appKey: "12574478",
    deviceId: "chrome-extension-demo",
    userAgent: "Mozilla/5.0",
    tokenProvider: async () => ({ accessToken: "access-token", expiresInMs: 3600000 }),
    rpcFactory: () =>
      fakeRpc(requests, {
        [LWP_ROUTES.register]: { code: 200, headers: { mid: "reg", "reg-uid": "seller-ali" }, body: { unitName: "icbu" } },
        [LWP_ROUTES.messages]: {
          code: 200,
          headers: { mid: "msg" },
          body: {
            hasMore: false,
            nextCursor: 9007199254740000,
            userMessageModels: [
              {
                message: {
                  messageId: "msg-1",
                  cid: "conv-1",
                  createAt: 1779862801000,
                  content: { text: { content: "hello" } },
                  sender: { uid: "buyer-ali" }
                }
              }
            ]
          }
        }
      })
  });

  const response = await client.getChatMessages({
    conversation: {
      singleChatUserConversation: {
        singleChatConversation: { cid: "conv-1", pairFirst: "seller-ali", pairSecond: "buyer-ali" }
      }
    },
    bootstrap: { aliId: "seller-ali" },
    before: null,
    pageSize: 20
  });

  assert.equal(response.status, 200);
  assert.equal(response.messages.length, 1);
  const firstMessage = response.messages[0].message as Record<string, unknown>;
  assert.equal(firstMessage.messageId, "msg-1");
  assert.equal(response.diagnostics?.listPath, "body.userMessageModels");
  assert.deepEqual(
    requests.map((item) => item.route),
    ["/reg", "/r/MessageManager/listUserMessages"]
  );
  assert.deepEqual(requests[1].body, ["conv-1", false, 9007199254740991, 20, false]);
});

function fakeRpc(requests: Array<{ route: string; body: unknown }>, frames: Record<string, Record<string, unknown>>) {
  return {
    connect: async () => undefined,
    requestFrame: async (frameText: string) => {
      const frame = parseLwpFrame(frameText);
      requests.push({ route: frame.route || "", body: frame.body });
      return parseLwpFrame(JSON.stringify(frames[frame.route || ""]));
    },
    request: async (route: string, body: unknown) => {
      requests.push({ route, body });
      return parseLwpFrame(JSON.stringify(frames[route]));
    },
    close: () => undefined
  };
}
