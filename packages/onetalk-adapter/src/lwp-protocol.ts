export const LWP_ROUTES = {
  register: "/reg",
  getState: "/r/SyncStatus/getState",
  ackDiff: "/r/SyncStatus/ackDiff",
  conversations: "/r/Conversation/listNewestPagination",
  messages: "/r/MessageManager/listUserMessages",
  heartbeat: "/!"
} as const;

export interface ParsedLwpFrame {
  code?: number;
  route?: string;
  mid?: string;
  headers: Record<string, unknown>;
  body?: unknown;
  raw: Record<string, unknown>;
}

export interface RegisterFrameInput {
  mid: string;
  appKey: string;
  deviceId: string;
  accessToken: string;
  userAgent: string;
}

export function buildRegisterFrame(input: RegisterFrameInput): string {
  return JSON.stringify({
    lwp: LWP_ROUTES.register,
    headers: {
      mid: input.mid,
      "app-key": input.appKey,
      did: input.deviceId,
      token: input.accessToken,
      ua: lwpUserAgent(input.userAgent),
      dt: "j",
      wv: "im:3,au:3,sy:6",
      sync: "0,0;0;0;",
      "cache-header": "app-key token ua wv"
    }
  });
}

export function buildGetStateFrame(mid: string): string {
  return buildLwpFrame(mid, LWP_ROUTES.getState, [{ topic: "sync" }]);
}

export function buildAckDiffFrame(mid: string, state: Record<string, unknown>): string {
  return buildLwpFrame(mid, LWP_ROUTES.ackDiff, [state]);
}

export function buildConversationListFrame(mid: string, cursor: number, pageSize: number): string {
  return buildLwpFrame(mid, LWP_ROUTES.conversations, [cursor, pageSize]);
}

export function buildMessageListFrame(mid: string, cid: string, cursor: number, pageSize: number): string {
  return buildLwpFrame(mid, LWP_ROUTES.messages, [cid, false, cursor, pageSize, false]);
}

export function buildHeartbeatFrame(mid: string): string {
  return JSON.stringify({
    lwp: LWP_ROUTES.heartbeat,
    headers: { mid }
  });
}

export function parseLwpFrame(text: string): ParsedLwpFrame {
  const raw = parseRecord(text);
  const headers = isRecord(raw.headers) ? raw.headers : {};
  const mid = typeof headers.mid === "string" ? headers.mid : undefined;
  const code = typeof raw.code === "number" ? raw.code : undefined;
  const route = typeof raw.lwp === "string" ? raw.lwp : undefined;
  return {
    code,
    route,
    mid,
    headers,
    body: raw.body,
    raw
  };
}

function buildLwpFrame(mid: string, route: string, body: unknown): string {
  return JSON.stringify({
    lwp: route,
    headers: { mid },
    body
  });
}

function parseRecord(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    if (isRecord(value)) return value;
  } catch {
    throw new Error("lwp_frame_invalid_json");
  }
  throw new Error("lwp_frame_invalid_shape");
}

function lwpUserAgent(userAgent: string): string {
  if (/DingWeb\/[^ ]+ IMPaaS/.test(userAgent)) return userAgent;
  const chromeVersion = /Chrome\/([^ ]+)/.exec(userAgent)?.[1];
  const macVersion = /Mac OS X ([^;)]+)/.exec(userAgent)?.[1]?.replace(/_/g, ".");
  const os = macVersion ? ` OS(Mac OS/${macVersion})` : "";
  const browser = chromeVersion ? ` Browser(Chrome/${chromeVersion})` : "";
  return `${userAgent} DingTalk(2.1.0-beta.22)${os}${browser} DingWeb/2.1.0-beta.22 IMPaaS`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
