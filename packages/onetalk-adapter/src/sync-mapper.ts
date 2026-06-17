import {
  companyNameFromProfile,
  countryFromProfile,
  customerProfileFor,
  displayNameFromProfile,
  loginIdFromProfile,
  lwpCustomerIdentity
} from "./customer-profile.js";
import type {
  ChannelSyncBatch,
  ChannelSyncContact,
  ChannelSyncConversation,
  ChannelSyncDeviceInput,
  ChannelSyncMessage,
  ChannelSyncSellerAccountInput
} from "@wangwang/collector-protocol";
import type { WebliteData } from "./onetalk-client.js";

export type MessageDirection = ChannelSyncMessage["direction"];
export type BrowserSyncSellerAccountInput = ChannelSyncSellerAccountInput;
export type BrowserSyncDeviceInput = ChannelSyncDeviceInput;
export type BrowserSyncCustomerInput = ChannelSyncContact;
export type BrowserSyncConversationInput = ChannelSyncConversation;
export type BrowserSyncMessageInput = ChannelSyncMessage;
export type BrowserSyncBatch = ChannelSyncBatch;

export interface MapWebliteToSyncBatchOptions {
  sellerAccount: BrowserSyncSellerAccountInput;
  device: BrowserSyncDeviceInput;
  collectedAt: string;
  source: string;
  previousCursor: string | null;
  weblite: WebliteData;
  messagesByConversationId: Record<string, Record<string, unknown>[]>;
}

const STABLE_CUSTOMER_ID_PATHS = [
  "contact.accountId",
  "contact.aliId",
  "latestMessage.message.contact.accountId",
  "latestMessage.message.contact.aliId",
  "contactAccountId",
  "buyerAccountId",
  "contactAliId",
  "accountId",
  "aliId"
];

const ENCRYPTED_CUSTOMER_ID_FALLBACK_PATHS = [
  "contact.accountIdEncrypt",
  "contact.aliIdEncrypt",
  "latestMessage.message.contact.accountIdEncrypt",
  "latestMessage.message.contact.aliIdEncrypt",
  "contactAccountIdEncrypt",
  "accountIdEncrypt",
  "aliIdEncrypt"
];

