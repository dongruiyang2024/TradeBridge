import { getChrome } from "../shared/chrome-api.js";

const chromeApi = getChrome();

chromeApi.runtime.onInstalled.addListener(() => {
  chromeApi.alarms.create("tradebridge-sync", { periodInMinutes: 30 });
});
