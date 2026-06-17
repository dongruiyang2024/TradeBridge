interface HistoryMessagePageWindow extends Window {
  IcbuIM?: {
    IMBaaSSDK?: {
      default?: {
        getMessageServiceV2?: () => HistoryMessageService;
        getMessageService?: () => HistoryMessageService;
      };
    };
  };
}

interface HistoryMessageService {
  listMessageWithConversationCodeForHistory?: (options: Record<string, unknown>) => Promise<unknown> | unknown;
  listMessageWithConversationCode?: (options: Record<string, unknown>) => Promise<unknown> | unknown;
}

export async function requestHistoryMessagesFromPageRuntime(
  pageWindow: Window,
  input: { conversations: Record<string, unknown>[]; count: number }
): Promise<Record<string, Record<string, unknown>[]>> {
  const runtime = pageWindow as HistoryMessagePageWindow;
  const sdk = runtime.IcbuIM?.IMBaaSSDK?.default;
  const services = [sdk?.getMessageServiceV2?.(), sdk?.getMessageService?.()].filter(isHistoryMessageService);
  if (!services.length) throw new Error("onetalk_history_message_sdk_unavailable");

  const output: Record<string, Record<string, unknown>[]> = {};
  for (const conversation of input.conversations) {
    const conversationCode = conversationCodeOf(conversation);
    if (!conversationCode) continue;
    const response = await fetchConversationHistory(services, conversation, conversationCode, input.count);
    const messages = messageListFromResponse(response)
      .map((message) => sanitizedHistoryMessage(message, conversationCode))
      .filter(isRecord);
    if (messages.length) output[conversationCode] = messages;
  }
  return output;
}

async function fetchConversationHistory(
  services: HistoryMessageService[],
  conversation: Record<string, unknown>,
  conversationCode: string,
  count: number
): Promise<unknown> {
  const sendTime = numericValue(
    firstValue(conversation, [
      "latestMessage.message.sendTime",
      "latestMessage.gmtChatLong",
      "lastContactTimeLong",
      "modifyTime"
    ])
  );
  const payload = compact({
    conversationCode,
    sendTime,
    count,
    fetchType: false
  });
  const errors: string[] = [];
  for (const service of services) {
    const methods = [service.listMessageWithConversationCodeForHistory, service.listMessageWithConversationCode].filter(
      (method): method is (options: Record<string, unknown>) => Promise<unknown> | unknown => typeof method === "function"
    );
    for (const method of methods) {
      try {
        return await callHistoryMethod(service, method, payload);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "onetalk_history_message_fetch_failed");
      }
    }
  }
  throw new Error(errors[0] || "onetalk_history_message_fetch_failed");
}

function callHistoryMethod(
  service: HistoryMessageService,
  method: (options: Record<string, unknown>) => Promise<unknown> | unknown,
  payload: Record<string, unknown>
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (value: unknown, failed = false) => {
      if (settled) return;
      settled = true;
      failed ? reject(value) : resolve(value);
    };
    try {
      const returned = method.call(service, {
        ...payload,
        dataCallback: (value: unknown) => settle(value),
        errorCallBack: (error: unknown) =>
          settle(new Error(errorMessage(error) || "onetalk_history_message_fetch_failed"), true)
      });
      if (isPromiseLike(returned)) void returned.then((value) => settle(value), (error) => settle(error, true));
    } catch (error) {
      settle(error, true);
    }
  });
}

function messageListFromResponse(response: unknown): Record<string, unknown>[] {
  if (Array.isArray(response)) return response.filter(isRecord);
  if (!isRecord(response)) return [];
  for (const key of ["data", "list", "userMessageModels"]) {
    const list = response[key];
    if (Array.isArray(list)) return list.filter(isRecord);
  }
  const body = response.body;
  if (isRecord(body) && Array.isArray(body.userMessageModels)) return body.userMessageModels.filter(isRecord);
  return [];
}

function sanitizedHistoryMessage(source: Record<string, unknown>, conversationCode: string): Record<string, unknown> | null {
  const message = isRecord(source.message) ? source.message : source;
  const sanitized = compact({
    messageId: firstString(message, ["messageId", "msgId", "messageID", "msgIdStr", "id"]),
    uuid: firstString(message, ["uuid"]),
    cid: firstString(message, ["cid", "conversationCode"]) || conversationCode,
    conversationCode: firstString(message, ["conversationCode", "cid"]) || conversationCode,
    messageType: firstString(message, ["messageType", "msgType", "type"]),
    content: sanitizedContent(message.content),
    sendTime: numericValue(firstValue(message, ["sendTime", "sentAt", "time", "gmtCreate", "createdAt", "createAt"])),
    sender: sanitizedActor(message.sender),
    receivers: sanitizedReceivers(message.receivers)
  });
  return Object.keys(sanitized).length ? { message: sanitized } : null;
}

function sanitizedContent(content: unknown): unknown {
  if (typeof content === "string" && content.trim()) return content.trim();
  if (!isRecord(content)) return undefined;
  const text = content.text;
  const sanitizedText = typeof text === "string" ? text.trim() : isRecord(text) ? compact({ content: firstString(text, ["content"]) }) : undefined;
  return compact({
    contentType: firstString(content, ["contentType"]),
    text: sanitizedText && (!isRecord(sanitizedText) || Object.keys(sanitizedText).length) ? sanitizedText : undefined,
    imageUrl: firstString(content, ["imageUrl", "imgUrl", "picUrl", "pictureUrl", "photoUrl", "url", "image.url", "pic.url"]),
    thumbnailUrl: firstString(content, ["thumbnailUrl", "thumbUrl", "thumbnail.url", "thumb.url"]),
    mimeType: firstString(content, ["mimeType", "mediaType"])
  });
}

function sanitizedActor(actor: unknown): unknown {
  if (typeof actor === "string" && actor.trim()) return actor.trim();
  if (!isRecord(actor)) return undefined;
  return compact({
    uid: firstString(actor, ["uid"]),
    targetId: firstString(actor, ["targetId"]),
    id: firstString(actor, ["id"])
  });
}

function sanitizedReceivers(receivers: unknown): unknown {
  if (!Array.isArray(receivers)) return undefined;
  const sanitized = receivers.map(sanitizedActor).filter((receiver) => receiver !== undefined);
  return sanitized.length ? sanitized : undefined;
}

function conversationCodeOf(conversation: Record<string, unknown>): string | undefined {
  return firstString(conversation, ["cid", "conversationCode", "latestMessage.message.conversationCode"]);
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

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (isRecord(error)) return firstString(error, ["err", "message", "error"]);
  if (typeof error === "string") return error;
  return undefined;
}

function compact<T extends Record<string, unknown>>(source: T): T {
  return Object.fromEntries(sourceEntries(source).filter(([, value]) => value !== undefined && value !== null && value !== "")) as T;
}

function sourceEntries(source: Record<string, unknown>): [string, unknown][] {
  return Object.entries(source);
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return isRecord(value) && typeof value.then === "function";
}

function isHistoryMessageService(value: unknown): value is HistoryMessageService {
  return (
    isRecord(value) &&
    (typeof value.listMessageWithConversationCodeForHistory === "function" ||
      typeof value.listMessageWithConversationCode === "function")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
