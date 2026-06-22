import type { ChromeApi } from "../shared/chrome-api.js";

const WHATSAPP_TAB_URL = "https://web.whatsapp.com/*";
const WHATSAPP_CONTENT_BRIDGE_FILE = "channels/whatsapp-web/whatsapp-page-bridge.js";

export async function sendMessageToWhatsAppTab(chromeApi: ChromeApi, message: unknown): Promise<unknown> {
  if (!chromeApi.tabs) throw new Error("chrome_tabs_unavailable");
  const tab = (await chromeApi.tabs.query({ url: WHATSAPP_TAB_URL })).find((item) => typeof item.id === "number");
  if (typeof tab?.id !== "number") throw new Error("whatsapp_web_tab_required");
  return sendMessageWithBridgeRetry(chromeApi, tab.id, message);
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
  if (!chromeApi.scripting) throw new Error("whatsapp_web_content_bridge_unavailable");
  await chromeApi.scripting.executeScript({
    target: { tabId },
    files: [WHATSAPP_CONTENT_BRIDGE_FILE]
  });
}

function isMissingReceiverError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Could not establish connection|Receiving end does not exist/i.test(message);
}
