# Chrome 插件完成度补齐实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 把当前 Chrome 插件从“主链路可跑”补齐到“状态可靠、面板响应快、配置面板可用、同步更完整、实时连接更稳”的可试用版本。

**架构：** 保持现有 MV3 插件结构不大改：popup 只展示缓存状态和触发动作，background 承担账号校验、同步、WS、发消息编排，options 承担激活、重置和连通性检查。新增少量可测试的纯逻辑模块，把现在藏在 `background/index.ts` 里的 dashboard 读取和账号校验刷新拆出来，避免继续扩大 service worker 入口文件。

**技术栈：** Chrome Extension Manifest V3、TypeScript、Vite、Node test runner、现有 `@wangwang/onetalk-adapter`、现有 `@wangwang/collector-protocol`。

---

## 执行前约束

- 当前工作区已有未提交的插件账号展示与账号校验改动。执行者不得回滚这些改动。
- 每个任务只 stage 本任务涉及文件；如果工作区还有其他文件变更，保留它们。
- 每个行为变更先写失败测试，再写实现。
- 每个任务结束后运行该任务列出的验证命令；任务之间可以 commit，也可以在用户明确要求时统一提交。

## 文件结构

### 修改

- `apps/chrome-extension/src/background/sync-orchestrator.ts`：修复同步成功保存状态时覆盖 `realtime`、`accountValidation` 的问题；使用本地 `nextCursor` 作为同步高水位。
- `apps/chrome-extension/test/sync-orchestrator.test.ts`：覆盖状态保留、cursor 过滤、默认分页深度。
- `apps/chrome-extension/src/background/index.ts`：改为读取缓存 dashboard，后台刷新账号校验；接入手动账号校验消息。
- `apps/chrome-extension/src/shared/extension-messages.ts`：新增账号校验消息和响应类型。
- `apps/chrome-extension/src/shared/sync-types.ts`：补充 dashboard、账号校验刷新、WS 重连计划、outbound deferred 状态需要的类型字段。
- `apps/chrome-extension/src/popup/popup.html`：增加“重新校验”按钮和加载态承载节点。
- `apps/chrome-extension/src/popup/popup.ts`：popup 秒开读取缓存，手动触发账号校验，不再被服务端请求阻塞。
- `apps/chrome-extension/src/popup/popup-view.ts`：新增按钮 label、校验态 tone、错误码中文映射。
- `apps/chrome-extension/test/popup-view.test.ts`：覆盖校验中、校验失效、手动校验按钮展示。
- `apps/chrome-extension/src/options/options.html`：升级为可用配置面板，展示当前账号、服务端、连接状态、重置入口。
- `apps/chrome-extension/src/options/options.ts`：回填账号与服务端，支持连通性检查、重新校验、重置。
- `apps/chrome-extension/public/manifest.json`：增加动态服务端授权所需的 optional host permissions。
- `apps/chrome-extension/test/manifest.test.ts`：覆盖 optional host permissions。
- `apps/chrome-extension/src/background/outbound-orchestrator.ts`：把 OneTalk tab 不可用、发送超时等临时失败改为 deferred，不立刻标记服务端消息 failed。
- `apps/chrome-extension/test/outbound-orchestrator.test.ts`：覆盖 deferred 不上报 failed。
- `apps/chrome-extension/src/background/tradebridge-ws-client.ts`：增加 ready 超时和 heartbeat 失活判断。
- `apps/chrome-extension/test/tradebridge-ws-client.test.ts`：覆盖 ready 超时、heartbeat 失活状态。

### 创建

- `apps/chrome-extension/src/background/dashboard-service.ts`：封装 dashboard 缓存读取、账号校验 TTL 判断、账号校验刷新。
- `apps/chrome-extension/test/dashboard-service.test.ts`：dashboard 服务单元测试。
- `apps/chrome-extension/src/options/options-view.ts`：options 面板文案和 view model。
- `apps/chrome-extension/test/options-view.test.ts`：options view model 测试。
- `apps/chrome-extension/src/options/options.css`：options 面板样式。
- `apps/chrome-extension/src/shared/server-permissions.ts`：从 Server URL 计算需要申请的 HTTP/WS origins。
- `apps/chrome-extension/test/server-permissions.test.ts`：服务端权限 origin 计算测试。

---

## 任务 1：同步成功时保留已有插件状态

**文件：**
- 修改：`apps/chrome-extension/src/background/sync-orchestrator.ts`
- 测试：`apps/chrome-extension/test/sync-orchestrator.test.ts`

- [ ] **步骤 1：编写失败的测试**

在 `apps/chrome-extension/test/sync-orchestrator.test.ts` 追加：

```ts
test("runSyncOnce preserves realtime and account validation status on successful sync", async () => {
  const store = new MemoryStateStore();
  store.status = {
    accountValidation: {
      state: "valid",
      email: "admin@example.com",
      checkedAt: "2026-06-01T06:31:00.000Z"
    },
    realtime: {
      state: "connected",
      sessionId: "session-1",
      connectedAt: "2026-06-01T06:30:00.000Z",
      lastChangedAt: "2026-06-01T06:30:00.000Z"
    },
    lastError: {
      code: "old_error",
      message: "old_error"
    }
  };

  const result = await runSyncOnce({
    now: () => new Date("2026-06-01T06:40:00.000Z"),
    stateStore: store,
    onetalkClient: {
      fetchWeblite: async () => ({
        html: "",
        bootstrap: { aliId: "self-ali" },
        conversations: []
      }),
      getChatMessages: async () => {
        throw new Error("messages_should_not_be_requested");
      }
    },
    uploadSyncBatch: async () => ({
      acceptedCount: 0,
      rejectedCount: 0,
      nextCursor: "2026-06-01T06:40:00.000Z",
      warnings: []
    })
  });

  assert.equal(result.ok, true);
  assert.equal(store.status.lastError, undefined);
  assert.deepEqual(store.status.accountValidation, {
    state: "valid",
    email: "admin@example.com",
    checkedAt: "2026-06-01T06:31:00.000Z"
  });
  assert.deepEqual(store.status.realtime, {
    state: "connected",
    sessionId: "session-1",
    connectedAt: "2026-06-01T06:30:00.000Z",
    lastChangedAt: "2026-06-01T06:30:00.000Z"
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge/apps/chrome-extension
node --import tsx --test test/sync-orchestrator.test.ts
```

