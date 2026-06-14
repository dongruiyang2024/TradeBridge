import { sendMessageToAllOneTalkTabs } from "./onetalk-tab-messaging.js";
import type { ChromeApi } from "../shared/chrome-api.js";

export interface OneTalkAccountIdentity {
  loginId: string;
  aliId: string;
}

export async function detectOneTalkAccount(chromeApi: ChromeApi): Promise<OneTalkAccountIdentity> {
  const responses = await sendMessageToAllOneTalkTabs(chromeApi, { type: "get-onetalk-account" });
  for (const response of responses) {
    const identity = accountIdentityFromResponse(response);
    if (identity) return identity;
  }
  throw new Error("missing_onetalk_account_identity");
}

function accountIdentityFromResponse(response: unknown): OneTalkAccountIdentity | null {
  if (!isRecord(response) || response.ok !== true) return null;
  const loginId = stringValue(response.loginId);
  const aliId = stringValue(response.aliId);
  return loginId && aliId ? { loginId, aliId } : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
