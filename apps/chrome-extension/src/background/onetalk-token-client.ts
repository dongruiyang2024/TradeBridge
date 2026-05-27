import { sendMessageToAllOneTalkTabs } from "./onetalk-tab-messaging.js";
import type { ChromeApi } from "../shared/chrome-api.js";

export interface OneTalkImToken {
  accessToken: string;
  refreshToken?: string;
  expiresInMs?: number;
  appKey?: string;
  deviceId?: string;
}

export interface RequestOneTalkImTokenOptions {
  chromeApi: ChromeApi;
  appKey: string;
  deviceId: string;
}

export async function requestOneTalkImToken(options: RequestOneTalkImTokenOptions): Promise<OneTalkImToken> {
  const responses = await sendMessageToAllOneTalkTabs(options.chromeApi, {
    type: "get-onetalk-im-token",
    appKey: options.appKey,
    deviceId: options.deviceId
  });
  let lastError: Error | null = null;
  for (const response of responses) {
    try {
      return tokenFromResponse(response);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("onetalk_token_response_invalid");
    }
  }
  throw lastError || new Error("onetalk_token_response_invalid");
}

function tokenFromResponse(response: unknown): OneTalkImToken {
  if (!isTokenResponse(response)) throw new Error("onetalk_token_response_invalid");
  if (!response.ok) throw new Error(response.error || "onetalk_token_fetch_failed");
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    expiresInMs: response.expiresInMs,
    appKey: response.appKey,
    deviceId: response.deviceId
  };
}

function isTokenResponse(value: unknown): value is {
  ok: boolean;
  accessToken: string;
  refreshToken?: string;
  expiresInMs?: number;
  appKey?: string;
  deviceId?: string;
  error?: string;
} {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    (value.ok === false || (typeof value.accessToken === "string" && value.accessToken.length > 0)) &&
    (value.refreshToken === undefined || typeof value.refreshToken === "string") &&
    (value.expiresInMs === undefined || typeof value.expiresInMs === "number") &&
    (value.appKey === undefined || typeof value.appKey === "string") &&
    (value.deviceId === undefined || typeof value.deviceId === "string") &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
