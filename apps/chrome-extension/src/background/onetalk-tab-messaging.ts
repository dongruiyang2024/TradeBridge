import type { ChromeApi } from "../shared/chrome-api.js";

const ONETALK_TAB_URL = "https://onetalk.alibaba.com/*";
const ONETALK_CONTENT_BRIDGE_FILE = "channels/alibaba-im/onetalk-page-bridge.js";

export async function sendMessageToOneTalkTab(chromeApi: ChromeApi, message: unknown): Promise<unknown> {
  if (!chromeApi.tabs) throw new Error("chrome_tabs_unavailable");
  const tab = (await queryOneTalkTabs(chromeApi)).find((item) => typeof item.id === "number");
  if (typeof tab?.id !== "number") throw new Error("onetalk_tab_required");
  return sendMessageWithBridgeRetry(chromeApi, tab.id, message);
}

export async function sendMessageToAllOneTalkTabs(chromeApi: ChromeApi, message: unknown): Promise<unknown[]> {
  const tabs = await queryOneTalkTabs(chromeApi);
  const responses: unknown[] = [];
  for (const tab of tabs) {
    if (typeof tab.id !== "number") continue;
    try {
      responses.push(await sendMessageWithBridgeRetry(chromeApi, tab.id, message));
    } catch (error) {
      responses.push(error);
    }
  }
  if (!responses.length) throw new Error("onetalk_tab_required");
  return responses;
}

async function queryOneTalkTabs(chromeApi: ChromeApi) {
  if (!chromeApi.tabs) throw new Error("chrome_tabs_unavailable");
  return chromeApi.tabs.query({ url: ONETALK_TAB_URL });
}

async function sendMessageWithBridgeRetry(chromeApi: ChromeApi, tabId: number, message: unknown): Promise<unknown> {
  try {
    return await chromeApi.tabs?.sendMessage(tabId, message);
  } catch (error) {
    if (!isMissingReceiverError(error)) throw error;
    await injectContentBridge(chromeApi, tabId);
    return chromeApi.tabs?.sendMessage(tabId, message);
  }
}

async function injectContentBridge(chromeApi: ChromeApi, tabId: number): Promise<void> {
  if (!chromeApi.scripting) throw new Error("onetalk_content_bridge_unavailable");
  await chromeApi.scripting.executeScript({
    target: { tabId },
    files: [ONETALK_CONTENT_BRIDGE_FILE]
  });
}

function isMissingReceiverError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Could not establish connection|Receiving end does not exist/i.test(message);
}
