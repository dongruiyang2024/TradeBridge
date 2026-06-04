import { lwpMessagesPageFromFrame, parseLwpFrame } from "@wangwang/onetalk-adapter/browser";

// Passive OneTalk message tap (runs in the page MAIN world).
//
// The OneTalk IM SDK maintains exactly one WebSocket to the LWP endpoint. We
// observe the frames that flow over THAT existing socket — we never open a
// second connection and never call send() ourselves. This keeps the network
// fingerprint identical to a normal user and avoids the duplicate-IM-session
// signature that triggers risk control.
//
// Two hooks cover both socket lifecycles:
//   1. Wrapping the WebSocket constructor attaches an inbound listener to any
//      socket created after install (the normal case at document_start, and
//      any later reconnect).
//   2. Patching prototype.send attaches an inbound listener the first time an
//      already-existing socket sends a frame (covers a socket created before
//      install, e.g. slow injection).
//
// Only sanitized message bodies are forwarded, grouped by conversation id.

interface TapGlobal {
  __tradeBridgeOneTalkMessageTapInstalled?: boolean;
}

const INBOUND_TAG = "__tradeBridgeOneTalkMessageTapped";
const IM_SOCKET_PATTERN = /dingtalk\.com|icbu|wss-/i;

export function installOneTalkMessageTap(targetWindow: Window): void {
  const tapGlobal = targetWindow as unknown as TapGlobal;
  if (tapGlobal.__tradeBridgeOneTalkMessageTapInstalled) return;

  const socketHost = targetWindow as unknown as { WebSocket?: typeof WebSocket };
  const NativeWebSocket = socketHost.WebSocket;
  if (typeof NativeWebSocket !== "function") return;
  tapGlobal.__tradeBridgeOneTalkMessageTapInstalled = true;

  const tapInbound = (socket: WebSocket & Record<string, unknown>): void => {
    try {
      if (socket[INBOUND_TAG]) return;
      socket[INBOUND_TAG] = true;
      socket.addEventListener("message", (event) => {
        try {
          handleFrame(targetWindow, (event as MessageEvent).data);
        } catch {
          // A single bad frame must never disrupt the page.
        }
      });
    } catch {
      // Never let tap installation break the socket.
    }
  };

  const originalSend = NativeWebSocket.prototype.send;
  if (typeof originalSend === "function") {
    NativeWebSocket.prototype.send = function patchedSend(this: WebSocket, ...args: unknown[]) {
      try {
        if (isImSocketUrl(this.url)) tapInbound(this as WebSocket & Record<string, unknown>);
      } catch {
        // ignore
      }
      return (originalSend as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof originalSend;
  }

  const WrappedWebSocket = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    try {
      if (isImSocketUrl(url)) tapInbound(socket as WebSocket & Record<string, unknown>);
    } catch {
      // ignore
    }
    return socket;
  } as unknown as typeof WebSocket;

  WrappedWebSocket.prototype = NativeWebSocket.prototype;
  // Copy the static readyState constants so callers reading WebSocket.OPEN etc.
  // still work. Cast through an index signature to bypass their readonly types.
  const target = WrappedWebSocket as unknown as Record<string, unknown>;
  const source = NativeWebSocket as unknown as Record<string, unknown>;
  for (const key of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) {
    target[key] = source[key];
  }
  try {
    socketHost.WebSocket = WrappedWebSocket;
  } catch {
    // If the constructor cannot be replaced, prototype.send patching still covers live sockets.
  }
}

function handleFrame(targetWindow: Window, data: unknown): void {
  decodeFrameText(data, (text) => {
    let frame;
    try {
      frame = parseLwpFrame(text);
    } catch {
      return;
    }
    const messages = lwpMessagesPageFromFrame(frame).messages;
    if (!messages.length) return;
    publishByConversation(targetWindow, messages);
  });
}

// Frames are text in practice (probe-confirmed), but tolerate Blob/ArrayBuffer
// just in case a future SDK build switches binary framing.
function decodeFrameText(data: unknown, onText: (text: string) => void): void {
  if (typeof data === "string") {
    onText(data);
    return;
  }
  if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer) {
    onText(new TextDecoder().decode(data));
    return;
  }
  if (ArrayBuffer.isView?.(data as ArrayBufferView)) {
    onText(new TextDecoder().decode(data as ArrayBufferView));
    return;
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    void data.text().then(onText).catch(() => undefined);
  }
}

function publishByConversation(targetWindow: Window, messages: Record<string, unknown>[]): void {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const message of messages) {
    const cid = conversationIdOf(message);
    if (!cid) continue;
    const bucket = grouped.get(cid);
    if (bucket) bucket.push(message);
    else grouped.set(cid, [message]);
  }
  for (const [externalConversationId, groupedMessages] of grouped) {
    targetWindow.postMessage(
      {
        source: "tradebridge-onetalk-page",
        type: "onetalk-messages-observed",
        externalConversationId,
        messages: groupedMessages
      },
      targetWindow.location.origin
    );
  }
}

function conversationIdOf(message: Record<string, unknown>): string | undefined {
  const direct = stringValue(message.cid) || stringValue(message.conversationCode) || stringValue(message.conversationId);
  if (direct) return direct;
  const body = isRecord(message.message) ? message.message : undefined;
  if (!body) return undefined;
  return stringValue(body.cid) || stringValue(body.conversationCode) || stringValue(body.conversationId);
}

function isImSocketUrl(url: unknown): boolean {
  return IM_SOCKET_PATTERN.test(String(url ?? ""));
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
