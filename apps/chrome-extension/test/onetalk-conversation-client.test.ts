import assert from "node:assert/strict";
import { test } from "node:test";
import { requestOneTalkConversations } from "../src/background/onetalk-conversation-client.js";
import type { ChromeApi } from "../src/shared/chrome-api.js";

test("requestOneTalkConversations returns SDK conversation records from an open OneTalk tab", async () => {
  const sentMessages: unknown[] = [];
  const conversations = await requestOneTalkConversations({
    chromeApi: fakeChromeApi(sentMessages, {
      ok: true,
      conversations: [
        {
          cid: "conversation-code",
          name: "Buyer Natural Name",
          loginId: "buyer-login",
          accountIdEncrypt: "buyer-account-encrypted"
        }
      ],
      nextCursor: 1779862804000,
      hasMore: false
    }),
    cursor: 1779862805000,
    count: 20
  });

  assert.deepEqual(conversations, {
    conversations: [
      {
        cid: "conversation-code",
        name: "Buyer Natural Name",
        loginId: "buyer-login",
        accountIdEncrypt: "buyer-account-encrypted"
      }
    ],
    nextCursor: 1779862804000,
    hasMore: false
  });
  assert.deepEqual(sentMessages, [
    {
      type: "get-onetalk-conversations",
      cursor: 1779862805000,
      count: 20
    }
  ]);
});

function fakeChromeApi(sentMessages: unknown[], response: unknown): ChromeApi {
  return {
    runtime: {
      onInstalled: { addListener: () => undefined },
      onMessage: { addListener: () => undefined },
      sendMessage: async () => undefined,
      getURL: (path) => `chrome-extension://id/${path}`,
      openOptionsPage: () => undefined
    },
    storage: { local: { get: async () => ({}), set: async () => undefined } },
    alarms: { create: () => undefined, onAlarm: { addListener: () => undefined } },
    tabs: {
      query: async () => [{ id: 9 }],
      sendMessage: async (_tabId, message) => {
        sentMessages.push(message);
        return response;
      }
    },
    scripting: {
      executeScript: async () => []
    }
  };
}
