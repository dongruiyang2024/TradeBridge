interface ConversationPageWindow extends Window {
  IcbuIM?: {
    IMBaaSSDK?: {
      default?: {
        getConversationServiceV2?: () => ConversationListService;
        getConversationService?: () => ConversationListService;
        getConversationServiceHttp?: () => ConversationContactDetailService;
      };
    };
  };
}

interface ConversationListService {
  getConversationListByPagination?: (options: unknown) => Promise<unknown> | unknown;
}

interface ConversationContactDetailService {
  getConversationContactDetailList?: (contacts: unknown[]) => Promise<unknown> | unknown;
}

export interface OneTalkConversationPage {
  conversations: Record<string, unknown>[];
  nextCursor?: string | number;
  hasMore: boolean;
}

export async function requestConversationsFromPageRuntime(
  pageWindow: Window,
  input: { cursor: number; count: number }
): Promise<OneTalkConversationPage> {
  const runtime = pageWindow as ConversationPageWindow;
  const sdk = runtime.IcbuIM?.IMBaaSSDK?.default;
  const services = [sdk?.getConversationServiceV2?.(), sdk?.getConversationService?.()].filter(isConversationListService);
  const contactDetailServices = [
    sdk?.getConversationServiceHttp?.(),
    sdk?.getConversationServiceV2?.(),
    sdk?.getConversationService?.()
  ].filter(isConversationContactDetailService);
  const errors: string[] = [];

  for (const service of services) {
    try {
      const response = await service.getConversationListByPagination.call(service, {
        cursor: input.cursor,
        count: input.count
      });
      return await conversationPageFromResponse(response, contactDetailServices);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "onetalk_conversation_sdk_error");
    }
  }

  if (errors.length) throw new Error(errors[0]);
  throw new Error("onetalk_conversation_sdk_unavailable");
}

async function conversationPageFromResponse(
  response: unknown,
  contactDetailServices: ConversationContactDetailService[]
): Promise<OneTalkConversationPage> {
  const body = conversationPageBody(response);
  const list = Array.isArray(body.list) ? body.list.filter(isRecord) : [];
  const contactDetails = await contactDetailMap(list, contactDetailServices);
  return {
    conversations: list.map((conversation) => sanitizedConversation(conversation, contactDetails.get(contactDetailLookupKey(conversation)))),
    nextCursor: cursorValue(body.nextCursor),
    hasMore: body.hasMore === true
  };
}

function conversationPageBody(response: unknown): Record<string, unknown> {
  if (!isRecord(response)) return {};
  if (Array.isArray(response.list)) return response;
  for (const key of ["data", "result", "object"]) {
    const nested = response[key];
    if (isRecord(nested) && Array.isArray(nested.list)) return nested;
  }
  return response;
}

function isConversationListService(value: unknown): value is Required<ConversationListService> {
  return isRecord(value) && typeof value.getConversationListByPagination === "function";
}

function isConversationContactDetailService(value: unknown): value is Required<ConversationContactDetailService> {
  return isRecord(value) && typeof value.getConversationContactDetailList === "function";
}

async function contactDetailMap(
  conversations: Record<string, unknown>[],
  services: ConversationContactDetailService[]
): Promise<Map<string, Record<string, unknown>>> {
  const entries = conversations.map(contactDetailRequest).filter(isContactDetailRequest);
  if (!entries.length || !services.length) return new Map();

  for (const service of services) {
    try {
      const response = await service.getConversationContactDetailList?.call(
        service,
        entries.map((entry) => entry.payload)
      );
      const details = contactDetailListFromResponse(response);
      if (details.length) return mapContactDetails(entries, details);
    } catch {
      // Customer details are a best-effort enrichment; the SDK conversation itself is still useful.
    }
  }

  return new Map();
}

interface ContactDetailRequest {
  lookupKey: string;
  payload: Record<string, string>;
}

function contactDetailRequest(conversation: Record<string, unknown>): ContactDetailRequest | null {
  const chatToken = firstString(conversation, [
    "contact.chatToken",
    "chatToken",
    "latestMessage.message.contact.chatToken"
  ]);
  if (!chatToken) return null;

  const encryptAccountId = firstString(conversation, [
    "contact.accountIdEncrypt",
    "accountIdEncrypt",
    "latestMessage.message.contact.accountIdEncrypt"
  ]);
  const encryptAliId = firstString(conversation, [
    "contact.aliIdEncrypt",
    "aliIdEncrypt",
    "latestMessage.message.contact.aliIdEncrypt"
  ]);
  const lookupKey = contactDetailLookupKey(conversation);
  if (!lookupKey) return null;
  if (encryptAccountId) return { lookupKey, payload: { encryptAccountId, chatToken } };
  if (encryptAliId) return { lookupKey, payload: { encryptAliId, chatToken } };
  return null;
}

function isContactDetailRequest(value: ContactDetailRequest | null): value is ContactDetailRequest {
  return !!value;
}

function contactDetailListFromResponse(response: unknown): Record<string, unknown>[] {
  if (Array.isArray(response)) return response.filter(isRecord);
  if (isRecord(response) && Array.isArray(response.contactDetailList)) return response.contactDetailList.filter(isRecord);
  return [];
}

function mapContactDetails(
  entries: ContactDetailRequest[],
  details: Record<string, unknown>[]
): Map<string, Record<string, unknown>> {
  const output = new Map<string, Record<string, unknown>>();
  for (let index = 0; index < details.length; index += 1) {
    const detail = sanitizedContactDetail(details[index]);
    const entryKey = entries[index]?.lookupKey;
    if (entryKey && Object.keys(detail).length) output.set(entryKey, detail);
    for (const key of contactDetailKeys(detail)) output.set(key, detail);
  }
  return output;
}

