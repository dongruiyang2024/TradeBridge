# Chrome 插件 OneTalk 同步 MVP 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。当前阶段不推荐子代理并行，因为 Phase 0 的 OneTalk 浏览器请求能力会影响后续模块边界。

**目标：** 实现一个内部试运行版 Chrome Manifest V3 插件，在用户已登录 OneTalk 的 Chrome 环境中同步最近会话和消息到 TradeBridge `/collector/v1/sync-batches`。

**架构：** 先把 `@wangwang/onetalk-adapter` 拆出 browser-safe 入口，供插件复用页面解析、payload 构造和 `SyncBatch` 映射。插件使用 background service worker 编排同步，content script 只负责页面状态探测，popup/options 提供同步入口和配置界面。OneTalk 鉴权只在浏览器本机请求中使用，上传前必须经过 sanitizer 阻断敏感字段。

**技术栈：** TypeScript、npm workspaces、Vite、Chrome Extension Manifest V3、Node test runner、tsx、现有 Fastify collector sync API。

---

## 范围说明

本计划覆盖设计文档中的 Phase 0 和 Phase 1：

- Phase 0：验证插件能在已登录 Chrome 中访问 OneTalk 页面/接口，并产出可测试的 fixture 和安全过滤能力。
- Phase 1：新增 `apps/chrome-extension` MVP，完成配置、手动同步、状态展示、去敏上传和本地构建。

Phase 2 的定时同步、指数退避、设备状态上报，Phase 3 的内部安装策略，以及 Phase 4 的公开发布合规材料，等 MVP 验收后另建计划。

## 文件结构

创建：

- `apps/chrome-extension/package.json`：Chrome 插件 workspace 包定义。
- `apps/chrome-extension/tsconfig.json`：插件 TypeScript 配置。
- `apps/chrome-extension/vite.config.ts`：插件多入口 Vite 构建。
- `apps/chrome-extension/public/manifest.json`：Manifest V3 配置。
- `apps/chrome-extension/src/background/index.ts`：service worker 入口。
- `apps/chrome-extension/src/background/onetalk-client.ts`：浏览器环境 OneTalk HTTP client。
- `apps/chrome-extension/src/background/sanitizer.ts`：同步批次敏感字段过滤和阻断。
- `apps/chrome-extension/src/background/storage.ts`：Chrome storage 访问封装。
- `apps/chrome-extension/src/background/sync-orchestrator.ts`：一次同步的编排逻辑。
- `apps/chrome-extension/src/background/tradebridge-client.ts`：TradeBridge collector API client。
- `apps/chrome-extension/src/content/onetalk-page-bridge.ts`：OneTalk 页面状态探测脚本。
- `apps/chrome-extension/src/options/options.html`：插件配置页面。
- `apps/chrome-extension/src/options/options.ts`：配置页面逻辑。
- `apps/chrome-extension/src/popup/popup.html`：插件弹窗页面。
- `apps/chrome-extension/src/popup/popup.ts`：弹窗同步入口和状态展示。
- `apps/chrome-extension/src/shared/chrome-api.ts`：插件使用到的最小 Chrome API 类型。
- `apps/chrome-extension/src/shared/extension-messages.ts`：background/content/popup 消息类型。
- `apps/chrome-extension/src/shared/sync-types.ts`：插件侧最小同步协议类型。
- `apps/chrome-extension/test/fixtures/weblite.html`：去敏 OneTalk 会话 fixture。
- `apps/chrome-extension/test/manifest.test.ts`：Manifest 权限测试。
- `apps/chrome-extension/test/onetalk-client.test.ts`：OneTalk client 测试。
- `apps/chrome-extension/test/sanitizer.test.ts`：敏感字段过滤测试。
- `apps/chrome-extension/test/sync-orchestrator.test.ts`：同步编排测试。
- `apps/chrome-extension/test/tradebridge-client.test.ts`：上传 client 测试。
- `docs/chrome-extension-trial-runbook.md`：内部试运行安装和验收手册。

修改：

- `package.json`：把 `@wangwang/chrome-extension` 加入根 `build` 和 `typecheck`。
- `package-lock.json`：刷新 workspace lock metadata。
- `packages/onetalk-adapter/package.json`：新增 `./browser` export。
- `packages/onetalk-adapter/src/onetalk-client.ts`：改为从 `payload.ts` 引入 `buildPayload`。
- `packages/onetalk-adapter/src/index.ts`：继续导出 Node/Electron 默认能力。

创建或修改：

- `packages/onetalk-adapter/src/browser.ts`：browser-safe public entry。
- `packages/onetalk-adapter/src/payload.ts`：浏览器和 Node 共用 payload 构造。
- `packages/onetalk-adapter/src/sync-mapper.ts`：浏览器安全的 `WebliteData` 到同步批次映射。
- `packages/onetalk-adapter/test/browser-entry.test.ts`：验证 browser entry 不依赖 session。
- `packages/onetalk-adapter/test/sync-mapper.test.ts`：验证映射、游标、方向和时间字段。

不修改：

- `packages/database/**` 当前已有未提交改动，本计划执行时不要主动改动这些文件，除非用户明确要求。
- `apps/server/src/server.ts` 第一版沿用已有 `/collector/v1/sync-batches`。

## 任务 1：拆出 browser-safe adapter 入口

**文件：**
- 创建：`packages/onetalk-adapter/src/payload.ts`
- 创建：`packages/onetalk-adapter/src/sync-mapper.ts`
- 创建：`packages/onetalk-adapter/src/browser.ts`
- 创建：`packages/onetalk-adapter/test/browser-entry.test.ts`
- 创建：`packages/onetalk-adapter/test/sync-mapper.test.ts`
- 修改：`packages/onetalk-adapter/src/onetalk-client.ts`
- 修改：`packages/onetalk-adapter/src/index.ts`
- 修改：`packages/onetalk-adapter/package.json`

- [ ] **步骤 1：编写 browser entry 失败测试**

创建 `packages/onetalk-adapter/test/browser-entry.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPayload, extractJsonAfter, pageBootstrap } from "../src/browser.js";

test("browser entry exposes parser and payload helpers without session helpers", () => {
  const html = `
    <script>
      window.aliId = 'self-ali';
      window.__VMFsConv__cache__ = [{"cid":"c1","contactAccountId":"buyer-1"}];
    </script>
  `;

  assert.deepEqual(pageBootstrap(html), { aliId: "self-ali" });
  assert.deepEqual(extractJsonAfter(html, "window.__VMFsConv__cache__"), [
    { cid: "c1", contactAccountId: "buyer-1" }
  ]);

  const payload = buildPayload(
    {
      contactAccountId: "buyer-1",
      encryptContactAccountId: "buyer-enc",
      contactAliId: "buyer-ali",
      encryptContactAliId: "buyer-ali-enc",
      cid: "conv-1"
    },
    { aliId: "self-ali" },
    1779706200000,
    50
  );

  assert.equal(payload.selfAliId, "self-ali");
  assert.equal(payload.conversationCode, "conv-1");
});
```

- [ ] **步骤 2：编写 sync mapper 失败测试**

