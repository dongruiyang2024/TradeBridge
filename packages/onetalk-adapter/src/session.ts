import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const COOKIE_NAMES = [
  "_m_h5_tk",
  "_m_h5_tk_enc",
  "_tb_token_",
  "ali_apache_id",
  "ali_apache_track",
  "cookie2",
  "icbu_s_tag",
  "intl_common_forever",
  "isg",
  "recommend_login",
  "sgcookie",
  "tfstk",
  "xman_f",
  "xman_i",
  "xman_t",
  "xman_us_f",
  "xman_us_t",
  "xlly_s"
];

const COOKIE_NAME_SET = new Set(COOKIE_NAMES);
const MAC_SAFE_STORAGE_SERVICES = [
  "Chromium Safe Storage",
  "Chrome Safe Storage",
  "AliSupplier Safe Storage",
  "AlibabaSupplier Safe Storage",
  "AliWorkbench Safe Storage"
];
const MAC_CHROMIUM_SALT = "saltysalt";
const MAC_CHROMIUM_IV = Buffer.alloc(16, " ");
const MAC_MOCK_KEYCHAIN_PASSWORD = "mock_password";
const TOKEN_CACHE_SUBDIRS = [
  ["Cache", "Cache_Data"],
  ["Code Cache", "js"],
  ["Local Storage", "leveldb"],
  ["Session Storage"]
];
const MAX_TOKEN_CACHE_FILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_KEYCHAIN_TIMEOUT_MS = 10000;
const macSafeStoragePasswordCache = new Map<string, string | null>();

export type CookieJar = Record<string, string>;

export interface ExtractCookiesOptions {
  cookieDbPaths?: string[];
  homeDir?: string;
  keychainPaths?: string[];
  platform?: NodeJS.Platform;
  safeStoragePassword?: string;
  safeStorageServices?: string[];
  tokenCachePaths?: string[];
}

interface ChromiumCookieRow {
  host_key?: string;
  name?: string;
  value?: string;
  encrypted_value_hex?: string;
}

export function extractCookies(paths: string[], options: ExtractCookiesOptions = {}): CookieJar {
  const found: CookieJar = {};
  for (const filePath of paths) {
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, "utf8");
    Object.assign(found, extractCookiesFromText(text));
  }
  if (options.cookieDbPaths?.length) {
    Object.assign(found, extractChromiumCookies(options.cookieDbPaths, options));
  }
  return found;
}

export function extractAliWorkbenchCookies(paths: string[], options: ExtractCookiesOptions = {}): CookieJar {
  const platform = options.platform || process.platform;
  const cookieDbPaths = options.cookieDbPaths || discoverAliWorkbenchCookieDbs(options.homeDir, platform);
  const tokenCachePaths = options.tokenCachePaths || discoverAliWorkbenchTokenCacheFiles(options.homeDir, platform);
  return extractCookies([...paths, ...tokenCachePaths], { ...options, platform, cookieDbPaths });
}