export function mapWebliteToSyncBatch(options: MapWebliteToSyncBatchOptions): BrowserSyncBatch {
  const customers = new Map<string, BrowserSyncCustomerInput>();
  const conversations: BrowserSyncConversationInput[] = [];
  const messages: BrowserSyncMessageInput[] = [];

  const rawConversations = options.weblite.conversations.filter(isRecord);
  for (let index = 0; index < rawConversations.length; index += 1) {
    const conversation = rawConversations[index];
    const lwpConversation = lwpSingleChatConversation(conversation);
    const pairCustomerId = lwpCustomerId(lwpConversation, options.weblite.bootstrap);
    const lwpIdentity = lwpCustomerIdentity(conversation, pairCustomerId);
    const externalConversationId =
      firstString(conversation, ["cid", "conversationCode", "conversationId", "id"]) ||
      firstString(lwpConversation, ["cid"]);
    // loginId is the most stable cross-session identity for a buyer; prefer it
    // as the dedup anchor so the same person never splits into multiple
    // customers when unstable ids (encrypted ids, cid-pair guesses) differ.
    const buyerLoginId = firstString(conversation, [
      "contact.loginId",
      "latestMessage.message.contact.loginId",
      "loginId",
      "contactLoginId"
    ]);
    const externalCustomerId =
      buyerLoginId ||
      lwpIdentity.pairCustomerId ||
      lwpIdentity.accountId ||
      firstString(conversation, STABLE_CUSTOMER_ID_PATHS) ||
      customerIdFromConversationId(externalConversationId, options.weblite.bootstrap) ||
      lwpIdentity.accountIdEncrypt ||
      lwpIdentity.aliIdEncrypt ||
      firstString(conversation, ENCRYPTED_CUSTOMER_ID_FALLBACK_PATHS);
    if (!externalConversationId || !externalCustomerId) continue;
    const customerProfile = customerProfileFor(options.weblite.customerProfiles, {
      externalCustomerId,
      conversation,
      lwpIdentity
    });

    customers.set(
      externalCustomerId,
      compact({
        externalCustomerId,
        loginId:
          firstString(conversation, [
            "contact.loginId",
            "latestMessage.message.contact.loginId",
            "loginId",
            "contactLoginId"
          ]) ||
          loginIdFromProfile(customerProfile),
        displayName:
          firstString(conversation, [
            "contact.name",
            "latestMessage.message.contact.name",
            "contactNick",
            "contactName",
            "contactDisplayName",
            "buyerName",
            "buyerNick",
            "nickName",
            "displayName",
            "nick",
            "name",
            "contact.companyName",
            "latestMessage.message.contact.companyName"
          ]) ||
          displayNameFromProfile(customerProfile),
        companyName:
          firstString(conversation, [
            "contact.companyName",
            "latestMessage.message.contact.companyName",
            "companyName",
            "buyerCompanyName"
          ]) ||
          companyNameFromProfile(customerProfile),
        avatarUrl: firstString(conversation, [
          "contact.fullPortrait",
          "latestMessage.message.contact.fullPortrait",
          "fullPortrait",
          "avatarUrl",
          "portraitUrl"
        ]),
        country:
          firstString(conversation, [
            "contact.country",
            "contact.countryCode",
            "contact.complianceCountryCode",
            "latestMessage.message.contact.country",
            "latestMessage.message.contact.countryCode",
            "latestMessage.message.contact.complianceCountryCode",
            "country"
          ]) ||
          countryFromProfile(customerProfile),
        currentTimeZone: firstString(conversation, [
          "contact.currentTimeZone",
          "latestMessage.message.contact.currentTimeZone",
          "currentTimeZone"
        ]),
        accountId: firstString(conversation, [
          "contact.accountId",
          "latestMessage.message.contact.accountId",
          "accountId"
        ]),
        accountIdEncrypt: firstString(conversation, [
          "contact.accountIdEncrypt",
          "latestMessage.message.contact.accountIdEncrypt",
          "accountIdEncrypt"
        ]),
        aliId: firstString(conversation, ["contact.aliId", "latestMessage.message.contact.aliId", "aliId"]),
        aliIdEncrypt: firstString(conversation, [
          "contact.aliIdEncrypt",
          "latestMessage.message.contact.aliIdEncrypt",
          "aliIdEncrypt"
        ]),
        loginIdEncrypt: firstString(conversation, [
          "contact.loginIdEncrypt",
          "latestMessage.message.contact.loginIdEncrypt",
          "loginIdEncrypt"
        ])
      })
    );

    conversations.push(
      compact({
        externalConversationId,
        externalCustomerId,
        lastMessageAt: isoTime(firstMessageTime(conversation))
      })
    );

    for (const rawMessage of options.messagesByConversationId[externalConversationId] || []) {
      const message = mapMessage(rawMessage, externalConversationId, options.weblite.bootstrap, conversation);
      if (message && isAfterCursor(message.sentAt, options.previousCursor)) {
        messages.push(message);
      }
    }
  }

  return compact({
    channel: "alibaba-im",
    channelAccount: compact({
      channel: "alibaba-im",
      externalAccountId: options.sellerAccount.externalAccountId,
      displayName: options.sellerAccount.displayName,
      surface: "onetalk-web"
    }),
    sellerAccount: options.sellerAccount,
    device: options.device,
    cursor: options.previousCursor ? { previousCursor: options.previousCursor } : undefined,
    sourceMeta: {
      source: options.source,
      surface: "onetalk-web",
      collectedAt: options.collectedAt,
      sourceBatchKey: `${options.sellerAccount.externalAccountId}:${options.device.deviceId}:${options.collectedAt}`
    },
    customers: Array.from(customers.values()),
    conversations,
    messages
  });
}

function firstMessageTime(conversation: Record<string, unknown>): unknown {
  return firstValue(conversation, [
    "lastMessageTime",
    "lastMessageAt",
    "lastMsgTime",
    "latestMessage.sendTime",
    "latestMessage.time",
    "latestMessage.gmtCreate",
    "latestMessage.createdAt",
    "latestMessage.gmtChatLong",
    "latestMessage.message.sendTime",
    "lastMessage.sendTime",
    "lastMessage.time",
    "lastMessage.gmtCreate",
    "lastMessage.createdAt",
    "singleChatUserConversation.lastMessage.message.createAt",
    "singleChatUserConversation.modifyTime"
  ]);
}

function mapMessage(
  raw: Record<string, unknown>,
  externalConversationId: string,
  bootstrap: Record<string, string>,
  conversation: Record<string, unknown>
): BrowserSyncMessageInput | null {
  const message = lwpMessage(raw) || raw;
  const sentAt = isoTime(firstValue(message, ["sendTime", "sentAt", "time", "gmtCreate", "createdAt", "createAt"]));
  const richContent = richContentOf(message);
  const attachments = richContent?.some((item) => item.type === "product") ? undefined : imageAttachmentsOf(message);
  return compact({
    externalConversationId,
    externalMessageId: firstString(message, ["messageId", "msgId", "messageID", "msgIdStr", "id"]),
    direction: directionOf(message, bootstrap, conversation),
    messageType: firstString(message, ["messageType", "type", "msgType", "content.contentType", "displayStyle"]) || "text",
    content: firstString(message, [
      "content",
      "text",
      "message",
      "summary",
      "messageContent",
      "textContent",
      "showText",
      "plainText",
      "content.text.content",
      "searchableContent.summary"
    ]),
    attachments,
    richContent,
    sentAt,
    rawSanitized: richContent?.length || attachments?.length ? { ...raw, attachments, richContent } : raw
  });
}

