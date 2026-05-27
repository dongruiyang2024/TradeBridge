import type { OutboundMessage } from "../shared/sync-types.js";

interface PageBridgeWindow extends Window {
  IcbuIM?: {
    IMBaaSSDK?: {
      default?: {
        getMessageService?: () => OneTalkMessageService;
      };
    };
  };
  lib?: {
    mtop?: {
      request?: (options: unknown, callback?: (response: unknown) => void) => Promise<unknown> | unknown;
    };
  };
  __tradeBridgeOneTalkPageBridgeInstalled?: boolean;
}

interface OneTalkMessageService {
  sendUIMessages?: (payload: unknown) => Promise<unknown> | unknown;
  sendMessage?: (payload: unknown) => Promise<unknown> | unknown;
  send?: (payload: unknown) => Promise<unknown> | unknown;
}

const pageWindow = window as PageBridgeWindow;

if (!pageWindow.__tradeBridgeOneTalkPageBridgeInstalled) {
  pageWindow.__tradeBridgeOneTalkPageBridgeInstalled = true;
  window.addEventListener("message", (event) => {
    if (event.source !== window || !isRecord(event.data)) return;
    if (event.data.source !== "tradebridge-extension") return;
    if (event.data.type === "send-onetalk-message") {
      void handleSendRequest(event.data);
      return;
    }
    if (event.data.type === "get-onetalk-im-token") {
      void handleTokenRequest(event.data);
    }
  });
}

async function handleSendRequest(data: Record<string, unknown>): Promise<void> {
  const requestId = typeof data.requestId === "string" ? data.requestId : "";
  const message = data.message;
  if (!requestId || !isOutboundMessage(message)) {
    publishResult(requestId, false, undefined, "invalid_outbound_message");
    return;
  }

  try {
    const result = await sendTextMessage(message);
    publishResult(requestId, true, externalMessageIdFromResult(result));
  } catch (error) {
    publishResult(requestId, false, undefined, error instanceof Error ? error.message : "onetalk_send_failed");
  }
}

async function handleTokenRequest(data: Record<string, unknown>): Promise<void> {
  const requestId = typeof data.requestId === "string" ? data.requestId : "";
  const appKey = typeof data.appKey === "string" ? data.appKey : "12574478";
  const deviceId = typeof data.deviceId === "string" ? data.deviceId : "";
  if (!requestId || !deviceId) {
    publishTokenResult(requestId, false, undefined, undefined, undefined, "invalid_token_request");
    return;
  }

  try {
    const result = await requestMtopToken(appKey, deviceId);
    const object = tokenObjectFromMtopResult(result);
    if (!object?.accessToken) throw new Error("onetalk_token_response_invalid");
    publishTokenResult(
      requestId,
      true,
      object.accessToken,
      object.refreshToken,
      object.accessTokenExpiredMillSeconds
    );
  } catch (error) {
    publishTokenResult(
      requestId,
      false,
      undefined,
      undefined,
      undefined,
      error instanceof Error ? error.message : "onetalk_token_fetch_failed"
    );
  }
}

function requestMtopToken(appKey: string, deviceId: string): Promise<unknown> {
  const request = pageWindow.lib?.mtop?.request;
  if (!request) return Promise.reject(new Error("onetalk_mtop_unavailable"));
  const options = {
    api: "mtop.alibaba.icbu.im.login.token.get",
    v: "1.0",
    appKey,
    dataType: "json",
    type: "GET",
    data: { appKey, deviceId }
  };
  return new Promise((resolve, reject) => {
    try {
      const maybePromise = request(options, resolve);
      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === "function") {
        (maybePromise as Promise<unknown>).then(resolve, reject);
      }
    } catch (error) {
      reject(error);
    }
  });
}

function tokenObjectFromMtopResult(value: unknown): {
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiredMillSeconds?: number;
} | null {
  const data = isRecord(value) && isRecord(value.data) ? value.data : null;
  const object = data && isRecord(data.object) ? data.object : null;
  if (!object) return null;
  return {
    accessToken: firstString(object, ["accessToken"]),
    refreshToken: firstString(object, ["refreshToken"]),
    accessTokenExpiredMillSeconds:
      typeof object.accessTokenExpiredMillSeconds === "number" ? object.accessTokenExpiredMillSeconds : undefined
  };
}

function publishTokenResult(
  requestId: string,
  ok: boolean,
  accessToken?: string,
  refreshToken?: string,
  expiresInMs?: number,
  error?: string
): void {
  window.postMessage(
    {
      source: "tradebridge-onetalk-page",
      type: "get-onetalk-im-token-result",
      requestId,
      ok,
      accessToken,
      refreshToken,
      expiresInMs,
      error
    },
    window.location.origin
  );
}

async function sendTextMessage(message: OutboundMessage): Promise<unknown> {
  const messageService = pageWindow.IcbuIM?.IMBaaSSDK?.default?.getMessageService?.();
  const send =
    messageService?.sendUIMessages?.bind(messageService) ||
    messageService?.sendMessage?.bind(messageService) ||
    messageService?.send?.bind(messageService);
  if (!send) throw new Error("onetalk_send_unavailable");

  return send({
    conversationCode: message.externalConversationId,
    cid: message.externalConversationId,
    content: message.content,
    text: message.content,
    messageType: "text",
    ext: {
      source: "tradebridge",
      outboundMessageId: message.id
    }
  });
}

function publishResult(requestId: string, ok: boolean, externalMessageId?: string, error?: string): void {
  window.postMessage(
    {
      source: "tradebridge-onetalk-page",
      type: "send-onetalk-message-result",
      requestId,
      ok,
      externalMessageId,
      error
    },
    window.location.origin
  );
}

function externalMessageIdFromResult(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return firstString(value, ["messageId", "msgId", "id", "externalMessageId", "clientMessageId"]);
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function isOutboundMessage(value: unknown): value is OutboundMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.externalConversationId === "string" &&
    typeof value.content === "string" &&
    value.content.trim().length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
