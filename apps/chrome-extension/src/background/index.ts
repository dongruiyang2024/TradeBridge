import { BrowserOnetalkClient } from "./onetalk-client.js";
import { ExtensionStateStore } from "./storage.js";
import { runSyncOnce } from "./sync-orchestrator.js";
import { uploadSyncBatch } from "./tradebridge-client.js";
import { getChrome } from "../shared/chrome-api.js";
import type { ExtensionMessage } from "../shared/extension-messages.js";

const chromeApi = getChrome();
const stateStore = new ExtensionStateStore(chromeApi.storage.local);

chromeApi.runtime.onInstalled.addListener(() => {
  chromeApi.alarms.create("tradebridge-sync", { periodInMinutes: 30 });
});

chromeApi.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "tradebridge-sync") {
    void runDefaultSync();
  }
});

chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const typed = message as ExtensionMessage;
  if (typed.type === "sync-now") {
    void runDefaultSync().then(sendResponse);
    return true;
  }
  if (typed.type === "read-status") {
    void stateStore.getStatus().then(sendResponse);
    return true;
  }
  return false;
});

function runDefaultSync() {
  return runSyncOnce({
    stateStore,
    onetalkClient: new BrowserOnetalkClient(),
    uploadSyncBatch
  });
}
