import assert from "node:assert/strict";
import { test } from "node:test";
import {
  lwpConversationPageFromFrame,
  lwpMessagesPageFromFrame,
  lwpRegisterStateFromFrame,
  parseLwpFrame
} from "../src/browser.js";

test("lwpRegisterStateFromFrame extracts safe registration state", () => {
  const state = lwpRegisterStateFromFrame(
    parseLwpFrame(
      JSON.stringify({
        code: 200,
        headers: { mid: "reg-mid", "reg-uid": "seller-ali", sid: "sid-secret" },
        body: { unitName: "icbu", timestamp: 1779862804977, cookie: "secret-cookie" }
      })
    )
  );

  assert.deepEqual(state, {
    ok: true,
    uid: "seller-ali",
    unitName: "icbu"
  });
});

test("lwpConversationPageFromFrame extracts conversation records and cursor", () => {
  const page = lwpConversationPageFromFrame(
    parseLwpFrame(
      JSON.stringify({
        code: 200,
        headers: { mid: "conv-mid" },
        body: {
          hasMore: true,
          nextCursor: 1779862804000,
          userConvs: [
            {
              singleChatUserConversation: {
                singleChatConversation: { cid: "conv-1", pairFirst: "seller-ali", pairSecond: "buyer-ali" },
                modifyTime: 1779862803000
              }
            }
          ]
        }
      })
    )
  );

  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, 1779862804000);
  assert.equal(page.conversations.length, 1);
  const firstConversation = page.conversations[0].singleChatUserConversation as Record<string, unknown>;
  const singleChatConversation = firstConversation.singleChatConversation as Record<string, unknown>;
  assert.equal(singleChatConversation.cid, "conv-1");
});

test("lwpMessagesPageFromFrame unwraps userMessageModels", () => {
  const page = lwpMessagesPageFromFrame(
    parseLwpFrame(
      JSON.stringify({
        code: 200,
        headers: { mid: "msg-mid" },
        body: {
          hasMore: false,
          nextCursor: "cursor-next",
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
      })
    )
  );

  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor, "cursor-next");
  assert.equal(page.messages.length, 1);
  const firstMessage = page.messages[0].message as Record<string, unknown>;
  assert.equal(firstMessage.messageId, "msg-1");
});
