import type { OneTalkCustomerProfileContact } from "../../shared/extension-messages.js";

interface CustomerProfilePageWindow extends Window {
  IcbuIM?: {
    lib?: {
      requestHelper?: {
        jsonp?: (endpoint: string, options: unknown) => Promise<unknown> | unknown;
      };
    };
  };
}

const CUSTOMER_INFO_ENDPOINT = "//alicrm.alibaba.com/jsonp/customerPluginQueryServiceI/queryCustomerInfo.json";

export async function requestCustomerProfilesFromPageRuntime(
  pageWindow: Window,
  contacts: OneTalkCustomerProfileContact[]
): Promise<Record<string, unknown>[]> {
  const runtime = pageWindow as CustomerProfilePageWindow;
  const jsonp = runtime.IcbuIM?.lib?.requestHelper?.jsonp;
  if (!jsonp) throw new Error("onetalk_customer_profile_unavailable");
  const profiles: Record<string, unknown>[] = [];
  for (const contact of contacts) {
    const profile = await requestCustomerProfile(jsonp, contact);
    if (profile) profiles.push(profile);
  }
  return profiles;
}

async function requestCustomerProfile(
  jsonp: (endpoint: string, options: unknown) => Promise<unknown> | unknown,
  contact: OneTalkCustomerProfileContact
): Promise<Record<string, unknown> | null> {
  const response = await jsonp(CUSTOMER_INFO_ENDPOINT, {
    type: "jsonp",
    data: {
      buyerAccountId: contact.buyerAccountId,
      buyerLoginId: contact.buyerLoginId || "",
      clientType: "PC",
      lang: "en_US"
    }
  });
  return sanitizedCustomerProfile(contact, response);
}

function sanitizedCustomerProfile(
  contact: OneTalkCustomerProfileContact,
  response: unknown
): Record<string, unknown> | null {
  const buyerInfo = firstRecord(response, ["data.data.buyerInfo", "data.buyerInfo", "buyerInfo"]);
  const sanitizedBuyerInfo = compact({
    firstName: firstString(buyerInfo, ["firstName"]),
    lastName: firstString(buyerInfo, ["lastName"]),
    companyName: firstString(buyerInfo, ["companyName"]),
    country: firstString(buyerInfo, ["country"]),
    encryptAccountId: firstString(buyerInfo, ["encryptAccountId"])
  });
  if (!Object.keys(sanitizedBuyerInfo).length) return null;
  return compact({
    buyerAccountId: contact.buyerAccountId,
    buyerLoginId: contact.buyerLoginId,
    data: { data: { buyerInfo: sanitizedBuyerInfo } }
  });
}

function firstRecord(source: unknown, keys: string[]): Record<string, unknown> {
  for (const key of keys) {
    const value = valueAtPath(source, key.split("."));
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

function valueAtPath(source: unknown, path: string[]): unknown {
  let current = source;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function compact<T extends Record<string, unknown>>(source: T): T {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== null)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
