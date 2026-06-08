import assert from "node:assert/strict";
import { test } from "node:test";
import { OneTalkHistoryMessageSource } from "../src/background/onetalk-history-message-source.js";
import type { ChromeApi } from "../src/shared/chrome-api.js";
import type { ExtensionConfig } from "../src/shared/sync-types.js";

const config: ExtensionConfig = {
  serverUrl: "http://127.0.0.1:5032",
  collectorToken: "collector-token",
  sellerAccountExternalId: "seller-demo",
  deviceId: "chrome-extension-demo"
};

test("OneTalkHistoryMessageSource follows history backfill settings", async () => {
  const conversations = [{ singleChatUserConversation: { singleChatConversation: { cid: "conv-1" } } }];
  let requestCount = 0;
  let requestedLimit = 0;
  const source = new OneTalkHistoryMessageSource({
    chromeApi: {} as ChromeApi,
    requestHistoryMessages: async (options) => {
      requestCount += 1;
      requestedLimit = options.count;
      return { "conv-1": [{ message: { messageId: "m-history" } }] };
    }
  });

  assert.deepEqual(await source.read(conversations, { ...config, historyBackfillEnabled: false }), {});
  assert.equal(requestCount, 0);

  const result = await source.read(conversations, {
    ...config,
    historyBackfillEnabled: true,
    historyMessagesPerConversation: 500
  });

  assert.equal(requestCount, 1);
  assert.equal(requestedLimit, 100);
  assert.equal(result["conv-1"]?.length, 1);
});