预期：新增测试 FAIL，失败点是 `store.status.accountValidation` 或 `store.status.realtime` 为 `undefined`。

- [ ] **步骤 3：编写最少实现代码**

在 `apps/chrome-extension/src/background/sync-orchestrator.ts` 的成功保存状态处改成保留旧状态：

```ts
await options.stateStore.saveStatus({
  ...previousStatus,
  lastSyncedAt: now().toISOString(),
  nextCursor: uploadResult.nextCursor,
  lastDiagnostics: messageFetch.diagnostics,
  lastError: undefined
});
```

- [ ] **步骤 4：运行测试验证通过**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge/apps/chrome-extension
node --import tsx --test test/sync-orchestrator.test.ts
```

预期：`sync-orchestrator.test.ts` 全部 PASS。

- [ ] **步骤 5：Commit**

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge
git add apps/chrome-extension/src/background/sync-orchestrator.ts apps/chrome-extension/test/sync-orchestrator.test.ts
git commit -m "fix(chrome-extension): 保留同步状态"
```

---

## 任务 2：拆出 dashboard 缓存读取与账号校验刷新服务

**文件：**
- 创建：`apps/chrome-extension/src/background/dashboard-service.ts`
- 创建：`apps/chrome-extension/test/dashboard-service.test.ts`
- 修改：`apps/chrome-extension/src/background/index.ts`
- 修改：`apps/chrome-extension/src/shared/extension-messages.ts`

- [ ] **步骤 1：编写失败的测试**

创建 `apps/chrome-extension/test/dashboard-service.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCOUNT_VALIDATION_TTL_MS,
  readCachedDashboard,
  refreshTradeBridgeAccountValidation,
  shouldRefreshAccountValidation
} from "../src/background/dashboard-service.js";
import type { ExtensionConfig, ExtensionStatus } from "../src/shared/sync-types.js";

const config: ExtensionConfig = {
  serverUrl: "http://127.0.0.1:5032",
  collectorToken: "collector-token",
  tradeBridgeAccountEmail: "admin@example.com",
  sellerAccountExternalId: "seller-1",
  deviceId: "chrome-extension-demo"
};

test("readCachedDashboard returns cached status without network validation", () => {
  const status: ExtensionStatus = {
    accountValidation: {
      state: "valid",
      email: "cached@example.com",
      checkedAt: "2026-06-01T06:00:00.000Z"
    }
  };

  const dashboard = readCachedDashboard({ config, status });

  assert.deepEqual(dashboard, {
    tradeBridgeAccountEmail: "cached@example.com",
    status
  });
});

test("shouldRefreshAccountValidation refreshes missing and stale validation only", () => {
  const now = new Date("2026-06-01T06:10:00.000Z");

  assert.equal(shouldRefreshAccountValidation({}, now), true);
  assert.equal(
    shouldRefreshAccountValidation(
      {
        accountValidation: {
          state: "valid",
          checkedAt: "2026-06-01T06:09:00.000Z"
        }
      },
      now
    ),
    false
  );
  assert.equal(
    shouldRefreshAccountValidation(
      {
        accountValidation: {
          state: "valid",
          checkedAt: new Date(now.getTime() - ACCOUNT_VALIDATION_TTL_MS - 1).toISOString()
        }
      },
      now
    ),
    true
  );
});

test("refreshTradeBridgeAccountValidation stores valid account status", async () => {
  let saved: ExtensionStatus | null = null;

  const status = await refreshTradeBridgeAccountValidation({
    config,
    previousStatus: {},
    now: () => new Date("2026-06-01T06:12:00.000Z"),
    saveStatus: async (value) => {
      saved = value;
    },
    validateTradeBridgeAccount: async () => ({
      account: {
        id: "user_1",
        email: "admin@example.com",
        displayName: "Admin User",
        roles: ["admin"]
      },
      device: {
        id: "collector-device-1",
        externalDeviceId: "chrome-extension-demo",
        status: "active"
      }
    })
  });

  assert.deepEqual(status.accountValidation, {
    state: "valid",
    email: "admin@example.com",
    checkedAt: "2026-06-01T06:12:00.000Z",
    error: undefined
  });
  assert.deepEqual(saved, status);
});

test("refreshTradeBridgeAccountValidation stores mismatch as invalid", async () => {
  const status = await refreshTradeBridgeAccountValidation({
    config,
    previousStatus: {},
    now: () => new Date("2026-06-01T06:12:00.000Z"),
    saveStatus: async () => undefined,
    validateTradeBridgeAccount: async () => ({
      account: {
        id: "user_2",
        email: "other@example.com",
        displayName: "Other User",
        roles: ["admin"]
      },
      device: {
        id: "collector-device-1",
        externalDeviceId: "chrome-extension-demo",
        status: "active"
      }
    })
  });

  assert.equal(status.accountValidation?.state, "invalid");
  assert.equal(status.accountValidation?.email, "other@example.com");
  assert.equal(status.accountValidation?.error, "tradebridge_account_mismatch");
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge/apps/chrome-extension
node --import tsx --test test/dashboard-service.test.ts
```

预期：FAIL，报错 `Cannot find module '../src/background/dashboard-service.js'`。

- [ ] **步骤 3：创建 dashboard 服务**

创建 `apps/chrome-extension/src/background/dashboard-service.ts`：

