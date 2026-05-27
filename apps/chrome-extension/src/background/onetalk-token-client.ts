import type { ChromeApi } from "../shared/chrome-api.js";

export interface OneTalkImToken {
  accessToken: string;
  refreshToken?: string;
  expiresInMs?: number;
}

export interface RequestOneTalkImTokenOptions {
  chromeApi: ChromeApi;
  appKey: string;
  deviceId: string;
}

export async function requestOneTalkImToken(options: RequestOneTalkImTokenOptions): Promise<OneTalkImToken> {
  if (!options.chromeApi.tabs) throw new Error("chrome_tabs_unavailable");
  const tabs = await options.chromeApi.tabs.query({ url: "https://onetalk.alibaba.com/*" });
  const tab = tabs.find((item) => typeof item.id === "number");
  if (typeof tab?.id !== "number") throw new Error("onetalk_tab_required");

  const response = await options.chromeApi.tabs.sendMessage(tab.id, {
    type: "get-onetalk-im-token",
    appKey: options.appKey,
    deviceId: options.deviceId
  });
  if (!isTokenResponse(response)) throw new Error("onetalk_token_response_invalid");
  if (!response.ok) throw new Error(response.error || "onetalk_token_fetch_failed");
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    expiresInMs: response.expiresInMs
  };
}

function isTokenResponse(value: unknown): value is {
  ok: boolean;
  accessToken: string;
  refreshToken?: string;
  expiresInMs?: number;
  error?: string;
} {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    (value.ok === false || (typeof value.accessToken === "string" && value.accessToken.length > 0)) &&
    (value.refreshToken === undefined || typeof value.refreshToken === "string") &&
    (value.expiresInMs === undefined || typeof value.expiresInMs === "number") &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