function richContentOf(message: Record<string, unknown>): ChannelSyncMessage["richContent"] | undefined {
  const existing = normalizeRichContent(firstValue(message, ["richContent", "richContents", "contentBlocks"]));
  const product = productContentOf(message) || productContentOf(firstValue(message, ["content"]));
  if (existing?.length) return product ? mergeRichContent(existing, product) : existing;
  return product ? [product] : undefined;
}

function normalizeRichContent(value: unknown): ChannelSyncMessage["richContent"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.map(productContentOf).filter(isProductContent);
  return normalized.length ? normalized : undefined;
}

function productContentOf(value: unknown): NonNullable<ChannelSyncMessage["richContent"]>[number] | null {
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
  }) as NonNullable<ChannelSyncMessage["richContent"]>[number];
}

function imageAttachmentsOf(value: unknown): ChannelSyncMessage["attachments"] | undefined {
  const records = imageCandidateRecords(value);
  const output: NonNullable<ChannelSyncMessage["attachments"]> = [];
  const seen = new Set<string>();
  for (const record of records) {
    const url = firstImageUrlString([record], IMAGE_URL_KEYS);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    output.push(
      compact({
        type: "image" as const,
        fileName: firstString(record, IMAGE_NAME_KEYS) || "图片",
        mimeType: firstString(record, IMAGE_MIME_KEYS),
        thumbnailUrl: firstImageUrlString([record], IMAGE_THUMBNAIL_KEYS),
        url
      })
    );
    if (output.length >= 8) break;
  }
  return output.length ? output : undefined;
}

function imageCandidateRecords(value: unknown, depth = 0, seen: unknown[] = []): Record<string, unknown>[] {
  const structured = structuredValue(value);
  if (Array.isArray(structured)) {
    return structured.flatMap((item) => imageCandidateRecords(item, depth, seen));
  }
  if (!isRecord(structured) || seen.includes(structured)) return [];
  seen.push(structured);

  const records = recordLooksImageLike(structured) ? [structured] : [];
  if (depth >= 4) return records;

  for (const key of IMAGE_NESTED_KEYS) {
    const nested = structured[key];
    if (nested !== undefined) records.push(...imageCandidateRecords(nested, depth + 1, seen));
  }
  for (const key of ["attachments", "attachmentList", "files", "fileList", "images", "imageList", "pics", "pictures", "items"]) {
    const nested = structured[key];
    if (Array.isArray(nested)) records.push(...nested.flatMap((item) => imageCandidateRecords(item, depth + 1, seen)));
  }

  return records;
}

function recordLooksImageLike(record: Record<string, unknown>): boolean {
  const hint = firstString(record, ["type", "messageType", "msgType", "contentType", "displayStyle", "mimeType", "fileType"]);
  if (hint && /image|img|pic|picture|photo/i.test(hint)) return true;
  return Object.keys(record).some((key) => /image|img|pic|picture|photo|thumbnail|media|file/i.test(key));
}

const IMAGE_URL_KEYS = [
  "url",
  "src",
  "href",
  "imageUrl",
  "imgUrl",
  "picUrl",
  "pictureUrl",
  "photoUrl",
  "thumbnailUrl",
  "thumbUrl",
  "originUrl",
  "originalUrl",
  "downloadUrl",
  "fileUrl",
  "mediaUrl",
  "resourceUrl",
  "image.url",
  "image.src",
  "img.url",
  "pic.url",
  "picture.url",
  "thumbnail.url",
  "file.url",
  "resource.url"
];
const IMAGE_THUMBNAIL_KEYS = ["thumbnailUrl", "thumbUrl", "image.thumbnailUrl", "image.thumbUrl", "thumbnail.url", "thumb.url"];
const IMAGE_NAME_KEYS = ["fileName", "filename", "name", "title", "displayName"];
const IMAGE_MIME_KEYS = ["mimeType", "mediaType", "image.mimeType", "image.mediaType", "contentType"];
const IMAGE_NESTED_KEYS = [
  "content",
  "image",
  "img",
  "pic",
  "picture",
  "photo",
  "thumbnail",
  "thumb",
  "file",
  "attachment",
  "media",
  "resource",
  "data",
  "payload",
  "body"
];

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
  "text.content",
  "content"
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

