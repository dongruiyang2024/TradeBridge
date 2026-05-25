import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  decryptMacChromiumCookie,
  defaultMacKeychainPaths,
  discoverAliWorkbenchCookieDbs,
  discoverAliWorkbenchTokenCacheFiles,
  extractCookies,
  extractCookiesFromText,
  getCtoken
} from "../src/session.js";

const tempRoots: string[] = [];

after(() => {
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extractCookiesFromText keeps the latest whitelisted cookie values", () => {
  const text = [
    "ignored=value; _tb_token_=old; xman_us_t=ctoken%3Dold",
    "cookie2=abc; _tb_token_=new; xman_us_t=ctoken%3Dfresh%26x_lid%3Dseller"
  ].join("\n");

  assert.deepEqual(extractCookiesFromText(text), {
    _tb_token_: "new",
    cookie2: "abc",
    xman_us_t: "ctoken%3Dfresh%26x_lid%3Dseller"
  });
  assert.equal(getCtoken({ xman_us_t: "ctoken%3Dfresh%26x_lid%3Dseller" }), "fresh");
});

test("extractCookies reads text log paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wangwang-session-test-"));
  tempRoots.push(root);
  const logPath = path.join(root, "cef.log");
  fs.writeFileSync(logPath, "xman_us_t=ctoken%3Dfrom-log; _tb_token_=tb-log", "utf8");

  assert.deepEqual(extractCookies([logPath]), {
    _tb_token_: "tb-log",
    xman_us_t: "ctoken%3Dfrom-log"
  });
});

test("decryptMacChromiumCookie decrypts Chromium v10 AES-CBC values", () => {
  const password = "test-safe-storage-secret";
  const key = crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const cipher = crypto.createCipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
  const encrypted = Buffer.concat([
    Buffer.from("v10", "utf8"),
    cipher.update("cookie-value", "utf8"),
    cipher.final()
  ]);

  assert.equal(decryptMacChromiumCookie(encrypted, password), "cookie-value");
});

test("discoverAliWorkbenchCookieDbs finds account Cookies files on macOS layout", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wangwang-session-test-"));
  tempRoots.push(root);
  const accountDir = path.join(root, "Library", "Application Support", "AliWorkbenchTemp", "202500001744639");
  fs.mkdirSync(accountDir, { recursive: true });
  fs.writeFileSync(path.join(accountDir, "Cookies"), "");

  assert.deepEqual(discoverAliWorkbenchCookieDbs(root, "darwin"), [path.join(accountDir, "Cookies")]);
});

test("discoverAliWorkbenchTokenCacheFiles finds cached request files on macOS layout", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wangwang-session-test-"));
  tempRoots.push(root);
  const cacheDir = path.join(root, "Library", "Application Support", "AliWorkbenchTemp", "202500001744639", "Cache", "Cache_Data");
  const codeCacheDir = path.join(root, "Library", "Application Support", "AliWorkbenchTemp", "202500001744639", "Code Cache", "js");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(codeCacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, "abc_0");
  const codeCacheFile = path.join(codeCacheDir, "def_0");
  fs.writeFileSync(cacheFile, "https://i.alibaba.com/a?ctoken=from-cache&_tb_token_=tb-cache");
  fs.writeFileSync(codeCacheFile, "https://i.alibaba.com/b?ctoken=from-code-cache&_tb_token_=tb-code-cache");

  assert.deepEqual(discoverAliWorkbenchTokenCacheFiles(root, "darwin"), [cacheFile, codeCacheFile]);
});

test("defaultMacKeychainPaths points at login keychain on macOS layout", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wangwang-session-test-"));
  tempRoots.push(root);
  const keychainDir = path.join(root, "Library", "Keychains");
  const loginKeychain = path.join(keychainDir, "login.keychain-db");
  fs.mkdirSync(keychainDir, { recursive: true });
  fs.writeFileSync(loginKeychain, "");

  assert.deepEqual(defaultMacKeychainPaths(root, "darwin"), [loginKeychain]);
  assert.deepEqual(defaultMacKeychainPaths(root, "linux"), []);
});

