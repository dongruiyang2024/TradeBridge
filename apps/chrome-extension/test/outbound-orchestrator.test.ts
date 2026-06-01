import assert from "node:assert/strict";
import { test } from "node:test";
import { runOutboundDelivery, sendOutboundMessagesViaOneTalk } from "../src/background/outbound-orchestrator.js";
import type { ChromeApi } from "../src/shared/chrome-api.js";
import type { ExtensionConfig, ExtensionStatus, OutboundMessage } from "../src/shared/sync-types.js";

class MemoryStateStore {
  config: ExtensionConfig | null = {
    serverUrl: "http://127.0.0.1:5032",
    collectorToken: "collector-token",
    sellerAccountExternalId: "seller-1",
    deviceId: "chrome-extension-demo"
  };
  status: ExtensionStatus = {};

  async getConfig() {
    return this.config;
  }

  async getStatus() {
    return this.status;
  }

  async saveStatus(status: ExtensionStatus) {
    this.status = status;
  }
}

test("runOutboundDelivery sends queued messages through an open OneTalk tab and marks delivery", async () => {
  const store = new MemoryStateStore();
  const delivered: Array<{ outboundMessageId: string; status: string; externalMessageId?: string }> = [];
  const sentToTab: unknown[] = [];

  const result = await runOutboundDelivery({
    stateStore: store,
    chromeApi: fakeChromeApi(sentToTab, { ok: true, externalMessageId: "onetalk-msg-1" }),
    listOutboundMessages: async () => [outboundMessage()],
    markOutboundMessageDelivered: async (options) => {
      delivered.push(options);
      return { ...outboundMessage(), status: options.status, externalMessageId: options.externalMessageId };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.sentCount, 1);
  assert.equal(delivered[0].outboundMessageId, "outbound-1");
  assert.equal(delivered[0].status, "sent");
  assert.equal(delivered[0].externalMessageId, "onetalk-msg-1");
  assert.deepEqual(sentToTab, [{ type: "send-onetalk-message", message: outboundMessage() }]);
});

test("runOutboundDelivery marks queued messages failed when no OneTalk tab is open", async () => {
  const store = new MemoryStateStore();
  const delivered: Array<{ status: string; errorCode?: string }> = [];

  const result = await runOutboundDelivery({
    stateStore: store,
    chromeApi: fakeChromeApi([], { ok: false }, []),
    listOutboundMessages: async () => [outboundMessage()],
    markOutboundMessageDelivered: async (options) => {
      delivered.push(options);
      return { ...outboundMessage(), status: options.status, errorCode: options.errorCode };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedCount, 1);
  assert.equal(delivered[0].status, "failed");
  assert.equal(delivered[0].errorCode, "onetalk_tab_required");
});

test("runOutboundDelivery marks sent when OneTalk page reports success without external message id", async () => {
  const store = new MemoryStateStore();
  const delivered: Array<{ outboundMessageId: string; status: string; externalMessageId?: string }> = [];

  const result = await runOutboundDelivery({
    stateStore: store,
    chromeApi: fakeChromeApi([], { ok: true }),
    listOutboundMessages: async () => [outboundMessage()],
    markOutboundMessageDelivered: async (options) => {
      delivered.push(options);
      return { ...outboundMessage(), status: options.status, externalMessageId: options.externalMessageId };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.sentCount, 1);
  assert.equal(delivered[0].status, "sent");
  assert.equal(delivered[0].externalMessageId, undefined);
});

test("sendOutboundMessagesViaOneTalk sends provided messages and returns delivery reports", async () => {
  const sentToTab: unknown[] = [];

  const reports = await sendOutboundMessagesViaOneTalk({
    chromeApi: fakeChromeApi(sentToTab, { ok: true, externalMessageId: "onetalk-msg-1" }),
    messages: [outboundMessage()]
  });

  assert.deepEqual(reports, [
    {
      outboundMessageId: "outbound-1",
      status: "sent",
      externalMessageId: "onetalk-msg-1"
    }
  ]);
  assert.deepEqual(sentToTab, [{ type: "send-onetalk-message", message: outboundMessage() }]);
});

function fakeChromeApi(sentToTab: unknown[], response: unknown, tabs = [{ id: 9 }]): ChromeApi {
  return {
    runtime: {
      onInstalled: { addListener: () => undefined },
      onMessage: { addListener: () => undefined },
      sendMessage: async () => undefined,
      getURL: (path) => `chrome-extension://id/${path}`,
      openOptionsPage: () => undefined
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => undefined
      }
    },
    alarms: {
      create: () => undefined,
      onAlarm: { addListener: () => undefined }
    },
    tabs: {
      query: async () => tabs,
      sendMessage: async (_tabId, message) => {
        sentToTab.push(message);
        return response;
      }
    }
  };
}

function outboundMessage(): OutboundMessage {
  return {
    id: "outbound-1",
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1",
    externalConversationId: "conv-1",
    content: "Hello",
    status: "queued",
    createdAt: "2026-05-27T07:00:00.000Z",
    updatedAt: "2026-05-27T07:00:00.000Z"
  };
}