export function extractCookiesFromText(text: string): CookieJar {
  const found: CookieJar = {};
  for (const name of COOKIE_NAMES) {
    const pattern = new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRegExp(name)}=([^;&\\s,\\]]+)`, "gm");
    for (const match of text.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (value && !value.includes("<")) {
        found[name] = value;
      }
    }
  }
  Object.assign(found, extractCsrfTokensFromRequestUrls(text));
  return found;
}

export function discoverAliWorkbenchCookieDbs(
  homeDir = os.homedir(),
  platform: NodeJS.Platform = process.platform
): string[] {
  if (platform !== "darwin") return [];
  const root = path.join(homeDir, "Library", "Application Support", "AliWorkbenchTemp");
  const candidates = new Set<string>();
  candidates.add(path.join(root, "Cookies"));
  try {
    for (const item of fs.readdirSync(root, { withFileTypes: true })) {
      if (item.isDirectory()) {
        candidates.add(path.join(root, item.name, "Cookies"));
      }
    }
  } catch {
    return [];
  }
  return Array.from(candidates)
    .filter((candidate) => fs.existsSync(candidate))
    .sort();
}

export function discoverAliWorkbenchTokenCacheFiles(
  homeDir = os.homedir(),
  platform: NodeJS.Platform = process.platform
): string[] {
  if (platform !== "darwin") return [];
  const root = path.join(homeDir, "Library", "Application Support", "AliWorkbenchTemp");
  const profileDirs = new Set<string>();
  profileDirs.add(root);
  try {
    for (const item of fs.readdirSync(root, { withFileTypes: true })) {
      if (item.isDirectory()) {
        profileDirs.add(path.join(root, item.name));
      }
    }
  } catch {
    return [];
  }

  const files = new Set<string>();
  for (const profileDir of profileDirs) {
    for (const subdir of TOKEN_CACHE_SUBDIRS) {
      addDirectoryFiles(path.join(profileDir, ...subdir), files);
    }
  }
  return Array.from(files).sort();
}

export function defaultMacKeychainPaths(
  homeDir = os.homedir(),
  platform: NodeJS.Platform = process.platform
): string[] {
  if (platform !== "darwin") return [];
  const loginKeychain = path.join(homeDir, "Library", "Keychains", "login.keychain-db");
  return fs.existsSync(loginKeychain) ? [loginKeychain] : [];
}

export function getCtoken(cookies: CookieJar): string {
  const raw = cookies.xman_us_t || "";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const params = new URLSearchParams(decoded);
  return params.get("ctoken") || params.get(" ctoken") || "";
}

export function csrfQuery(cookies: CookieJar): string {
  const params = new URLSearchParams();
  const ctoken = getCtoken(cookies);
  const tbToken = cookies._tb_token_ || "";
  if (ctoken) params.set("ctoken", ctoken);
  if (tbToken) params.set("_tb_token_", tbToken);
  return params.toString();
}

export function cookieHeader(cookies: CookieJar): string {
  return Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractCsrfTokensFromRequestUrls(text: string): CookieJar {
  const found: CookieJar = {};
  for (const match of text.matchAll(/[?&](ctoken|_tb_token_)=([^&#\s"'<>]+)/g)) {
    const name = match[1];
    const value = decodeTokenValue(match[2]);
    if (!value || value.includes("<")) continue;
    if (name === "_tb_token_") {
      found._tb_token_ = value;
    } else {
      found.xman_us_t = `ctoken%3D${encodeURIComponent(value)}`;
    }
  }
  return found;
}

function decodeTokenValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function addDirectoryFiles(dirPath: string, files: Set<string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(dirPath, entry.name);
    try {
      const stat = fs.statSync(filePath);
      if (stat.size <= MAX_TOKEN_CACHE_FILE_BYTES) {
        files.add(filePath);
      }
    } catch {
      // Cache files can disappear while AliWorkbench is running.
    }
  }
}

function extractChromiumCookies(paths: string[], options: ExtractCookiesOptions): CookieJar {
  const found: CookieJar = {};
  const macPasswordCandidates = macChromiumPasswordCandidates(options.safeStoragePassword);
  let attemptedKeychainPassword = Boolean(options.safeStoragePassword);
  for (const dbPath of paths) {
    for (const row of readChromiumCookieRows(dbPath)) {
      const name = row.name || "";
      if (!COOKIE_NAME_SET.has(name)) continue;
      let value = row.value || decryptChromiumCookieValue(row, options, macPasswordCandidates);
      if (!value && !attemptedKeychainPassword && isMacPlatform(options.platform)) {
        const keychainPassword = resolveMacSafeStoragePassword(options.safeStorageServices, options.keychainPaths);
        attemptedKeychainPassword = true;
        if (keychainPassword) {
          macPasswordCandidates.push(keychainPassword);
          value = decryptChromiumCookieValue(row, options, macPasswordCandidates);
        }
      }
      if (value && !value.includes("<")) {
        found[name] = value;
      }
    }
  }
  return found;
}

function decryptChromiumCookieValue(
  row: ChromiumCookieRow,
  options: ExtractCookiesOptions,
  safeStoragePasswords: string[] = []
): string | null {
  if (!row.encrypted_value_hex) return null;
  const encrypted = Buffer.from(row.encrypted_value_hex, "hex");
  if (isMacPlatform(options.platform)) {
    for (const password of safeStoragePasswords) {
      const decrypted = decryptMacChromiumCookie(encrypted, password);
      if (decrypted) return decrypted;
    }
  }
  return null;
}

function macChromiumPasswordCandidates(safeStoragePassword?: string): string[] {
  return Array.from(new Set([safeStoragePassword || "", MAC_MOCK_KEYCHAIN_PASSWORD].filter(Boolean)));
}

export function decryptMacChromiumCookie(encryptedValue: Buffer | Uint8Array, safeStoragePassword: string): string | null {
  const encrypted = Buffer.from(encryptedValue);
  const prefix = encrypted.subarray(0, 3).toString("utf8");
  if (prefix !== "v10" && prefix !== "v11") return null;
  try {
    const key = crypto.pbkdf2Sync(safeStoragePassword, MAC_CHROMIUM_SALT, 1003, 16, "sha1");
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, MAC_CHROMIUM_IV);
    return Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function readChromiumCookieRows(dbPath: string): ChromiumCookieRow[] {
  if (!fs.existsSync(dbPath)) return [];
  const sql = [
    "select host_key, name, value, hex(encrypted_value) as encrypted_value_hex",
    "from cookies",
    "where host_key like '%alibaba.com' or host_key like '%alicdn.com'",
    "order by host_key, name, path"
  ].join(" ");
  try {
    const output = execFileSync("sqlite3", ["-json", dbPath, sql], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000
    });
    return output.trim() ? (JSON.parse(output) as ChromiumCookieRow[]) : [];
  } catch {
    return [];
  }
}

function resolveMacSafeStoragePassword(services: string[] = [], keychainPaths?: string[]): string | null {
  if (process.env.WANGWANG_CHROMIUM_SAFE_STORAGE_PASSWORD) {
    return process.env.WANGWANG_CHROMIUM_SAFE_STORAGE_PASSWORD;
  }
  const candidates = [
    ...services,
    process.env.WANGWANG_CHROMIUM_SAFE_STORAGE_SERVICE || "",
    ...MAC_SAFE_STORAGE_SERVICES
  ].filter(Boolean);
  const uniqueCandidates = Array.from(new Set(candidates));
  const keychains = keychainPaths || defaultMacKeychainPaths();
  const keychainSearchPaths = keychains.length ? keychains : [""];
  const cacheKey = `${uniqueCandidates.join("\0")}\n${keychains.join("\0")}`;
  if (macSafeStoragePasswordCache.has(cacheKey)) {
    return macSafeStoragePasswordCache.get(cacheKey) || null;
  }
  const timeout = Number(process.env.WANGWANG_KEYCHAIN_TIMEOUT_MS || DEFAULT_KEYCHAIN_TIMEOUT_MS);
  for (const service of uniqueCandidates) {
    for (const keychainPath of keychainSearchPaths) {
      try {
        const args = ["find-generic-password", "-w", "-s", service];
        if (keychainPath) args.push(keychainPath);
        const password = execFileSync("/usr/bin/security", args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_KEYCHAIN_TIMEOUT_MS
        }).trim();
        if (password) {
          macSafeStoragePasswordCache.set(cacheKey, password);
          return password;
        }
      } catch (error) {
        if (isCommandTimeout(error)) {
          macSafeStoragePasswordCache.set(cacheKey, null);
          return null;
        }
        // Try the next keychain path or known Chromium safe-storage service name.
      }
    }
  }
  macSafeStoragePasswordCache.set(cacheKey, null);
  return null;
}

function isCommandTimeout(error: unknown): boolean {
  const maybeError = error as { code?: string; killed?: boolean; signal?: string };
  return maybeError.code === "ETIMEDOUT" || maybeError.killed === true || maybeError.signal === "SIGTERM";
}

function isMacPlatform(platform: NodeJS.Platform | undefined): boolean {
  return (platform || process.platform) === "darwin";
}
