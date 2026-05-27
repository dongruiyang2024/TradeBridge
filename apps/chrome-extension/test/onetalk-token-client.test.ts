import assert from "node:assert/strict";
import { test } from "node:test";
import { requestOneTalkImToken } from "../src/background/onetalk-token-client.js";
import type { ChromeApi } from "../src/shared/chrome-api.js";

test("requestOneTalkImToken sends request to an open OneTalk tab", async () => {
  const sentMessages: unknown[] = [];
  const token = await requestOneTalkImToken({
    chromeApi: fakeChromeApi(sentMessages, {
      ok: true,
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresInMs: 3600000
    }),
    appKey: "12574478",
    deviceId: "chrome-extension-demo"
  });

  assert.equal(token.accessToken, "access-token");
  assert.equal(token.refreshToken, "refresh-token");
  assert.equal(token.expiresInMs, 3600000);
  assert.deepEqual(sentMessages, [
    {
      type: "get-onetalk-im-token",
      appKey: "12574478",
      deviceId: "chrome-extension-demo"
    }
  ]);
});

test("requestOneTalkImToken fails when no OneTalk tab is open", async () => {
  await assert.rejects(
    () =>
      requestOneTalkImToken({
        chromeApi: fakeChromeApi([], { ok: false }, []),
        appKey: "12574478",
        deviceId: "chrome-extension-demo"
      }),
    /onetalk_tab_required/
  );
});

test("requestOneTalkImToken rejects invalid page responses", async () => {
  await assert.rejects(
    () =>
      requestOneTalkImToken({
        chromeApi: fakeChromeApi([], { ok: true, accessToken: "" }),
        appKey: "12574478",
        deviceId: "chrome-extension-demo"
      }),
    /onetalk_token_response_invalid/
  );
});

function fakeChromeApi(sentMessages: unknown[], response: unknown, tabs = [{ id: 9 }]): ChromeApi {
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
      query: async () => tabs,
      sendMessage: async (_tabId, message) => {
        sentMessages.push(message);
        return response;
      }
    }
  };
}
