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
      expiresInMs: 3600000,
      appKey: "page-runtime-app-key",
      deviceId: "page-runtime-device-id"
    }),
    appKey: "12574478",
    deviceId: "chrome-extension-demo"
  });

  assert.equal(token.accessToken, "access-token");
  assert.equal(token.refreshToken, "refresh-token");
  assert.equal(token.expiresInMs, 3600000);
  assert.equal(token.appKey, "page-runtime-app-key");
  assert.equal(token.deviceId, "page-runtime-device-id");
  assert.deepEqual(sentMessages, [
    {
      type: "get-onetalk-im-token",
      appKey: "12574478",
      deviceId: "chrome-extension-demo"
    }
  ]);
});

test("requestOneTalkImToken injects the bridge and retries when the OneTalk tab has no receiver", async () => {
  const sentMessages: unknown[] = [];
  const injectedFiles: string[] = [];
  let sendAttempts = 0;

  const token = await requestOneTalkImToken({
    chromeApi: fakeChromeApi(sentMessages, {
      ok: true,
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresInMs: 3600000
    }, [{ id: 9 }], {
      injectedFiles,
      sendMessage: async (_tabId, message) => {
        sendAttempts += 1;
        if (sendAttempts === 1) throw new Error("Could not establish connection. Receiving end does not exist.");
        sentMessages.push(message);
        return {
          ok: true,
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresInMs: 3600000
        };
      }
    }),
    appKey: "12574478",
    deviceId: "chrome-extension-demo"
  });

  assert.equal(token.accessToken, "access-token");
  assert.equal(sendAttempts, 2);
  assert.deepEqual(injectedFiles, ["content/onetalk-page-bridge.js"]);
  assert.deepEqual(sentMessages, [
    {
      type: "get-onetalk-im-token",
      appKey: "12574478",
      deviceId: "chrome-extension-demo"
    }
  ]);
});

test("requestOneTalkImToken tries the next OneTalk tab when the first tab returns no token", async () => {
  const sentMessages: unknown[] = [];
  const token = await requestOneTalkImToken({
    chromeApi: fakeChromeApi(sentMessages, { ok: false, error: "onetalk_token_response_invalid" }, [{ id: 1 }, { id: 2 }], {
      sendMessage: async (tabId, message) => {
        sentMessages.push({ tabId, message });
        if (tabId === 1) return { ok: false, error: "onetalk_token_response_invalid" };
        return {
          ok: true,
          accessToken: "access-token-from-second-tab",
          appKey: "page-runtime-app-key",
          deviceId: "page-runtime-device-id"
        };
      }
    }),
    appKey: "12574478",
    deviceId: "chrome-extension-demo"
  });

  assert.equal(token.accessToken, "access-token-from-second-tab");
  assert.deepEqual(
    sentMessages.map((item) => (item as { tabId: number }).tabId),
    [1, 2]
  );
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

function fakeChromeApi(
  sentMessages: unknown[],
  response: unknown,
  tabs = [{ id: 9 }],
  options: {
    injectedFiles?: string[];
    sendMessage?: (tabId: number, message: unknown) => Promise<unknown>;
  } = {}
): ChromeApi {
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
      sendMessage: options.sendMessage || (async (_tabId, message) => {
        sentMessages.push(message);
        return response;
      })
    },
    scripting: {
      executeScript: async ({ files }) => {
        options.injectedFiles?.push(...files);
        return [];
      }
    }
  };
}
