// Passive OneTalk message tap (runs in the page MAIN world).
//
// OneTalk does NOT carry plaintext messages over its WebSocket (verified by the
// probe series). Instead, the page SDK routes every received/changed message
// through an internal event bus:
//   IcbuIM.IMBaaSSDK.IcbuEventServiceImpl.instance.emitter.emit(eventName, payload)
// and the live message service singleton is:
//   IcbuIM.IMBaaSSDK.IcbuMessageServiceImpl.instance
//
// We wrap emitter.emit (pass-through) and, for any payload that looks like a
// message, normalize it and forward it to the content bridge. We never open a
// socket, never send frames, and never break the page (emit return value is
// passed through; all work is wrapped in try/catch).
//
// First version filters by PAYLOAD SHAPE, not event name (the exact event name
// for "new message" is confirmed at runtime via the debug panel, then the
// filter is tightened). Seen event names are reported for that purpose.

interface TapGlobal {
  __tradeBridgeOneTalkMessageTapInstalled?: boolean;
  __tradeBridgeSeenEventNames?: string[];
}

interface SdkRoot {
  IcbuIM?: {
    IMBaaSSDK?: {
      IcbuEventServiceImpl?: { instance?: { emitter?: EmitterLike } };
    };
  };
}

interface EmitterLike {
  emit?: (...args: unknown[]) => unknown;
  __tradeBridgeEmitWrapped?: boolean;
}

const EMITTER_WRAP_TAG = "__tradeBridgeEmitWrapped";
const MAX_SEEN_EVENT_NAMES = 40;
const EMITTER_POLL_INTERVAL_MS = 500;
const EMITTER_POLL_MAX_ATTEMPTS = 40;

export function installOneTalkMessageTap(targetWindow: Window): void {
  const tapGlobal = targetWindow as unknown as TapGlobal;
  if (tapGlobal.__tradeBridgeOneTalkMessageTapInstalled) return;
  tapGlobal.__tradeBridgeOneTalkMessageTapInstalled = true;
  tapGlobal.__tradeBridgeSeenEventNames = tapGlobal.__tradeBridgeSeenEventNames || [];

  // The emitter may not exist yet at document_start; poll until it appears.
  let attempts = 0;
  const tryWrap = (): boolean => {
    const emitter = findEmitter(targetWindow);
    if (!emitter || typeof emitter.emit !== "function" || emitter[EMITTER_WRAP_TAG]) {
      return !!emitter && emitter[EMITTER_WRAP_TAG] === true;
    }
    wrapEmitter(targetWindow, emitter);
    return true;
  };
  if (tryWrap()) return;
  if (typeof targetWindow.setInterval !== "function") return;
  const timer = targetWindow.setInterval(() => {
    attempts += 1;
    if (tryWrap() || attempts >= EMITTER_POLL_MAX_ATTEMPTS) {
      targetWindow.clearInterval(timer);
    }
  }, EMITTER_POLL_INTERVAL_MS);
}

function findEmitter(targetWindow: Window): EmitterLike | undefined {
  const root = targetWindow as unknown as SdkRoot;
  return root.IcbuIM?.IMBaaSSDK?.IcbuEventServiceImpl?.instance?.emitter;
}

function wrapEmitter(targetWindow: Window, emitter: EmitterLike): void {
  const original = emitter.emit;
  if (typeof original !== "function") return;
  emitter.emit = function wrappedEmit(this: unknown, ...args: unknown[]) {
    try {
      observeEmit(targetWindow, args[0], args[1]);
    } catch {
      // Observation must never disrupt the page's own event dispatch.
    }
    return (original as (...a: unknown[]) => unknown).apply(this, args);
  };
  emitter[EMITTER_WRAP_TAG] = true;
}

function observeEmit(targetWindow: Window, eventName: unknown, payload: unknown): void {
  recordEventName(targetWindow, eventName);
  if (!isRecord(payload)) return;
  const message = extractMessage(payload);
  if (!message) return;
  const externalConversationId = message.cid;
  if (!externalConversationId) return;
  publish(targetWindow, externalConversationId, message.record);
}

