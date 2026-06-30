import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Plugin } from "vite";
import {
  DEFAULT_TRADEBRIDGE_SERVER_URL,
  createOneTalkPageScriptIifePlugin,
  loadTradeBridgeServerEnv,
  resolveTradeBridgeServerUrl,
  wrapClassicScriptInIife
} from "../vite.config";

test("wrapClassicScriptInIife scopes top-level page declarations", () => {
  const wrapped = wrapClassicScriptInIife('const $ = "profile-url";\nwindow.__flag = true;');

  assert.match(wrapped, /^\(function \(\) \{\n/);
  assert.match(wrapped, /\n\}\)\(\);\n$/);
  assert.equal(wrapped.includes('const $ = "profile-url";'), true);
  assert.equal(wrapped.startsWith("const $"), false);
});

test("OneTalk page script IIFE plugin wraps only the injected page script chunk", () => {
  const plugin = createOneTalkPageScriptIifePlugin() as Plugin;
  const bundle = {
    "channels/alibaba-im/onetalk-page-script.js": {
      type: "chunk",
      fileName: "channels/alibaba-im/onetalk-page-script.js",
      code: "const $ = 1;",
      imports: [],
      dynamicImports: []
    },
    "background/index.js": {
      type: "chunk",
      fileName: "background/index.js",
      code: "const $ = 2;",
      imports: [],
      dynamicImports: []
    }
  };

  const hook = plugin.generateBundle;
  const generateBundle = typeof hook === "function" ? hook : hook?.handler;
  if (typeof generateBundle !== "function") throw new Error("missing_generate_bundle_hook");
  const invokeGenerateBundle = generateBundle as Function;
  invokeGenerateBundle.call({ error(message: string): never { throw new Error(message); } }, {}, bundle, false);

  assert.match(bundle["channels/alibaba-im/onetalk-page-script.js"].code, /^\(function \(\) \{/);
  assert.equal(bundle["background/index.js"].code, "const $ = 2;");
});

test("resolveTradeBridgeServerUrl defaults to local server", () => {
  assert.equal(resolveTradeBridgeServerUrl({}), DEFAULT_TRADEBRIDGE_SERVER_URL);
});

test("resolveTradeBridgeServerUrl requires explicit server url for non-local builds", () => {
  assert.throws(
    () => resolveTradeBridgeServerUrl({}, { requireExplicit: true, mode: "production" }),
    /TRADEBRIDGE_SERVER_URL must be set for production extension builds/
  );
});

test("resolveTradeBridgeServerUrl uses TRADEBRIDGE_SERVER_URL", () => {
  assert.equal(
    resolveTradeBridgeServerUrl({ TRADEBRIDGE_SERVER_URL: " https://tradebridge.example.com/api " }),
    "https://tradebridge.example.com"
  );
});

test("resolveTradeBridgeServerUrl rejects invalid URLs", () => {
  assert.throws(
    () => resolveTradeBridgeServerUrl({ TRADEBRIDGE_SERVER_URL: "ftp://tradebridge.example.com" }),
    /TRADEBRIDGE_SERVER_URL/
  );
});

test("loadTradeBridgeServerEnv ignores env files for development builds", () => {
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), "tradebridge-env-"));
  fs.writeFileSync(path.join(envDir, ".env.local"), "TRADEBRIDGE_SERVER_URL=http://127.0.0.1:5032\n");
  fs.writeFileSync(path.join(envDir, ".env.production.local"), "TRADEBRIDGE_SERVER_URL=https://tradebridge.example.com\n");

  assert.deepEqual(
    loadTradeBridgeServerEnv("development", {
      envDir,
      processEnv: { TRADEBRIDGE_SERVER_URL: "https://shell.example.com" }
    }),
    {}
  );
});

test("loadTradeBridgeServerEnv reads only mode-specific extension env files for production", () => {
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), "tradebridge-env-"));
  fs.writeFileSync(path.join(envDir, ".env.local"), "TRADEBRIDGE_SERVER_URL=http://127.0.0.1:5032\n");
  fs.writeFileSync(path.join(envDir, ".env.production.local"), "TRADEBRIDGE_SERVER_URL=https://tradebridge.example.com\n");

  assert.deepEqual(loadTradeBridgeServerEnv("production", { envDir, processEnv: {} }), {
    TRADEBRIDGE_SERVER_URL: "https://tradebridge.example.com"
  });
});

test("loadTradeBridgeServerEnv lets shell env override mode files", () => {
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), "tradebridge-env-"));
  fs.writeFileSync(path.join(envDir, ".env.test.local"), "TRADEBRIDGE_SERVER_URL=https://file.example.com\n");

  assert.deepEqual(
    loadTradeBridgeServerEnv("test", {
      envDir,
      processEnv: { TRADEBRIDGE_SERVER_URL: "https://shell.example.com" }
    }),
    { TRADEBRIDGE_SERVER_URL: "https://shell.example.com" }
  );
});
