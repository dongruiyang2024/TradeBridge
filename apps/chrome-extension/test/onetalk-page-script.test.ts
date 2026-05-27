import assert from "node:assert/strict";
import test from "node:test";

interface PostedMessage {
  source: string;
  type: string;
  requestId: string;
  ok: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresInMs?: number;
  appKey?: string;
  deviceId?: string;
  profiles?: unknown[];
  error?: string;
}

interface FakeResourceEntry {
  name: string;
}

test("OneTalk page token request reuses page runtime token parameters", async () => {
  const requests: unknown[] = [];
  const posted: PostedMessage[] = [];
  const pageDataAppKey = "7594e10385fca14f1521481c62f5cfd0";
  const pageDeviceId = "page-runtime-device-id-from-onetalk";
  const extensionDeviceId = "chrome-extension";

  const fakeWindow = createFakeWindow({
    resources: [
      {
        name: tokenResourceUrl({
          queryAppKey: "12574478",
          dataAppKey: pageDataAppKey,
          deviceId: pageDeviceId
        })
      }
    ],
    request: (options, callback) => {
      requests.push(options);
      callback({
        data: {
          object: {
            accessToken: "access-token",
            refreshToken: "refresh-token",
            accessTokenExpiredMillSeconds: 12345
          }
        }
      });
    },
    posted
  });

  Reflect.set(globalThis, "window", fakeWindow);
  await import("../src/content/onetalk-page-script");

  fakeWindow.dispatchMessage({
    source: "tradebridge-extension",
    type: "get-onetalk-im-token",
    requestId: "request-1",
    appKey: "12574478",
    deviceId: extensionDeviceId
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(requests, [
    {
      api: "mtop.alibaba.icbu.im.login.token.get",
      v: "1.0",
      appKey: "12574478",
      type: "jsonp",
      dataType: "jsonp",
      jsonpIncPrefix: "imList",
      timeout: 20000,
      wsConnectTimeout: 20000,
      batchConnectWs: true,
      log: {},
      data: {
        appKey: pageDataAppKey,
        deviceId: pageDeviceId
      }
    }
  ]);
  assert.equal(posted[0]?.ok, true);
  assert.equal(posted[0]?.accessToken, "access-token");
  assert.equal(posted[0]?.appKey, pageDataAppKey);
  assert.equal(posted[0]?.deviceId, pageDeviceId);
});

test("OneTalk page token request retries with JSON string data when object data has no token", async () => {
  const requests: unknown[] = [];
  const posted: PostedMessage[] = [];
  const pageDataAppKey = "7594e10385fca14f1521481c62f5cfd0";
  const pageDeviceId = "page-runtime-device-id-from-onetalk";

  const fakeWindow = createFakeWindow({
    resources: [
      {
        name: tokenResourceUrl({
          queryAppKey: "12574478",
          dataAppKey: pageDataAppKey,
          deviceId: pageDeviceId
        })
      }
    ],
    request: (options, callback) => {
      requests.push(options);
      const request = options as { data?: unknown };
      if (typeof request.data === "string") {
        callback({
          data: {
            object: {
              accessToken: "access-token",
              refreshToken: "refresh-token"
            }
          }
        });
        return;
      }

      callback({
        data: {
          errorCode: "7",
          errorMsg: "not support appkey"
        }
      });
    },
    posted
  });

  Reflect.set(globalThis, "window", fakeWindow);
  await import(`../src/content/onetalk-page-script?json-retry-${Date.now()}`);

  fakeWindow.dispatchMessage({
    source: "tradebridge-extension",
    type: "get-onetalk-im-token",
    requestId: "request-1",
    appKey: "12574478",
    deviceId: "chrome-extension"
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(requests.length, 2);
  assert.equal(typeof (requests[0] as { data?: unknown }).data, "object");
  assert.equal(
    (requests[1] as { data?: unknown }).data,
    JSON.stringify({
      appKey: pageDataAppKey,
      deviceId: pageDeviceId
    })
  );
  assert.equal(posted[0]?.ok, true);
  assert.equal(posted[0]?.accessToken, "access-token");
});

test("OneTalk page token request parses JSONP token responses", async () => {
  const posted: PostedMessage[] = [];
  const fakeWindow = createFakeWindow({
    resources: [],
    request: (_options, callback) => {
      callback(
        'mtopjsonpimList1({"data":{"object":{"accessToken":"access-token","refreshToken":"refresh-token","accessTokenExpiredMillSeconds":12345}}})'
      );
    },
    posted
  });

  Reflect.set(globalThis, "window", fakeWindow);
  await import(`../src/content/onetalk-page-script?jsonp-response-${Date.now()}`);

  fakeWindow.dispatchMessage({
    source: "tradebridge-extension",
    type: "get-onetalk-im-token",
    requestId: "request-jsonp",
    appKey: "12574478",
    deviceId: "chrome-extension"
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(posted[0]?.ok, true);
  assert.equal(posted[0]?.accessToken, "access-token");
  assert.equal(posted[0]?.refreshToken, "refresh-token");
  assert.equal(posted[0]?.expiresInMs, 12345);
});

test("OneTalk page token request preserves token errors", async () => {
  const posted: PostedMessage[] = [];
  const fakeWindow = createFakeWindow({
    resources: [],
    request: () => {
      throw new Error("onetalk_token_probe_failed");
    },
    posted
  });

  Reflect.set(globalThis, "window", fakeWindow);
  await import(`../src/content/onetalk-page-script?error-path-${Date.now()}`);

  fakeWindow.dispatchMessage({
    source: "tradebridge-extension",
    type: "get-onetalk-im-token",
    requestId: "request-error",
    appKey: "12574478",
    deviceId: "chrome-extension"
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(posted[0]?.ok, false);
  assert.equal(posted[0]?.error, "onetalk_token_probe_failed");
});

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
  await import(`../src/content/onetalk-page-script?customer-profile-${Date.now()}`);

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

function createFakeWindow(input: {
  resources: FakeResourceEntry[];
  request: (options: unknown, callback: (response: unknown) => void) => void;
  jsonp?: (endpoint: string, options: unknown) => Promise<unknown>;
  posted: PostedMessage[];
}) {
  const listeners: Array<(event: { source: unknown; data: unknown }) => void> = [];
  const fakeWindow = {
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

function tokenResourceUrl(input: { queryAppKey: string; dataAppKey: string; deviceId: string }) {
  const url = new URL("https://acs.h.alibaba.com/h5/mtop.alibaba.icbu.im.login.token.get/1.0/");
  url.searchParams.set("appKey", input.queryAppKey);
  url.searchParams.set(
    "data",
    JSON.stringify({
      appKey: input.dataAppKey,
      deviceId: input.deviceId
    })
  );
  return url.toString();
}