```ts
import type { ExtensionDashboardResponse } from "../shared/extension-messages.js";
import type {
  CollectorAccountValidationResult,
  ExtensionConfig,
  ExtensionStatus
} from "../shared/sync-types.js";

export const ACCOUNT_VALIDATION_TTL_MS = 5 * 60 * 1000;

export interface ReadCachedDashboardInput {
  config: ExtensionConfig | null;
  status: ExtensionStatus;
}

export interface RefreshTradeBridgeAccountValidationInput {
  config: ExtensionConfig;
  previousStatus: ExtensionStatus;
  now?: () => Date;
  saveStatus(status: ExtensionStatus): Promise<void>;
  validateTradeBridgeAccount(input: {
    serverUrl: string;
    collectorToken: string;
    timeoutMs?: number;
  }): Promise<CollectorAccountValidationResult>;
}

export function readCachedDashboard(input: ReadCachedDashboardInput): ExtensionDashboardResponse {
  return {
    tradeBridgeAccountEmail: input.status.accountValidation?.email || input.config?.tradeBridgeAccountEmail,
    status: input.status
  };
}

export function shouldRefreshAccountValidation(
  status: ExtensionStatus,
  now: Date,
  ttlMs = ACCOUNT_VALIDATION_TTL_MS
): boolean {
  const checkedAt = status.accountValidation?.checkedAt;
  if (!checkedAt) return true;

  const checkedAtMs = Date.parse(checkedAt);
  if (!Number.isFinite(checkedAtMs)) return true;

  return now.getTime() - checkedAtMs > ttlMs;
}

export async function refreshTradeBridgeAccountValidation(
  input: RefreshTradeBridgeAccountValidationInput
): Promise<ExtensionStatus> {
  const now = input.now || (() => new Date());
  const checkedAt = now().toISOString();

  try {
    const result = await input.validateTradeBridgeAccount({
      serverUrl: input.config.serverUrl,
      collectorToken: input.config.collectorToken,
      timeoutMs: 3000
    });
    const accountEmail = result.account.email;
    const isMismatched =
      !!input.config.tradeBridgeAccountEmail &&
      input.config.tradeBridgeAccountEmail.trim().toLowerCase() !== accountEmail.trim().toLowerCase();
    const nextStatus: ExtensionStatus = {
      ...input.previousStatus,
      accountValidation: {
        state: isMismatched ? "invalid" : "valid",
        email: accountEmail,
        checkedAt,
        error: isMismatched ? "tradebridge_account_mismatch" : undefined
      }
    };
    await input.saveStatus(nextStatus);
    return nextStatus;
  } catch (error) {
    const nextStatus: ExtensionStatus = {
      ...input.previousStatus,
      accountValidation: {
        state: "invalid",
        email: input.config.tradeBridgeAccountEmail,
        checkedAt,
        error: error instanceof Error ? error.message : "tradebridge_account_validation_failed"
      }
    };
    await input.saveStatus(nextStatus);
    return nextStatus;
  }
}
```

- [ ] **步骤 4：接入 background 入口**

在 `apps/chrome-extension/src/background/index.ts` 中删除本地 `validateStoredTradeBridgeAccount()` 函数，改为：

```ts
import {
  readCachedDashboard,
  refreshTradeBridgeAccountValidation,
  shouldRefreshAccountValidation
} from "./dashboard-service.js";
```

替换 `readDashboard()`：

```ts
async function readDashboard() {
  const [config, status] = await Promise.all([stateStore.getConfig(), stateStore.getStatus()]);
  const dashboard = readCachedDashboard({ config, status });

  if (config && shouldRefreshAccountValidation(status, new Date())) {
    void refreshTradeBridgeAccountValidation({
      config,
      previousStatus: status,
      saveStatus: (nextStatus) => stateStore.saveStatus(nextStatus),
      validateTradeBridgeAccount
    });
  }

  return dashboard;
}
```

在 runtime message 分支中增加手动校验：

```ts
if (typed.type === "validate-account") {
  void validateAccountNow().then(sendResponse);
  return true;
}
```

并增加函数：

```ts
async function validateAccountNow(): Promise<{ ok: boolean; error?: string }> {
  const [config, status] = await Promise.all([stateStore.getConfig(), stateStore.getStatus()]);
  if (!config) return { ok: false, error: "collector_activation_required" };

  const nextStatus = await refreshTradeBridgeAccountValidation({
    config,
    previousStatus: status,
    saveStatus: (value) => stateStore.saveStatus(value),
    validateTradeBridgeAccount
  });
  return nextStatus.accountValidation?.state === "valid"
    ? { ok: true }
    : { ok: false, error: nextStatus.accountValidation?.error || "tradebridge_account_validation_failed" };
}
```

在 `apps/chrome-extension/src/shared/extension-messages.ts` 中扩展消息类型：

```ts
export type ExtensionMessage =
  | { type: "onetalk-page-ready"; url: string }
  | { type: "onetalk-login-required"; url: string }
  | { type: "send-onetalk-message"; message: OutboundMessage }
  | { type: "get-onetalk-im-token"; appKey: string; deviceId: string }
  | { type: "get-onetalk-customer-profiles"; contacts: OneTalkCustomerProfileContact[] }
  | { type: "get-onetalk-conversations"; cursor: number; count: number }
  | { type: "sync-now" }
  | { type: "realtime-reconnect" }
  | { type: "validate-account" }
  | { type: "open-options" }
  | { type: "read-status" }
  | { type: "read-dashboard" };

export interface ValidateAccountResponse {
  ok: boolean;
  error?: string;
}
```

- [ ] **步骤 5：运行测试验证通过**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge/apps/chrome-extension
node --import tsx --test test/dashboard-service.test.ts
npm run build -w @wangwang/chrome-extension
```

预期：新增测试 PASS，插件构建 PASS。

- [ ] **步骤 6：Commit**

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge
git add apps/chrome-extension/src/background/dashboard-service.ts apps/chrome-extension/test/dashboard-service.test.ts apps/chrome-extension/src/background/index.ts apps/chrome-extension/src/shared/extension-messages.ts
git commit -m "feat(chrome-extension): 缓存读取插件面板状态"
```

---

## 任务 3：popup 改成秒开并支持手动账号校验

**文件：**
- 修改：`apps/chrome-extension/src/popup/popup.html`
- 修改：`apps/chrome-extension/src/popup/popup.ts`
- 修改：`apps/chrome-extension/src/popup/popup-view.ts`
- 测试：`apps/chrome-extension/test/popup-view.test.ts`

- [ ] **步骤 1：编写失败的测试**

在 `apps/chrome-extension/test/popup-view.test.ts` 追加：

```ts
test("createPopupViewModel exposes manual account validation action", () => {
  const view = createPopupViewModel({
    tradeBridgeAccountEmail: "admin@example.com",
    status: {
      accountValidation: {
        state: "unknown"
      }
    }
  });

  assert.equal(view.accountValidationLabel, "账号校验：未验证");
  assert.equal(view.validateAccountActionLabel, "重新校验");
});

test("popup markup exposes account validation action", () => {
  const markup = fs.readFileSync(path.resolve("src/popup/popup.html"), "utf8");

  assert.equal(markup.includes('id="validate-account"'), true);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge/apps/chrome-extension
node --import tsx --test test/popup-view.test.ts
```

