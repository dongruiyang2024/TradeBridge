import {
  buildPayload,
  extractJsonAfter,
  pageBootstrap,
  type ChatMessageRequest,
  type ChatMessageResponse,
  type WebliteData
} from "@wangwang/onetalk-adapter/browser";
import { getChrome, type ChromeCookie } from "../shared/chrome-api.js";
import { readLatestOnetalkPageSnapshot } from "./onetalk-page-snapshot.js";

const WEBLITE_URL = "https://onetalk.alibaba.com/message/weblitePWA.htm";
const MESSAGE_URL = "https://onetalk.alibaba.com/message/getChatMessageList.htm";

export class BrowserOnetalkClient {
  async fetchWeblite(): Promise<WebliteData> {
    const response = await fetch(WEBLITE_URL, {
      credentials: "include",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    const html = await response.text();
    if (response.url.includes("login.alibaba.com") || /newlogin/i.test(html.slice(0, 5000))) {
      throw new Error("onetalk_login_required");
    }
    const parsed = extractJsonAfter(html, "window.__VMFsConv__cache__");
    const conversations = Array.isArray(parsed) ? parsed.filter(isRecord) : [];
    const pageSnapshot = await readLatestOnetalkPageSnapshot();
    return {
      html,
      conversations,
      bootstrap: pageBootstrap(html),
      pageSnapshot
    };
  }

  async getChatMessages(request: ChatMessageRequest): Promise<ChatMessageResponse> {
    const query = await csrfQueryFromChromeCookies();
    const endpoint = MESSAGE_URL + (query ? `?${query}` : "");
    const payload = buildPayload(request.conversation, request.bootstrap, request.before, request.pageSize);
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: new URLSearchParams({ params: JSON.stringify(payload) })
    });
    const text = await response.text();
    if (response.url.includes("login.alibaba.com") || /newlogin/i.test(text.slice(0, 5000))) {
      throw new Error("onetalk_login_required");
    }
    if (response.status === 429) {
      throw new Error("onetalk_rate_limited");
    }
    const raw = safeJson(text);
    const code = isRecord(raw) ? (raw.code as string | number | null) ?? null : null;
    const contentType = response.headers.get("content-type");
    const list = messageListFromRaw(raw);
    return {
      status: response.status,
      contentType,
      code,
      raw,
      messages: list.messages,
      diagnostics: {
        status: response.status,
        contentType,
        code,
        listLength: list.messages.length,
        listPath: list.path,
        topLevelKeys: objectKeys(raw),
        dataKeys: objectKeys(isRecord(raw) ? raw.data : undefined)
      }
    };
  }
}

async function csrfQueryFromChromeCookies(): Promise<string> {
  const cookies = await readAlibabaCookies();
  const cookieMap = Object.fromEntries(cookies.map((cookie) => [cookie.name, cookie.value]));
  const params = new URLSearchParams();
  const ctoken = ctokenFromXmanUsT(cookieMap.xman_us_t || "");
  const tbToken = cookieMap._tb_token_ || "";
  if (ctoken) params.set("ctoken", ctoken);
  if (tbToken) params.set("_tb_token_", tbToken);
  return params.toString();
}

async function readAlibabaCookies(): Promise<ChromeCookie[]> {
  try {
    return (await getChrome().cookies?.getAll({ domain: "alibaba.com" })) || [];
  } catch {
    return [];
  }
}

function ctokenFromXmanUsT(raw: string): string {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const params = new URLSearchParams(decoded);
  return params.get("ctoken") || params.get(" ctoken") || "";
}

function messageListFromRaw(raw: unknown): { messages: Record<string, unknown>[]; path?: string } {
  for (const path of [
    ["data", "list"],
    ["data", "messages"],
    ["data", "messageList"],
    ["data", "data", "list"],
    ["result", "list"],
    ["result", "messages"],
    ["list"],
    ["messages"]
  ]) {
    const value = valueAtPath(raw, path);
    if (Array.isArray(value)) return { messages: value.filter(isRecord), path: path.join(".") };
  }
  return { messages: [] };
}

function valueAtPath(source: unknown, path: string[]): unknown {
  let current = source;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function objectKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).sort() : [];
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
