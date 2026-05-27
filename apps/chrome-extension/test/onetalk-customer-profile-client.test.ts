import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contactProfileRequestsFromConversations,
  requestOneTalkCustomerProfiles
} from "../src/background/onetalk-customer-profile-client.js";
import type { ChromeApi } from "../src/shared/chrome-api.js";

test("contactProfileRequestsFromConversations extracts encrypted buyer account ids from LWP custom fields", () => {
  const contacts = contactProfileRequestsFromConversations([
    {
      singleChatUserConversation: {
        user_extension: {
          custom: JSON.stringify({
            toAccIdE: "buyer-account-encrypted",
            toAccId: "buyer-account",
            fromAccIdE: "seller-account-encrypted"
          })
        }
      }
    },
    {
      contactAccountIdEncrypt: "legacy-buyer-account",
      contactLoginId: "legacy-login"
    },
    {
      singleChatUserConversation: {
        user_extension: {
          custom: JSON.stringify({ toAccIdE: "buyer-account-encrypted" })
        }
      }
    }
  ]);

  assert.deepEqual(contacts, [
    { buyerAccountId: "buyer-account-encrypted" },
    { buyerAccountId: "legacy-buyer-account", buyerLoginId: "legacy-login" }
  ]);
});

test("requestOneTalkCustomerProfiles returns profile records from an open OneTalk tab", async () => {
  const sentMessages: unknown[] = [];
  const profiles = await requestOneTalkCustomerProfiles({
    chromeApi: fakeChromeApi(sentMessages, {
      ok: true,
      profiles: [
        {
          buyerAccountId: "buyer-account-encrypted",
          data: { data: { buyerInfo: { firstName: "Peter", lastName: "SHU" } } }
        }
      ]
    }),
    contacts: [{ buyerAccountId: "buyer-account-encrypted" }]
  });

  assert.deepEqual(profiles, [
    {
      buyerAccountId: "buyer-account-encrypted",
      data: { data: { buyerInfo: { firstName: "Peter", lastName: "SHU" } } }
    }
  ]);
  assert.deepEqual(sentMessages, [
    {
      type: "get-onetalk-customer-profiles",
      contacts: [{ buyerAccountId: "buyer-account-encrypted" }]
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
