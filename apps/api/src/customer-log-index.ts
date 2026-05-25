import fs from "node:fs";
import { LOG_PATHS } from "./config.js";

export interface UserInfoRecord {
  aliId?: number | string;
  available?: boolean;
  countryCode?: string;
  countryIcon?: string;
  emailValidation?: boolean;
  joiningYears?: number;
  loginId?: string;
  potentialScore?: number;
  recentContact?: boolean;
}

export interface AccountTokenRecord {
  accountId?: number | string;
  accountIdEncrypted?: string;
  checkResult?: boolean;
  targetAliId?: number | string;
  targetAliIdEncrypted?: string;
  targetLoginId?: string;
  targetLoginIdEncrypted?: string;
}

export interface ContactExtInfoRecord {
  accountIdEncrypt?: string;
  accountStatus?: string | number;
  aliId?: number | string;
  avatarUrl?: string;
  companyName?: string;
  country?: string;
  firstName?: string;
  lastName?: string;
  loginId?: string;
  vaccountId?: number | string;
}

export interface AlicrmContext {
  contactAccountIdEncrypt?: string;
  ownerAccountIdEncrypt?: string;
  buyerLoginId?: string;
  chatLoginId?: string;
  fromPage?: string;
  hasChatToken: boolean;
}

export class CustomerLogIndex {
  private readonly userByAliId = new Map<string, UserInfoRecord>();
  private readonly userByLoginId = new Map<string, UserInfoRecord>();
  private readonly accountByEncryptedId = new Map<string, AccountTokenRecord>();
  private readonly accountByTargetAliId = new Map<string, AccountTokenRecord>();
  private readonly accountByLoginId = new Map<string, AccountTokenRecord>();
  private readonly contactExtByEncryptedId = new Map<string, ContactExtInfoRecord>();
  private readonly contactExtByAliId = new Map<string, ContactExtInfoRecord>();
  private readonly contactExtByLoginId = new Map<string, ContactExtInfoRecord>();
  private readonly alicrmContexts: AlicrmContext[] = [];

  static fromDefaultLogs(): CustomerLogIndex {
    const index = new CustomerLogIndex();
    for (const path of LOG_PATHS) {
      if (!fs.existsSync(path)) continue;
      const text = fs.readFileSync(path, "utf8");
      index.addText(text);
    }
    return index;
  }

  findUser(options: { aliId?: unknown; loginId?: unknown }): UserInfoRecord | null {
    const byAli = keyOf(options.aliId);
    if (byAli && this.userByAliId.has(byAli)) return this.userByAliId.get(byAli) || null;
    const byLogin = loginKey(options.loginId);
    if (byLogin && this.userByLoginId.has(byLogin)) return this.userByLoginId.get(byLogin) || null;
    return null;
  }

  findAccount(options: { accountIdEncrypted?: unknown; targetAliId?: unknown; loginId?: unknown }): AccountTokenRecord | null {
    const byEncrypted = keyOf(options.accountIdEncrypted);
    if (byEncrypted && this.accountByEncryptedId.has(byEncrypted)) return this.accountByEncryptedId.get(byEncrypted) || null;
    const byAli = keyOf(options.targetAliId);
    if (byAli && this.accountByTargetAliId.has(byAli)) return this.accountByTargetAliId.get(byAli) || null;
    const byLogin = loginKey(options.loginId);
    if (byLogin && this.accountByLoginId.has(byLogin)) return this.accountByLoginId.get(byLogin) || null;
    return null;
  }

  findContactExt(options: { accountIdEncrypt?: unknown; aliId?: unknown; loginId?: unknown }): ContactExtInfoRecord | null {
    const byEncrypted = keyOf(options.accountIdEncrypt);
    if (byEncrypted && this.contactExtByEncryptedId.has(byEncrypted)) return this.contactExtByEncryptedId.get(byEncrypted) || null;
    const byAli = keyOf(options.aliId);
    if (byAli && this.contactExtByAliId.has(byAli)) return this.contactExtByAliId.get(byAli) || null;
    const byLogin = loginKey(options.loginId);
    if (byLogin && this.contactExtByLoginId.has(byLogin)) return this.contactExtByLoginId.get(byLogin) || null;
    return null;
  }

  findAlicrmContext(options: { contactAccountIdEncrypt?: unknown; buyerLoginId?: unknown }): AlicrmContext | null {
    const encrypted = keyOf(options.contactAccountIdEncrypt);
    const login = loginKey(options.buyerLoginId);
    for (let index = this.alicrmContexts.length - 1; index >= 0; index -= 1) {
      const item = this.alicrmContexts[index];
      if (encrypted && item.contactAccountIdEncrypt === encrypted) return item;
      if (login && loginKey(item.buyerLoginId || item.chatLoginId) === login) return item;
    }
    return null;
  }

  private addText(text: string): void {
    this.addMtopPayloads(text);
    this.addAlicrmContexts(text);
  }

