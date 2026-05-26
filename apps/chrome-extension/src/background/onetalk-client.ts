import {
  buildPayload,
  extractJsonAfter,
  pageBootstrap,
  type ChatMessageRequest,
  type ChatMessageResponse,
  type WebliteData
} from "@wangwang/onetalk-adapter/browser";

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
    return {
      html,
      conversations,
      bootstrap: pageBootstrap(html)
    };
  }

  async getChatMessages(request: ChatMessageRequest): Promise<ChatMessageResponse> {
    const payload = buildPayload(request.conversation, request.bootstrap, request.before, request.pageSize);
    const response = await fetch(MESSAGE_URL, {
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