test("extractCookies reads csrf tokens from cached request URLs", () => {
  assert.deepEqual(
    extractCookiesFromText("https://i.alibaba.com/a?ctoken=from-cache&_tb_token_=tb-cache&callback=jsonp"),
    {
      _tb_token_: "tb-cache",
      xman_us_t: "ctoken%3Dfrom-cache"
    }
  );
});

test("extractCookies decrypts macOS Chromium Cookies database values", (t) => {
  try {
    execFileSync("sqlite3", ["-version"], { stdio: "ignore" });
  } catch {
    t.skip("sqlite3 CLI is not available");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wangwang-session-test-"));
  tempRoots.push(root);
  const dbPath = path.join(root, "Cookies");
  const password = "test-safe-storage-secret";
  const tbToken = encryptMacCookie("_tb_token_value_", password);
  const cookie2 = encryptMacCookie("cookie2-value", password);
  execFileSync("sqlite3", [
    dbPath,
    [
      "create table cookies (host_key text, name text, value text, encrypted_value blob, path text, is_secure integer);",
      `insert into cookies values ('.alibaba.com', '_tb_token_', '', X'${tbToken}', '/', 1);`,
      `insert into cookies values ('.alibaba.com', 'cookie2', '', X'${cookie2}', '/', 1);`,
      "insert into cookies values ('.example.com', '_tb_token_', 'wrong-domain', X'', '/', 1);"
    ].join(" ")
  ]);

  assert.deepEqual(extractCookies([], {
    cookieDbPaths: [dbPath],
    platform: "darwin",
    safeStoragePassword: password
  }), {
    _tb_token_: "_tb_token_value_",
    cookie2: "cookie2-value"
  });

  const previousPassword = process.env.WANGWANG_CHROMIUM_SAFE_STORAGE_PASSWORD;
  process.env.WANGWANG_CHROMIUM_SAFE_STORAGE_PASSWORD = password;
  try {
    assert.equal(extractCookies([], {
      cookieDbPaths: [dbPath],
      platform: "darwin",
      keychainPaths: []
    }).cookie2, "cookie2-value");
  } finally {
    if (previousPassword === undefined) {
      delete process.env.WANGWANG_CHROMIUM_SAFE_STORAGE_PASSWORD;
    } else {
      process.env.WANGWANG_CHROMIUM_SAFE_STORAGE_PASSWORD = previousPassword;
    }
  }
});

test("extractCookies decrypts AliSupplier mock-keychain cookies", (t) => {
  try {
    execFileSync("sqlite3", ["-version"], { stdio: "ignore" });
  } catch {
    t.skip("sqlite3 CLI is not available");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wangwang-session-test-"));
  tempRoots.push(root);
  const dbPath = path.join(root, "Cookies");
  const cookie2 = encryptMacCookie("cookie2-value", "mock_password");
  const sgcookie = encryptMacCookie("sgcookie-value", "mock_password");
  execFileSync("sqlite3", [
    dbPath,
    [
      "create table cookies (host_key text, name text, value text, encrypted_value blob, path text, is_secure integer);",
      `insert into cookies values ('.alibaba.com', 'cookie2', '', X'${cookie2}', '/', 1);`,
      `insert into cookies values ('.alibaba.com', 'sgcookie', '', X'${sgcookie}', '/', 1);`
    ].join(" ")
  ]);

  assert.deepEqual(extractCookies([], {
    cookieDbPaths: [dbPath],
    platform: "darwin",
    keychainPaths: []
  }), {
    cookie2: "cookie2-value",
    sgcookie: "sgcookie-value"
  });
});

function encryptMacCookie(value: string, password: string): string {
  const key = crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const cipher = crypto.createCipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
  return Buffer.concat([Buffer.from("v10", "utf8"), cipher.update(value, "utf8"), cipher.final()]).toString("hex");
}