function recordEventName(targetWindow: Window, eventName: unknown): void {
  const name = typeof eventName === "string" ? eventName : undefined;
  if (!name) return;
  const tapGlobal = targetWindow as unknown as TapGlobal;
  const seen = tapGlobal.__tradeBridgeSeenEventNames || (tapGlobal.__tradeBridgeSeenEventNames = []);
  if (seen.includes(name) || seen.length >= MAX_SEEN_EVENT_NAMES) return;
  seen.push(name);
  // A newly seen event name is reported so the popup debug panel can surface
  // the real event names (used to tighten filtering in a later version).
  publishDiagnostics(targetWindow, seen.slice());
}

function publishDiagnostics(targetWindow: Window, seenEventNames: string[]): void {
  targetWindow.postMessage(
    {
      source: "tradebridge-onetalk-page",
      type: "onetalk-capture-diagnostics",
      seenEventNames
    },
    targetWindow.location.origin
  );
}

function publish(targetWindow: Window, externalConversationId: string, record: Record<string, unknown>): void {
  targetWindow.postMessage(
    {
      source: "tradebridge-onetalk-page",
      type: "onetalk-messages-observed",
      externalConversationId,
      messages: [record]
    },
    targetWindow.location.origin
  );
}
interface ExtractedMessage {
  cid: string;
  record: Record<string, unknown>;
}

// Normalize an event-bus payload into a record shaped for the sync mapper,
// which reads `record.message` first and falls back to `record` itself. We
// emit { message: {...} } so the mapper's lwpMessage(raw) path applies.
//
// Two confirmed shapes:
//   A) payload.messageModel.{cid,messageId/uuid,content.text.content,createAt,sender.uid}
//   B) payload.{conversationCode,messageId/uuid,content,sender,sendTime,contact}
function extractMessage(payload: Record<string, unknown>): ExtractedMessage | null {
  const model = isRecord(payload.messageModel) ? payload.messageModel : null;

  // Shape A: messageModel present.
  if (model) {
    const cid = firstString(model, ["cid", "conversationCode"]);
    const messageId = firstString(model, ["messageId", "uuid"]);
    const content = textContentOf(model.content) ?? firstString(model, ["content"]);
    if (cid && (messageId || content)) {
      return {
        cid,
        record: {
          message: compact({
            messageId,
            cid,
            content,
            contentType: contentTypeOf(model.content),
            sendTime: numericValue(model.createAt) ?? numericValue(model.sendTime),
            sender: senderId(model.sender),
            receivers: model.receivers
          })
        }
      };
    }
  }

  // Shape B: top-level message event (often carries contact info too).
  const cid = firstString(payload, ["conversationCode", "cid"]);
  const messageId = firstString(payload, ["messageId", "uuid"]);
  const content = textContentOf(payload.content) ?? firstString(payload, ["content"]);
  // Require message-like markers; ignore typing/read-receipt/system-only events.
  if (cid && messageId && (content || isRecord(payload.content))) {
    return {
      cid,
      record: {
        message: compact({
          messageId,
          cid,
          content,
          contentType: contentTypeOf(payload.content),
          messageType: firstString(payload, ["messageType", "msgType"]),
          sendTime: numericValue(payload.sendTime) ?? numericValue(payload.createAt),
          sender: senderId(payload.sender)
        }),
        contact: isRecord(payload.contact) ? payload.contact : undefined
      }
    };
  }

  return null;
}

function textContentOf(content: unknown): string | undefined {
  if (typeof content === "string" && content.trim()) return content.trim();
  if (!isRecord(content)) return undefined;
  const text = content.text;
  if (typeof text === "string" && text.trim()) return text.trim();
  if (isRecord(text)) {
    const inner = text.content;
    if (typeof inner === "string" && inner.trim()) return inner.trim();
  }
  return undefined;
}

function contentTypeOf(content: unknown): string | undefined {
  if (!isRecord(content)) return undefined;
  return firstString(content, ["contentType"]);
}

function senderId(sender: unknown): string | undefined {
  if (typeof sender === "string" && sender.trim()) return sender.trim();
  if (isRecord(sender)) return firstString(sender, ["uid", "targetId", "id"]);
  return undefined;
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function compact<T extends Record<string, unknown>>(source: T): T {
  return Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== null)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

