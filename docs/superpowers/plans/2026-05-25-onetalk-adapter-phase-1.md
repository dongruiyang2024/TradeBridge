# OneTalk Adapter Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Extract the current OneTalk session, request, and page parsing kernel into `packages/onetalk-adapter` while keeping the existing local viewer API working.

**Architecture:** The adapter package owns AliWorkbench session discovery, Chromium cookie extraction, OneTalk HTTP payload construction, and `weblitePWA.htm` parsing. `apps/api` remains responsible for local routes, customer log indexing, message/customer shaping, and export orchestration. The new package must expose small functions/classes that later desktop collector code can reuse without depending on Fastify.

**Tech Stack:** TypeScript, npm workspaces, Node.js built-ins, Fastify API consumer, Node test runner with `tsx`.

---

### Task 1: Add Adapter Package Skeleton And Session Tests

**Files:**
- Create: `packages/onetalk-adapter/package.json`
- Create: `packages/onetalk-adapter/tsconfig.json`
- Create: `packages/onetalk-adapter/src/index.ts`
- Create: `packages/onetalk-adapter/src/session.ts`
- Create: `packages/onetalk-adapter/test/session.test.ts`
- Modify: `package-lock.json`

- [x] **Step 1: Write the failing session test**

Create `packages/onetalk-adapter/test/session.test.ts` with the existing cookie extraction expectations:

```ts
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  decryptMacChromiumCookie,
  discoverAliWorkbenchCookieDbs,
  discoverAliWorkbenchTokenCacheFiles,
  extractCookies,
  extractCookiesFromText,
  getCtoken
} from "../src/index.js";

const tempRoots: string[] = [];

after(() => {
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extractCookiesFromText keeps latest whitelisted cookie values", () => {
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

test("discoverAliWorkbenchCookieDbs finds account Cookies files on macOS layout", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "onetalk-adapter-session-test-"));
  tempRoots.push(root);
  const accountDir = path.join(root, "Library", "Application Support", "AliWorkbenchTemp", "202500001744639");
  fs.mkdirSync(accountDir, { recursive: true });
  fs.writeFileSync(path.join(accountDir, "Cookies"), "");

  assert.deepEqual(discoverAliWorkbenchCookieDbs(root, "darwin"), [path.join(accountDir, "Cookies")]);
});

test("discoverAliWorkbenchTokenCacheFiles finds cached request files on macOS layout", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "onetalk-adapter-session-test-"));
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

test("decryptMacChromiumCookie decrypts Chromium v10 AES-CBC values", () => {
  const password = "test-safe-storage-secret";
  const key = crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const cipher = crypto.createCipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
  const encrypted = Buffer.concat([Buffer.from("v10", "utf8"), cipher.update("cookie-value", "utf8"), cipher.final()]);

  assert.equal(decryptMacChromiumCookie(encrypted, password), "cookie-value");
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
```

- [x] **Step 2: Run the adapter test and verify it fails**

Run: `npm test -w @wangwang/onetalk-adapter`

Expected: npm reports the workspace does not exist, or TypeScript reports missing exports.

- [x] **Step 3: Add the package skeleton and session implementation**

Copy the session extraction implementation from `apps/api/src/session.ts` into `packages/onetalk-adapter/src/session.ts`, export it from `packages/onetalk-adapter/src/index.ts`, and add build/test scripts.

- [x] **Step 4: Run the adapter test and verify it passes**

Run: `npm test -w @wangwang/onetalk-adapter`

Expected: the session tests pass.

### Task 2: Move OneTalk Client And Parser Into Adapter

**Files:**
- Create: `packages/onetalk-adapter/src/config.ts`
- Create: `packages/onetalk-adapter/src/onetalk-client.ts`
- Create: `packages/onetalk-adapter/src/weblite-parser.ts`
- Create: `packages/onetalk-adapter/test/onetalk-client.test.ts`
- Create: `packages/onetalk-adapter/test/weblite-parser.test.ts`

- [x] **Step 1: Write parser and payload tests**

Add tests that import `extractJsonAfter`, `pageBootstrap`, and `buildPayload` from `../src/index.js`. The parser test should confirm a small HTML snippet yields one cached conversation and decoded bootstrap values. The payload test should confirm encrypted account IDs, conversation code, `chatToken`, fallback `selfAliId`, and `timeSlide` are preserved.

- [x] **Step 2: Run tests and verify they fail**

Run: `npm test -w @wangwang/onetalk-adapter`

Expected: exports for parser/client utilities are missing.

- [x] **Step 3: Move parser and client implementation**

Copy `apps/api/src/weblite-parser.ts` and `apps/api/src/onetalk-client.ts` into the adapter package. Move `ALIWORKBENCH_UA` into adapter `config.ts`, then export `OnetalkClient`, `buildPayload`, parser helpers, and session helpers from adapter `index.ts`.

- [x] **Step 4: Run tests and verify they pass**

Run: `npm test -w @wangwang/onetalk-adapter`

Expected: adapter tests pass.

### Task 3: Rewire API To Use Adapter

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/conversation-service.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/test/session.test.ts`
- Delete: `apps/api/src/session.ts`
- Delete: `apps/api/src/onetalk-client.ts`
- Delete: `apps/api/src/weblite-parser.ts`

- [x] **Step 1: Update API imports**

Replace imports from local `./session.js`, `./onetalk-client.js`, and `./weblite-parser.js` with `@wangwang/onetalk-adapter`.

- [x] **Step 2: Keep API-specific config local**

Leave `SERVER_HOST`, `SERVER_PORT`, `LOCAL_API_TOKEN`, `EXPORTS_DIR`, `LOG_PATHS`, and `COOKIE_DB_PATHS` in `apps/api/src/config.ts`. Remove the duplicate `ALIWORKBENCH_UA` export from the API config.

- [x] **Step 3: Move session tests to adapter ownership**

Replace API session tests with a small compatibility test only if needed. The adapter package becomes the owner of cookie/session tests.

- [x] **Step 4: Run API tests**

Run: `npm test -w @wangwang/api`

Expected: tests pass or no local API tests are required after migration.

### Task 4: Workspace Verification

**Files:**
- Modify: `package-lock.json`

- [x] **Step 1: Refresh npm workspace metadata**

Run: `npm install --package-lock-only`

Expected: `package-lock.json` includes `packages/onetalk-adapter`.

- [x] **Step 2: Run full typecheck**

Run: `npm run typecheck`

Expected: shared, adapter, API, and web type checks pass.

- [x] **Step 3: Run full build**

Run: `npm run build`

Expected: shared, adapter, API, and web build outputs are generated successfully.

- [x] **Step 4: Inspect git diff**

Run: `git status --short`

Expected: document deletions, new adapter package, API import updates, and package lock changes are visible.