创建 `packages/onetalk-adapter/test/sync-mapper.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { mapWebliteToSyncBatch } from "../src/browser.js";

test("mapWebliteToSyncBatch maps conversations and messages into collector batch shape", () => {
  const batch = mapWebliteToSyncBatch({
    orgId: "org_internal",
    sellerAccount: { externalAccountId: "seller-demo", displayName: "Seller Demo" },
    device: { deviceId: "chrome-extension-demo", deviceName: "Chrome Extension" },
    collectedAt: "2026-05-26T08:10:00.000Z",
    source: "chrome-extension",
    previousCursor: null,
    weblite: {
      html: "",
      bootstrap: { aliId: "self-ali" },
      conversations: [
        {
          cid: "conv-1",
          contactAccountId: "buyer-1",
          contactNick: "Buyer One",
          lastMessageTime: 1779706200000
        }
      ]
    },
    messagesByConversationId: {
      "conv-1": [
        {
          messageId: "m1",
          senderAliId: "self-ali",
          messageType: "text",
          content: "I can ship tomorrow",
          sendTime: 1779706140000
        },
        {
          messageId: "m2",
          senderAliId: "buyer-ali",
          messageType: "text",
          content: "Thanks",
          sendTime: 1779706200000
        }
      ]
    }
  });

  assert.equal(batch.sourceMeta?.source, "chrome-extension");
  assert.equal(batch.sourceMeta?.sourceBatchKey, "seller-demo:chrome-extension-demo:2026-05-26T08:10:00.000Z");
  assert.deepEqual(batch.customers, [
    {
      externalCustomerId: "buyer-1",
      displayName: "Buyer One"
    }
  ]);
  assert.deepEqual(batch.conversations, [
    {
      externalConversationId: "conv-1",
      externalCustomerId: "buyer-1",
      lastMessageAt: "2026-05-25T10:50:00.000Z"
    }
  ]);
  assert.deepEqual(batch.messages?.map((message) => [message.externalMessageId, message.direction]), [
    ["m1", "sent"],
    ["m2", "received"]
  ]);
});

test("mapWebliteToSyncBatch filters messages at or before the previous cursor", () => {
  const batch = mapWebliteToSyncBatch({
    orgId: "org_internal",
    sellerAccount: { externalAccountId: "seller-demo" },
    device: { deviceId: "chrome-extension-demo" },
    collectedAt: "2026-05-26T08:10:00.000Z",
    source: "chrome-extension",
    previousCursor: "2026-05-25T10:49:00.000Z",
    weblite: {
      html: "",
      bootstrap: { aliId: "self-ali" },
      conversations: [{ cid: "conv-1", contactAccountId: "buyer-1" }]
    },
    messagesByConversationId: {
      "conv-1": [
        { messageId: "old", senderAliId: "buyer", content: "old", sendTime: 1779706140000 },
        { messageId: "new", senderAliId: "buyer", content: "new", sendTime: 1779706200000 }
      ]
    }
  });

  assert.deepEqual(batch.messages?.map((message) => message.externalMessageId), ["new"]);
});
```

- [ ] **步骤 3：运行 adapter 测试并确认失败**

运行：

```bash
npm test -w @wangwang/onetalk-adapter
```

预期：失败，TypeScript 或 Node 报 `Cannot find module '../src/browser.js'`。

- [ ] **步骤 4：抽出 payload helper**

创建 `packages/onetalk-adapter/src/payload.ts`：

```ts
export function buildPayload(
  conversation: Record<string, unknown>,
  bootstrap: Record<string, string>,
  before: number | null,
  pageSize: number
): Record<string, unknown> {
  return {
    contactAccountId: conversation.contactAccountId,
    contactAccountIdEncrypt: conversation.encryptContactAccountId ?? conversation.contactAccountIdEncrypt,
    aliId: conversation.contactAliId,
    aliIdEncrypt: conversation.encryptContactAliId ?? conversation.aliIdEncrypt,
    cid: conversation.cid,
    conversationCode: conversation.cid,
    chatToken: conversation.chatToken,
    selfAliId: conversation.selfAliId ?? bootstrap.aliId,
    timeSlide: {
      forward: false,
      timeStamp: before,
      pageSize
    }
  };
}
```

修改 `packages/onetalk-adapter/src/onetalk-client.ts`：

```ts
import { buildPayload } from "./payload.js";
```

并删除该文件底部原有的 `export function buildPayload(...)` 实现，保留对 `buildPayload` 的使用。

- [ ] **步骤 5：新增 sync mapper**

创建 `packages/onetalk-adapter/src/sync-mapper.ts`：

```ts
import type { WebliteData } from "./onetalk-client.js";

export type MessageDirection = "received" | "sent" | "unknown";

export interface BrowserSyncSellerAccountInput {
  externalAccountId: string;
  displayName?: string;
  status?: string;
}

export interface BrowserSyncDeviceInput {
  deviceId: string;
  deviceName?: string;
}

export interface BrowserSyncCustomerInput {
  externalCustomerId: string;
  loginId?: string;
  displayName?: string;
  country?: string;
  ownerUserId?: string;
  stage?: string;
}

export interface BrowserSyncConversationInput {
  externalConversationId: string;
  externalCustomerId?: string;
  lastMessageAt?: string;
}

export interface BrowserSyncMessageInput {
  externalConversationId: string;
  externalMessageId?: string;
  direction: MessageDirection;
  messageType?: string | number;
  content?: string;
  sentAt?: string;
  rawSanitized?: Record<string, unknown>;
}

export interface BrowserSyncBatch {
  orgId: string;
  sellerAccount: BrowserSyncSellerAccountInput;
  device: BrowserSyncDeviceInput;
  cursor?: Record<string, unknown>;
  sourceMeta?: Record<string, unknown>;
  customers?: BrowserSyncCustomerInput[];
  conversations?: BrowserSyncConversationInput[];
  messages?: BrowserSyncMessageInput[];
}

export interface MapWebliteToSyncBatchOptions {
  orgId: string;
  sellerAccount: BrowserSyncSellerAccountInput;
  device: BrowserSyncDeviceInput;
  collectedAt: string;
  source: string;
  previousCursor: string | null;
  weblite: WebliteData;
  messagesByConversationId: Record<string, Record<string, unknown>[]>;
}

export function mapWebliteToSyncBatch(options: MapWebliteToSyncBatchOptions): BrowserSyncBatch {
  const customers = new Map<string, BrowserSyncCustomerInput>();
  const conversations: BrowserSyncConversationInput[] = [];
  const messages: BrowserSyncMessageInput[] = [];

  for (const conversation of options.weblite.conversations.filter(isRecord)) {
    const externalConversationId = firstString(conversation, ["cid", "conversationCode", "conversationId", "id"]);
    const externalCustomerId = firstString(conversation, [
      "contactAccountId",
      "contactAccountIdEncrypt",
      "buyerAccountId",
      "contactAliId"
    ]);
    if (!externalConversationId || !externalCustomerId) continue;

    customers.set(
      externalCustomerId,
      compact({
        externalCustomerId,
        loginId: firstString(conversation, ["loginId", "contactLoginId"]),
        displayName: firstString(conversation, ["contactNick", "displayName", "nick", "contactName"]),
        country: firstString(conversation, ["country"])
      })
    );

    conversations.push(
      compact({
        externalConversationId,
        externalCustomerId,
        lastMessageAt: isoTime(firstValue(conversation, ["lastMessageTime", "lastMessageAt", "lastMsgTime"]))
      })
    );

    for (const rawMessage of options.messagesByConversationId[externalConversationId] || []) {
      const message = mapMessage(rawMessage, externalConversationId, options.weblite.bootstrap, conversation);
      if (message && isAfterCursor(message.sentAt, options.previousCursor)) {
        messages.push(message);
      }
    }
  }

  return compact({
    orgId: options.orgId,
    sellerAccount: options.sellerAccount,
    device: options.device,
    cursor: options.previousCursor ? { previousCursor: options.previousCursor } : undefined,
    sourceMeta: {
      source: options.source,
      collectedAt: options.collectedAt,
      sourceBatchKey: `${options.sellerAccount.externalAccountId}:${options.device.deviceId}:${options.collectedAt}`
    },
    customers: Array.from(customers.values()),
    conversations,
    messages
  });
}

function mapMessage(
  message: Record<string, unknown>,
  externalConversationId: string,
  bootstrap: Record<string, string>,
  conversation: Record<string, unknown>
): BrowserSyncMessageInput | null {
  const sentAt = isoTime(firstValue(message, ["sendTime", "sentAt", "time", "gmtCreate", "createdAt"]));
  return compact({
    externalConversationId,
    externalMessageId: firstString(message, ["messageId", "msgId", "id"]),
    direction: directionOf(message, bootstrap, conversation),
    messageType: firstString(message, ["messageType", "type", "msgType"]) || "text",
    content: firstString(message, ["content", "text", "message", "summary"]),
    sentAt,
    rawSanitized: message
  });
}

function directionOf(
  message: Record<string, unknown>,
  bootstrap: Record<string, string>,
  conversation: Record<string, unknown>
): MessageDirection {
  const explicit = firstString(message, ["direction"]);
  if (explicit === "sent" || explicit === "received" || explicit === "unknown") return explicit;
  const sender = firstString(message, ["senderAliId", "fromAliId", "senderId", "fromId"]);
  const self = firstString(conversation, ["selfAliId"]) || bootstrap.aliId;
  if (!sender || !self) return "unknown";
  return sender === self ? "sent" : "received";
}

function isAfterCursor(sentAt: string | undefined, cursor: string | null): boolean {
  if (!cursor || !sentAt) return true;
  return Date.parse(sentAt) > Date.parse(cursor);
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  const value = firstValue(source, keys);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function firstValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value != null && value !== "") return value;
  }
  return undefined;
}

function isoTime(value: unknown): string | undefined {
  const numeric = numericTime(value);
  if (numeric != null) return new Date(numeric).toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return undefined;
}

function numericTime(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;
  if (raw == null || !Number.isFinite(raw)) return null;
  return raw < 10_000_000_000 ? raw * 1000 : raw;
}

function compact<T extends Record<string, unknown>>(source: T): T {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== null)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
```