function contactDetailKeys(source: Record<string, unknown>): string[] {
  return [
    firstString(source, ["accountIdEncrypt", "accountId"]),
    firstString(source, ["aliIdEncrypt", "aliId"]),
    firstString(source, ["loginIdEncrypt"]),
    firstString(source, ["loginId"])
  ].filter((value): value is string => !!value);
}

function contactDetailLookupKey(conversation: Record<string, unknown>): string {
  return (
    firstString(conversation, [
      "contact.accountIdEncrypt",
      "accountIdEncrypt",
      "latestMessage.message.contact.accountIdEncrypt",
      "contact.aliIdEncrypt",
      "aliIdEncrypt",
      "latestMessage.message.contact.aliIdEncrypt",
      "contact.loginId",
      "loginId",
      "latestMessage.message.contact.loginId"
    ]) || ""
  );
}

function sanitizedContactDetail(detail: Record<string, unknown>): Record<string, unknown> {
  return compact({
    name: firstString(detail, ["name", "displayName", "nickName"]),
    loginId: firstString(detail, ["loginId"]),
    loginIdEncrypt: firstString(detail, ["loginIdEncrypt"]),
    aliId: firstString(detail, ["aliId"]),
    aliIdEncrypt: firstString(detail, ["aliIdEncrypt"]),
    accountId: firstString(detail, ["accountId"]),
    accountIdEncrypt: firstString(detail, ["accountIdEncrypt"]),
    companyName: firstString(detail, ["companyName"]),
    fullPortrait: firstString(detail, ["fullPortrait"]),
    country: firstString(detail, ["country", "countryCode", "complianceCountryCode"]),
    currentTimeZone: firstString(detail, ["currentTimeZone"])
  });
}

function sanitizedConversation(
  conversation: Record<string, unknown>,
  contactDetail?: Record<string, unknown>
): Record<string, unknown> {
  return compact({
    cid: firstString(conversation, ["cid", "conversationCode"]),
    name: firstString(conversation, ["name"]),
    loginId: firstString(conversation, ["loginId"]),
    loginIdEncrypt: firstString(conversation, ["loginIdEncrypt"]),
    accountId: firstString(conversation, ["accountId"]),
    accountIdEncrypt: firstString(conversation, ["accountIdEncrypt"]),
    aliId: firstString(conversation, ["aliId"]),
    aliIdEncrypt: firstString(conversation, ["aliIdEncrypt"]),
    fullPortrait: firstString(conversation, ["fullPortrait"]),
    conversationType: firstString(conversation, ["conversationType"]),
    createAt: numericValue(conversation.createAt),
    modifyTime: numericValue(conversation.modifyTime),
    lastContactTimeLong: numericValue(conversation.lastContactTimeLong),
    unreadCount: numericValue(conversation.unreadCount),
    contact: mergedContact(conversation, contactDetail),
    latestMessage: sanitizedLatestMessage(conversation.latestMessage)
  });
}

function mergedContact(
  conversation: Record<string, unknown>,
  contactDetail: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const contact = compact({
    ...(sanitizedContact(valueAtPath(conversation, ["latestMessage", "message", "contact"])) || {}),
    ...(sanitizedContact(conversation.contact) || {}),
    ...(contactDetail || {})
  });
  return Object.keys(contact).length ? contact : undefined;
}

function sanitizedContact(contact: unknown): Record<string, unknown> | undefined {
  if (!isRecord(contact)) return undefined;
  return compact({
    name: firstString(contact, ["name"]),
    companyName: firstString(contact, ["companyName"]),
    loginId: firstString(contact, ["loginId"]),
    loginIdEncrypt: firstString(contact, ["loginIdEncrypt"]),
    accountId: firstString(contact, ["accountId"]),
    accountIdEncrypt: firstString(contact, ["accountIdEncrypt"]),
    aliId: firstString(contact, ["aliId"]),
    aliIdEncrypt: firstString(contact, ["aliIdEncrypt"]),
    fullPortrait: firstString(contact, ["fullPortrait"]),
    country: firstString(contact, ["country", "countryCode", "complianceCountryCode"]),
    currentTimeZone: firstString(contact, ["currentTimeZone"])
  });
}

function sanitizedLatestMessage(latestMessage: unknown): Record<string, unknown> | undefined {
  if (!isRecord(latestMessage)) return undefined;
  return compact({
    messageId: firstString(latestMessage, ["messageId"]),
    messageType: firstString(latestMessage, ["messageType"]),
    viewType: firstString(latestMessage, ["viewType"]),
    gmtChat: firstString(latestMessage, ["gmtChat"]),
    gmtChatLong: numericValue(latestMessage.gmtChatLong),
    message: sanitizedLatestMessageBody(latestMessage.message)
  });
}

function sanitizedLatestMessageBody(message: unknown): Record<string, unknown> | undefined {
  if (!isRecord(message)) return undefined;
  return compact({
    conversationCode: firstString(message, ["conversationCode"]),
    messageId: firstString(message, ["messageId", "uuid"]),
    messageType: firstString(message, ["messageType", "msgType", "type"]),
    sendTime: numericValue(message.sendTime),
    sender: firstString(message, ["sender"]),
    receiver: firstString(message, ["receiver"])
  });
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = key.includes(".") ? valueAtPath(source, key.split(".")) : source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
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

function cursorValue(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function compact<T extends Record<string, unknown>>(source: T): T {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== null)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