function mergeRichContent(
  existing: NonNullable<ChannelSyncMessage["richContent"]>,
  product: NonNullable<ChannelSyncMessage["richContent"]>[number]
): NonNullable<ChannelSyncMessage["richContent"]> {
  let merged = false;
  const output = existing.map((item) => {
    if (merged || item.type !== "product") return item;
    merged = true;
    return compact({ ...product, ...item }) as NonNullable<ChannelSyncMessage["richContent"]>[number];
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

function firstImageUrlString(records: Record<string, unknown>[], keys: string[]): string | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = firstString(record, [key]);
      if (value && isImageUrlLike(value)) return value;
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

function isImageUrlLike(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  if (/^data:image\//i.test(trimmed)) return true;
  if (!/^(https?:)?\/\//i.test(trimmed) && !trimmed.startsWith("/")) return false;
  return (
    /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|webp)(?:[?#]|$)/i.test(trimmed) ||
    /(?:alicdn|alibaba|oss|cdn|img|image|picture|photo)/i.test(trimmed)
  );
}

function isProductContent(
  value: NonNullable<ChannelSyncMessage["richContent"]>[number] | null
): value is NonNullable<ChannelSyncMessage["richContent"]>[number] {
  return value !== null;
}

function directionOf(
  message: Record<string, unknown>,
  bootstrap: Record<string, string>,
  conversation: Record<string, unknown>
): MessageDirection {
  const explicit = firstString(message, ["direction"]);
  if (explicit === "sent" || explicit === "received" || explicit === "unknown") return explicit;
  const sender = firstString(message, ["senderAliId", "fromAliId", "senderId", "fromId", "sender.uid"]);
  const self =
    firstString(conversation, ["selfAliId"]) ||
    firstString(lwpSingleChatConversation(conversation), ["pairFirst"]) ||
    bootstrap.aliId;
  if (!sender || !self) return "unknown";
  return sender === self ? "sent" : "received";
}

function isAfterCursor(sentAt: string | undefined, cursor: string | null): boolean {
  if (!cursor || !sentAt) return true;
  return Date.parse(sentAt) > Date.parse(cursor);
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = key.includes(".") ? valueAtPath(source, key.split(".")) : source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function firstValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = key.includes(".") ? valueAtPath(source, key.split(".")) : source[key];
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

function isoTime(value: unknown): string | undefined {
  const numeric = numericTime(value);
  if (numeric != null) return new Date(numeric).toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return undefined;
}

function numericTime(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;
  if (raw == null || !Number.isFinite(raw)) return null;
  return raw < 10_000_000_000 ? raw * 1000 : raw;
}

function compact<T extends Record<string, unknown>>(source: T): T {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== null)) as T;
}

function lwpSingleChatConversation(conversation: Record<string, unknown>): Record<string, unknown> {
  const wrapper = valueAtPath(conversation, ["singleChatUserConversation", "singleChatConversation"]);
  return isRecord(wrapper) ? wrapper : {};
}

function lwpCustomerId(lwpConversation: Record<string, unknown>, bootstrap: Record<string, string>): string | undefined {
  const pairFirst = firstString(lwpConversation, ["pairFirst"]);
  const pairSecond = firstString(lwpConversation, ["pairSecond"]);
  const self = bootstrap.aliId;
  if (self && pairFirst === self) return pairSecond;
  if (self && pairSecond === self) return pairFirst;
  // Without the seller's own aliId we cannot tell which side of the pair is the
  // buyer; guessing flips per conversation and splits one buyer into several
  // customers. Defer to stable ids (loginId/accountId) instead.
  return undefined;
}

function customerIdFromConversationId(
  externalConversationId: string | undefined,
  bootstrap: Record<string, string>
): string | undefined {
  const pair = conversationIdPair(externalConversationId);
  if (!pair) return undefined;
  const [left, right] = pair;
  const self = bootstrap.aliId;
  if (self && left === self) return right;
  if (self && right === self) return left;
  // Without the seller's own id, "left" is not reliably the buyer (the seller
  // can be on either side depending on the conversation), so do not guess.
  return undefined;
}

function conversationIdPair(externalConversationId: string | undefined): [string, string] | null {
  const head = externalConversationId?.split("#")[0]?.split("@")[0];
  if (!head) return null;
  const match = /^(\d+)-(\d+)$/.exec(head);
  return match ? [match[1], match[2]] : null;
}

function lwpMessage(raw: Record<string, unknown>): Record<string, unknown> | null {
  const value = raw.message;
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