- [ ] **步骤 6：新增 browser entry 并更新导出**

创建 `packages/onetalk-adapter/src/browser.ts`：

```ts
export { buildPayload } from "./payload.js";
export { extractJsonAfter, pageBootstrap } from "./weblite-parser.js";
export type { ChatMessageRequest, ChatMessageResponse, ChatDataSummaryResponse, WebliteData } from "./onetalk-client.js";
export * from "./sync-mapper.js";
```

修改 `packages/onetalk-adapter/src/index.ts`，增加 payload 和 sync mapper 导出：

```ts
export * from "./config.js";
export * from "./facade.js";
export * from "./onetalk-client.js";
export * from "./payload.js";
export * from "./session.js";
export * from "./sync-mapper.js";
export * from "./weblite-parser.js";
```

修改 `packages/onetalk-adapter/package.json`：

```json
{
  "name": "@wangwang/onetalk-adapter",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./browser": {
      "types": "./dist/browser.d.ts",
      "import": "./dist/browser.js"
    }
  },
  "scripts": {
    "test": "node --import tsx --test test/*.test.ts",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.10.7",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3"
  }
}
```

- [ ] **步骤 7：运行 adapter 测试并确认通过**

运行：

```bash
npm test -w @wangwang/onetalk-adapter
npm run build -w @wangwang/onetalk-adapter
```

预期：所有 adapter 测试通过，build 退出码为 0。

- [ ] **步骤 8：Commit adapter browser entry**

```bash
git add packages/onetalk-adapter
git commit -m "feat(onetalk): 增加浏览器安全适配入口"
```

## 任务 2：新增 Chrome extension workspace 骨架

**文件：**
- 创建：`apps/chrome-extension/package.json`
- 创建：`apps/chrome-extension/tsconfig.json`
- 创建：`apps/chrome-extension/vite.config.ts`
- 创建：`apps/chrome-extension/public/manifest.json`
- 创建：`apps/chrome-extension/src/shared/chrome-api.ts`
- 创建：`apps/chrome-extension/src/shared/sync-types.ts`
- 创建：`apps/chrome-extension/src/shared/extension-messages.ts`
- 创建：`apps/chrome-extension/src/background/index.ts`
- 创建：`apps/chrome-extension/src/content/onetalk-page-bridge.ts`
- 创建：`apps/chrome-extension/src/popup/popup.html`
- 创建：`apps/chrome-extension/src/popup/popup.ts`
- 创建：`apps/chrome-extension/src/options/options.html`
- 创建：`apps/chrome-extension/src/options/options.ts`
- 创建：`apps/chrome-extension/test/manifest.test.ts`
- 修改：`package-lock.json`

- [ ] **步骤 1：编写 Manifest 权限失败测试**

创建 `apps/chrome-extension/test/manifest.test.ts`：

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const manifestPath = path.resolve("public/manifest.json");

test("manifest uses minimal permissions for internal OneTalk collector", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    manifest_version: number;
    permissions?: string[];
    host_permissions?: string[];
    background?: { service_worker?: string; type?: string };
  };

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions?.sort(), ["alarms", "cookies", "storage"]);
  assert.ok(manifest.host_permissions?.includes("https://onetalk.alibaba.com/*"));
  assert.ok(manifest.host_permissions?.includes("http://127.0.0.1:5032/*"));
  assert.equal(manifest.host_permissions?.includes("<all_urls>"), false);
  assert.equal(manifest.permissions?.includes("webRequest"), false);
  assert.equal(manifest.background?.service_worker, "background/index.js");
  assert.equal(manifest.background?.type, "module");
});
```

- [ ] **步骤 2：运行插件测试并确认 workspace 不存在**

运行：

```bash
npm test -w @wangwang/chrome-extension
```

预期：npm 报 `No workspaces found` 或 `Missing script: test`。

- [ ] **步骤 3：创建插件 package 和 TypeScript 配置**

创建 `apps/chrome-extension/package.json`：

```json
{
  "name": "@wangwang/chrome-extension",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "node --import tsx --test test/*.test.ts",
    "build": "tsc -p tsconfig.json && vite build",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@wangwang/onetalk-adapter": "0.1.0"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vite": "^6.0.7"
  }
}
```

创建 `apps/chrome-extension/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": [],
    "noEmit": true
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

- [ ] **步骤 4：创建 Vite 多入口配置**

创建 `apps/chrome-extension/vite.config.ts`：

```ts
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "background/index": resolve(__dirname, "src/background/index.ts"),
        "content/onetalk-page-bridge": resolve(__dirname, "src/content/onetalk-page-bridge.ts"),
        "popup/popup": resolve(__dirname, "src/popup/popup.html"),
        "options/options": resolve(__dirname, "src/options/options.html")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
```

- [ ] **步骤 5：创建 Manifest 和最小源码**

创建 `apps/chrome-extension/public/manifest.json`：

```json
{
  "manifest_version": 3,
  "name": "TradeBridge OneTalk Collector",
  "version": "0.1.0",
  "description": "Sync authorized OneTalk conversations to TradeBridge without uploading OneTalk credentials.",
  "permissions": ["storage", "alarms", "cookies"],
  "host_permissions": [
    "https://onetalk.alibaba.com/*",
    "https://*.alibaba.com/*",
    "http://127.0.0.1:5032/*"
  ],
  "background": {
    "service_worker": "background/index.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://onetalk.alibaba.com/*"],
      "js": ["content/onetalk-page-bridge.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html"
  },
  "options_page": "options/options.html"
}
```

创建 `apps/chrome-extension/src/shared/chrome-api.ts`：

```ts
export interface ChromeStorageArea {
  get(keys?: string[] | Record<string, unknown> | string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ChromeRuntimeMessageSender {
  tab?: { id?: number; url?: string };
}

export interface ChromeRuntimeApi {
  onInstalled: {
    addListener(callback: () => void): void;
  };
  onMessage: {
    addListener(
      callback: (
        message: unknown,
        sender: ChromeRuntimeMessageSender,
        sendResponse: (response?: unknown) => void
      ) => boolean | void
    ): void;
  };
  sendMessage(message: unknown): Promise<unknown>;
  openOptionsPage(): void;
}

export interface ChromeAlarmsApi {
  create(name: string, alarmInfo: { periodInMinutes?: number; delayInMinutes?: number }): void;
  onAlarm: {
    addListener(callback: (alarm: { name: string }) => void): void;
  };
}

export interface ChromeApi {
  runtime: ChromeRuntimeApi;
  storage: {
    local: ChromeStorageArea;
  };
  alarms: ChromeAlarmsApi;
}

export function getChrome(): ChromeApi {
  return (globalThis as unknown as { chrome: ChromeApi }).chrome;
}
```

创建 `apps/chrome-extension/src/shared/sync-types.ts`：

