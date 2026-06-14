import assert from "node:assert/strict";
import test from "node:test";

interface PostedMessage {
  source: string;
  type: string;
  requestId: string;
  ok: boolean;
  appKey?: string;
  deviceId?: string;
  profiles?: unknown[];
  conversations?: unknown[];
  messagesByConversationId?: Record<string, unknown[]>;
  error?: string;
  loginId?: string;
  aliId?: string;
}

interface FakeResourceEntry {
  name: string;
}

test("OneTalk page customer profile request queries CRM helper and returns whitelisted fields", async () => {
  const posted: PostedMessage[] = [];
  const jsonpRequests: Array<{ endpoint: string; options: Record<string, unknown> }> = [];
  const fakeWindow = createFakeWindow({
    resources: [],
    request: () => undefined,
    jsonp: async (endpoint, options) => {
      jsonpRequests.push({ endpoint, options: options as Record<string, unknown> });
      return {
        data: {
          data: {
            buyerInfo: {
              firstName: "Peter",
              lastName: "SHU",
              companyName: "Peter Tools Co.",
              country: "CN",
              encryptAccountId: "response-account-encrypted",
              mobileNumber: "should-not-leave-page"
            }
          }
        }
      };
    },
    posted
  });

  Reflect.set(globalThis, "window", fakeWindow);
  await import(`../src/channels/alibaba-im/onetalk-page-script?customer-profile-${Date.now()}`);

  fakeWindow.dispatchMessage({
    source: "tradebridge-extension",
    type: "get-onetalk-customer-profiles",
    requestId: "request-profile",
    contacts: [{ buyerAccountId: "buyer-account-encrypted", buyerLoginId: "buyer-login" }]
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(jsonpRequests[0]?.endpoint, "//alicrm.alibaba.com/jsonp/customerPluginQueryServiceI/queryCustomerInfo.json");
  assert.deepEqual((jsonpRequests[0]?.options.data as Record<string, unknown>), {
    buyerAccountId: "buyer-account-encrypted",
    buyerLoginId: "buyer-login",
    clientType: "PC",
    lang: "en_US"
  });
  assert.equal(posted[0]?.ok, true);
  assert.deepEqual(posted[0]?.profiles, [
    {
      buyerAccountId: "buyer-account-encrypted",
      buyerLoginId: "buyer-login",
      data: {
        data: {
          buyerInfo: {
            firstName: "Peter",
            lastName: "SHU",
            companyName: "Peter Tools Co.",
            country: "CN",
            encryptAccountId: "response-account-encrypted"
          }
        }
      }
    }
  ]);
});

test("OneTalk page conversation request returns sanitized SDK conversation fields", async () => {
  const posted: PostedMessage[] = [];
  const conversationRequests: unknown[] = [];
  const contactDetailRequests: unknown[] = [];
  const fakeWindow = createFakeWindow({
    resources: [],
    request: () => undefined,
    conversationPage: async (options) => {
      conversationRequests.push(options);
      return {
        hasMore: false,
        nextCursor: 1779862804000,
        list: [
          {
            cid: "conversation-code",
            name: "Buyer Natural Name",
            loginId: "buyer-login",
            accountIdEncrypt: "root-account-should-not-win",
            aliIdEncrypt: "root-ali-should-not-win",
            chatToken: "root-token-should-not-win",
            contact: {
              loginId: "buyer-contact-login",
              accountIdEncrypt: "buyer-account-encrypted",
              aliIdEncrypt: "buyer-ali-encrypted",
              chatToken: "buyer-contact-token"
            },
            latestMessage: {
              gmtChatLong: 1779862800000,
              content: "must-not-leave-page",
              message: {
                sendTime: 1779862800000,
                contact: {
                  name: "Stale Active Contact Name",
                  companyName: "Stale Active Contact Co.",
                  loginId: "stale-active-contact-login",
                  accountIdEncrypt: "stale-active-account-encrypted",
                  aliIdEncrypt: "stale-active-ali-encrypted",
                  chatToken: "stale-active-token"
                }
              }
            }
          }
        ]
      };
    },
    conversationContactDetails: async (contacts) => {
      contactDetailRequests.push(contacts);
      return [
        {
          name: "Detail Natural Name",
          companyName: "Detail Company",
          loginId: "detail-login",
          fullPortrait: "https://img.example/avatar.png",
          kHTAccessToken: "must-not-leave-page"
        }
      ];
    },
    posted
  });

  Reflect.set(globalThis, "window", fakeWindow);
  await import(`../src/channels/alibaba-im/onetalk-page-script?sdk-conversations-${Date.now()}`);

  fakeWindow.dispatchMessage({
    source: "tradebridge-extension",
    type: "get-onetalk-conversations",
    requestId: "request-conversations",
    cursor: 1779862805000,
    count: 20
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(posted[0]?.ok, true, posted[0]?.error);
  assert.deepEqual(conversationRequests, [{ cursor: 1779862805000, count: 20 }]);
  assert.deepEqual(contactDetailRequests, [[{ encryptAccountId: "buyer-account-encrypted", chatToken: "buyer-contact-token" }]]);
  assert.deepEqual(posted[0]?.conversations, [
    {
      cid: "conversation-code",
      name: "Buyer Natural Name",
      loginId: "buyer-login",
      accountIdEncrypt: "root-account-should-not-win",
      aliIdEncrypt: "root-ali-should-not-win",
      contact: {
        name: "Detail Natural Name",
        companyName: "Detail Company",
        loginId: "detail-login",
        accountIdEncrypt: "buyer-account-encrypted",
        aliIdEncrypt: "buyer-ali-encrypted",
        fullPortrait: "https://img.example/avatar.png"
      },
      latestMessage: {
        gmtChatLong: 1779862800000,
        message: {
          sendTime: 1779862800000
        }
      }
    }
  ]);
  const serializedPosted = JSON.stringify(posted[0]);
  for (const secret of [
    "must-not-leave-page",
    "root-token-should-not-win",
    "top-contact-token-should-not-win",
    "buyer-contact-token",
    "stale-active-token",
    "Stale Active Contact Name"
  ]) {
    assert.equal(serializedPosted.includes(secret), false);
  }
});

test("OneTalk page account request returns detected seller identities", async () => {
  const posted: PostedMessage[] = [];
  const fakeWindow = createFakeWindow({
    resources: [],
    request: () => undefined,
    posted,
    accountGlobals: {
      selfLoginId: "seller-login",
      aliId: "seller-ali"
    }
  });

  Reflect.set(globalThis, "window", fakeWindow);
  await import(`../src/channels/alibaba-im/onetalk-page-script?account-identity-${Date.now()}`);

  fakeWindow.dispatchMessage({
    source: "tradebridge-extension",
    type: "get-onetalk-account",
    requestId: "request-account"
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(posted[0]?.ok, true, posted[0]?.error);
  assert.equal(posted[0]?.type, "get-onetalk-account-result");
  assert.equal((posted[0] as PostedMessage & { loginId?: string }).loginId, "seller-login");
  assert.equal((posted[0] as PostedMessage & { aliId?: string }).aliId, "seller-ali");
});

test("OneTalk page history message request returns sanitized SDK message fields", async () => {
  const posted: PostedMessage[] = [];
  const historyRequests: unknown[] = [];
  const fakeWindow = createFakeWindow({
    resources: [],
    request: () => undefined,
    messageHistory: async (options) => {
      historyRequests.push(options);
      return {
        hasMore: false,
        data: [
          {
            messageId: "history-1",
            uuid: "history-uuid-1",
            conversationCode: "conversation-code",
            messageType: "text",
            content: { text: { content: "older message" }, chatToken: "must-not-leave-page" },
            sendTime: 1779862700000,
            sender: { uid: "buyer-ali", chatToken: "must-not-leave-page" },
            contact: { chatToken: "must-not-leave-page" }
          }
        ]
      };
    },
    posted
  });

  Reflect.set(globalThis, "window", fakeWindow);
  await import(`../src/channels/alibaba-im/onetalk-page-script?history-messages-${Date.now()}`);

  fakeWindow.dispatchMessage({
    source: "tradebridge-extension",
    type: "get-onetalk-history-messages",
    requestId: "request-history",
    conversations: [{ cid: "conversation-code", latestMessage: { message: { sendTime: 1779862800000 } } }],
    count: 20
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(posted[0]?.ok, true, posted[0]?.error);
  assert.deepEqual(
    historyRequests.map((request) => {
      const record = request as Record<string, unknown>;
      return {
        conversationCode: record.conversationCode,
        sendTime: record.sendTime,
        count: record.count,
        fetchType: record.fetchType
      };
    }),
    [
      {
        conversationCode: "conversation-code",
        sendTime: 1779862800000,
        count: 20,
        fetchType: false
      }
    ]
  );
  assert.deepEqual(posted[0]?.messagesByConversationId, {
    "conversation-code": [
      {
        message: {
          messageId: "history-1",
          uuid: "history-uuid-1",
          cid: "conversation-code",
          conversationCode: "conversation-code",
          messageType: "text",
          content: { text: { content: "older message" } },
          sendTime: 1779862700000,
          sender: { uid: "buyer-ali" }
        }
      }
    ]
  });
  assert.equal(JSON.stringify(posted[0]).includes("must-not-leave-page"), false);
});

function createFakeWindow(input: {
  resources: FakeResourceEntry[];
  request: (options: unknown, callback: (response: unknown) => void) => void;
  jsonp?: (endpoint: string, options: unknown) => Promise<unknown>;
  conversationPage?: (options: unknown) => Promise<unknown> | unknown;
  legacyConversationPage?: (options: unknown) => Promise<unknown> | unknown;
  conversationContactDetails?: (contacts: unknown[]) => Promise<unknown> | unknown;
  messageHistory?: (options: unknown) => Promise<unknown> | unknown;
  posted: PostedMessage[];
  accountGlobals?: Record<string, string>;
}) {
  const listeners: Array<(event: { source: unknown; data: unknown }) => void> = [];
  const fakeWindow = {
    ...(input.accountGlobals || {}),
    location: { origin: "https://onetalk.alibaba.com" },
    performance: {
      getEntriesByType(type: string) {
        return type === "resource" ? input.resources : [];
      }
    },
    lib: {
      mtop: {
        request: input.request
      }
    },
    IcbuIM: {
      IMBaaSSDK: {
        default: {
          getConversationServiceV2: () => ({
            getConversationListByPagination: input.conversationPage
          }),
          getConversationServiceHttp: () => ({
            getConversationContactDetailList:
              input.conversationContactDetails ??
              (() => {
                throw new Error("conversation_contact_detail_should_not_be_called");
              })
          }),
          getConversationService: () => ({
            getConversationListByPagination:
              input.legacyConversationPage ??
              (() => {
                throw new Error("legacy_conversation_service_should_not_be_called");
              })
          }),
          getMessageServiceV2: () => ({
            listMessageWithConversationCodeForHistory: input.messageHistory
              ? (options: Record<string, unknown>) => {
                  void Promise.resolve(input.messageHistory?.(options)).then(options.dataCallback as (value: unknown) => void);
                }
              : undefined,
            listMessageWithConversationCode: input.messageHistory
              ? (options: Record<string, unknown>) => {
                  void Promise.resolve(input.messageHistory?.(options)).then(options.dataCallback as (value: unknown) => void);
                }
              : undefined
          })
        }
      },
      lib: {
        requestHelper: {
          jsonp: input.jsonp
        }
      }
    },
    addEventListener(type: string, listener: (event: { source: unknown; data: unknown }) => void) {
      if (type === "message") listeners.push(listener);
    },
    postMessage(message: PostedMessage, _origin: string) {
      input.posted.push(message);
    },
    dispatchMessage(data: unknown) {
      for (const listener of listeners) listener({ source: fakeWindow, data });
    }
  };
  return fakeWindow;
}
