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

// Confirmed by the direction probe:
//   BaaSMessageNew          → an inbound (customer) message       → received
//   BaaSMessageSendCallback → our own outbound send echo          → sent
// All other events (read receipts, typing, message.changed, ...) are noise.
const RECEIVED_EVENT = "BaaSMessageNew";
const SENT_EVENT = "BaaSMessageSendCallback";

function observeEmit(targetWindow: Window, eventName: unknown, payload: unknown): void {
  recordEventName(targetWindow, eventName);
  if (!isRecord(payload)) return;
  const name = typeof eventName === "string" ? eventName : "";
  const direction = name === RECEIVED_EVENT ? "received" : name === SENT_EVENT ? "sent" : null;
  if (!direction) return; // only real inbound/outbound message events
  const message = extractMessage(payload, direction);
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
// emit { message: {...} } so the mapper's lwpMessage(raw) path applies, and we
// stamp the probe-confirmed `direction` so the mapper uses it directly instead
// of guessing.
//
// Two confirmed shapes:
//   A) payload.messageModel.{cid,messageId/uuid,content.text.content,createAt,sender.uid}
//   B) payload.{conversationCode,messageId/uuid,content,sender,sendTime,contact}
function extractMessage(payload: Record<string, unknown>, direction: "sent" | "received"): ExtractedMessage | null {
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
            direction,
            contentType: contentTypeOf(model.content),
            richContent: richContentOf(model.content),
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
          direction,
          contentType: contentTypeOf(payload.content),
          richContent: richContentOf(payload.content) ?? richContentOf(payload),
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

function richContentOf(value: unknown): Record<string, unknown>[] | undefined {
  const existing = normalizeRichContent(firstValue(value, ["richContent", "richContents", "contentBlocks"]));
  const product = productContentOf(value);
  if (existing?.length) return product ? mergeRichContent(existing, product) : existing;
  return product ? [product] : undefined;
}

function normalizeRichContent(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.map(productContentOf).filter(isRecord);
  return normalized.length ? normalized : undefined;
}

function productContentOf(value: unknown): Record<string, unknown> | null {
  const records = productCandidateRecords(value);
  if (!records.length) return null;
  const url = firstUrlString(records, PRODUCT_URL_KEYS);
  if (!url) return null;
  return compact({
    type: "product",
    url,
    title: firstStringFromRecords(records, PRODUCT_TITLE_KEYS),
    imageUrl: firstUrlString(records, PRODUCT_IMAGE_KEYS),
    priceText: firstStringFromRecords(records, PRODUCT_PRICE_KEYS),
    moqText: moqTextFromRecords(records),
    productId: firstStringFromRecords(records, PRODUCT_ID_KEYS) || productIdFromUrl(url)
  });
}

const PRODUCT_URL_KEYS = [
  "url",
  "href",
  "link",
  "linkUrl",
  "cardUrl",
  "redirectUrl",
  "actionUrl",
  "detailUrl",
  "productUrl",
  "offerUrl",
  "itemUrl",
  "targetUrl",
  "jumpUrl",
  "landingUrl",
  "action.url",
  "action.href",
  "jump.url",
  "link.url",
  "target.url",
  "router.url",
  "text.content"
];
const PRODUCT_TITLE_KEYS = ["title", "name", "productName", "subject", "productTitle", "offerTitle", "itemTitle"];
const PRODUCT_IMAGE_KEYS = [
  "imageUrl",
  "mainImageUrl",
  "mainImage",
  "image",
  "picUrl",
  "pictureUrl",
  "thumbnailUrl",
  "imgUrl",
  "coverUrl",
  "mainImage.url",
  "mainImage.src",
  "image.url",
  "image.src",
  "pic.url",
  "picture.url",
  "thumbnail.url",
  "cover.url"
];
const PRODUCT_PRICE_KEYS = [
  "priceText",
  "priceRangeText",
  "displayPrice",
  "formattedPrice",
  "price",
  "priceRange",
  "priceInfo.priceText",
  "priceInfo.displayPrice",
  "priceInfo.formattedPrice",
  "priceInfo.price",
  "priceInfo.priceRange",
  "price.text",
  "price.displayText",
  "price.display",
  "text"
];
const PRODUCT_MOQ_TEXT_KEYS = [
  "moqText",
  "moq",
  "minOrderText",
  "minimumOrderText",
  "minOrderQuantityText",
  "moq.text",
  "moq.displayText",
  "minOrder.text",
  "minOrder.displayText",
  "minimumOrder.text",
  "minimumOrder.displayText",
  "minOrderInfo.text",
  "minOrderInfo.displayText"
];
const PRODUCT_MOQ_QUANTITY_KEYS = [
  "minOrderQuantity",
  "minimumOrderQuantity",
  "minOrderQty",
  "moqQuantity",
  "moq.value",
  "moq.quantity",
  "moq.qty",
  "minOrder.value",
  "minOrder.quantity",
  "minOrder.qty",
  "minimumOrder.value",
  "minimumOrder.quantity",
  "minimumOrder.qty",
  "minOrderInfo.value",
  "minOrderInfo.quantity",
  "quantity",
  "qty"
];
const PRODUCT_MOQ_UNIT_KEYS = [
  "minOrderUnit",
  "minimumOrderUnit",
  "moqUnit",
  "moq.unit",
  "moq.unitName",
  "minOrder.unit",
  "minOrder.unitName",
  "minimumOrder.unit",
  "minimumOrder.unitName",
  "minOrderInfo.unit",
  "minOrderInfo.unitName",
  "unit",
  "unitName"
];
const PRODUCT_ID_KEYS = [
  "productId",
  "offerId",
  "itemId",
  "id",
  "ids",
  "productID",
  "offerID",
  "itemID",
  "product.id",
  "product.productId",
  "offer.id",
  "offer.offerId",
  "item.id",
  "item.itemId"
];
const PRODUCT_NESTED_KEYS = [
  "productCard",
  "offerCard",
  "product",
  "offer",
  "item",
  "card",
  "cardData",
  "cardInfo",
  "data",
  "bizData",
  "payload",
  "content",
  "productInfo",
  "offerInfo",
  "itemInfo",
  "detail",
  "details",
  "action",
  "jump",
  "link",
  "target",
  "router",
  "mainImage",
  "image",
  "pic",
  "picture",
  "thumbnail",
  "cover",
  "priceInfo",
  "price",
  "priceRange",
  "moq",
  "minOrder",
  "minimumOrder",
  "minOrderInfo",
  "minimumOrderInfo"
];

function productCandidateRecords(value: unknown, depth = 0, seen: unknown[] = []): Record<string, unknown>[] {
  const structured = structuredValue(value);
  if (Array.isArray(structured)) {
    return structured.flatMap((item) => productCandidateRecords(item, depth, seen));
  }
  if (!isRecord(structured) || seen.includes(structured)) return [];
  seen.push(structured);

  const records = [structured];
  if (depth >= 4) return records;

  for (const key of PRODUCT_NESTED_KEYS) {
    const nested = structured[key];
    if (nested !== undefined) records.push(...productCandidateRecords(nested, depth + 1, seen));
  }
  for (const key of ["richContent", "richContents", "contentBlocks", "cards", "items", "products", "offers"]) {
    const nested = structured[key];
    if (Array.isArray(nested)) records.push(...nested.flatMap((item) => productCandidateRecords(item, depth + 1, seen)));
  }

  return records;
}

function mergeRichContent(existing: Record<string, unknown>[], product: Record<string, unknown>): Record<string, unknown>[] {
  let merged = false;
  const output = existing.map((item) => {
    if (merged || item.type !== "product") return item;
    merged = true;
    return compact({ ...product, ...item });
  });
  return merged ? output : [...existing, product];
}

function firstStringFromRecords(records: Record<string, unknown>[], keys: string[]): string | undefined {
  for (const record of records) {
    const value = firstString(record, keys);
    if (value) return value;
  }
  return undefined;
}

function firstUrlString(records: Record<string, unknown>[], keys: string[]): string | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = firstString(record, [key]);
      if (value && isUrlLike(value)) return value;
    }
  }
  return undefined;
}

