interface TokenPageWindow extends Window {
  lib?: {
    mtop?: {
      request?: (options: unknown, callback?: (response: unknown) => void) => Promise<unknown> | unknown;
    };
  };
}

type MtopRequest = NonNullable<NonNullable<NonNullable<TokenPageWindow["lib"]>["mtop"]>["request"]>;

export interface OneTalkPageToken {
  accessToken: string;
  refreshToken?: string;
  expiresInMs?: number;
  appKey?: string;
  deviceId?: string;
}

interface OneTalkTokenRequestData {
  appKey: string;
  deviceId: string;
}

interface MtopOptionPreset {
  type: "jsonp" | "GET";
  dataType: "jsonp" | "json";
  jsonpIncPrefix?: string;
  timeout?: number;
  wsConnectTimeout?: number;
  batchConnectWs?: boolean;
  log?: Record<string, never>;
}

const MTOP_LOGIN_TOKEN_API = "mtop.alibaba.icbu.im.login.token.get";
const TOKEN_OPTION_PRESETS: MtopOptionPreset[] = [
  {
    type: "jsonp",
    dataType: "jsonp",
    jsonpIncPrefix: "imList",
    timeout: 20_000,
    wsConnectTimeout: 20_000,
    batchConnectWs: true,
    log: {}
  },
  { type: "GET", dataType: "json" }
];

export async function requestImTokenFromPageRuntime(
  pageWindow: Window,
  appKey: string,
  deviceId: string
): Promise<OneTalkPageToken> {
  const runtime = pageWindow as TokenPageWindow;
  const request = runtime.lib?.mtop?.request;
  if (!request) throw new Error("onetalk_mtop_unavailable");
  const tokenData = tokenRequestDataFromPageRuntime(runtime, { appKey, deviceId });
  const response = await requestMtopTokenWithFallbacks(request, appKey, tokenData);
  const object = tokenObjectFromMtopResult(response);
  if (!object?.accessToken) throw new Error("onetalk_token_response_invalid");
  return {
    accessToken: object.accessToken,
    refreshToken: object.refreshToken,
    expiresInMs: object.accessTokenExpiredMillSeconds,
    appKey: tokenData.appKey,
    deviceId: tokenData.deviceId
  };
}

async function requestMtopTokenWithFallbacks(
  request: MtopRequest,
  fallbackAppKey: string,
  tokenData: OneTalkTokenRequestData
): Promise<unknown> {
  let lastResponse: unknown;
  for (const requestAppKey of uniqueStrings([fallbackAppKey, tokenData.appKey])) {
    for (const preset of TOKEN_OPTION_PRESETS) {
      for (const data of [tokenData, JSON.stringify(tokenData)]) {
        const response = await requestMtopTokenAttempt(request, requestAppKey, data, preset);
        if (tokenObjectFromMtopResult(response)?.accessToken) return response;
        lastResponse = response;
      }
    }
  }
  return lastResponse;
}

function requestMtopTokenAttempt(
  request: MtopRequest,
  appKey: string,
  data: OneTalkTokenRequestData | string,
  preset: MtopOptionPreset
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try {
      const maybePromise = request({ api: MTOP_LOGIN_TOKEN_API, v: "1.0", appKey, ...preset, data }, resolve);
      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === "function") {
        (maybePromise as Promise<unknown>).then(resolve, reject);
      }
    } catch (error) {
      reject(error);
    }
  });
}

function tokenRequestDataFromPageRuntime(
  pageWindow: TokenPageWindow,
  fallback: OneTalkTokenRequestData
): OneTalkTokenRequestData {
  return recentPageTokenRequestData(pageWindow, fallback) || fallback;
}

function recentPageTokenRequestData(
  pageWindow: TokenPageWindow,
  fallback: OneTalkTokenRequestData
): OneTalkTokenRequestData | null {
  const entries = pageWindow.performance?.getEntriesByType?.("resource") || [];
  const candidates: OneTalkTokenRequestData[] = [];
  for (const entry of entries) {
    const name = typeof entry.name === "string" ? entry.name : "";
    if (!name.includes(MTOP_LOGIN_TOKEN_API)) continue;
    const tokenData = tokenRequestDataFromResourceName(name);
    if (tokenData) candidates.push(tokenData);
  }

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (candidate.appKey !== fallback.appKey && candidate.deviceId !== fallback.deviceId) return candidate;
  }
  return candidates[candidates.length - 1] || null;
}

function tokenRequestDataFromResourceName(name: string): OneTalkTokenRequestData | null {
  try {
    const data = new URL(name).searchParams.get("data");
    if (!data) return null;
    const parsed: unknown = JSON.parse(data);
    if (!isRecord(parsed)) return null;
    const appKey = firstString(parsed, ["appKey"]);
    const deviceId = firstString(parsed, ["deviceId"]);
    return appKey && deviceId ? { appKey, deviceId } : null;
  } catch {
    return null;
  }
}

function tokenObjectFromMtopResult(value: unknown): {
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiredMillSeconds?: number;
} | null {
  const response = parseMtopResponse(value);
  const data = isRecord(response) && isRecord(response.data) ? response.data : null;
  const object = data && isRecord(data.object) ? data.object : null;
  if (!object) return null;
  return {
    accessToken: firstString(object, ["accessToken"]),
    refreshToken: firstString(object, ["refreshToken"]),
    accessTokenExpiredMillSeconds:
      typeof object.accessTokenExpiredMillSeconds === "number" ? object.accessTokenExpiredMillSeconds : undefined
  };
}

function parseMtopResponse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  const jsonp = /^[^(]*\((.*)\)\s*;?$/.exec(text);
  const payload = jsonp?.[1] || text;
  try {
    return JSON.parse(payload);
  } catch {
    return value;
  }
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)));
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
