import { sendMessageToAllOneTalkTabs } from "./onetalk-tab-messaging.js";
import type { ChromeApi } from "../shared/chrome-api.js";
import type { OneTalkCustomerProfileContact } from "../shared/extension-messages.js";

export interface RequestOneTalkCustomerProfilesOptions {
  chromeApi: ChromeApi;
  contacts: OneTalkCustomerProfileContact[];
}

export async function requestOneTalkCustomerProfiles(
  options: RequestOneTalkCustomerProfilesOptions
): Promise<Record<string, unknown>[]> {
  if (!options.contacts.length) return [];
  const responses = await sendMessageToAllOneTalkTabs(options.chromeApi, {
    type: "get-onetalk-customer-profiles",
    contacts: options.contacts
  });
  for (const response of responses) {
    const profiles = profilesFromResponse(response);
    if (profiles) return profiles;
  }
  return [];
}

export function contactProfileRequestsFromConversations(
  conversations: Record<string, unknown>[]
): OneTalkCustomerProfileContact[] {
  const contacts = new Map<string, OneTalkCustomerProfileContact>();
  for (const conversation of conversations) {
    const custom = parsedRecord(firstValue(conversation, [
      "singleChatUserConversation.user_extension.custom",
      "singleChatUserConversation.userExtension.custom"
    ]));
    const buyerAccountId =
      firstString(custom, ["toAccIdE", "buyerAccountId", "contactAccountIdEncrypt"]) ||
      firstString(conversation, [
        "contact.accountIdEncrypt",
        "contact.accountId",
        "latestMessage.message.contact.accountIdEncrypt",
        "latestMessage.message.contact.accountId",
        "buyerAccountId",
        "contactAccountIdEncrypt",
        "contactAccountId",
        "accountIdEncrypt",
        "accountId"
      ]);
    if (!buyerAccountId || contacts.has(buyerAccountId)) continue;
    contacts.set(buyerAccountId, {
      buyerAccountId,
      buyerLoginId: firstString(conversation, [
        "contact.loginId",
        "latestMessage.message.contact.loginId",
        "buyerLoginId",
        "contactLoginId",
        "loginId"
      ])
    });
  }
  return Array.from(contacts.values()).map(compactContact);
}

function profilesFromResponse(response: unknown): Record<string, unknown>[] | null {
  if (!isRecord(response) || response.ok !== true || !Array.isArray(response.profiles)) return null;
  return response.profiles.filter(isRecord);
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

function parsedRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function compactContact(contact: OneTalkCustomerProfileContact): OneTalkCustomerProfileContact {
  return contact.buyerLoginId ? contact : { buyerAccountId: contact.buyerAccountId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
