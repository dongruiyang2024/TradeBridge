export interface LwpCustomerIdentity {
  accountIdEncrypt?: string;
  accountId?: string;
  aliIdEncrypt?: string;
  pairCustomerId?: string;
}

export interface CustomerProfileMatchInput {
  externalCustomerId: string;
  conversation: Record<string, unknown>;
  lwpIdentity: LwpCustomerIdentity;
}

const CUSTOMER_PROFILE_MATCH_PATHS = [
  "externalCustomerId",
  "customerId",
  "buyerAccountId",
  "buyerAccountIdEncrypt",
  "contactAccountId",
  "contactAccountIdEncrypt",
  "accountId",
  "encryptAccountId",
  "loginId",
  "buyerLoginId",
  "contactLoginId",
  "aliId",
  "buyerAliId",
  "contactAliId",
  "data.data.buyerInfo.encryptAccountId",
  "data.data.buyerInfo.loginId",
  "data.object.loginId",
  "data.object.aliId",
  "buyerInfo.encryptAccountId",
  "buyerInfo.loginId"
];

export function lwpCustomerIdentity(
  conversation: Record<string, unknown>,
  pairCustomerId: string | undefined
): LwpCustomerIdentity {
  const custom = parsedRecord(
    firstValue(conversation, [
      "singleChatUserConversation.user_extension.custom",
      "singleChatUserConversation.userExtension.custom"
    ])
  );
  return {
    accountIdEncrypt: firstString(custom, ["toAccIdE", "buyerAccountId", "contactAccountIdEncrypt"]),
    accountId: firstString(custom, ["toAccId", "contactAccountId"]),
    aliIdEncrypt: firstString(custom, ["toAliIdE", "contactAliIdEncrypt"]),
    pairCustomerId
  };
}

export function customerProfileFor(
  profiles: Record<string, unknown>[] | undefined,
  input: CustomerProfileMatchInput
): Record<string, unknown> {
  const matchIds = new Set(
    uniqueStrings([
      input.externalCustomerId,
      ...stringsFromPaths(input.conversation, CUSTOMER_PROFILE_MATCH_PATHS),
      ...identityValues(input.lwpIdentity)
    ])
  );
  return (
    (profiles || [])
      .filter(isRecord)
      .find((profile) => stringsFromPaths(profile, CUSTOMER_PROFILE_MATCH_PATHS).some((id) => matchIds.has(id))) || {}
  );
}

export function displayNameFromProfile(profile: Record<string, unknown>): string | undefined {
  const buyerInfo = buyerInfoFromProfile(profile);
  return (
    firstString(profile, ["displayName", "contactNick", "contactName", "buyerName", "buyerNick", "nickName", "name"]) ||
    firstString(buyerInfo, ["displayName", "contactNick", "contactName", "buyerName", "buyerNick", "nickName", "name"]) ||
    joinName(firstString(buyerInfo, ["firstName"]), firstString(buyerInfo, ["lastName"])) ||
    firstString(buyerInfo, ["companyName"])
  );
}

export function loginIdFromProfile(profile: Record<string, unknown>): string | undefined {
  const buyerInfo = buyerInfoFromProfile(profile);
  return (
    firstString(profile, ["loginId", "buyerLoginId", "contactLoginId", "data.object.loginId"]) ||
    firstString(buyerInfo, ["loginId", "buyerLoginId", "contactLoginId"])
  );
}

export function countryFromProfile(profile: Record<string, unknown>): string | undefined {
  const buyerInfo = buyerInfoFromProfile(profile);
  return firstString(buyerInfo, ["country", "countryCode"]) || firstString(profile, ["country", "countryCode"]);
}

function identityValues(identity: LwpCustomerIdentity): string[] {
  return uniqueStrings([
    identity.accountIdEncrypt,
    identity.accountId,
    identity.aliIdEncrypt,
    identity.pairCustomerId
  ].filter((value): value is string => typeof value === "string"));
}

function buyerInfoFromProfile(profile: Record<string, unknown>): Record<string, unknown> {
  return firstRecord(profile, ["data.data.buyerInfo", "data.buyerInfo", "buyerInfo"]);
}

function firstRecord(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  for (const key of keys) {
    const value = key.includes(".") ? valueAtPath(source, key.split(".")) : source[key];
    if (isRecord(value)) return value;
  }
  return {};
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

function stringsFromPaths(source: Record<string, unknown>, keys: string[]): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const value = key.includes(".") ? valueAtPath(source, key.split(".")) : source[key];
    if (typeof value === "string" && value.trim()) values.push(value.trim());
    if (typeof value === "number" && Number.isFinite(value)) values.push(String(value));
  }
  return values;
}

function valueAtPath(source: unknown, path: string[]): unknown {
  let current = source;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function joinName(firstName: string | undefined, lastName: string | undefined): string | undefined {
  const value = [firstName, lastName].filter(Boolean).join(" ").trim();
  return value || undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
