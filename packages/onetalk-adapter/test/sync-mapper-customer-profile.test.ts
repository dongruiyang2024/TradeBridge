import assert from "node:assert/strict";
import { test } from "node:test";
import { mapWebliteToSyncBatch } from "../src/browser.js";

test("mapWebliteToSyncBatch maps stable LWP customer id and CRM profile natural name", () => {
  const batch = mapWebliteToSyncBatch({
    sellerAccount: { externalAccountId: "seller-demo" },
    device: { deviceId: "chrome-extension-demo" },
    collectedAt: "2026-05-27T04:40:00.000Z",
    source: "chrome-extension",
    previousCursor: null,
    weblite: {
      html: "",
      bootstrap: { aliId: "seller-ali" },
      conversations: [
        {
          singleChatUserConversation: {
            modifyTime: Date.parse("2026-05-27T04:33:20.000Z"),
            singleChatConversation: {
              cid: "conv-lwp-profile",
              pairFirst: "seller-ali",
              pairSecond: "buyer-ali"
            },
            user_extension: {
              custom: JSON.stringify({
                fromAccId: "seller-account",
                fromAccIdE: "seller-account-encrypted",
                fromAliIdE: "seller-ali-encrypted",
                toAccId: "buyer-account",
                toAccIdE: "buyer-account-encrypted",
                toAliIdE: "buyer-ali-encrypted"
              })
            }
          }
        }
      ],
      customerProfiles: [
        {
          buyerAccountId: "buyer-account-encrypted",
          buyerLoginId: "buyer-login",
          data: {
            data: {
              buyerInfo: {
                firstName: "Buyer",
                lastName: "Sample",
                companyName: "Buyer Tools Co.",
                country: "CN"
              }
            }
          }
        }
      ]
    },
    messagesByConversationId: {}
  });

  assert.deepEqual(batch.customers, [
    {
      externalCustomerId: "buyer-ali",
      loginId: "buyer-login",
      displayName: "Buyer Sample",
      country: "CN"
    }
  ]);
  assert.deepEqual(batch.conversations, [
    {
      externalConversationId: "conv-lwp-profile",
      externalCustomerId: "buyer-ali",
      lastMessageAt: "2026-05-27T04:33:20.000Z"
    }
  ]);
});
