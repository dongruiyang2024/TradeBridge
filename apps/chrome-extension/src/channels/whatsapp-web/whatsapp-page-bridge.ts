import type { ChromeApi } from "../../shared/chrome-api.js";
import type { ExtensionMessage } from "../../shared/extension-messages.js";
import type { OutboundMessage } from "../../shared/sync-types.js";

interface ContentBridgeGlobal {
  __tradeBridgeWhatsAppContentBridgeInstalled?: boolean;
}

const PAGE_SCRIPT_FILE = "channels/whatsapp-web/whatsapp-page-script.js";
const PAGE_SOURCE = "tradebridge-whatsapp-web-page";
const EXTENSION_SOURCE = "tradebridge-extension";
const chromeApi = (globalThis as unknown as { chrome: ChromeApi }).chrome;
const bridgeGlobal = globalThis as unknown as ContentBridgeGlobal;

if (!bridgeGlobal.__tradeBridgeWhatsAppContentBridgeInstalled) {
  bridgeGlobal.__tradeBridgeWhatsAppContentBridgeInstalled = true;
  installBridge();
}

function installBridge(): void {
  injectPageScript();
  observePageMessages();

  void chromeApi.runtime.sendMessage({
    type: "whatsapp-web-page-ready",
    url: location.href
  }).catch(() => undefined);

  chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const typed = message as ExtensionMessage;
    if (typed.type === "send-whatsapp-web-message") {
      void sendOutboundMessageToPage(typed.message).then(sendResponse);
      return true;
    }
    return false;
  });
}

function observePageMessages(): void {
  window.addEventListener("message", (event) => {
    if (event.source !== window || !isRecord(event.data)) return;
    if (event.data.source !== PAGE_SOURCE) return;
    if (event.data.type === "whatsapp-web-messages-observed") {
      const externalConversationId =
        typeof event.data.externalConversationId === "string" ? event.data.externalConversationId : "";
      const messages = Array.isArray(event.data.messages) ? event.data.messages.filter(isRecord) : [];
      if (!externalConversationId || !messages.length) return;
      void chromeApi.runtime
        .sendMessage({ type: "whatsapp-web-messages-observed", externalConversationId, messages })
        .catch(() => undefined);
      return;
    }
    if (event.data.type === "whatsapp-web-runtime-unavailable") {
      void chromeApi.runtime
        .sendMessage({ type: "whatsapp-web-capture-diagnostics", seenEventNames: ["runtime-unavailable"] })
        .catch(() => undefined);
    }
  });
}

function injectPageScript(): void {
  const target = document.documentElement || document.head;
  if (!target) {
    document.addEventListener("DOMContentLoaded", injectPageScript, { once: true });
    return;
  }

  const script = document.createElement("script");
  script.src = chromeApi.runtime.getURL(PAGE_SCRIPT_FILE);
  script.async = false;
  script.onload = () => script.remove();
  target.append(script);
}

async function sendOutboundMessageToPage(message: OutboundMessage) {
  const requestId = `tradebridge-whatsapp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      resolve({ ok: false, error: "whatsapp_web_send_timeout" });
    }, 15_000);

    function handleMessage(event: MessageEvent): void {
      if (event.source !== window || !isRecord(event.data)) return;
      if (event.data.source !== PAGE_SOURCE) return;
      if (event.data.type !== "send-whatsapp-web-message-result" || event.data.requestId !== requestId) return;

      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
      resolve({
        ok: event.data.ok === true,
        externalMessageId: typeof event.data.externalMessageId === "string" ? event.data.externalMessageId : undefined,
        error: typeof event.data.error === "string" ? event.data.error : undefined
      });
    }

    window.addEventListener("message", handleMessage);
    window.postMessage(
      {
        source: EXTENSION_SOURCE,
        type: "send-whatsapp-web-message",
        requestId,
        message
      },
      window.location.origin
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