```ts
export type {
  BrowserSyncBatch as SyncBatch,
  BrowserSyncDeviceInput as SyncDeviceInput,
  BrowserSyncSellerAccountInput as SyncSellerAccountInput
} from "@wangwang/onetalk-adapter/browser";

export interface SyncBatchResult {
  acceptedCount: number;
  rejectedCount: number;
  nextCursor: string | null;
  warnings: string[];
}

export interface ExtensionConfig {
  serverUrl: string;
  collectorToken: string;
  orgId: string;
  sellerAccountExternalId: string;
  sellerAccountDisplayName?: string;
  deviceId: string;
  deviceName?: string;
  syncIntervalMinutes?: number;
}

export interface ExtensionStatus {
  lastSyncedAt?: string;
  nextCursor?: string | null;
  lastError?: {
    code: string;
    message: string;
  };
}
```

创建 `apps/chrome-extension/src/shared/extension-messages.ts`：

```ts
export type ExtensionMessage =
  | { type: "onetalk-page-ready"; url: string }
  | { type: "sync-now" }
  | { type: "open-options" }
  | { type: "read-status" };

export interface SyncNowResponse {
  ok: boolean;
  acceptedCount?: number;
  rejectedCount?: number;
  nextCursor?: string | null;
  error?: string;
}
```

创建最小入口文件：

```ts
// apps/chrome-extension/src/background/index.ts
import { getChrome } from "../shared/chrome-api.js";

const chromeApi = getChrome();

chromeApi.runtime.onInstalled.addListener(() => {
  chromeApi.alarms.create("tradebridge-sync", { periodInMinutes: 30 });
});
```

```ts
// apps/chrome-extension/src/content/onetalk-page-bridge.ts
import { getChrome } from "../shared/chrome-api.js";

void getChrome().runtime.sendMessage({
  type: "onetalk-page-ready",
  url: location.href
});
```

```html
<!-- apps/chrome-extension/src/popup/popup.html -->
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>TradeBridge</title>
  </head>
  <body>
    <main>
      <button id="sync-now" type="button">同步</button>
      <button id="open-options" type="button">设置</button>
      <p id="status">未同步</p>
    </main>
    <script type="module" src="./popup.ts"></script>
  </body>
</html>
```

```ts
// apps/chrome-extension/src/popup/popup.ts
import { getChrome } from "../shared/chrome-api.js";

const chromeApi = getChrome();
const status = document.querySelector<HTMLParagraphElement>("#status");

document.querySelector<HTMLButtonElement>("#sync-now")?.addEventListener("click", async () => {
  status?.replaceChildren("同步中...");
  const result = await chromeApi.runtime.sendMessage({ type: "sync-now" });
  status?.replaceChildren(JSON.stringify(result));
});

document.querySelector<HTMLButtonElement>("#open-options")?.addEventListener("click", () => {
  chromeApi.runtime.openOptionsPage();
});
```

```html
<!-- apps/chrome-extension/src/options/options.html -->
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>TradeBridge 设置</title>
  </head>
  <body>
    <main>
      <form id="options-form">
        <label>Server URL <input name="serverUrl" value="http://127.0.0.1:5032" /></label>
        <label>Org ID <input name="orgId" value="org_internal" /></label>
        <label>Seller Account <input name="sellerAccountExternalId" /></label>
        <label>Device ID <input name="deviceId" /></label>
        <label>Collector Token <input name="collectorToken" type="password" /></label>
        <button type="submit">保存</button>
      </form>
      <p id="options-status"></p>
    </main>
    <script type="module" src="./options.ts"></script>
  </body>
</html>
```

```ts
// apps/chrome-extension/src/options/options.ts
document.querySelector<HTMLFormElement>("#options-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  document.querySelector("#options-status")?.replaceChildren("配置页面已加载，存储逻辑在任务 4 接入。");
});
```

- [ ] **步骤 6：刷新 lock metadata**

运行：

```bash
npm install --package-lock-only
```

预期：`package-lock.json` 增加 `apps/chrome-extension` workspace；不升级无关依赖版本。

- [ ] **步骤 7：运行插件测试、typecheck 和 build**

运行：

```bash
npm test -w @wangwang/chrome-extension
npm run typecheck -w @wangwang/chrome-extension
npm run build -w @wangwang/chrome-extension
```

预期：Manifest 测试通过，typecheck 退出码 0，`apps/chrome-extension/dist/manifest.json` 存在。

- [ ] **步骤 8：Commit 插件骨架**

```bash
git add apps/chrome-extension package-lock.json
git commit -m "feat(extension): 新增 Chrome 插件工作区骨架"
```

## 任务 3：实现 sanitizer 安全阻断

**文件：**
- 创建：`apps/chrome-extension/src/background/sanitizer.ts`
- 创建：`apps/chrome-extension/test/sanitizer.test.ts`

- [ ] **步骤 1：编写 sanitizer 失败测试**

创建 `apps/chrome-extension/test/sanitizer.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNoSensitiveFields, sanitizeForUpload } from "../src/background/sanitizer.js";

test("sanitizeForUpload removes sensitive keys recursively", () => {
  const sanitized = sanitizeForUpload({
    orgId: "org_internal",
    cookie2: "secret-cookie",
    nested: {
      ctoken: "secret-ctoken",
      safe: "value",
      list: [{ chatToken: "secret-chat-token", content: "hello" }]
    }
  });

  assert.deepEqual(sanitized, {
    orgId: "org_internal",
    nested: {
      safe: "value",
      list: [{ content: "hello" }]
    }
  });
});

test("assertNoSensitiveFields blocks payloads that still contain sensitive text", () => {
  assert.throws(
    () => assertNoSensitiveFields({ messages: [{ content: "ctoken=secret-value" }] }),
    /sanitizer_blocked_payload/
  );
});

test("assertNoSensitiveFields allows normal customer and message data", () => {
  assert.doesNotThrow(() =>
    assertNoSensitiveFields({
      customers: [{ externalCustomerId: "buyer-1", displayName: "Buyer One" }],
      messages: [{ content: "Can you ship tomorrow?" }]
    })
  );
});
```

- [ ] **步骤 2：运行 sanitizer 测试并确认失败**

运行：

```bash
npm test -w @wangwang/chrome-extension -- test/sanitizer.test.ts
```

预期：失败，报 `Cannot find module '../src/background/sanitizer.js'`。

- [ ] **步骤 3：实现 sanitizer**

创建 `apps/chrome-extension/src/background/sanitizer.ts`：

```ts
const SENSITIVE_KEY_PATTERNS = [
  /^cookie$/i,
  /^set-cookie$/i,
  /^authorization$/i,
  /^ctoken$/i,
  /^_tb_token_$/i,
  /^cookie2$/i,
  /^sgcookie$/i,
  /^x5sec$/i,
  /^chattoken$/i,
  /token/i,
  /csrf/i
];

const SENSITIVE_TEXT_PATTERNS = [
  /(?:^|[?&;\s])ctoken=/i,
  /(?:^|[?&;\s])_tb_token_=/i,
  /(?:^|[?&;\s])cookie2=/i,
  /(?:^|[?&;\s])sgcookie=/i,
  /(?:^|[?&;\s])x5sec=/i,
  /(?:^|[?&;\s])chatToken=/i,
  /Authorization:\s*/i,
  /Cookie:\s*/i,
  /Set-Cookie:\s*/i
];

export class SanitizerBlockedPayloadError extends Error {
  constructor(message = "sanitizer_blocked_payload") {
    super(message);
    this.name = "SanitizerBlockedPayloadError";
  }
}

export function sanitizeForUpload<T>(value: T): T {
  return sanitizeValue(value) as T;
}

export function assertNoSensitiveFields(value: unknown): void {
  const text = JSON.stringify(value);
  for (const pattern of SENSITIVE_TEXT_PATTERNS) {
    if (pattern.test(text)) {
      throw new SanitizerBlockedPayloadError();
    }
  }
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    output[key] = sanitizeValue(child);
  }
  return output;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}
```

- [ ] **步骤 4：运行 sanitizer 测试并确认通过**

运行：

```bash
npm test -w @wangwang/chrome-extension -- test/sanitizer.test.ts
```

预期：3 个 sanitizer 测试通过。

- [ ] **步骤 5：Commit sanitizer**

```bash
git add apps/chrome-extension/src/background/sanitizer.ts apps/chrome-extension/test/sanitizer.test.ts
git commit -m "feat(extension): 增加同步数据去敏阻断"
```