预期：FAIL，失败点是 `validateAccountActionLabel` 未定义或 markup 没有 `validate-account`。

- [ ] **步骤 3：更新 popup view model**

在 `apps/chrome-extension/src/popup/popup-view.ts` 中扩展接口：

```ts
export interface PopupViewModel {
  accountLabel: string;
  accountValidationLabel: string;
  realtimeLabel: string;
  syncLabel: string;
  errorLabel: string;
  headlineLabel: string;
  reconnectActionLabel: string;
  validateAccountActionLabel: string;
}
```

在返回值中增加：

```ts
validateAccountActionLabel: "重新校验"
```

- [ ] **步骤 4：更新 popup HTML 与 TS**

在 `apps/chrome-extension/src/popup/popup.html` 的 actions 区域增加按钮：

```html
<button id="validate-account" type="button">重新校验</button>
```

在 `apps/chrome-extension/src/popup/popup.ts` 增加事件处理：

```ts
document.querySelector<HTMLButtonElement>("#validate-account")?.addEventListener("click", async () => {
  accountValidation?.replaceChildren("账号校验：校验中...");
  const result = (await chromeApi.runtime.sendMessage({ type: "validate-account" })) as {
    ok: boolean;
    error?: string;
  };
  if (result.ok) {
    await renderStatus();
  } else {
    accountValidation?.replaceChildren(`账号校验：失效（${result.error || "tradebridge_account_validation_failed"}）`);
  }
});
```

在 `renderStatus()` 中更新按钮文案：

```ts
document.querySelector<HTMLButtonElement>("#validate-account")?.replaceChildren(view.validateAccountActionLabel);
```

- [ ] **步骤 5：运行测试验证通过**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge/apps/chrome-extension
node --import tsx --test test/popup-view.test.ts
npm run build -w @wangwang/chrome-extension
```

预期：popup view 测试 PASS，插件构建 PASS。

- [ ] **步骤 6：Commit**

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge
git add apps/chrome-extension/src/popup/popup.html apps/chrome-extension/src/popup/popup.ts apps/chrome-extension/src/popup/popup-view.ts apps/chrome-extension/test/popup-view.test.ts
git commit -m "feat(chrome-extension): 支持手动校验账号"
```

---

## 任务 4：升级 options 为可用配置面板

**文件：**
- 创建：`apps/chrome-extension/src/options/options-view.ts`
- 创建：`apps/chrome-extension/test/options-view.test.ts`
- 创建：`apps/chrome-extension/src/options/options.css`
- 修改：`apps/chrome-extension/src/options/options.html`
- 修改：`apps/chrome-extension/src/options/options.ts`
- 修改：`apps/chrome-extension/src/shared/chrome-api.ts`

- [ ] **步骤 1：编写失败的测试**

创建 `apps/chrome-extension/test/options-view.test.ts`：

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createOptionsViewModel } from "../src/options/options-view.js";

test("createOptionsViewModel shows activated account and server", () => {
  const view = createOptionsViewModel({
    config: {
      serverUrl: "http://127.0.0.1:5032",
      collectorToken: "collector-token",
      tradeBridgeAccountEmail: "admin@example.com",
      sellerAccountExternalId: "seller-1",
      deviceId: "chrome-extension-demo"
    },
    status: {
      accountValidation: {
        state: "valid",
        email: "admin@example.com",
        checkedAt: "2026-06-01T06:31:00.000Z"
      }
    }
  });

  assert.equal(view.accountLabel, "admin@example.com");
  assert.equal(view.serverLabel, "http://127.0.0.1:5032");
  assert.equal(view.activationLabel, "已激活");
  assert.equal(view.accountValidationLabel, "账号校验：已验证");
});

test("createOptionsViewModel shows inactive state", () => {
  const view = createOptionsViewModel({
    config: null,
    status: {}
  });

  assert.equal(view.accountLabel, "未激活");
  assert.equal(view.serverLabel, "未配置");
  assert.equal(view.activationLabel, "未激活");
});