  private addMtopPayloads(text: string): void {
    const marker = 'data={"api":"';
    let index = 0;
    while (index < text.length) {
      const markerIndex = text.indexOf(marker, index);
      if (markerIndex < 0) break;
      const objectStart = text.indexOf("{", markerIndex);
      if (objectStart < 0) break;
      const raw = extractBalancedJson(text, objectStart);
      index = objectStart + Math.max(raw?.length || 1, 1);
      if (!raw) continue;
      const parsed = safeJson(raw);
      if (!isRecord(parsed) || typeof parsed.api !== "string") continue;
      const api = parsed.api.toLowerCase();
      if (api === "mtop.alibaba.icbu.im.getuserinfobyparams") {
        const object = isRecord(parsed.data) ? parsed.data.object : null;
        if (Array.isArray(object)) {
          for (const item of object) {
            if (isRecord(item)) this.addUserInfo(item as UserInfoRecord);
          }
        }
      }
      if (api === "mtop.alibaba.icbu.im.security.getaccountinfobytoken") {
        const object = isRecord(parsed.data) && isRecord(parsed.data.object) ? parsed.data.object : null;
        if (object) this.addAccountToken(object as AccountTokenRecord);
      }
      if (api === "mtop.alibaba.icbu.contact.extinfo.get") {
        const data = isRecord(parsed.data) && isRecord(parsed.data.data) ? parsed.data.data : null;
        const list = isRecord(data) && Array.isArray(data.accountInfoList) ? data.accountInfoList : [];
        for (const item of list) {
          if (isRecord(item)) this.addContactExtInfo(item as ContactExtInfoRecord);
        }
      }
    }
  }

  private addUserInfo(record: UserInfoRecord): void {
    const aliId = keyOf(record.aliId);
    const loginId = loginKey(record.loginId);
    if (aliId) this.userByAliId.set(aliId, pickUserInfo(record));
    if (loginId) this.userByLoginId.set(loginId, pickUserInfo(record));
  }

  private addAccountToken(record: AccountTokenRecord): void {
    const clean = pickAccountToken(record);
    const encrypted = keyOf(clean.accountIdEncrypted);
    const aliId = keyOf(clean.targetAliId);
    const loginId = loginKey(clean.targetLoginId);
    if (encrypted) this.accountByEncryptedId.set(encrypted, clean);
    if (aliId) this.accountByTargetAliId.set(aliId, clean);
    if (loginId) this.accountByLoginId.set(loginId, clean);
  }

  private addContactExtInfo(record: ContactExtInfoRecord): void {
    const clean = pickContactExtInfo(record);
    const encrypted = keyOf(clean.accountIdEncrypt);
    const aliId = keyOf(clean.aliId);
    const loginId = loginKey(clean.loginId);
    if (encrypted) this.contactExtByEncryptedId.set(encrypted, clean);
    if (aliId) this.contactExtByAliId.set(aliId, clean);
    if (loginId) this.contactExtByLoginId.set(loginId, clean);
  }

  private addAlicrmContexts(text: string): void {
    const urlPattern = /https?:\/\/onetalk\.alibaba\.com\/message\/alicrm\.htm\?[^\s"'<>\\\]]+/gi;
    for (const match of text.matchAll(urlPattern)) {
      const url = cleanLogUrl(match[0]);
      const context = parseAlicrmUrl(url);
      if (context.contactAccountIdEncrypt || context.buyerLoginId || context.chatLoginId) {
        this.alicrmContexts.push(context);
      }
    }
  }
}

function pickUserInfo(record: UserInfoRecord): UserInfoRecord {
  return {
    aliId: record.aliId,
    available: record.available,
    countryCode: record.countryCode,
    countryIcon: record.countryIcon,
    emailValidation: record.emailValidation,
    joiningYears: record.joiningYears,
    loginId: record.loginId,
    potentialScore: record.potentialScore,
    recentContact: record.recentContact
  };
}

function pickAccountToken(record: AccountTokenRecord): AccountTokenRecord {
  return {
    accountId: record.accountId,
    accountIdEncrypted: record.accountIdEncrypted,
    checkResult: record.checkResult,
    targetAliId: record.targetAliId,
    targetAliIdEncrypted: record.targetAliIdEncrypted,
    targetLoginId: record.targetLoginId,
    targetLoginIdEncrypted: record.targetLoginIdEncrypted
  };
}

function pickContactExtInfo(record: ContactExtInfoRecord): ContactExtInfoRecord {
  return {
    accountIdEncrypt: record.accountIdEncrypt,
    accountStatus: record.accountStatus,
    aliId: record.aliId,
    avatarUrl: record.avatarUrl,
    companyName: record.companyName,
    country: record.country,
    firstName: record.firstName,
    lastName: record.lastName,
    loginId: record.loginId,
    vaccountId: record.vaccountId
  };
}

function parseAlicrmUrl(url: string): AlicrmContext {
  const params = new URL(url).searchParams;
  const nested = params.get("return_url");
  const nestedParams = nested ? parseNestedParams(nested) : null;
  const read = (key: string) => params.get(key) || nestedParams?.get(key) || undefined;
  return {
    contactAccountIdEncrypt: read("contactAccountIdEncrypt") || read("secContactAccountId"),
    ownerAccountIdEncrypt: read("ownerAccountIdEncrypt") || read("secOwnerAccountId"),
    buyerLoginId: read("buyerLoginId"),
    chatLoginId: read("chatLoginId"),
    fromPage: read("fromPage"),
    hasChatToken: Boolean(read("chatToken"))
  };
}

function parseNestedParams(value: string): URLSearchParams | null {
  try {
    return new URLSearchParams(new URL(value).search);
  } catch {
    return null;
  }
}

function cleanLogUrl(value: string): string {
  let result = value.replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  for (let index = 0; index < 2; index += 1) {
    result = decodeURIComponentSafe(result);
  }
  return result.replace(/[),\]};]+$/g, "");
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractBalancedJson(text: string, start: number): string | null {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function keyOf(value: unknown): string {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number") return String(value);
  return "";
}

function loginKey(value: unknown): string {
  return keyOf(value).toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
