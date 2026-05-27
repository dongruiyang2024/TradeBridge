import type { WeblitePageConversation, WeblitePageSnapshot } from "@wangwang/onetalk-adapter/browser";
import { getChrome } from "../shared/chrome-api.js";
import type { ExtensionMessage } from "../shared/extension-messages.js";
import { ONETALK_PAGE_SNAPSHOT_STORAGE_KEY } from "../shared/onetalk-page-snapshot.js";
import type { OutboundMessage } from "../shared/sync-types.js";

const loginRequired =
  /login\.alibaba\.com|newlogin/i.test(location.href) || Boolean(document.querySelector("input[type='password']"));

let snapshotTimer: number | undefined;

injectPageScript();

void getChrome().runtime.sendMessage({
  type: loginRequired ? "onetalk-login-required" : "onetalk-page-ready",
  url: location.href
}).catch(() => undefined);

getChrome().runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const typed = message as ExtensionMessage;
  if (typed.type === "send-onetalk-message") {
    void sendOutboundMessageToPage(typed.message).then(sendResponse);
    return true;
  }
  if (typed.type === "get-onetalk-im-token") {
    void requestImTokenFromPage(typed.appKey, typed.deviceId).then(sendResponse);
    return true;
  }
  return false;
});

if (!loginRequired) {
  startSnapshotObserverWhenReady();
}

function injectPageScript(): void {
  const target = document.documentElement || document.head;
  if (!target) {
    document.addEventListener("DOMContentLoaded", injectPageScript, { once: true });
    return;
  }

  const script = document.createElement("script");
  script.src = getChrome().runtime.getURL("content/onetalk-page-script.js");
  script.async = false;
  script.onload = () => script.remove();
  target.append(script);
}

function startSnapshotObserverWhenReady(): void {
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", startSnapshotObserverWhenReady, { once: true });
    return;
  }

  scheduleSnapshot();
  new MutationObserver(scheduleSnapshot).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
  window.setInterval(scheduleSnapshot, 10_000);
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

function scheduleSnapshot(): void {
  window.clearTimeout(snapshotTimer);
  snapshotTimer = window.setTimeout(() => {
    void publishSnapshot().catch(() => undefined);
  }, 800);
}

async function publishSnapshot(): Promise<void> {
  const snapshot = collectPageSnapshot();
  if (!snapshot.conversations?.length) return;
  const stored = {
    url: location.href,
    savedAt: new Date().toISOString(),
    snapshot
  };
  await getChrome().storage.local.set({ [ONETALK_PAGE_SNAPSHOT_STORAGE_KEY]: stored });
  await getChrome().runtime.sendMessage({
    type: "onetalk-page-snapshot",
    url: location.href,
    snapshot
  });
}

function collectPageSnapshot(): WeblitePageSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    conversations: collectVisibleConversations()
  };
}

function collectVisibleConversations(): WeblitePageConversation[] {
  const rows = new Map<number, WeblitePageConversation>();
  for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    const candidate = textCandidate(element);
    if (!candidate) continue;
    const bucket = Math.round(candidate.top / 48);
    if (rows.has(bucket)) continue;
    rows.set(bucket, {
      displayName: candidate.text,
      country: countryFromText(rowText(element))
    });
  }
  return Array.from(rows.values()).slice(0, 100);
}

function textCandidate(element: HTMLElement): { text: string; top: number } | null {
  const text = cleanText(element.innerText || element.textContent || "");
  if (!text || isIgnoredLabel(text)) return null;
  const rect = element.getBoundingClientRect();
  if (!isVisibleConversationName(element, rect)) return null;
  return { text, top: rect.top };
}

function isVisibleConversationName(element: HTMLElement, rect: DOMRect): boolean {
  const style = getComputedStyle(element);
  const weight = Number.parseInt(style.fontWeight, 10) || (style.fontWeight === "bold" ? 700 : 400);
  const leftLimit = Math.min(window.innerWidth * 0.35, 420);
  return (
    rect.width > 20 &&
    rect.height > 10 &&
    rect.height < 40 &&
    rect.top > 120 &&
    rect.left > 80 &&
    rect.left < leftLimit &&
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    weight >= 500
  );
}

function rowText(element: HTMLElement): string {
  let current: HTMLElement | null = element;
  while (current?.parentElement) {
    const rect = current.getBoundingClientRect();
    if (rect.height >= 40 && rect.height <= 140 && rect.width >= 160) return current.innerText || "";
    current = current.parentElement;
  }
  return element.innerText || "";
}

function countryFromText(text: string): string | undefined {
  const match = /\b[A-Z]{2}\b/.exec(text);
  return match?.[0];
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isIgnoredLabel(text: string): boolean {
  return (
    text.length > 80 ||
    /^[A-Z]{2}$/.test(text) ||
    /^(全部|未读|待回复|待跟进|消息|搜索|自动接待|客户|订单|物流报价|\d{4}-\d{2}-\d{2})$/.test(text)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