test("options markup loads stylesheet and exposes reset and validation controls", () => {
  const markup = fs.readFileSync(path.resolve("src/options/options.html"), "utf8");

  assert.equal(markup.includes("./options.css"), true);
  assert.equal(markup.includes('id="current-account"'), true);
  assert.equal(markup.includes('id="validate-account"'), true);
  assert.equal(markup.includes('id="reset-config"'), true);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge/apps/chrome-extension
node --import tsx --test test/options-view.test.ts
```

预期：FAIL，报错 `Cannot find module '../src/options/options-view.js'`。

- [ ] **步骤 3：创建 options view model**

创建 `apps/chrome-extension/src/options/options-view.ts`：

```ts
import type { ExtensionConfig, ExtensionStatus } from "../shared/sync-types.js";

export interface OptionsViewInput {
  config: ExtensionConfig | null;
  status: ExtensionStatus;
}

export interface OptionsViewModel {
  accountLabel: string;
  serverLabel: string;
  activationLabel: string;
  accountValidationLabel: string;
}

export function createOptionsViewModel(input: OptionsViewInput): OptionsViewModel {
  return {
    accountLabel: input.status.accountValidation?.email || input.config?.tradeBridgeAccountEmail || "未激活",
    serverLabel: input.config?.serverUrl || "未配置",
    activationLabel: input.config ? "已激活" : "未激活",
    accountValidationLabel: accountValidationLabel(input.status)
  };
}

function accountValidationLabel(status: ExtensionStatus): string {
  const validation = status.accountValidation;
  if (!validation || validation.state === "unknown") return "账号校验：未验证";
  if (validation.state === "valid") return "账号校验：已验证";
  return `账号校验：失效（${validation.error || "tradebridge_account_validation_failed"}）`;
}
```

- [ ] **步骤 4：升级 options HTML**

替换 `apps/chrome-extension/src/options/options.html` 的 body 为：

```html
<body>
  <main class="options-shell">
    <section class="summary-panel" aria-label="当前状态">
      <div>
        <span class="label">状态</span>
        <strong id="activation-state">未激活</strong>
      </div>
      <div>
        <span class="label">账号</span>
        <strong id="current-account">未激活</strong>
      </div>
      <div>
        <span class="label">服务端</span>
        <strong id="current-server">未配置</strong>
      </div>
      <p id="account-validation">账号校验：未验证</p>
    </section>

    <form id="options-form" class="activation-form">
      <label>Server URL <input name="serverUrl" value="http://127.0.0.1:5032" /></label>
      <label>邮箱 <input name="email" type="email" autocomplete="username" /></label>
      <label>密码 <input name="password" type="password" autocomplete="current-password" /></label>
      <div class="actions">
        <button type="submit">激活采集端</button>
        <button id="validate-account" type="button">重新校验</button>
        <button id="reset-config" type="button">断开并重置</button>
      </div>
    </form>
    <p id="options-status"></p>
  </main>
  <script type="module" src="./options.ts"></script>
</body>
```

在 `<head>` 中加入：

```html
<link rel="stylesheet" href="./options.css" />
```

- [ ] **步骤 5：创建 options CSS**

创建 `apps/chrome-extension/src/options/options.css`：

```css
:root {
  color-scheme: light;
  font-family:
    ui-sans-serif,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  color: #172033;
  background: #f5f7fb;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #f5f7fb;
}

.options-shell {
  width: min(720px, calc(100vw - 32px));
  margin: 32px auto;
  display: grid;
  gap: 16px;
}

.summary-panel,
.activation-form {
  display: grid;
  gap: 12px;
  border: 1px solid #dce4f1;
  border-radius: 8px;
  padding: 16px;
  background: #ffffff;
}

.summary-panel {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.summary-panel p {
  grid-column: 1 / -1;
  margin: 0;
}

.label {
  display: block;
  color: #65738a;
  font-size: 12px;
  line-height: 1.4;
}

strong {
  display: block;
  margin-top: 4px;
  overflow-wrap: anywhere;
  font-size: 14px;
}

label {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: #303b4f;
}

input {
  min-height: 40px;
  border: 1px solid #cdd8e8;
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

button {
  min-height: 40px;
  border: 1px solid #cdd8e8;
  border-radius: 8px;
  padding: 0 14px;
  background: #ffffff;
  color: #172033;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

button[type="submit"] {
  border-color: #1e5eff;
  background: #1e5eff;
  color: #ffffff;
}

#options-status {
  min-height: 20px;
  margin: 0;
  color: #4e5a6f;
  font-size: 13px;
}
```

- [ ] **步骤 6：接入 options TS**

在 `apps/chrome-extension/src/shared/chrome-api.ts` 中扩展 storage 类型：

```ts
export interface ChromeStorageArea {
  get(keys?: string[] | Record<string, unknown> | string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}
```

在 `apps/chrome-extension/src/options/options.ts` 中加入 view model：

```ts
import { createOptionsViewModel } from "./options-view.js";
```

增加 DOM 引用：

```ts
const activationState = document.querySelector<HTMLElement>("#activation-state");
const currentAccount = document.querySelector<HTMLElement>("#current-account");
const currentServer = document.querySelector<HTMLElement>("#current-server");
const accountValidation = document.querySelector<HTMLElement>("#account-validation");
```

更新 `hydrate()`：

```ts
async function hydrate(): Promise<void> {
  const [config, extensionStatus] = await Promise.all([store.getConfig(), store.getStatus()]);
  currentConfig = config;
  renderSummary(config, extensionStatus);
  if (!form || !config) return;
  setInput("serverUrl", config.serverUrl);
  setInput("email", config.tradeBridgeAccountEmail);
}

function renderSummary(config: ExtensionConfig | null, extensionStatus: Awaited<ReturnType<typeof store.getStatus>>): void {
  const view = createOptionsViewModel({ config, status: extensionStatus });
  activationState?.replaceChildren(view.activationLabel);
  currentAccount?.replaceChildren(view.accountLabel);
  currentServer?.replaceChildren(view.serverLabel);
  accountValidation?.replaceChildren(view.accountValidationLabel);
}
```

增加按钮：

```ts
document.querySelector<HTMLButtonElement>("#validate-account")?.addEventListener("click", async () => {
  status?.replaceChildren("账号校验中...");
  const result = (await chromeApi.runtime.sendMessage({ type: "validate-account" })) as {
    ok: boolean;
    error?: string;
  };
  await hydrate();
  status?.replaceChildren(result.ok ? "账号已验证" : `账号校验失败：${activationErrorMessage(result.error || "")}`);
});

document.querySelector<HTMLButtonElement>("#reset-config")?.addEventListener("click", async () => {
  await chromeApi.storage.local.remove(["tradebridgeConfig", "tradebridgeStatus"]);
  currentConfig = null;
  await hydrate();
  status?.replaceChildren("已重置");
});
```

- [ ] **步骤 7：运行测试验证通过**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge/apps/chrome-extension
node --import tsx --test test/options-view.test.ts
npm run build -w @wangwang/chrome-extension
```

预期：options view 测试 PASS，插件构建 PASS。

- [ ] **步骤 8：Commit**

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge
git add apps/chrome-extension/src/options/options-view.ts apps/chrome-extension/test/options-view.test.ts apps/chrome-extension/src/options/options.css apps/chrome-extension/src/options/options.html apps/chrome-extension/src/options/options.ts apps/chrome-extension/src/shared/chrome-api.ts
git commit -m "feat(chrome-extension): 完善配置面板"
```

---

## 任务 5：启用本地高水位 cursor 与默认多页消息拉取

**文件：**
- 修改：`apps/chrome-extension/src/background/sync-orchestrator.ts`
- 测试：`apps/chrome-extension/test/sync-orchestrator.test.ts`

- [ ] **步骤 1：编写失败的测试**

在 `apps/chrome-extension/test/sync-orchestrator.test.ts` 中新增：

```ts
test("runSyncOnce passes previous cursor to mapper and skips older messages", async () => {
  const store = new MemoryStateStore();
  store.status = { nextCursor: "2026-06-01T06:30:00.000Z" };
  const uploaded: SyncBatch[] = [];

  const result = await runSyncOnce({
    now: () => new Date("2026-06-01T06:40:00.000Z"),
    stateStore: store,
    onetalkClient: {
      fetchWeblite: async () => ({
        html: "",
        bootstrap: { aliId: "self-ali" },
        conversations: [
          {
            singleChatUserConversation: {
              singleChatConversation: { cid: "conv-1", pairFirst: "self-ali", pairSecond: "buyer-ali" }
            }
          }
        ]
      }),
      getChatMessages: async () => ({
        status: 200,
        contentType: "application/lwp+json",
        code: 200,
        raw: {},
        messages: [
          {
            message: {
              messageId: "old-message",
              cid: "conv-1",
              sender: { uid: "buyer-ali" },
              content: { text: { content: "old" } },
              createAt: Date.parse("2026-06-01T06:20:00.000Z")
            }
          },
          {
            message: {
              messageId: "new-message",
              cid: "conv-1",
              sender: { uid: "buyer-ali" },
              content: { text: { content: "new" } },
              createAt: Date.parse("2026-06-01T06:35:00.000Z")
            }
          }
        ]
      })
    },
    uploadSyncBatch: async (options) => {
      uploaded.push(options.batch);
      return {
        acceptedCount: options.batch.messages?.length || 0,
        rejectedCount: 0,
        nextCursor: "2026-06-01T06:35:00.000Z",
        warnings: []
      };
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(uploaded[0].messages?.map((message) => message.externalMessageId), ["new-message"]);
  assert.deepEqual(uploaded[0].cursor, { previousCursor: "2026-06-01T06:30:00.000Z" });
});

test("runSyncOnce fetches multiple pages by default for each conversation", async () => {
  const store = new MemoryStateStore();
  const beforeValues: Array<number | null> = [];

  await runSyncOnce({
    pageSize: 1,
    now: () => new Date("2026-06-01T06:40:00.000Z"),
    stateStore: store,
    onetalkClient: {
      fetchWeblite: async () => ({
        html: "",
        bootstrap: { aliId: "self-ali" },
        conversations: [
          {
            singleChatUserConversation: {
              singleChatConversation: { cid: "conv-1", pairFirst: "self-ali", pairSecond: "buyer-ali" }
            }
          }
        ]
      }),
      getChatMessages: async ({ before }) => {
        beforeValues.push(before);
        return {
          status: 200,
          contentType: "application/lwp+json",
          code: 200,
          raw: {},
          messages: [
            {
              message: {
                messageId: `message-${beforeValues.length}`,
                cid: "conv-1",
                sender: { uid: "buyer-ali" },
                content: { text: { content: "hello" } },
                createAt: Date.parse("2026-06-01T06:35:00.000Z") - beforeValues.length
              }
            }
          ]
        };
      }
    },
    uploadSyncBatch: async () => ({
      acceptedCount: 0,
      rejectedCount: 0,
      nextCursor: null,
      warnings: []
    })
  });

  assert.deepEqual(beforeValues.length, 3);
  assert.equal(beforeValues[0], null);
  assert.equal(typeof beforeValues[1], "number");
  assert.equal(typeof beforeValues[2], "number");
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge/apps/chrome-extension
node --import tsx --test test/sync-orchestrator.test.ts
```

预期：第一条新增测试 FAIL，上传消息包含 `old-message`；第二条新增测试 FAIL，`beforeValues.length` 为 `1`。

- [ ] **步骤 3：实现 cursor 与默认多页**

在 `apps/chrome-extension/src/background/sync-orchestrator.ts` 顶部增加：

```ts
const DEFAULT_MAX_PAGES_PER_CONVERSATION = 3;
```

修改 `maxPages`：

```ts
const maxPages = options.maxPagesPerConversation ?? DEFAULT_MAX_PAGES_PER_CONVERSATION;
```

修改 mapper 入参：

```ts
previousCursor: previousStatus.nextCursor ?? null,
```

- [ ] **步骤 4：运行测试验证通过**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge/apps/chrome-extension
node --import tsx --test test/sync-orchestrator.test.ts
```

预期：`sync-orchestrator.test.ts` 全部 PASS。

- [ ] **步骤 5：Commit**

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge
git add apps/chrome-extension/src/background/sync-orchestrator.ts apps/chrome-extension/test/sync-orchestrator.test.ts
git commit -m "feat(chrome-extension): 启用同步高水位"
```

---

## 任务 6：WS ready 超时和 heartbeat 失活判断

**文件：**
- 修改：`apps/chrome-extension/src/background/tradebridge-ws-client.ts`
- 测试：`apps/chrome-extension/test/tradebridge-ws-client.test.ts`

- [ ] **步骤 1：编写失败的测试**

在 `apps/chrome-extension/test/tradebridge-ws-client.test.ts` 追加：

```ts
test("TradeBridgeWsClient rejects connect when ready times out", async () => {
  const sockets: FakeWebSocket[] = [];
  let timeoutHandler: (() => void) | null = null;
  const client = new TradeBridgeWsClient({
    socketFactory: (url) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
    setTimeout: (handler) => {
      timeoutHandler = handler;
      return 1;
    },
    clearTimeout: () => undefined,
    setInterval: () => 1,
    clearInterval: () => undefined,
    readyTimeoutMs: 1000
  });

  const ready = client.connect({
    serverUrl: "http://127.0.0.1:5032",
    collectorToken: "collector-token",
    sellerAccountExternalId: "seller-1",
    deviceId: "device-1"
  });
  sockets[0].open();
  timeoutHandler?.();

  await assert.rejects(ready, /collector_ws_ready_timeout/);
  assert.deepEqual(client.state, { kind: "error", error: "collector_ws_ready_timeout" });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge/apps/chrome-extension
node --import tsx --test test/tradebridge-ws-client.test.ts
```

预期：TypeScript 或运行时报错，`setTimeout`、`clearTimeout`、`readyTimeoutMs` 选项不存在。

- [ ] **步骤 3：扩展 WS client options**

在 `apps/chrome-extension/src/background/tradebridge-ws-client.ts` 的 options 中增加：

```ts
  readyTimeoutMs?: number;
  setTimeout?: (handler: () => void, timeoutMs: number) => unknown;
  clearTimeout?: (timerId: unknown) => void;
```

在 class 中增加：

```ts
private readyTimeoutId: unknown = null;
```

在 `connect()` Promise 内、`socket.onopen` 之前设置 ready timeout：

```ts
const readyTimeoutMs = this.options.readyTimeoutMs ?? 10_000;
const setTimeoutFn = this.options.setTimeout || globalThis.setTimeout;
this.readyTimeoutId = setTimeoutFn(() => {
  this.setState({ kind: "error", error: "collector_ws_ready_timeout" });
  if (!resolved) reject(new Error("collector_ws_ready_timeout"));
  this.close();
}, readyTimeoutMs);
```

在收到 `collector.ready` 前清理：

```ts
this.clearReadyTimeout();
```

增加方法：

```ts
private clearReadyTimeout(): void {
  if (this.readyTimeoutId == null) return;
  if (this.options.clearTimeout) this.options.clearTimeout(this.readyTimeoutId);
  else globalThis.clearTimeout(this.readyTimeoutId as ReturnType<typeof globalThis.setTimeout>);
  this.readyTimeoutId = null;
}
```

在 `close()` 开头调用：

```ts
this.clearReadyTimeout();
```

- [ ] **步骤 4：运行测试验证通过**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge/apps/chrome-extension
node --import tsx --test test/tradebridge-ws-client.test.ts
```

预期：`tradebridge-ws-client.test.ts` 全部 PASS。

- [ ] **步骤 5：Commit**

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge
git add apps/chrome-extension/src/background/tradebridge-ws-client.ts apps/chrome-extension/test/tradebridge-ws-client.test.ts
git commit -m "feat(chrome-extension): 增强 websocket 超时处理"
```

---

## 任务 7：临时发信失败改为 deferred，不立即标记服务端 failed

**文件：**
- 修改：`apps/chrome-extension/src/background/outbound-orchestrator.ts`
- 测试：`apps/chrome-extension/test/outbound-orchestrator.test.ts`

- [ ] **步骤 1：编写失败的测试**

替换 `apps/chrome-extension/test/outbound-orchestrator.test.ts` 中 “no OneTalk tab is open” 测试为：

```ts
test("runOutboundDelivery defers queued messages when no OneTalk tab is open", async () => {
  const store = new MemoryStateStore();
  const delivered: Array<{ status: string; errorCode?: string }> = [];

  const result = await runOutboundDelivery({
    stateStore: store,
    chromeApi: fakeChromeApi([], { ok: false }, []),
    listOutboundMessages: async () => [outboundMessage()],
    markOutboundMessageDelivered: async (options) => {
      delivered.push(options);
      return { ...outboundMessage(), status: options.status, errorCode: options.errorCode };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.sentCount, 0);
  assert.equal(result.failedCount, 0);
  assert.equal(result.deferredCount, 1);
  assert.deepEqual(delivered, []);
  assert.equal(store.status.lastError?.code, "outbound_send_deferred");
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge/apps/chrome-extension
node --import tsx --test test/outbound-orchestrator.test.ts
```

预期：FAIL，当前实现会把消息标记为 `failed` 并调用 `markOutboundMessageDelivered`。

- [ ] **步骤 3：扩展 outbound 类型和临时错误判定**

在 `apps/chrome-extension/src/background/outbound-orchestrator.ts` 中修改类型：

```ts
export interface RunOutboundDeliveryResult {
  ok: boolean;
  sentCount?: number;
  failedCount?: number;
  deferredCount?: number;
  error?: string;
}

export interface OutboundDeliveryReport {
  outboundMessageId: string;
  status: "sent" | "failed" | "deferred";
  externalMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}
```

增加临时错误判定：

```ts
function isTransientSendError(error?: string): boolean {
  return error === "onetalk_tab_required" || error === "chrome_tabs_unavailable" || error === "onetalk_send_timeout";
}
```

在 `sendOutboundMessagesViaOneTalk()` 失败分支中改为：

```ts
const errorCode = result.error || "onetalk_send_failed";
reports.push({
  outboundMessageId: message.id,
  status: isTransientSendError(errorCode) ? "deferred" : "failed",
  errorCode,
  errorMessage: result.error || "OneTalk send failed"
});
```

在 `runOutboundDelivery()` 循环中跳过 deferred 上报：

```ts
let deferredCount = 0;

for (const report of reports) {
  if (report.status === "deferred") {
    deferredCount += 1;
    continue;
  }
  await options.markOutboundMessageDelivered({
    serverUrl: config.serverUrl,
    collectorToken: config.collectorToken,
    outboundMessageId: report.outboundMessageId,
    status: report.status,
    externalMessageId: report.externalMessageId,
    errorCode: report.errorCode,
    errorMessage: report.errorMessage,
    deliveredAt: new Date().toISOString()
  });
  if (report.status === "sent") sentCount += 1;
  else failedCount += 1;
}
```

保存状态改为：

```ts
await options.stateStore.saveStatus({
  ...previousStatus,
  lastError:
    failedCount > 0
      ? { code: "outbound_send_partial_failed", message: "outbound_send_partial_failed" }
      : deferredCount > 0
        ? { code: "outbound_send_deferred", message: "outbound_send_deferred" }
        : undefined
});
return { ok: failedCount === 0 && deferredCount === 0, sentCount, failedCount, deferredCount };
```

- [ ] **步骤 4：运行测试验证通过**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge/apps/chrome-extension
node --import tsx --test test/outbound-orchestrator.test.ts
```

预期：`outbound-orchestrator.test.ts` 全部 PASS。

- [ ] **步骤 5：Commit**

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge
git add apps/chrome-extension/src/background/outbound-orchestrator.ts apps/chrome-extension/test/outbound-orchestrator.test.ts
git commit -m "feat(chrome-extension): 延后处理临时发信失败"
```

---

## 任务 8：为自定义服务端 URL 申请运行时权限

**文件：**
- 创建：`apps/chrome-extension/src/shared/server-permissions.ts`
- 创建：`apps/chrome-extension/test/server-permissions.test.ts`
- 修改：`apps/chrome-extension/src/shared/chrome-api.ts`
- 修改：`apps/chrome-extension/src/options/options.ts`
- 修改：`apps/chrome-extension/public/manifest.json`
- 修改：`apps/chrome-extension/test/manifest.test.ts`

- [ ] **步骤 1：编写失败的测试**

创建 `apps/chrome-extension/test/server-permissions.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { serverPermissionOrigins } from "../src/shared/server-permissions.js";

test("serverPermissionOrigins maps http server url to http and ws origins", () => {
  assert.deepEqual(serverPermissionOrigins("http://127.0.0.1:5032"), [
    "http://127.0.0.1:5032/*",
    "ws://127.0.0.1:5032/*"
  ]);
});

test("serverPermissionOrigins maps https server url to https and wss origins", () => {
  assert.deepEqual(serverPermissionOrigins("https://tradebridge.example.com/api"), [
    "https://tradebridge.example.com/*",
    "wss://tradebridge.example.com/*"
  ]);
});
```

在 `apps/chrome-extension/test/manifest.test.ts` 中增加：

```ts
assert.ok(manifest.optional_host_permissions?.includes("http://*/*"));
assert.ok(manifest.optional_host_permissions?.includes("https://*/*"));
assert.ok(manifest.optional_host_permissions?.includes("ws://*/*"));
assert.ok(manifest.optional_host_permissions?.includes("wss://*/*"));
```

并给 manifest 类型加字段：

```ts
optional_host_permissions?: string[];
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge/apps/chrome-extension
node --import tsx --test test/server-permissions.test.ts test/manifest.test.ts
```

预期：FAIL，`server-permissions.js` 不存在且 manifest 缺少 optional permissions。

- [ ] **步骤 3：创建 server permissions 工具**

创建 `apps/chrome-extension/src/shared/server-permissions.ts`：

```ts
export function serverPermissionOrigins(serverUrl: string): string[] {
  const httpUrl = new URL(serverUrl);
  httpUrl.pathname = "/";
  httpUrl.search = "";
  httpUrl.hash = "";

  const wsUrl = new URL(httpUrl.toString());
  wsUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";

  return [`${httpUrl.origin}/*`, `${wsUrl.origin}/*`];
}
```

- [ ] **步骤 4：扩展 ChromeApi 类型**

在 `apps/chrome-extension/src/shared/chrome-api.ts` 中给 `ChromeApi` 增加：

```ts
  permissions?: {
    request(input: { origins?: string[] }): Promise<boolean>;
  };
```

- [ ] **步骤 5：更新 manifest**

在 `apps/chrome-extension/public/manifest.json` 中增加：

```json
"optional_host_permissions": ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"]
```

- [ ] **步骤 6：激活前申请权限**

在 `apps/chrome-extension/src/options/options.ts` 中导入：

```ts
import { serverPermissionOrigins } from "../shared/server-permissions.js";
```

在 `activateCollectorDevice()` 前加入：

```ts
const granted = await chromeApi.permissions?.request({
  origins: serverPermissionOrigins(serverUrl)
});
if (granted === false) throw new Error("server_permission_denied");
```

在 `activationErrorMessage()` 中增加：

```ts
server_permission_denied: "未授权访问该服务端地址"
```

- [ ] **步骤 7：运行测试验证通过**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge/apps/chrome-extension
node --import tsx --test test/server-permissions.test.ts test/manifest.test.ts
npm run build -w @wangwang/chrome-extension
```

预期：权限工具测试 PASS，manifest 测试 PASS，插件构建 PASS。

- [ ] **步骤 8：Commit**

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge
git add apps/chrome-extension/src/shared/server-permissions.ts apps/chrome-extension/test/server-permissions.test.ts apps/chrome-extension/src/shared/chrome-api.ts apps/chrome-extension/src/options/options.ts apps/chrome-extension/public/manifest.json apps/chrome-extension/test/manifest.test.ts
git commit -m "feat(chrome-extension): 支持自定义服务端权限"
```

---

## 任务 9：最终回归验证

**文件：**
- 修改：无
- 测试：所有 Chrome 插件相关测试、构建、空白检查

- [ ] **步骤 1：运行 Chrome 插件完整测试**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge
npm run test -w @wangwang/chrome-extension
```

预期：全部测试 PASS，输出包含 `# fail 0`。

- [ ] **步骤 2：运行插件构建**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge
npm run build -w @wangwang/chrome-extension
```

预期：`tsc` 和 `vite build` 均成功，输出包含 `✓ built`。

- [ ] **步骤 3：运行服务端与数据库相关回归**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge
npm run test -w @wangwang/database
npm run test -w @wangwang/server
```

预期：两个包均 PASS，输出均包含 `# fail 0`。

- [ ] **步骤 4：检查 diff 空白**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge
git diff --check
```

预期：无输出，退出码为 0。

- [ ] **步骤 5：查看工作区**

运行：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge
git status --short
```

预期：只出现本计划相关文件变更和此前已知的插件账号展示/账号校验变更；没有意外删除文件。

- [ ] **步骤 6：Commit**

如果任务 1 到任务 8 已经逐任务 commit，本步骤只提交计划或收尾修正：

```bash
cd /Users/wait9yan/projects/app/xiezi/tradebridge
git add docs/superpowers/plans/2026-06-01-chrome-extension-completion.md
git commit -m "docs(chrome-extension): 补充插件完成度计划"
```

如果用户要求不提交，则跳过 commit 并在交付回复中列出验证命令输出摘要。

---

## 自检结果

**规格覆盖度：**
- 状态覆盖问题：任务 1 覆盖。
- popup 延迟与账号校验：任务 2、任务 3 覆盖。
- options 面板简陋：任务 4 覆盖。
- 增量同步和分页：任务 5 覆盖。
- WS 稳定性：任务 6 覆盖。
- outbound 临时失败语义：任务 7 覆盖。
- 自定义服务端权限：任务 8 覆盖。
- 最终验证：任务 9 覆盖。

**占位符扫描：**
- 已按技能要求扫描，未发现禁止写法。
- 每个涉及代码变更的步骤都包含具体代码片段和命令。

**类型一致性：**
- `validate-account` 消息在 `extension-messages.ts`、popup、options、background 中名称一致。
- `ExtensionStatus.accountValidation` 沿用现有字段。
- `OutboundDeliveryReport.status` 扩展为 `"sent" | "failed" | "deferred"`，只在插件内部使用，不改变服务端 delivery API。
