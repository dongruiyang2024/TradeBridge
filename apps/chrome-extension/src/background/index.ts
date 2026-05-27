import {
  contactProfileRequestsFromConversations,
  requestOneTalkCustomerProfiles
} from "./onetalk-customer-profile-client.js";
import { BrowserOnetalkLwpClient } from "./onetalk-lwp-client.js";
import { requestOneTalkImToken } from "./onetalk-token-client.js";
import { runOutboundDelivery } from "./outbound-orchestrator.js";
import { ExtensionStateStore } from "./storage.js";
import { runSyncOnce } from "./sync-orchestrator.js";
import { listOutboundMessages, markOutboundMessageDelivered, uploadSyncBatch } from "./tradebridge-client.js";
import { getChrome } from "../shared/chrome-api.js";
import type { ExtensionMessage } from "../shared/extension-messages.js";

const chromeApi = getChrome();
const stateStore = new ExtensionStateStore(chromeApi.storage.local);

chromeApi.runtime.onInstalled.addListener(() => {
  chromeApi.alarms.create("tradebridge-sync", { periodInMinutes: 30 });
  chromeApi.alarms.create("tradebridge-outbound", { periodInMinutes: 1 });
});

chromeApi.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "tradebridge-sync") {
    void runDefaultSyncAndOutbound();
  }
  if (alarm.name === "tradebridge-outbound") {
    void runDefaultOutboundDelivery();
  }
});

chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const typed = message as ExtensionMessage;
  if (typed.type === "sync-now") {
    void runDefaultSyncAndOutbound().then(sendResponse);
    return true;
  }
  if (typed.type === "read-status") {
    void stateStore.getStatus().then(sendResponse);
    return true;
  }
  return false;
});

async function runDefaultSync() {
  const config = await stateStore.getConfig();
  return runSyncOnce({
    stateStore,
    onetalkClient: new BrowserOnetalkLwpClient({
      appKey: "12574478",
      deviceId: config?.deviceId || "chrome-extension",
      userAgent: navigator.userAgent,
      tokenProvider: async () =>
        requestOneTalkImToken({
          chromeApi,
          appKey: "12574478",
          deviceId: config?.deviceId || "chrome-extension"
        }),
      customerProfileProvider: async (conversations) =>
        requestOneTalkCustomerProfiles({
          chromeApi,
          contacts: contactProfileRequestsFromConversations(conversations)
        })
    }),
    uploadSyncBatch
  });
}

async function runDefaultSyncAndOutbound() {
  const sync = await runDefaultSync();
  await runDefaultOutboundDelivery();
  return sync;
}

function runDefaultOutboundDelivery() {
  return runOutboundDelivery({
    stateStore,
    chromeApi,
    listOutboundMessages,
    markOutboundMessageDelivered
  });
}