function moqTextFromRecords(records: Record<string, unknown>[]): string | undefined {
  const text = firstStringFromRecords(records, PRODUCT_MOQ_TEXT_KEYS);
  if (text && !isRecord(structuredValue(text))) return text;
  const quantity = firstStringFromRecords(records, PRODUCT_MOQ_QUANTITY_KEYS);
  if (!quantity) return undefined;
  const unit = firstStringFromRecords(records, PRODUCT_MOQ_UNIT_KEYS);
  return unit ? `${quantity} ${unit}` : quantity;
}

function productIdFromUrl(url: string): string | undefined {
  try {
    const normalized = url.startsWith("//") ? `https:${url}` : url.startsWith("/") ? `https://workspace.alibaba.com${url}` : url;
    const parsed = new URL(normalized);
    for (const key of ["ids", "productId", "offerId", "itemId", "id"]) {
      const value = parsed.searchParams.get(key);
      if (value?.trim()) return value.trim();
    }
  } catch {
    // Fall back to a query-string regex for non-standard card links.
  }
  const match = /(?:[?&]|^)(?:ids|productId|offerId|itemId|id)=([^&#]+)/.exec(url);
  return match ? decodeURIComponent(match[1]).trim() || undefined : undefined;
}

function structuredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function isUrlLike(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  return /^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith("/") || /(?:[?&]|^)type=2000(?:&|$)/.test(trimmed);
}

function senderId(sender: unknown): string | undefined {
  if (typeof sender === "string" && sender.trim()) return sender.trim();
  if (isRecord(sender)) return firstString(sender, ["uid", "targetId", "id"]);
  return undefined;
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = key.includes(".") ? valueAtPath(source, key.split(".")) : source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function firstValue(source: unknown, keys: string[]): unknown {
  const structured = structuredValue(source);
  if (!isRecord(structured)) return undefined;
  for (const key of keys) {
    const value = key.includes(".") ? valueAtPath(structured, key.split(".")) : structured[key];
    if (value != null && value !== "") return value;
  }
  return undefined;
}

function valueAtPath(source: unknown, path: string[]): unknown {
  let current = source;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
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
