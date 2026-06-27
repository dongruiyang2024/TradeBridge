import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { BrowserChannelAdapter } from "../src/background/browser-channel-adapters.js";
import { runOutboundDelivery, sendOutboundMessagesViaOneTalk } from "../src/background/outbound-orchestrator.js";
import { OutboundPacer } from "../src/background/outbound-pacer.js";
import type { ChromeApi } from "../src/shared/chrome-api.js";
import type { ExtensionConfig, ExtensionStatus, OutboundMessage } from "../src/shared/sync-types.js";

// A pacer with no delays and generous caps, so delivery tests assert routing
// and reporting without waiting on real timers. Pacing itself is covered in
// outbound-pacer.test.ts.
function instantPacer() {
  return new OutboundPacer({
    minDelayMs: 0,
    maxDelayMs: 0,
    maxPerMinute: 1000,
    maxPerHour: 1000,
    sleep: async () => undefined
  });
}

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
  const listRequests: Array<{ serverUrl: string; collectorToken: string; channel?: string; channelAccountExternalId?: string }> = [];
  const sentToTab: unknown[] = [];

  const result = await runOutboundDelivery({
    stateStore: store,
    chromeApi: fakeChromeApi(sentToTab, { ok: true, externalMessageId: "onetalk-msg-1" }),
    pacer: instantPacer(),
    listOutboundMessages: async (options) => {
      listRequests.push(options);
      return [outboundMessage()];
    },
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
  assert.equal(listRequests[0].channel, "alibaba-im");
  assert.equal(listRequests[0].channelAccountExternalId, "seller-1");
  assert.deepEqual(sentToTab, [{ type: "send-onetalk-message", message: outboundMessage() }]);
});

test("runOutboundDelivery can send through a registered browser channel adapter", async () => {
  const store = new MemoryStateStore();
  const delivered: Array<{ outboundMessageId: string; status: string; externalMessageId?: string }> = [];
  const listRequests: Array<{ serverUrl: string; collectorToken: string; channel?: string; channelAccountExternalId?: string }> = [];
  const sentMessages: OutboundMessage[] = [];
  const marketplaceAdapter: BrowserChannelAdapter = {
    channel: "marketplace-chat",
    surface: "marketplace-web",
    channelAccount: () => ({
      channel: "marketplace-chat",
      externalAccountId: "marketplace-account-1",
      surface: "marketplace-web"
    }),
    async send(_chromeApi, message) {
      sentMessages.push(message);
      return { ok: true, externalMessageId: `marketplace-${message.id}` };
    }
  };

  const result = await runOutboundDelivery({
    stateStore: store,
    chromeApi: fakeChromeApi([], { ok: true }),
    pacer: instantPacer(),
    adapters: [marketplaceAdapter],
    listOutboundMessages: async (options) => {
      listRequests.push(options);
      return [
        outboundMessage({
          channel: "marketplace-chat",
          channelAccountExternalId: "marketplace-account-1"
        })
      ];
    },
    markOutboundMessageDelivered: async (options) => {
      delivered.push(options);
      return {
        ...outboundMessage(),
        status: options.status,
        externalMessageId: options.externalMessageId
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(listRequests[0].channel, "marketplace-chat");
  assert.equal(listRequests[0].channelAccountExternalId, "marketplace-account-1");
  assert.deepEqual(sentMessages.map((message) => message.channel), ["marketplace-chat"]);
  assert.equal(delivered[0].externalMessageId, "marketplace-outbound-1");
});

test("runOutboundDelivery marks queued messages failed when no OneTalk tab is open", async () => {
  const store = new MemoryStateStore();
  const delivered: Array<{ status: string; errorCode?: string }> = [];

  const result = await runOutboundDelivery({
    stateStore: store,
    chromeApi: fakeChromeApi([], { ok: false }, []),
    pacer: instantPacer(),
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
    pacer: instantPacer(),
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
    messages: [outboundMessage()],
    pacer: instantPacer()
  });

  assert.deepEqual(reports, [
    {
      outboundMessageId: "outbound-1",
      status: "sent",
      channel: "alibaba-im",
      externalMessageId: "onetalk-msg-1"
    }
  ]);
  assert.deepEqual(sentToTab, [{ type: "send-onetalk-message", message: outboundMessage() }]);
});

test("sendOutboundMessagesViaOneTalk rejects messages for other channel types", async () => {
  const sentToTab: unknown[] = [];

  const reports = await sendOutboundMessagesViaOneTalk({
    chromeApi: fakeChromeApi(sentToTab, { ok: true }),
    messages: [{ ...outboundMessage(), channel: "marketplace-chat" }],
    pacer: instantPacer()
  });

  assert.deepEqual(reports, [
    {
      outboundMessageId: "outbound-1",
      status: "failed",
      channel: "marketplace-chat",
      errorCode: "channel_not_supported_by_collector",
      errorMessage: "Channel not supported by collector"
    }
  ]);
  assert.deepEqual(sentToTab, []);
});

test("sendOutboundMessagesViaOneTalk stops at the pacer rate cap, leaving the rest unreported for retry", async () => {
  const sentToTab: unknown[] = [];
  const pacer = new OutboundPacer({
    minDelayMs: 0,
    maxDelayMs: 0,
    maxPerMinute: 2,
    maxPerHour: 1000,
    sleep: async () => undefined
  });
  const messages = [
    { ...outboundMessage(), id: "outbound-1" },
    { ...outboundMessage(), id: "outbound-2" },
    { ...outboundMessage(), id: "outbound-3" }
  ];

  const reports = await sendOutboundMessagesViaOneTalk({
    chromeApi: fakeChromeApi(sentToTab, { ok: true, externalMessageId: "x" }),
    messages,
    pacer
  });

  // Only the first two pass the per-minute cap; the third is deferred (no
  // report), so it stays queued and retries next cycle.
  assert.deepEqual(reports.map((report) => report.outboundMessageId), ["outbound-1", "outbound-2"]);
  assert.equal(sentToTab.length, 2);
});

test("outbound send payload carries no third-party marker", () => {
  // The send payload is built in onetalk-page-script sendTextMessage. Guard
  // against reintroducing an ext/source marker that would travel upstream.
  const source = fs.readFileSync(path.resolve("src/channels/alibaba-im/onetalk-page-script.ts"), "utf8");
  assert.equal(source.includes('source: "tradebridge"'), false);
  assert.equal(/ext:\s*\{/.test(source), false);
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

function outboundMessage(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    id: "outbound-1",
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1",
    externalConversationId: "conv-1",
    content: "Hello",
    status: "queued",
    createdAt: "2026-05-27T07:00:00.000Z",
    updatedAt: "2026-05-27T07:00:00.000Z",
    ...overrides
  };
}