## 任务 4：实现 TradeBridge client 和配置存储

**文件：**
- 创建：`apps/chrome-extension/src/background/tradebridge-client.ts`
- 创建：`apps/chrome-extension/src/background/storage.ts`
- 创建：`apps/chrome-extension/test/tradebridge-client.test.ts`

- [ ] **步骤 1：编写 TradeBridge client 失败测试**

创建 `apps/chrome-extension/test/tradebridge-client.test.ts`：

```ts
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { uploadSyncBatch } from "../src/background/tradebridge-client.js";

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

test("uploadSyncBatch posts collector batch with bearer token", async () => {
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({
      ok: true,
      acceptedCount: 1,
      rejectedCount: 0,
      nextCursor: "2026-05-26T08:10:00.000Z",
      warnings: []
    });
  };

  const result = await uploadSyncBatch({
    serverUrl: "http://127.0.0.1:5032",
    collectorToken: "collector-token",
    batch: {
      orgId: "org_internal",
      sellerAccount: { externalAccountId: "seller-demo" },
      device: { deviceId: "chrome-extension-demo" }
    }
  });

  assert.equal(result.acceptedCount, 1);
  assert.equal(requests[0].url, "http://127.0.0.1:5032/collector/v1/sync-batches");
  assert.equal(requests[0].headers.get("authorization"), "Bearer collector-token");
  assert.equal(requests[0].headers.get("content-type"), "application/json");
});

test("uploadSyncBatch maps 401 to tradebridge_unauthorized", async () => {
  globalThis.fetch = async () => Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  await assert.rejects(
    () =>
      uploadSyncBatch({
        serverUrl: "http://127.0.0.1:5032",
        collectorToken: "bad-token",
        batch: {
          orgId: "org_internal",
          sellerAccount: { externalAccountId: "seller-demo" },
          device: { deviceId: "chrome-extension-demo" }
        }
      }),
    /tradebridge_unauthorized/
  );
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：

```bash
npm test -w @wangwang/chrome-extension -- test/tradebridge-client.test.ts
```

预期：失败，报 `Cannot find module '../src/background/tradebridge-client.js'`。

- [ ] **步骤 3：实现 TradeBridge client**

创建 `apps/chrome-extension/src/background/tradebridge-client.ts`：

```ts
import type { SyncBatch, SyncBatchResult } from "../shared/sync-types.js";

export interface UploadSyncBatchOptions {
  serverUrl: string;
  collectorToken: string;
  batch: SyncBatch;
}

export async function uploadSyncBatch(options: UploadSyncBatchOptions): Promise<SyncBatchResult> {
  const response = await fetch(syncBatchUrl(options.serverUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.collectorToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(options.batch)
  });
  const body = await response.json().catch(() => null);

  if (response.status === 401) {
    throw new Error("tradebridge_unauthorized");
  }
  if (!response.ok || !isSyncBatchResponse(body)) {
    throw new Error("tradebridge_upload_failed");
  }

  return {
    acceptedCount: body.acceptedCount,
    rejectedCount: body.rejectedCount,
    nextCursor: body.nextCursor,
    warnings: body.warnings
  };
}

function syncBatchUrl(serverUrl: string): string {
  return new URL("/collector/v1/sync-batches", serverUrl).toString();
}

