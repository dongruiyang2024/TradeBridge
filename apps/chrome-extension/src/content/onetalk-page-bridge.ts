import type { ChromeApi } from "../shared/chrome-api.js";
import type { ExtensionMessage, OneTalkCustomerProfileContact } from "../shared/extension-messages.js";
import type { OutboundMessage } from "../shared/sync-types.js";

interface ContentBridgeGlobal {
  __tradeBridgeOneTalkContentBridgeInstalled?: boolean;
}

const chromeApi = (globalThis as unknown as { chrome: ChromeApi }).chrome;
const bridgeGlobal = globalThis as unknown as ContentBridgeGlobal;
const loginRequired = /login\.alibaba\.com|newlogin/i.test(location.href);

if (!bridgeGlobal.__tradeBridgeOneTalkContentBridgeInstalled) {
  bridgeGlobal.__tradeBridgeOneTalkContentBridgeInstalled = true;
  installBridge();
}

function installBridge(): void {
  injectPageScript();

  void chromeApi.runtime.sendMessage({
    type: loginRequired ? "onetalk-login-required" : "onetalk-page-ready",
    url: location.href
  }).catch(() => undefined);

  chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const typed = message as ExtensionMessage;
    if (typed.type === "send-onetalk-message") {
      void sendOutboundMessageToPage(typed.message).then(sendResponse);
      return true;
    }
    if (typed.type === "get-onetalk-im-token") {
      void requestImTokenFromPage(typed.appKey, typed.deviceId).then(sendResponse);
      return true;
    }
    if (typed.type === "get-onetalk-customer-profiles") {
      void requestCustomerProfilesFromPage(typed.contacts).then(sendResponse);
      return true;
    }
    if (typed.type === "get-onetalk-conversations") {
      void requestConversationsFromPage(typed.cursor, typed.count).then(sendResponse);
      return true;
    }
    return false;
  });

}

function injectPageScript(): void {
  const target = document.documentElement || document.head;
  if (!target) {
    document.addEventListener("DOMContentLoaded", injectPageScript, { once: true });
    return;
  }

  const script = document.createElement("script");
  script.src = chromeApi.runtime.getURL("content/onetalk-page-script.js");
  script.async = false;
  script.onload = () => script.remove();
  target.append(script);
}

async function sendOutboundMessageToPage(message: OutboundMessage) {
  const requestId = `tradebridge-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      resolve({ ok: false, error: "onetalk_send_timeout" });
    }, 15_000);

    function handleMessage(event: MessageEvent): void {
      if (event.source !== window || !isRecord(event.data)) return;
      if (event.data.source !== "tradebridge-onetalk-page") return;
      if (event.data.type !== "send-onetalk-message-result" || event.data.requestId !== requestId) return;

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
        source: "tradebridge-extension",
        type: "send-onetalk-message",
        requestId,
        message
      },
      window.location.origin
    );
  });
}

async function requestImTokenFromPage(appKey: string, deviceId: string) {
  const requestId = `tradebridge-token-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      resolve({ ok: false, error: "onetalk_token_timeout" });
    }, 15_000);

    function handleMessage(event: MessageEvent): void {
      if (event.source !== window || !isRecord(event.data)) return;
      if (event.data.source !== "tradebridge-onetalk-page") return;
      if (event.data.type !== "get-onetalk-im-token-result" || event.data.requestId !== requestId) return;

      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
      resolve({
        ok: event.data.ok === true,
        accessToken: typeof event.data.accessToken === "string" ? event.data.accessToken : undefined,
        refreshToken: typeof event.data.refreshToken === "string" ? event.data.refreshToken : undefined,
        expiresInMs: typeof event.data.expiresInMs === "number" ? event.data.expiresInMs : undefined,
        appKey: typeof event.data.appKey === "string" ? event.data.appKey : undefined,
        deviceId: typeof event.data.deviceId === "string" ? event.data.deviceId : undefined,
        error: typeof event.data.error === "string" ? event.data.error : undefined
      });
    }

    window.addEventListener("message", handleMessage);
    window.postMessage(
      {
        source: "tradebridge-extension",
        type: "get-onetalk-im-token",
        requestId,
        appKey,
        deviceId
      },
      window.location.origin
    );
  });
}

async function requestCustomerProfilesFromPage(contacts: OneTalkCustomerProfileContact[]) {
  const requestId = `tradebridge-profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      resolve({ ok: false, error: "onetalk_customer_profile_timeout" });
    }, 30_000);

    function handleMessage(event: MessageEvent): void {
      if (event.source !== window || !isRecord(event.data)) return;
      if (event.data.source !== "tradebridge-onetalk-page") return;
      if (event.data.type !== "get-onetalk-customer-profiles-result" || event.data.requestId !== requestId) return;

      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
      resolve({
        ok: event.data.ok === true,
        profiles: Array.isArray(event.data.profiles) ? event.data.profiles : [],
        error: typeof event.data.error === "string" ? event.data.error : undefined
      });
    }

    window.addEventListener("message", handleMessage);
    window.postMessage(
      {
        source: "tradebridge-extension",
        type: "get-onetalk-customer-profiles",
        requestId,
        contacts
      },
      window.location.origin
    );
  });
}

async function requestConversationsFromPage(cursor: number, count: number) {
  const requestId = `tradebridge-conversations-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      resolve({ ok: false, error: "onetalk_conversation_timeout" });
    }, 15_000);

    function handleMessage(event: MessageEvent): void {
      if (event.source !== window || !isRecord(event.data)) return;
      if (event.data.source !== "tradebridge-onetalk-page") return;
      if (event.data.type !== "get-onetalk-conversations-result" || event.data.requestId !== requestId) return;

      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
      resolve({
        ok: event.data.ok === true,
        conversations: Array.isArray(event.data.conversations) ? event.data.conversations : [],
        nextCursor:
          typeof event.data.nextCursor === "number" || typeof event.data.nextCursor === "string"
            ? event.data.nextCursor
            : undefined,
        hasMore: event.data.hasMore === true,
        error: typeof event.data.error === "string" ? event.data.error : undefined
      });
    }

    window.addEventListener("message", handleMessage);
    window.postMessage(
      {
        source: "tradebridge-extension",
        type: "get-onetalk-conversations",
        requestId,
        cursor,
        count
      },
      window.location.origin
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
