import { ALIWORKBENCH_UA } from "./config.js";
import { CookieJar, cookieHeader, csrfQuery } from "./session.js";
import { extractJsonAfter, pageBootstrap } from "./weblite-parser.js";

export interface WebliteData {
  html: string;
  conversations: Record<string, unknown>[];
  bootstrap: Record<string, string>;
}

export interface ChatMessageRequest {
  conversation: Record<string, unknown>;
  bootstrap: Record<string, string>;
  before: number | null;
  pageSize: number;
}

export interface ChatMessageResponse {
  status: number;
  contentType: string | null;
  code: string | number | null;
  raw: unknown;
  messages: Record<string, unknown>[];
}

export interface ChatDataSummaryResponse {
  status: number;
  contentType: string | null;
  code: string | number | null;
  raw: unknown;
  data: Record<string, unknown> | null;
}

export class OnetalkClient {
  constructor(private readonly cookies: CookieJar) {}

  async fetchWeblite(): Promise<WebliteData> {
    const response = await fetch("https://onetalk.alibaba.com/message/weblitePWA.htm", {
      headers: {
        "User-Agent": ALIWORKBENCH_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Cookie: cookieHeader(this.cookies)
      }
    });
    const html = await response.text();
    if (response.url.includes("login.alibaba.com") || /newlogin/i.test(html.slice(0, 5000))) {
      throw new Error("onetalk redirected to login");
    }
    const parsed = extractJsonAfter(html, "window.__VMFsConv__cache__");
    const conversations = Array.isArray(parsed) ? parsed.filter(isRecord) : [];
    return { html, conversations, bootstrap: pageBootstrap(html) };
  }

  async getChatMessages(request: ChatMessageRequest): Promise<ChatMessageResponse> {
    const query = csrfQuery(this.cookies);
    const endpoint =
      "https://onetalk.alibaba.com/message/getChatMessageList.htm" + (query ? `?${query}` : "");
    const payload = buildPayload(request.conversation, request.bootstrap, request.before, request.pageSize);
    const body = new URLSearchParams({ params: JSON.stringify(payload) });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "User-Agent": ALIWORKBENCH_UA,
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://onetalk.alibaba.com",
        Referer: "https://onetalk.alibaba.com/message/weblitePWA.htm",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cookieHeader(this.cookies)
      },
      body
    });
    const text = await response.text();
    const raw = safeJson(text);
    const code = isRecord(raw) ? (raw.code as string | number | null) ?? null : null;
    const data = isRecord(raw) && isRecord(raw.data) ? raw.data : {};
    const list = Array.isArray(data.list) ? data.list.filter(isRecord) : [];
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      code,
      raw,
      messages: list
    };
  }

  async getChatDataSummary(params: { secContactAccountId: string; secOwnerAccountId: string }): Promise<ChatDataSummaryResponse> {
    const query = csrfQuery(this.cookies);
    const endpoint =
      "https://onetalk.alibaba.com/chatManager/getChatDataSummary.htm" + (query ? `?${query}` : "");
    const body = new URLSearchParams({
      params: JSON.stringify({
        secContactAccountId: params.secContactAccountId,
        secOwnerAccountId: params.secOwnerAccountId,
        companyView: true
      })
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "User-Agent": ALIWORKBENCH_UA,
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://onetalk.alibaba.com",
        Referer: "https://onetalk.alibaba.com/message/alicrm.htm",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cookieHeader(this.cookies)
      },
      body
    });
    const text = await response.text();
    const raw = safeJson(text);
    const code = isRecord(raw) ? (raw.code as string | number | null) ?? null : null;
    const data = isRecord(raw) && isRecord(raw.data) ? raw.data : null;
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      code,
      raw,
      data
    };
  }
}

export function buildPayload(
  conversation: Record<string, unknown>,
  bootstrap: Record<string, string>,
  before: number | null,
  pageSize: number
): Record<string, unknown> {
  return {
    contactAccountId: conversation.contactAccountId,
    contactAccountIdEncrypt: conversation.encryptContactAccountId ?? conversation.contactAccountIdEncrypt,
    aliId: conversation.contactAliId,
    aliIdEncrypt: conversation.encryptContactAliId ?? conversation.aliIdEncrypt,
    cid: conversation.cid,
    conversationCode: conversation.cid,
    chatToken: conversation.chatToken,
    selfAliId: conversation.selfAliId ?? bootstrap.aliId,
    timeSlide: {
      forward: false,
      timeStamp: before,
      pageSize
    }
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