function isSyncBatchResponse(value: unknown): value is SyncBatchResult & { ok: true } {
  return (
    isRecord(value) &&
    value.ok === true &&
    typeof value.acceptedCount === "number" &&
    typeof value.rejectedCount === "number" &&
    (typeof value.nextCursor === "string" || value.nextCursor === null) &&
    Array.isArray(value.warnings) &&
    value.warnings.every((item) => typeof item === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
```

- [ ] **步骤 4：实现配置存储**

创建 `apps/chrome-extension/src/background/storage.ts`：

```ts
import type { ChromeStorageArea } from "../shared/chrome-api.js";
import type { ExtensionConfig, ExtensionStatus } from "../shared/sync-types.js";

export interface ExtensionState {
  config?: ExtensionConfig;
  status?: ExtensionStatus;
}

const CONFIG_KEY = "tradebridgeConfig";
const STATUS_KEY = "tradebridgeStatus";

export class ExtensionStateStore {
  constructor(private readonly storage: ChromeStorageArea) {}

  async getConfig(): Promise<ExtensionConfig | null> {
    const data = await this.storage.get(CONFIG_KEY);
    return isConfig(data[CONFIG_KEY]) ? data[CONFIG_KEY] : null;
  }

  async saveConfig(config: ExtensionConfig): Promise<void> {
    await this.storage.set({ [CONFIG_KEY]: config });
  }

  async getStatus(): Promise<ExtensionStatus> {
    const data = await this.storage.get(STATUS_KEY);
    return isRecord(data[STATUS_KEY]) ? (data[STATUS_KEY] as ExtensionStatus) : {};
  }

  async saveStatus(status: ExtensionStatus): Promise<void> {
    await this.storage.set({ [STATUS_KEY]: status });
  }
}

export function validateConfig(config: ExtensionConfig | null): asserts config is ExtensionConfig {
  if (!config?.serverUrl || !config.collectorToken || !config.orgId || !config.sellerAccountExternalId || !config.deviceId) {
    throw new Error("config_required");
  }
}

function isConfig(value: unknown): value is ExtensionConfig {
  return (
    isRecord(value) &&
    typeof value.serverUrl === "string" &&
    typeof value.collectorToken === "string" &&
    typeof value.orgId === "string" &&
    typeof value.sellerAccountExternalId === "string" &&
    typeof value.deviceId === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
```

- [ ] **步骤 5：运行 client 测试、插件 typecheck**

运行：

```bash
npm test -w @wangwang/chrome-extension -- test/tradebridge-client.test.ts
npm run typecheck -w @wangwang/chrome-extension
```

预期：测试通过，typecheck 退出码 0。

- [ ] **步骤 6：Commit client 和 storage**

```bash
git add apps/chrome-extension/src/background/tradebridge-client.ts apps/chrome-extension/src/background/storage.ts apps/chrome-extension/test/tradebridge-client.test.ts
git commit -m "feat(extension): 接入 TradeBridge 上传与本地配置"
```

## 任务 5：实现浏览器 OneTalk client

**文件：**
- 创建：`apps/chrome-extension/src/background/onetalk-client.ts`
- 创建：`apps/chrome-extension/test/fixtures/weblite.html`
- 创建：`apps/chrome-extension/test/onetalk-client.test.ts`

- [ ] **步骤 1：创建去敏 weblite fixture**

创建 `apps/chrome-extension/test/fixtures/weblite.html`：

```html
<!doctype html>
<html>
  <body>
    <script>
      window.aliId = 'self-ali';
      window.__VMFsConv__cache__ = [
        {
          "cid": "conv-1",
          "contactAccountId": "buyer-1",
          "encryptContactAccountId": "buyer-enc",
          "contactAliId": "buyer-ali",
          "encryptContactAliId": "buyer-ali-enc",
          "contactNick": "Buyer One",
          "latestMessage": { "content": "hello", "sendTime": 1779706200000 }
        }
      ];
    </script>
  </body>
</html>
```

- [ ] **步骤 2：编写 OneTalk client 失败测试**

创建 `apps/chrome-extension/test/onetalk-client.test.ts`：

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { BrowserOnetalkClient } from "../src/background/onetalk-client.js";

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

test("fetchWeblite parses cached conversations and sends credentials include", async () => {
  const requests: Request[] = [];
  const html = fs.readFileSync(path.resolve("test/fixtures/weblite.html"), "utf8");
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html" }
    });
  };

  const client = new BrowserOnetalkClient();
  const result = await client.fetchWeblite();

  assert.equal(result.bootstrap.aliId, "self-ali");
  assert.equal(result.conversations.length, 1);
  assert.equal(requests[0].credentials, "include");
});

test("getChatMessages posts payload and parses message list", async () => {
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({
      code: 200,
      data: {
        list: [{ messageId: "m1", content: "hello", sendTime: 1779706200000 }]
      }
    });
  };

  const client = new BrowserOnetalkClient();
  const result = await client.getChatMessages({
    conversation: {
      cid: "conv-1",
      contactAccountId: "buyer-1",
      encryptContactAccountId: "buyer-enc",
      contactAliId: "buyer-ali",
      encryptContactAliId: "buyer-ali-enc"
    },
    bootstrap: { aliId: "self-ali" },
    before: 1779706200000,
    pageSize: 50
  });

  assert.equal(result.status, 200);
  assert.equal(result.messages.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].credentials, "include");
});

test("fetchWeblite maps login pages to onetalk_login_required", async () => {
  globalThis.fetch = async () =>
    new Response("<html><script>newlogin</script></html>", {
      status: 200,
      headers: { "content-type": "text/html" }
    });

  const client = new BrowserOnetalkClient();
  await assert.rejects(() => client.fetchWeblite(), /onetalk_login_required/);
});
```

- [ ] **步骤 3：运行 OneTalk client 测试并确认失败**

运行：

```bash
npm test -w @wangwang/chrome-extension -- test/onetalk-client.test.ts
```

预期：失败，报 `Cannot find module '../src/background/onetalk-client.js'`。

- [ ] **步骤 4：实现 BrowserOnetalkClient**

创建 `apps/chrome-extension/src/background/onetalk-client.ts`：

```ts
import {
  buildPayload,
  extractJsonAfter,
  pageBootstrap,
  type ChatMessageRequest,
  type ChatMessageResponse,
  type WebliteData
} from "@wangwang/onetalk-adapter/browser";

const WEBLITE_URL = "https://onetalk.alibaba.com/message/weblitePWA.htm";
const MESSAGE_URL = "https://onetalk.alibaba.com/message/getChatMessageList.htm";

export class BrowserOnetalkClient {
  async fetchWeblite(): Promise<WebliteData> {
    const response = await fetch(WEBLITE_URL, {
      credentials: "include",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    const html = await response.text();
    if (response.url.includes("login.alibaba.com") || /newlogin/i.test(html.slice(0, 5000))) {
      throw new Error("onetalk_login_required");
    }
    const parsed = extractJsonAfter(html, "window.__VMFsConv__cache__");
    const conversations = Array.isArray(parsed) ? parsed.filter(isRecord) : [];
    return {
      html,
      conversations,
      bootstrap: pageBootstrap(html)
    };
  }

  async getChatMessages(request: ChatMessageRequest): Promise<ChatMessageResponse> {
    const payload = buildPayload(request.conversation, request.bootstrap, request.before, request.pageSize);
    const response = await fetch(MESSAGE_URL, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: new URLSearchParams({ params: JSON.stringify(payload) })
    });
    const text = await response.text();
    if (response.url.includes("login.alibaba.com") || /newlogin/i.test(text.slice(0, 5000))) {
      throw new Error("onetalk_login_required");
    }
    if (response.status === 429) {
      throw new Error("onetalk_rate_limited");
    }
    const raw = safeJson(text);
    const code = isRecord(raw) ? (raw.code as string | number | null) ?? null : null;
    const data = isRecord(raw) && isRecord(raw.data) ? raw.data : {};
    const list = Array.isArray(data.list) ? data.list.filter(isRecord) : [];
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      code,
      raw,
      messages: list
    };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
```

- [ ] **步骤 5：运行 OneTalk client 测试并确认通过**

运行：

```bash
npm test -w @wangwang/chrome-extension -- test/onetalk-client.test.ts
npm run typecheck -w @wangwang/chrome-extension
```

预期：OneTalk client 测试通过，typecheck 退出码 0。

- [ ] **步骤 6：Commit OneTalk client**

```bash
git add apps/chrome-extension/src/background/onetalk-client.ts apps/chrome-extension/test/fixtures/weblite.html apps/chrome-extension/test/onetalk-client.test.ts
git commit -m "feat(extension): 增加浏览器 OneTalk 客户端"
```

## 任务 6：实现同步编排

**文件：**
- 创建：`apps/chrome-extension/src/background/sync-orchestrator.ts`
- 创建：`apps/chrome-extension/test/sync-orchestrator.test.ts`
- 修改：`apps/chrome-extension/src/background/index.ts`

- [ ] **步骤 1：编写同步编排失败测试**

创建 `apps/chrome-extension/test/sync-orchestrator.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { runSyncOnce } from "../src/background/sync-orchestrator.js";
import type { ExtensionConfig, ExtensionStatus, SyncBatch } from "../src/shared/sync-types.js";

class MemoryStateStore {
  config: ExtensionConfig | null = {
    serverUrl: "http://127.0.0.1:5032",
    collectorToken: "collector-token",
    orgId: "org_internal",
    sellerAccountExternalId: "seller-demo",
    sellerAccountDisplayName: "Seller Demo",
    deviceId: "chrome-extension-demo",
    deviceName: "Chrome Extension"
  };
  status: ExtensionStatus = {};

  async getConfig() {
    return this.config;
  }
  async getStatus() {
    return this.status;
  }
  async saveStatus(status: ExtensionStatus) {
    this.status = status;
  }
}

test("runSyncOnce fetches OneTalk data, sanitizes it, uploads batch, and saves cursor", async () => {
  const store = new MemoryStateStore();
  const uploaded: SyncBatch[] = [];

  const result = await runSyncOnce({
    now: () => new Date("2026-05-26T08:10:00.000Z"),
    stateStore: store,
    onetalkClient: {
      fetchWeblite: async () => ({
        html: "",
        bootstrap: { aliId: "self-ali" },
        conversations: [{ cid: "conv-1", contactAccountId: "buyer-1", contactNick: "Buyer One" }]
      }),
      getChatMessages: async () => ({
        status: 200,
        contentType: "application/json",
        code: 200,
        raw: {},
        messages: [
          {
            messageId: "m1",
            senderAliId: "buyer-ali",
            messageType: "text",
            content: "hello",
            sendTime: 1779706200000
          }
        ]
      })
    },
    uploadSyncBatch: async (options) => {
      uploaded.push(options.batch);
      return {
        acceptedCount: options.batch.messages?.length || 0,
        rejectedCount: 0,
        nextCursor: "2026-05-25T10:50:00.000Z",
        warnings: []
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].sourceMeta?.source, "chrome-extension");
  assert.equal(uploaded[0].messages?.[0].content, "hello");
  assert.equal(store.status.nextCursor, "2026-05-25T10:50:00.000Z");
  assert.equal(store.status.lastError, undefined);
});

test("runSyncOnce stores config_required errors", async () => {
  const store = new MemoryStateStore();
  store.config = null;

  const result = await runSyncOnce({
    stateStore: store,
    onetalkClient: {
      fetchWeblite: async () => {
        throw new Error("should not fetch");
      },
      getChatMessages: async () => {
        throw new Error("should not fetch");
      }
    },
    uploadSyncBatch: async () => {
      throw new Error("should not upload");
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "config_required");
  assert.equal(store.status.lastError?.code, "config_required");
});
```

- [ ] **步骤 2：运行编排测试并确认失败**

运行：

```bash
npm test -w @wangwang/chrome-extension -- test/sync-orchestrator.test.ts
```

预期：失败，报 `Cannot find module '../src/background/sync-orchestrator.js'`。

- [ ] **步骤 3：实现同步编排**

创建 `apps/chrome-extension/src/background/sync-orchestrator.ts`：

```ts
import { mapWebliteToSyncBatch, type ChatMessageResponse, type WebliteData } from "@wangwang/onetalk-adapter/browser";
import { assertNoSensitiveFields, sanitizeForUpload } from "./sanitizer.js";
import { validateConfig } from "./storage.js";
import type { ExtensionConfig, ExtensionStatus, SyncBatch, SyncBatchResult } from "../shared/sync-types.js";

export interface SyncStateStore {
  getConfig(): Promise<ExtensionConfig | null>;
  getStatus(): Promise<ExtensionStatus>;
  saveStatus(status: ExtensionStatus): Promise<void>;
}

export interface SyncOnetalkClient {
  fetchWeblite(): Promise<WebliteData>;
  getChatMessages(options: {
    conversation: Record<string, unknown>;
    bootstrap: Record<string, string>;
    before: number | null;
    pageSize: number;
  }): Promise<ChatMessageResponse>;
}

export interface RunSyncOnceOptions {
  stateStore: SyncStateStore;
  onetalkClient: SyncOnetalkClient;
  uploadSyncBatch(options: { serverUrl: string; collectorToken: string; batch: SyncBatch }): Promise<SyncBatchResult>;
  now?: () => Date;
  pageSize?: number;
  maxPagesPerConversation?: number;
}

export interface RunSyncResult {
  ok: boolean;
  acceptedCount?: number;
  rejectedCount?: number;
  nextCursor?: string | null;
  error?: string;
}

export async function runSyncOnce(options: RunSyncOnceOptions): Promise<RunSyncResult> {
  const now = options.now || (() => new Date());
  const pageSize = options.pageSize || 50;
  const maxPages = options.maxPagesPerConversation || 1;
  const previousStatus = await options.stateStore.getStatus();

  try {
    const config = await options.stateStore.getConfig();
    validateConfig(config);

    const weblite = await options.onetalkClient.fetchWeblite();
    const messagesByConversationId = await fetchMessagesByConversation({
      client: options.onetalkClient,
      weblite,
      pageSize,
      maxPages
    });
    const mapped = mapWebliteToSyncBatch({
      orgId: config.orgId,
      sellerAccount: {
        externalAccountId: config.sellerAccountExternalId,
        displayName: config.sellerAccountDisplayName
      },
      device: {
        deviceId: config.deviceId,
        deviceName: config.deviceName
      },
      collectedAt: now().toISOString(),
      source: "chrome-extension",
      previousCursor: previousStatus.nextCursor || null,
      weblite,
      messagesByConversationId
    });

    const sanitized = sanitizeForUpload(mapped);
    assertNoSensitiveFields(sanitized);
    const uploadResult = await options.uploadSyncBatch({
      serverUrl: config.serverUrl,
      collectorToken: config.collectorToken,
      batch: sanitized
    });

    await options.stateStore.saveStatus({
      lastSyncedAt: now().toISOString(),
      nextCursor: uploadResult.nextCursor,
      lastError: undefined
    });

    return {
      ok: true,
      acceptedCount: uploadResult.acceptedCount,
      rejectedCount: uploadResult.rejectedCount,
      nextCursor: uploadResult.nextCursor
    };
  } catch (error) {
    const code = error instanceof Error ? error.message : "sync_failed";
    await options.stateStore.saveStatus({
      ...previousStatus,
      lastError: {
        code,
        message: code
      }
    });
    return { ok: false, error: code };
  }
}

async function fetchMessagesByConversation(options: {
  client: SyncOnetalkClient;
  weblite: WebliteData;
  pageSize: number;
  maxPages: number;
}): Promise<Record<string, Record<string, unknown>[]>> {
  const output: Record<string, Record<string, unknown>[]> = {};

  for (const conversation of options.weblite.conversations.filter(isRecord)) {
    const conversationId = firstString(conversation, ["cid", "conversationCode", "conversationId", "id"]);
    if (!conversationId) continue;
    const messages: Record<string, unknown>[] = [];
    let before: number | null = null;

    for (let page = 0; page < options.maxPages; page += 1) {
      const result = await options.client.getChatMessages({
        conversation,
        bootstrap: options.weblite.bootstrap,
        before,
        pageSize: options.pageSize
      });
      const records = result.messages.filter(isRecord);
      messages.push(...records);
      if (records.length < options.pageSize) break;
      const oldest = oldestTimestamp(records);
      if (oldest == null) break;
      before = oldest - 1;
    }

    output[conversationId] = messages;
  }

  return output;
}

function oldestTimestamp(records: Record<string, unknown>[]): number | null {
  const times = records
    .map((record) => numericTime(firstValue(record, ["sendTime", "sentAt", "time", "gmtCreate", "createdAt"])))
    .filter((value): value is number => value != null);
  return times.length ? Math.min(...times) : null;
}

function numericTime(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;
  if (raw == null || !Number.isFinite(raw)) return null;
  return raw < 10_000_000_000 ? raw * 1000 : raw;
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  const value = firstValue(source, keys);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function firstValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value != null && value !== "") return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
```

- [ ] **步骤 4：接入 background 入口**

修改 `apps/chrome-extension/src/background/index.ts`：

```ts
import { BrowserOnetalkClient } from "./onetalk-client.js";
import { ExtensionStateStore } from "./storage.js";
import { runSyncOnce } from "./sync-orchestrator.js";
import { uploadSyncBatch } from "./tradebridge-client.js";
import { getChrome } from "../shared/chrome-api.js";
import type { ExtensionMessage } from "../shared/extension-messages.js";

const chromeApi = getChrome();
const stateStore = new ExtensionStateStore(chromeApi.storage.local);

chromeApi.runtime.onInstalled.addListener(() => {
  chromeApi.alarms.create("tradebridge-sync", { periodInMinutes: 30 });
});

chromeApi.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "tradebridge-sync") {
    void runDefaultSync();
  }
});

chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const typed = message as ExtensionMessage;
  if (typed.type === "sync-now") {
    void runDefaultSync().then(sendResponse);
    return true;
  }
  if (typed.type === "read-status") {
    void stateStore.getStatus().then(sendResponse);
    return true;
  }
  return false;
});

function runDefaultSync() {
  return runSyncOnce({
    stateStore,
    onetalkClient: new BrowserOnetalkClient(),
    uploadSyncBatch
  });
}
```

- [ ] **步骤 5：运行编排测试、完整插件测试和构建**

运行：

```bash
npm test -w @wangwang/chrome-extension -- test/sync-orchestrator.test.ts
npm test -w @wangwang/chrome-extension
npm run build -w @wangwang/chrome-extension
```

预期：插件所有测试通过，build 退出码 0。

- [ ] **步骤 6：Commit 同步编排**

```bash
git add apps/chrome-extension/src/background/index.ts apps/chrome-extension/src/background/sync-orchestrator.ts apps/chrome-extension/test/sync-orchestrator.test.ts
git commit -m "feat(extension): 编排 OneTalk 同步上传"
```

## 任务 7：完善 options、popup 和 content script

**文件：**
- 修改：`apps/chrome-extension/src/options/options.html`
- 修改：`apps/chrome-extension/src/options/options.ts`
- 修改：`apps/chrome-extension/src/popup/popup.html`
- 修改：`apps/chrome-extension/src/popup/popup.ts`
- 修改：`apps/chrome-extension/src/content/onetalk-page-bridge.ts`

- [ ] **步骤 1：实现 options 配置保存**

替换 `apps/chrome-extension/src/options/options.ts`：

```ts
import { ExtensionStateStore } from "../background/storage.js";
import { getChrome } from "../shared/chrome-api.js";
import type { ExtensionConfig } from "../shared/sync-types.js";

const store = new ExtensionStateStore(getChrome().storage.local);
const form = document.querySelector<HTMLFormElement>("#options-form");
const status = document.querySelector<HTMLParagraphElement>("#options-status");

void hydrate();

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const config: ExtensionConfig = {
    serverUrl: required(formData, "serverUrl"),
    orgId: required(formData, "orgId"),
    sellerAccountExternalId: required(formData, "sellerAccountExternalId"),
    deviceId: required(formData, "deviceId"),
    collectorToken: required(formData, "collectorToken")
  };
  await store.saveConfig(config);
  status?.replaceChildren("已保存");
});

async function hydrate(): Promise<void> {
  const config = await store.getConfig();
  if (!form || !config) return;
  setInput("serverUrl", config.serverUrl);
  setInput("orgId", config.orgId);
  setInput("sellerAccountExternalId", config.sellerAccountExternalId);
  setInput("deviceId", config.deviceId);
  setInput("collectorToken", config.collectorToken);
}

function setInput(name: string, value: string): void {
  const input = form?.elements.namedItem(name);
  if (input instanceof HTMLInputElement) input.value = value;
}

function required(formData: FormData, name: string): string {
  const value = String(formData.get(name) || "").trim();
  if (!value) throw new Error(`missing_${name}`);
  return value;
}
```

- [ ] **步骤 2：实现 popup 状态展示**

替换 `apps/chrome-extension/src/popup/popup.ts`：

```ts
import { getChrome } from "../shared/chrome-api.js";
import type { SyncNowResponse } from "../shared/extension-messages.js";
import type { ExtensionStatus } from "../shared/sync-types.js";

const chromeApi = getChrome();
const status = document.querySelector<HTMLParagraphElement>("#status");

void renderStatus();

document.querySelector<HTMLButtonElement>("#sync-now")?.addEventListener("click", async () => {
  status?.replaceChildren("同步中...");
  const result = (await chromeApi.runtime.sendMessage({ type: "sync-now" })) as SyncNowResponse;
  if (result.ok) {
    status?.replaceChildren(`已同步 ${result.acceptedCount || 0} 条消息`);
  } else {
    status?.replaceChildren(`同步失败：${result.error || "sync_failed"}`);
  }
});

document.querySelector<HTMLButtonElement>("#open-options")?.addEventListener("click", () => {
  chromeApi.runtime.openOptionsPage();
});

async function renderStatus(): Promise<void> {
  const current = (await chromeApi.runtime.sendMessage({ type: "read-status" })) as ExtensionStatus;
  if (current.lastError) {
    status?.replaceChildren(`最近错误：${current.lastError.code}`);
    return;
  }
  if (current.lastSyncedAt) {
    status?.replaceChildren(`最近同步：${current.lastSyncedAt}`);
    return;
  }
  status?.replaceChildren("未同步");
}
```

- [ ] **步骤 3：实现 content script 页面状态探测**

替换 `apps/chrome-extension/src/content/onetalk-page-bridge.ts`：

```ts
import { getChrome } from "../shared/chrome-api.js";

const loginRequired = /login\.alibaba\.com|newlogin/i.test(location.href) || Boolean(document.querySelector("input[type='password']"));

void getChrome().runtime.sendMessage({
  type: loginRequired ? "onetalk-login-required" : "onetalk-page-ready",
  url: location.href
});
```

同时修改 `apps/chrome-extension/src/shared/extension-messages.ts`，把 `ExtensionMessage` 扩展为：

```ts
export type ExtensionMessage =
  | { type: "onetalk-page-ready"; url: string }
  | { type: "onetalk-login-required"; url: string }
  | { type: "sync-now" }
  | { type: "open-options" }
  | { type: "read-status" };
```

- [ ] **步骤 4：运行插件构建**

运行：

```bash
npm run typecheck -w @wangwang/chrome-extension
npm run build -w @wangwang/chrome-extension
```

预期：typecheck 和 build 均退出码 0。

- [ ] **步骤 5：Commit UI wiring**

```bash
git add apps/chrome-extension/src/options apps/chrome-extension/src/popup apps/chrome-extension/src/content apps/chrome-extension/src/shared/extension-messages.ts
git commit -m "feat(extension): 完成插件配置与同步入口"
```

## 任务 8：接入根构建、文档和最终验证

**文件：**
- 修改：`package.json`
- 修改：`package-lock.json`
- 创建：`docs/chrome-extension-trial-runbook.md`

- [ ] **步骤 1：更新根脚本**

修改根 `package.json`，把 extension 加入 `build` 和 `typecheck`。

`build` 改为：

```json
"build": "npm run build -w @wangwang/shared && npm run build -w @wangwang/env && npm run build -w @wangwang/onetalk-adapter && npm run build -w @wangwang/database && npm run build -w @wangwang/collector-desktop && npm run build -w @wangwang/api && npm run build -w @wangwang/server && npm run build -w @wangwang/web && npm run build -w @wangwang/chrome-extension"
```

`typecheck` 改为：

```json
"typecheck": "npm run build -w @wangwang/shared && npm run build -w @wangwang/env && npm run build -w @wangwang/onetalk-adapter && npm run build -w @wangwang/database && npm run typecheck -w @wangwang/collector-desktop && npm run typecheck -w @wangwang/api && npm run typecheck -w @wangwang/server && npm run typecheck -w @wangwang/web && npm run typecheck -w @wangwang/chrome-extension"
```

- [ ] **步骤 2：新增内部试运行手册**

创建 `docs/chrome-extension-trial-runbook.md`：

```md
# Chrome 插件内部试运行手册

## 前置条件

- Chrome 浏览器。
- 用户已能访问 `https://onetalk.alibaba.com/` 并完成登录。
- TradeBridge server 运行在 `http://127.0.0.1:5032`。
- 管理员已注册采集设备并拿到 collector token。

## 构建插件

```bash
npm run build -w @wangwang/chrome-extension
```

构建产物在：

```text
apps/chrome-extension/dist
```

## 安装 unpacked extension

1. 打开 `chrome://extensions`。
2. 开启 Developer mode。
3. 点击 Load unpacked。
4. 选择 `apps/chrome-extension/dist`。

## 配置

在插件设置页填写：

- Server URL：`http://127.0.0.1:5032`
- Org ID：`org_internal`
- Seller Account External ID：卖家账号外部 ID
- Device ID：本机插件设备 ID
- Collector Token：TradeBridge 返回的采集设备 token

不要在设置页填写 OneTalk Cookie、`ctoken`、`_tb_token_`、`sgcookie`、`x5sec` 或 `chatToken`。

## 手工验证

1. Chrome 打开 `https://onetalk.alibaba.com/`。
2. 确认 OneTalk 页面已登录。
3. 点击插件弹窗里的同步按钮。
4. 打开 TradeBridge Web 工作台。
5. 确认客户、会话和消息可见。
6. 撤销 collector token 后再次同步，确认插件显示 `tradebridge_unauthorized`。

## 安全检查

服务端、导出文件、Web 响应中不应出现：

- `cookie2`
- `ctoken`
- `_tb_token_`
- `sgcookie`
- `x5sec`
- `chatToken`
- `Authorization`
- `Cookie`
- `Set-Cookie`
```

- [ ] **步骤 3：刷新 lock metadata**

运行：

```bash
npm install --package-lock-only
```

预期：`package-lock.json` 与 workspace 新包一致；没有无关依赖升级。

- [ ] **步骤 4：运行最终验证**

运行：

```bash
npm test -w @wangwang/onetalk-adapter
npm test -w @wangwang/chrome-extension
npm run build -w @wangwang/chrome-extension
npm run typecheck
```

预期：

- adapter 测试通过。
- extension 测试通过。
- extension build 退出码 0。
- root typecheck 退出码 0。

如果 `npm run typecheck` 因工作区已有数据库未提交改动失败，先记录失败输出，不要回滚用户已有改动；只修复与本计划相关的 extension/adapter 类型错误。

- [ ] **步骤 5：检查敏感字段和 diff**

运行：

```bash
rg -n "ctoken|_tb_token_|cookie2|sgcookie|x5sec|chatToken|Set-Cookie|Authorization|Cookie" apps/chrome-extension packages/onetalk-adapter docs/chrome-extension-trial-runbook.md
git diff --check
git status --short
```

预期：

- `rg` 命中只能出现在 sanitizer、测试、文档的禁止项说明里。
- `git diff --check` 无 trailing whitespace 或 conflict marker。
- `git status --short` 中本计划相关文件清晰可见；数据库相关既有改动没有被回滚。

- [ ] **步骤 6：Commit 集成收尾**

```bash
git add package.json package-lock.json docs/chrome-extension-trial-runbook.md apps/chrome-extension packages/onetalk-adapter
git commit -m "feat(extension): 接入 OneTalk 同步插件 MVP"
```

## 执行建议

按任务顺序串行执行。任务 1 到任务 6 是 MVP 的核心闭环；任务 7 改善可用性；任务 8 做仓库级收尾。

如果任务 5 真实浏览器验证发现 background `fetch(..., { credentials: "include" })` 无法携带 OneTalk 登录态，停止继续扩展 UI，改为在同一计划内调整 `BrowserOnetalkClient`：由 background 给 content script 发消息，让 content script 在 `onetalk.alibaba.com` 页面上下文执行同源请求并返回去敏响应。仍然保持 `/collector/v1/sync-batches`、sanitizer 和 TradeBridge client 不变。
