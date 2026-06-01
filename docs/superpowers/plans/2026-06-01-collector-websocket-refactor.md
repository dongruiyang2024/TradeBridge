# Collector WebSocket 双向连接重构实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 Chrome 插件与 TradeBridge server 之间的 outbound 投递主路径从分钟级 HTTP 轮询改成秒级 WebSocket 双向连接，并保留现有 HTTP collector API 作为兜底。

**架构：** 新增共享 collector WS 协议包，server 使用 `@fastify/websocket` 暴露 `/collector/v1/ws`，插件在 MV3 service worker 中维护带 heartbeat 的 WS client。server 通过 WS 推送 `outbound.available`，插件通过 WS claim 消息、发送 OneTalk、回写 delivery report；现有 sync batch 上传第一版继续走 HTTP，WS 只负责触发 `sync.request` 与状态上报。

**技术栈：** TypeScript、Fastify 5、`@fastify/websocket`、Chrome Extension Manifest V3、浏览器原生 `WebSocket`、Node test runner、Postgres/InMemory sync store。

---

## 范围决策

- 一期 WS 覆盖：collector 鉴权、heartbeat、连接状态、server 推送 outbound 可用事件、插件 claim outbound、插件 delivery report、server 请求插件尽快同步。
- 一期保留 HTTP：`POST /collector/v1/sync-batches` 继续负责批量同步上传，`GET /collector/v1/outbound-messages` 和 delivery HTTP endpoint 继续作为 alarm fallback。
- 一期不做二进制帧、不做 sync batch 分片、不做跨 server 实例广播。单进程 server 使用内存 hub；多实例部署前再接 Redis pub/sub 或 Postgres `LISTEN/NOTIFY`。
- 一期要求 Chrome 116+。Chrome 官方说明 Chrome 116 起 extension service worker 可通过 WS 消息活动保持活跃；本实现使用 20 秒 client keepalive，并保留 alarm watchdog。
- 鉴权不把 collector token 放 URL。插件连接 WS 后第一帧发送 `collector.hello`，server 鉴权成功后才注册 session。
- outbound 必须加入 claim/lease，避免多个插件或 service worker 重连时重复发送同一条消息。

## 参考资料

- Chrome Extensions：Use WebSockets in service workers，说明 Chrome 116+ 与 20 秒 keepalive 方式。
  https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets
- Chrome Extensions：Extension service worker lifecycle，说明 service worker 生命周期和 alarm 行为。
  https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- `@fastify/websocket` README，说明 `websocket: true` route、同步注册 message handler、`injectWS` 测试能力。
  https://github.com/fastify/fastify-websocket

## 文件结构

- 创建：`packages/collector-protocol/package.json`
  - 新增 workspace 包，供 server 与 Chrome 插件共享 WS envelope、消息类型、runtime parser。
- 创建：`packages/collector-protocol/tsconfig.json`
  - 继承根 TS 配置，输出 `dist`。
- 创建：`packages/collector-protocol/src/index.ts`
  - 定义 `CollectorWsMessage` union、message builder、parser、type guard、错误码常量。
- 创建：`packages/collector-protocol/test/collector-protocol.test.ts`
  - 覆盖协议解析、非法消息拒绝、outbound claim/delivery 消息构造。
- 修改：`package.json`
  - 根 `build`、`typecheck` 增加 `@wangwang/collector-protocol`。
- 修改：`apps/server/package.json`
  - 增加 `@fastify/websocket`、`@wangwang/collector-protocol`，dev dependency 增加 `@types/ws`。
- 修改：`apps/chrome-extension/package.json`
  - 增加 `@wangwang/collector-protocol`。

- 修改：`packages/database/src/sync-types.ts`
  - 增加 outbound claim 字段与 `ClaimPendingOutboundMessagesInput`。
- 修改：`packages/database/src/sync-store.ts`
  - InMemory store 实现 claim/lease。
- 修改：`packages/database/src/postgres-sync-store.ts`
  - Postgres store 实现 claim/lease，使用 `FOR UPDATE SKIP LOCKED`。
- 修改：`packages/database/src/migrations.ts`
  - 注册 `003_outbound_message_claim_lease.sql`。
- 创建：`packages/database/migrations/003_outbound_message_claim_lease.sql`
  - 为 `outbound_message` 增加 claim 字段和 claimable index。
- 修改：`packages/database/test/sync-store.test.ts`
  - 覆盖 claim、重复 claim 拦截、lease 过期后可重新 claim。
- 修改：`packages/database/test/postgres-sync-store.test.ts`
  - 覆盖 Postgres claim 返回字段与不重复领取。
- 修改：`packages/database/test/migrations.test.ts`
  - 覆盖第三个 migration 顺序与 SQL 内容。

- 创建：`apps/server/src/collector-realtime-hub.ts`
  - 管理在线 collector session，按 seller 推送 WS 消息。
- 创建：`apps/server/src/collector-ws.ts`
  - 注册 `/collector/v1/ws`，处理 hello、heartbeat、outbound claim、delivery report、sync status。
- 修改：`apps/server/src/server.ts`
  - 注册 websocket plugin 与 collector WS route；internal outbound 创建成功后通知 hub。
- 创建：`apps/server/test/collector-realtime-hub.test.ts`
  - 使用 fake socket 覆盖 session 注册、seller 推送、close 清理。
- 创建：`apps/server/test/collector-ws.test.ts`
  - 使用 `injectWS` 覆盖 hello 鉴权、outbound claim、delivery report、非法 payload。
- 修改：`apps/server/test/sync-batches.test.ts`
  - 确认 HTTP fallback 仍可领取未 claim 或 claim 过期的 outbound。

- 创建：`apps/chrome-extension/src/background/tradebridge-ws-client.ts`
  - 浏览器 WS client，负责 URL 转换、hello、请求/响应关联、keepalive、重连。
- 创建：`apps/chrome-extension/src/background/realtime-orchestrator.ts`
  - 把 WS 事件转成 outbound claim、OneTalk 发送、delivery report、sync request。
- 修改：`apps/chrome-extension/src/background/outbound-orchestrator.ts`
  - 抽出可复用的 `sendOutboundMessagesViaOneTalk()`，HTTP polling 与 WS claim 共用发送逻辑。
- 修改：`apps/chrome-extension/src/background/index.ts`
  - 启动 realtime orchestrator；保留原 alarm 作为 fallback/watchdog。
- 修改：`apps/chrome-extension/src/background/storage.ts`
  - 扩展 `ExtensionStatus` 的 WS 状态存储读写。
- 修改：`apps/chrome-extension/src/shared/chrome-api.ts`
  - 增加 `runtime.onStartup`、`alarms.clear` 或本计划需要的最小 Chrome API 类型。
- 修改：`apps/chrome-extension/src/shared/extension-messages.ts`
  - 增加 `realtime-reconnect`、`read-status` 响应中 WS 状态字段。
- 修改：`apps/chrome-extension/src/shared/sync-types.ts`
  - 扩展 `ExtensionStatus`：`realtime` 状态、最近连接时间、最近错误、重连次数。
- 修改：`apps/chrome-extension/src/options/options.ts`
  - 激活成功保存 config 后通知 background 立即重连 WS。
- 修改：`apps/chrome-extension/src/popup/popup.ts`
  - 展示 WS 连接状态与最近错误。
- 修改：`apps/chrome-extension/public/manifest.json`
  - 增加 `minimum_chrome_version: "116"`，host permissions 增加本地 `ws://127.0.0.1:5032/*`。
- 创建：`apps/chrome-extension/test/tradebridge-ws-client.test.ts`
  - 使用 fake WebSocket 覆盖 URL 转换、hello、ready、keepalive、重连。
- 创建：`apps/chrome-extension/test/realtime-orchestrator.test.ts`
  - 覆盖 `outbound.available` 到 claim，再到 OneTalk 发送和 delivery report。
- 修改：`apps/chrome-extension/test/outbound-orchestrator.test.ts`
  - 覆盖抽出的 send-only 函数。
- 修改：`apps/chrome-extension/test/manifest.test.ts`
  - 覆盖 Chrome 最低版本与 WS host permission。
- 修改：`apps/chrome-extension/test/tradebridge-client.test.ts`
  - 保持 HTTP fallback 测试不变，新增 claim 时 HTTP list 不应读取 active claimed 消息的服务端测试放在 server/database。

## 任务 1：创建共享 collector WS 协议包

**文件：**
- 创建：`packages/collector-protocol/package.json`
- 创建：`packages/collector-protocol/tsconfig.json`
- 创建：`packages/collector-protocol/src/index.ts`
- 创建：`packages/collector-protocol/test/collector-protocol.test.ts`
- 修改：`package.json`

- [ ] **步骤 1：编写失败的协议测试**

创建 `packages/collector-protocol/test/collector-protocol.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCollectorWsMessage,
  isCollectorHelloMessage,
  isOutboundClaimMessage,
  parseCollectorWsMessage
} from "../src/index.js";

test("collector protocol parses hello and outbound claim messages", () => {
  const hello = parseCollectorWsMessage(
    JSON.stringify({
      v: 1,
      id: "msg-1",
      type: "collector.hello",
      sentAt: "2026-06-01T00:00:00.000Z",
      payload: {
        collectorToken: "collector-token",
        deviceId: "device-1",
        deviceName: "Chrome Extension",
        capabilities: ["outbound.claim", "delivery.report"]
      }
    })
  );

  assert.equal(isCollectorHelloMessage(hello), true);
  assert.equal(hello.payload.collectorToken, "collector-token");

  const claim = parseCollectorWsMessage(
    JSON.stringify({
      v: 1,
      id: "msg-2",
      type: "outbound.claim",
      sentAt: "2026-06-01T00:00:01.000Z",
      payload: { limit: 10, leaseMs: 120000 }
    })
  );

  assert.equal(isOutboundClaimMessage(claim), true);
  assert.equal(claim.payload.limit, 10);
});

test("collector protocol rejects invalid payloads", () => {
  assert.throws(() => parseCollectorWsMessage("not-json"), /collector_ws_invalid_json/);
  assert.throws(
    () => parseCollectorWsMessage(JSON.stringify({ v: 1, id: "x", type: "collector.hello", payload: {} })),
    /collector_ws_invalid_message/
  );
});

test("collector protocol builds typed messages with timestamps", () => {
  const message = buildCollectorWsMessage({
    id: "server-1",
    type: "outbound.available",
    sentAt: "2026-06-01T00:00:02.000Z",
    payload: {
      sellerAccountExternalId: "seller-1",
      pendingCount: 2
    }
  });

  assert.deepEqual(message, {
    v: 1,
    id: "server-1",
    type: "outbound.available",
    sentAt: "2026-06-01T00:00:02.000Z",
    payload: {
      sellerAccountExternalId: "seller-1",
      pendingCount: 2
    }
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
npm run test -w @wangwang/collector-protocol
```

预期：FAIL，报错包含 `No workspaces found` 或 `Cannot find module '../src/index.js'`。

- [ ] **步骤 3：创建 package 与协议实现**

创建 `packages/collector-protocol/package.json`：

```json
{
  "name": "@wangwang/collector-protocol",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "test": "node --import tsx --test test/*.test.ts",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.7.3"
  }
}
```

创建 `packages/collector-protocol/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"]
}
```

创建 `packages/collector-protocol/src/index.ts`：

```ts
export const COLLECTOR_WS_VERSION = 1;

export type CollectorWsMessage =
  | CollectorHelloMessage
  | CollectorReadyMessage
  | HeartbeatPingMessage
  | HeartbeatPongMessage
  | OutboundAvailableMessage
  | OutboundClaimMessage
  | OutboundClaimedMessage
  | OutboundDeliveryReportMessage
  | SyncRequestMessage
  | CollectorStatusMessage
  | CollectorAckMessage
  | CollectorErrorMessage;

export interface CollectorWsEnvelope<TType extends string, TPayload> {
  v: 1;
  id: string;
  type: TType;
  sentAt: string;
  payload: TPayload;
}

export type CollectorHelloMessage = CollectorWsEnvelope<
  "collector.hello",
  {
    collectorToken: string;
    deviceId: string;
    deviceName?: string;
    capabilities: string[];
  }
>;

export type CollectorReadyMessage = CollectorWsEnvelope<
  "collector.ready",
  {
    sessionId: string;
    sellerAccountExternalId: string;
    deviceId: string;
    heartbeatIntervalMs: number;
    serverTime: string;
  }
>;

export type HeartbeatPingMessage = CollectorWsEnvelope<"heartbeat.ping", { nonce: string }>;
export type HeartbeatPongMessage = CollectorWsEnvelope<"heartbeat.pong", { nonce: string; status?: string }>;

export type OutboundAvailableMessage = CollectorWsEnvelope<
  "outbound.available",
  {
    sellerAccountExternalId: string;
    pendingCount: number;
  }
>;

export type OutboundClaimMessage = CollectorWsEnvelope<"outbound.claim", { limit: number; leaseMs: number }>;

export type OutboundClaimedMessage = CollectorWsEnvelope<
  "outbound.claimed",
  {
    requestId: string;
    leaseMs: number;
    messages: CollectorOutboundMessage[];
  }
>;

export type OutboundDeliveryReportMessage = CollectorWsEnvelope<
  "outbound.delivery.report",
  {
    outboundMessageId: string;
    status: "sent" | "failed";
    externalMessageId?: string;
    errorCode?: string;
    errorMessage?: string;
    deliveredAt: string;
  }
>;

export type SyncRequestMessage = CollectorWsEnvelope<
  "sync.request",
  {
    reason: "server-request" | "outbound-delivered" | "watchdog";
  }
>;

export type CollectorStatusMessage = CollectorWsEnvelope<
  "collector.status",
  {
    connectedToOneTalk: boolean;
    lastSyncedAt?: string;
    lastErrorCode?: string;
  }
>;

export type CollectorAckMessage = CollectorWsEnvelope<"ack", { requestId: string }>;
export type CollectorErrorMessage = CollectorWsEnvelope<"error", { requestId?: string; code: string; message: string }>;

export interface CollectorOutboundMessage {
  id: string;
  sellerAccountExternalId: string;
  externalCustomerId: string;
  externalConversationId: string;
  content: string;
  status: "queued" | "sent" | "failed";
  createdByUserId?: string;
  deliveredByDeviceId?: string;
  externalMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  claimedByDeviceId?: string;
  claimExpiresAt?: string;
}

export function buildCollectorWsMessage<T extends CollectorWsMessage>(input: Omit<T, "v">): T {
  return { v: COLLECTOR_WS_VERSION, ...input } as T;
}

export function serializeCollectorWsMessage(message: CollectorWsMessage): string {
  return JSON.stringify(message);
}

export function parseCollectorWsMessage(text: string): CollectorWsMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("collector_ws_invalid_json");
  }
  if (!isCollectorWsMessage(parsed)) {
    throw new Error("collector_ws_invalid_message");
  }
  return parsed;
}

export function isCollectorHelloMessage(message: CollectorWsMessage): message is CollectorHelloMessage {
  return message.type === "collector.hello";
}

export function isOutboundClaimMessage(message: CollectorWsMessage): message is OutboundClaimMessage {
  return message.type === "outbound.claim";
}

export function isOutboundDeliveryReportMessage(message: CollectorWsMessage): message is OutboundDeliveryReportMessage {
  return message.type === "outbound.delivery.report";
}

function isCollectorWsMessage(value: unknown): value is CollectorWsMessage {
  if (!isRecord(value)) return false;
  if (value.v !== COLLECTOR_WS_VERSION) return false;
  if (typeof value.id !== "string" || typeof value.type !== "string" || typeof value.sentAt !== "string") return false;
  if (!isRecord(value.payload)) return false;

  switch (value.type) {
    case "collector.hello":
      return (
        typeof value.payload.collectorToken === "string" &&
        typeof value.payload.deviceId === "string" &&
        Array.isArray(value.payload.capabilities) &&
        value.payload.capabilities.every((item) => typeof item === "string")
      );
    case "collector.ready":
      return (
        typeof value.payload.sessionId === "string" &&
        typeof value.payload.sellerAccountExternalId === "string" &&
        typeof value.payload.deviceId === "string" &&
        typeof value.payload.heartbeatIntervalMs === "number" &&
        typeof value.payload.serverTime === "string"
      );
    case "heartbeat.ping":
    case "heartbeat.pong":
      return typeof value.payload.nonce === "string";
    case "outbound.available":
      return (
        typeof value.payload.sellerAccountExternalId === "string" &&
        typeof value.payload.pendingCount === "number"
      );
    case "outbound.claim":
      return typeof value.payload.limit === "number" && typeof value.payload.leaseMs === "number";
    case "outbound.claimed":
      return (
        typeof value.payload.requestId === "string" &&
        typeof value.payload.leaseMs === "number" &&
        Array.isArray(value.payload.messages)
      );
    case "outbound.delivery.report":
      return (
        typeof value.payload.outboundMessageId === "string" &&
        (value.payload.status === "sent" || value.payload.status === "failed") &&
        typeof value.payload.deliveredAt === "string"
      );
    case "sync.request":
      return (
        value.payload.reason === "server-request" ||
        value.payload.reason === "outbound-delivered" ||
        value.payload.reason === "watchdog"
      );
    case "collector.status":
      return typeof value.payload.connectedToOneTalk === "boolean";
    case "ack":
      return typeof value.payload.requestId === "string";
    case "error":
      return typeof value.payload.code === "string" && typeof value.payload.message === "string";
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
```

修改根 `package.json`，在 `build` 与 `typecheck` 中把 `@wangwang/collector-protocol` 放在 `@wangwang/database` 与应用包之前：

```json
{
  "scripts": {
    "build": "npm run build -w @wangwang/env && npm run build -w @wangwang/collector-protocol && npm run build -w @wangwang/onetalk-adapter && npm run build -w @wangwang/database && npm run build -w @wangwang/collector-desktop && npm run build -w @wangwang/server && npm run build -w @wangwang/web && npm run build -w @wangwang/chrome-extension",
    "typecheck": "npm run build -w @wangwang/env && npm run build -w @wangwang/collector-protocol && npm run build -w @wangwang/onetalk-adapter && npm run build -w @wangwang/database && npm run typecheck -w @wangwang/collector-desktop && npm run typecheck -w @wangwang/server && npm run typecheck -w @wangwang/web && npm run typecheck -w @wangwang/chrome-extension"
  }
}
```

- [ ] **步骤 4：运行协议包测试与构建**

运行：

```bash
npm run test -w @wangwang/collector-protocol
npm run build -w @wangwang/collector-protocol
```

预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add package.json packages/collector-protocol
git commit -m "feat(collector): 新增 WS 协议包"
```

## 任务 2：为 outbound 队列增加 claim/lease

**文件：**
- 修改：`packages/database/src/sync-types.ts`
- 修改：`packages/database/src/sync-store.ts`
- 修改：`packages/database/src/postgres-sync-store.ts`
- 修改：`packages/database/src/migrations.ts`
- 创建：`packages/database/migrations/003_outbound_message_claim_lease.sql`
- 修改：`packages/database/test/sync-store.test.ts`
- 修改：`packages/database/test/postgres-sync-store.test.ts`
- 修改：`packages/database/test/migrations.test.ts`

- [ ] **步骤 1：编写失败的 InMemory claim 测试**

在 `packages/database/test/sync-store.test.ts` 的 outbound 测试后追加：

```ts
test("outbound messages are claimed once until lease expires", async () => {
  const store = new InMemorySyncStore();
  await store.acceptSyncBatch({
    sellerAccount: { externalAccountId: "seller-1" },
    device: { deviceId: "device-1" },
    customers: [{ externalCustomerId: "customer-1" }],
    conversations: [{ externalConversationId: "conv-1", externalCustomerId: "customer-1" }]
  });
  await store.createOutboundMessage({
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1",
    externalConversationId: "conv-1",
    content: "Please check the updated quote."
  });

  const first = await store.claimPendingOutboundMessages({
    sellerAccountExternalId: "seller-1",
    deviceId: "device-a",
    limit: 10,
    leaseMs: 120000,
    now: new Date("2026-06-01T00:00:00.000Z")
  });
  const second = await store.claimPendingOutboundMessages({
    sellerAccountExternalId: "seller-1",
    deviceId: "device-b",
    limit: 10,
    leaseMs: 120000,
    now: new Date("2026-06-01T00:00:30.000Z")
  });
  const expired = await store.claimPendingOutboundMessages({
    sellerAccountExternalId: "seller-1",
    deviceId: "device-b",
    limit: 10,
    leaseMs: 120000,
    now: new Date("2026-06-01T00:03:00.000Z")
  });

  assert.equal(first.length, 1);
  assert.equal(first[0].claimedByDeviceId, "device-a");
  assert.equal(first[0].claimExpiresAt, "2026-06-01T00:02:00.000Z");
  assert.equal(second.length, 0);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].claimedByDeviceId, "device-b");
});
```

- [ ] **步骤 2：编写失败的 migration 测试**

修改 `packages/database/test/migrations.test.ts` 中 migration 顺序断言：

```ts
assert.deepEqual(
  INTERNAL_SYNC_MIGRATIONS.map((migration) => [migration.id, migration.filename]),
  [
    ["001_internal_sync_schema", "001_internal_sync_schema.sql"],
    ["002_outbound_message_queue", "002_outbound_message_queue.sql"],
    ["003_outbound_message_claim_lease", "003_outbound_message_claim_lease.sql"]
  ]
);
```

追加：

```ts
test("outbound claim lease migration adds claim tracking columns", () => {
  const normalized = INTERNAL_SYNC_MIGRATIONS[2].sql.replace(/\s+/g, " ").toLowerCase();

  assert.match(normalized, /alter table outbound_message add column if not exists claimed_by_device_id text/);
  assert.match(normalized, /alter table outbound_message add column if not exists claim_expires_at timestamptz/);
  assert.match(normalized, /create index if not exists idx_outbound_message_claimable/);
});
```

- [ ] **步骤 3：运行数据库测试验证失败**

运行：

```bash
npm run test -w @wangwang/database -- sync-store.test.ts migrations.test.ts
```

预期：FAIL，报错包含 `claimPendingOutboundMessages is not a function` 和 migration 数量不匹配。

- [ ] **步骤 4：实现类型、migration 与 InMemory claim**

修改 `packages/database/src/sync-types.ts`：

```ts
export interface ClaimPendingOutboundMessagesInput {
  sellerAccountExternalId: string;
  deviceId: string;
  limit?: number;
  leaseMs?: number;
  now?: Date;
}

export interface StoredOutboundMessage extends ConversationCustomerScope {
  id: string;
  content: string;
  status: OutboundMessageStatus;
  createdByUserId?: string;
  deliveredByDeviceId?: string;
  externalMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  claimedByDeviceId?: string;
  claimExpiresAt?: string;
}
```

修改 `packages/database/src/sync-store.ts` import，加入 `ClaimPendingOutboundMessagesInput`。在 `InMemorySyncStore` 中加入方法：

```ts
async claimPendingOutboundMessages(input: ClaimPendingOutboundMessagesInput): Promise<StoredOutboundMessage[]> {
  const limit = Math.max(1, Math.min(input.limit || 20, 100));
  const leaseMs = Math.max(30_000, Math.min(input.leaseMs || 120_000, 600_000));
  const now = input.now || new Date();
  const claimExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
  const claimed: StoredOutboundMessage[] = [];

  for (const message of this.sortedOutboundMessages()) {
    if (claimed.length >= limit) break;
    if (message.sellerAccountExternalId !== input.sellerAccountExternalId || message.status !== "queued") continue;
    if (message.claimExpiresAt && new Date(message.claimExpiresAt).getTime() > now.getTime()) continue;

    const updated: StoredOutboundMessage = {
      ...message,
      claimedByDeviceId: input.deviceId,
      claimExpiresAt,
      updatedAt: now.toISOString()
    };
    this.outboundMessages.set(updated.id, updated);
    claimed.push(updated);
  }

  return claimed;
}
```

修改 `listPendingOutboundMessages`，排除 active claim：

```ts
const now = Date.now();
return this.sortedOutboundMessages()
  .filter(
    (item) =>
      item.sellerAccountExternalId === input.sellerAccountExternalId &&
      item.status === "queued" &&
      (!item.claimExpiresAt || new Date(item.claimExpiresAt).getTime() <= now)
  )
  .slice(0, limit);
```

创建 `packages/database/migrations/003_outbound_message_claim_lease.sql`：

```sql
ALTER TABLE outbound_message ADD COLUMN IF NOT EXISTS claimed_by_device_id TEXT;
ALTER TABLE outbound_message ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_outbound_message_claimable
  ON outbound_message (seller_account_id, status, claim_expires_at, created_at);
```

修改 `packages/database/src/migrations.ts`：

```ts
export const INTERNAL_SYNC_MIGRATIONS: DatabaseMigration[] = [
  loadMigration("001_internal_sync_schema", "001_internal_sync_schema.sql"),
  loadMigration("002_outbound_message_queue", "002_outbound_message_queue.sql"),
  loadMigration("003_outbound_message_claim_lease", "003_outbound_message_claim_lease.sql")
];
```

- [ ] **步骤 5：实现 Postgres claim**

修改 `packages/database/src/postgres-sync-store.ts`：

```ts
interface OutboundMessageRow {
  id: string;
  sellerAccountExternalId: string;
  externalCustomerId: string;
  externalConversationId: string;
  content: string;
  status: OutboundMessageStatus;
  createdByUserId?: string | null;
  deliveredByDeviceId?: string | null;
  externalMessageId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  deliveredAt?: string | Date | null;
  claimedByDeviceId?: string | null;
  claimExpiresAt?: string | Date | null;
}
```

在 class 中加入：

```ts
async claimPendingOutboundMessages(input: ClaimPendingOutboundMessagesInput): Promise<StoredOutboundMessage[]> {
  const limit = Math.max(1, Math.min(input.limit || 20, 100));
  const leaseMs = Math.max(30_000, Math.min(input.leaseMs || 120_000, 600_000));
  const result = await this.client.query<OutboundMessageRow>(
    `
    /* claim_pending_outbound_messages */
    WITH candidates AS (
      SELECT om.id
      FROM outbound_message om
      INNER JOIN seller_account s ON s.id = om.seller_account_id
      WHERE s.external_account_id = $1
        AND om.status = 'queued'
        AND (om.claim_expires_at IS NULL OR om.claim_expires_at <= now())
      ORDER BY om.created_at ASC, om.id ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    ),
    updated_message AS (
      UPDATE outbound_message om
      SET
        claimed_by_device_id = $3,
        claim_expires_at = now() + ($4::text || ' milliseconds')::interval,
        updated_at = now()
      FROM candidates
      WHERE om.id = candidates.id
      RETURNING om.*
    )
    SELECT
      om.id::text AS "id",
      s.external_account_id AS "sellerAccountExternalId",
      c.external_customer_id AS "externalCustomerId",
      conv.external_conversation_id AS "externalConversationId",
      om.content AS "content",
      om.status AS "status",
      om.created_by::text AS "createdByUserId",
      om.delivered_by_device_id AS "deliveredByDeviceId",
      om.external_message_id AS "externalMessageId",
      om.error_code AS "errorCode",
      om.error_message AS "errorMessage",
      om.created_at AS "createdAt",
      om.updated_at AS "updatedAt",
      om.delivered_at AS "deliveredAt",
      om.claimed_by_device_id AS "claimedByDeviceId",
      om.claim_expires_at AS "claimExpiresAt"
    FROM updated_message om
    INNER JOIN seller_account s ON s.id = om.seller_account_id
    INNER JOIN customer c ON c.id = om.customer_id
    INNER JOIN conversation conv ON conv.id = om.conversation_id
    `,
    [input.sellerAccountExternalId, limit, input.deviceId, leaseMs]
  );
  return result.rows.map(mapOutboundMessage);
}
```

修改 `list_pending_outbound_messages` 查询，增加：

```sql
AND (om.claim_expires_at IS NULL OR om.claim_expires_at <= now())
```

在所有 outbound SELECT 列中补充：

```sql
om.claimed_by_device_id AS "claimedByDeviceId",
om.claim_expires_at AS "claimExpiresAt"
```

修改 `mapOutboundMessage`：

```ts
...optionalProps({
  createdByUserId: row.createdByUserId,
  deliveredByDeviceId: row.deliveredByDeviceId,
  externalMessageId: row.externalMessageId,
  errorCode: row.errorCode,
  errorMessage: row.errorMessage,
  deliveredAt: isoString(row.deliveredAt),
  claimedByDeviceId: row.claimedByDeviceId,
  claimExpiresAt: isoString(row.claimExpiresAt)
})
```

- [ ] **步骤 6：运行数据库测试**

运行：

```bash
npm run test -w @wangwang/database
```

预期：PASS。

- [ ] **步骤 7：Commit**

```bash
git add packages/database
git commit -m "feat(database): 增加 outbound 领取租约"
```

## 任务 3：实现 server 端实时 hub

**文件：**
- 创建：`apps/server/src/collector-realtime-hub.ts`
- 创建：`apps/server/test/collector-realtime-hub.test.ts`

- [ ] **步骤 1：编写失败的 hub 测试**

创建 `apps/server/test/collector-realtime-hub.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCollectorRealtimeHub } from "../src/collector-realtime-hub.js";

test("collector realtime hub sends outbound availability to seller sessions", () => {
  const hub = createCollectorRealtimeHub({
    now: () => new Date("2026-06-01T00:00:00.000Z"),
    nextId: () => "server-msg-1"
  });
  const sellerSocket = fakeSocket();
  const otherSocket = fakeSocket();

  hub.addSession({
    sessionId: "session-1",
    sellerAccountExternalId: "seller-1",
    deviceId: "device-1",
    socket: sellerSocket
  });
  hub.addSession({
    sessionId: "session-2",
    sellerAccountExternalId: "seller-2",
    deviceId: "device-2",
    socket: otherSocket
  });

  const delivered = hub.notifyOutboundAvailable("seller-1", 3);

  assert.equal(delivered, 1);
  assert.equal(sellerSocket.sent.length, 1);
  assert.equal(JSON.parse(sellerSocket.sent[0]).type, "outbound.available");
  assert.equal(JSON.parse(sellerSocket.sent[0]).payload.pendingCount, 3);
  assert.equal(otherSocket.sent.length, 0);
});

test("collector realtime hub removes closed sessions", () => {
  const hub = createCollectorRealtimeHub();
  const socket = fakeSocket();
  hub.addSession({
    sessionId: "session-1",
    sellerAccountExternalId: "seller-1",
    deviceId: "device-1",
    socket
  });

  hub.removeSession("session-1");

  assert.equal(hub.notifyOutboundAvailable("seller-1", 1), 0);
});

function fakeSocket() {
  return {
    readyState: 1,
    sent: [] as string[],
    send(data: string) {
      this.sent.push(data);
    },
    close() {
      this.readyState = 3;
    }
  };
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
npm run test -w @wangwang/server -- collector-realtime-hub.test.ts
```

预期：FAIL，报错包含 `Cannot find module '../src/collector-realtime-hub.js'`。

- [ ] **步骤 3：实现 hub**

创建 `apps/server/src/collector-realtime-hub.ts`：

```ts
import {
  buildCollectorWsMessage,
  serializeCollectorWsMessage,
  type CollectorWsMessage
} from "@wangwang/collector-protocol";

const SOCKET_OPEN = 1;

export interface CollectorRealtimeSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface CollectorRealtimeSession {
  sessionId: string;
  sellerAccountExternalId: string;
  deviceId: string;
  socket: CollectorRealtimeSocket;
}

export interface CollectorRealtimeHubOptions {
  now?: () => Date;
  nextId?: () => string;
}

export interface CollectorRealtimeHub {
  addSession(session: CollectorRealtimeSession): void;
  removeSession(sessionId: string): void;
  notifyOutboundAvailable(sellerAccountExternalId: string, pendingCount: number): number;
  sendToSession(sessionId: string, message: CollectorWsMessage): boolean;
}

export function createCollectorRealtimeHub(options: CollectorRealtimeHubOptions = {}): CollectorRealtimeHub {
  const sessions = new Map<string, CollectorRealtimeSession>();
  const now = options.now || (() => new Date());
  const nextId = options.nextId || (() => crypto.randomUUID());

  return {
    addSession(session) {
      sessions.set(session.sessionId, session);
    },
    removeSession(sessionId) {
      sessions.delete(sessionId);
    },
    notifyOutboundAvailable(sellerAccountExternalId, pendingCount) {
      const message = buildCollectorWsMessage({
        id: nextId(),
        type: "outbound.available",
        sentAt: now().toISOString(),
        payload: { sellerAccountExternalId, pendingCount }
      });
      let delivered = 0;
      for (const session of sessions.values()) {
        if (session.sellerAccountExternalId !== sellerAccountExternalId) continue;
        if (send(session.socket, message)) delivered += 1;
      }
      return delivered;
    },
    sendToSession(sessionId, message) {
      const session = sessions.get(sessionId);
      return session ? send(session.socket, message) : false;
    }
  };
}

function send(socket: CollectorRealtimeSocket, message: CollectorWsMessage): boolean {
  if (socket.readyState !== SOCKET_OPEN) return false;
  socket.send(serializeCollectorWsMessage(message));
  return true;
}
```

- [ ] **步骤 4：运行 hub 测试**

运行：

```bash
npm run build -w @wangwang/collector-protocol
npm run test -w @wangwang/server -- collector-realtime-hub.test.ts
```

预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add apps/server/src/collector-realtime-hub.ts apps/server/test/collector-realtime-hub.test.ts
git commit -m "feat(server): 新增 collector 实时连接 hub"
```

## 任务 4：接入 Fastify WebSocket route

**文件：**
- 修改：`apps/server/package.json`
- 修改：`package-lock.json`
- 创建：`apps/server/src/collector-ws.ts`
- 修改：`apps/server/src/server.ts`
- 创建：`apps/server/test/collector-ws.test.ts`

- [ ] **步骤 1：安装 server WS 依赖**

运行：

```bash
npm install @fastify/websocket -w @wangwang/server
npm install @wangwang/collector-protocol -w @wangwang/server
npm install @types/ws -D -w @wangwang/server
```

预期：`apps/server/package.json` 增加运行时依赖，`package-lock.json` 更新。

- [ ] **步骤 2：编写失败的 WS route 测试**

创建 `apps/server/test/collector-ws.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore } from "@wangwang/database";
import { buildCollectorWsMessage, parseCollectorWsMessage } from "@wangwang/collector-protocol";
import { createServer } from "../src/server.js";

test("collector websocket accepts hello with registered device token", async (t) => {
  const store = new InMemorySyncStore();
  await store.registerCollectorDevice({
    sellerAccountExternalId: "seller-1",
    externalDeviceId: "device-1",
    deviceName: "Chrome Extension",
    token: "device-token"
  });
  const app = await createServer({ store });
  t.after(() => app.close());
  await app.ready();

  const ws = await app.injectWS("/collector/v1/ws");
  t.after(() => ws.close());
  const ready = nextMessage(ws);
  ws.send(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "client-1",
        type: "collector.hello",
        sentAt: "2026-06-01T00:00:00.000Z",
        payload: {
          collectorToken: "device-token",
          deviceId: "device-1",
          deviceName: "Chrome Extension",
          capabilities: ["outbound.claim", "delivery.report"]
        }
      })
    )
  );

  const message = parseCollectorWsMessage(await ready);
  assert.equal(message.type, "collector.ready");
  assert.equal(message.payload.sellerAccountExternalId, "seller-1");
});

test("collector websocket closes when hello token is invalid", async (t) => {
  const app = await createServer({ store: new InMemorySyncStore() });
  t.after(() => app.close());
  await app.ready();

  const ws = await app.injectWS("/collector/v1/ws");
  const closed = new Promise<{ code: number }>((resolve) => {
    ws.on("close", (code) => resolve({ code }));
  });
  ws.send(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "client-1",
        type: "collector.hello",
        sentAt: "2026-06-01T00:00:00.000Z",
        payload: {
          collectorToken: "bad-token",
          deviceId: "device-1",
          capabilities: []
        }
      })
    )
  );

  assert.equal((await closed).code, 1008);
});

function nextMessage(ws: { once(event: "message", listener: (data: Buffer) => void): void }): Promise<string> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(data.toString()));
  });
}
```

- [ ] **步骤 3：运行测试验证失败**

运行：

```bash
npm run build -w @wangwang/collector-protocol
npm run test -w @wangwang/server -- collector-ws.test.ts
```

预期：FAIL，报错包含 `app.injectWS is not a function` 或 `/collector/v1/ws` 未注册。

- [ ] **步骤 4：实现 WS route**

创建 `apps/server/src/collector-ws.ts`：

```ts
import {
  buildCollectorWsMessage,
  isCollectorHelloMessage,
  isOutboundClaimMessage,
  isOutboundDeliveryReportMessage,
  parseCollectorWsMessage,
  serializeCollectorWsMessage,
  type CollectorWsMessage
} from "@wangwang/collector-protocol";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { SyncStore } from "./server.js";
import type { CollectorRealtimeHub } from "./collector-realtime-hub.js";

const HEARTBEAT_INTERVAL_MS = 20_000;
const OUTBOUND_LEASE_MS = 120_000;

export interface RegisterCollectorWsRoutesOptions {
  store: SyncStore;
  hub: CollectorRealtimeHub;
  now?: () => Date;
  nextId?: () => string;
}

export async function registerCollectorWsRoutes(
  app: FastifyInstance,
  options: RegisterCollectorWsRoutesOptions
): Promise<void> {
  const now = options.now || (() => new Date());
  const nextId = options.nextId || (() => crypto.randomUUID());

  app.get("/collector/v1/ws", { websocket: true }, (socket: WebSocket) => {
    let sessionId: string | null = null;
    let sellerAccountExternalId: string | null = null;
    let deviceId: string | null = null;
    const heartbeat = globalThis.setInterval(() => {
      send(socket, {
        id: nextId(),
        type: "heartbeat.ping",
        sentAt: now().toISOString(),
        payload: { nonce: nextId() }
      });
    }, HEARTBEAT_INTERVAL_MS);

    socket.on("message", async (data) => {
      try {
        const message = parseCollectorWsMessage(data.toString());
        if (!sessionId) {
          if (!isCollectorHelloMessage(message)) {
            socket.close(1008, "collector_hello_required");
            return;
          }
          const device = await options.store.authenticateCollectorDevice(message.payload.collectorToken);
          if (!device) {
            socket.close(1008, "collector_unauthorized");
            return;
          }
          sessionId = nextId();
          sellerAccountExternalId = device.sellerAccountExternalId || "default-seller";
          deviceId = device.externalDeviceId || message.payload.deviceId;
          options.hub.addSession({
            sessionId,
            sellerAccountExternalId,
            deviceId,
            socket
          });
          send(socket, {
            id: nextId(),
            type: "collector.ready",
            sentAt: now().toISOString(),
            payload: {
              sessionId,
              sellerAccountExternalId,
              deviceId,
              heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
              serverTime: now().toISOString()
            }
          });
          return;
        }

        if (message.type === "heartbeat.pong" || message.type === "collector.status") return;

        if (isOutboundClaimMessage(message)) {
          const messages = await options.store.claimPendingOutboundMessages({
            sellerAccountExternalId: sellerAccountExternalId || "default-seller",
            deviceId: deviceId || "unknown-device",
            limit: message.payload.limit,
            leaseMs: message.payload.leaseMs || OUTBOUND_LEASE_MS
          });
          send(socket, {
            id: nextId(),
            type: "outbound.claimed",
            sentAt: now().toISOString(),
            payload: {
              requestId: message.id,
              leaseMs: message.payload.leaseMs || OUTBOUND_LEASE_MS,
              messages
            }
          });
          return;
        }

        if (isOutboundDeliveryReportMessage(message)) {
          await options.store.markOutboundMessageDelivered({
            id: message.payload.outboundMessageId,
            sellerAccountExternalId: sellerAccountExternalId || "default-seller",
            status: message.payload.status,
            externalMessageId: message.payload.externalMessageId,
            deliveredByDeviceId: deviceId || undefined,
            deliveredAt: message.payload.deliveredAt,
            errorCode: message.payload.errorCode,
            errorMessage: message.payload.errorMessage
          });
          send(socket, {
            id: nextId(),
            type: "ack",
            sentAt: now().toISOString(),
            payload: { requestId: message.id }
          });
          return;
        }

        send(socket, {
          id: nextId(),
          type: "error",
          sentAt: now().toISOString(),
          payload: { requestId: message.id, code: "collector_ws_unknown_message", message: message.type }
        });
      } catch (error) {
        send(socket, {
          id: nextId(),
          type: "error",
          sentAt: now().toISOString(),
          payload: {
            code: "collector_ws_message_failed",
            message: error instanceof Error ? error.message : "collector_ws_message_failed"
          }
        });
      }
    });

    socket.on("close", () => {
      globalThis.clearInterval(heartbeat);
      if (sessionId) options.hub.removeSession(sessionId);
    });
  });
}

function send(socket: WebSocket, message: Omit<CollectorWsMessage, "v">): void {
  socket.send(serializeCollectorWsMessage(buildCollectorWsMessage(message)));
}
```

修改 `apps/server/src/server.ts`：

```ts
import websocket from "@fastify/websocket";
import { createCollectorRealtimeHub } from "./collector-realtime-hub.js";
import { registerCollectorWsRoutes } from "./collector-ws.js";
```

在 `createServer()` 内创建 app 后、普通 routes 前注册：

```ts
const realtimeHub = createCollectorRealtimeHub();
await app.register(websocket, {
  options: { maxPayload: 1024 * 1024 }
});
await registerCollectorWsRoutes(app, { store, hub: realtimeHub });
```

扩展 `SyncStore` interface：

```ts
claimPendingOutboundMessages(
  input: ClaimPendingOutboundMessagesInput
): Promise<StoredOutboundMessage[]> | StoredOutboundMessage[];
```

- [ ] **步骤 5：运行 WS route 测试**

运行：

```bash
npm run build -w @wangwang/collector-protocol
npm run build -w @wangwang/database
npm run test -w @wangwang/server -- collector-ws.test.ts
```

预期：PASS。

- [ ] **步骤 6：Commit**

```bash
git add package-lock.json apps/server/package.json apps/server/src/collector-ws.ts apps/server/src/server.ts apps/server/test/collector-ws.test.ts
git commit -m "feat(server): 接入 collector websocket"
```

## 任务 5：server 创建 outbound 后推送 WS 通知

**文件：**
- 修改：`apps/server/src/server.ts`
- 修改：`apps/server/test/collector-ws.test.ts`
- 修改：`apps/server/test/sync-batches.test.ts`

- [ ] **步骤 1：编写失败的 push + claim + delivery 测试**

在 `apps/server/test/collector-ws.test.ts` 追加：

```ts
test("collector websocket receives outbound availability and reports delivery", async (t) => {
  const store = new InMemorySyncStore();
  await store.createInternalUser({
    email: "admin@example.com",
    displayName: "Admin User",
    passwordHash: await import("../src/auth.js").then(({ hashPassword }) => hashPassword("secret")),
    roles: ["admin"]
  });
  await store.registerCollectorDevice({
    sellerAccountExternalId: "seller-1",
    externalDeviceId: "device-1",
    deviceName: "Chrome Extension",
    token: "device-token"
  });
  const app = await createServer({ store });
  t.after(() => app.close());
  await app.ready();
  await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: "Bearer device-token" },
    payload: {
      sellerAccount: { externalAccountId: "seller-1" },
      device: { deviceId: "device-1" },
      customers: [{ externalCustomerId: "customer-1" }],
      conversations: [{ externalConversationId: "conv-1", externalCustomerId: "customer-1" }]
    }
  });

  const ws = await app.injectWS("/collector/v1/ws");
  t.after(() => ws.close());
  const ready = nextMessage(ws);
  ws.send(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "hello-1",
        type: "collector.hello",
        sentAt: "2026-06-01T00:00:00.000Z",
        payload: { collectorToken: "device-token", deviceId: "device-1", capabilities: ["outbound.claim"] }
      })
    )
  );
  assert.equal(parseCollectorWsMessage(await ready).type, "collector.ready");

  const authHeaders = await createInternalAuthHeaders(app);
  const available = nextMessage(ws);
  await app.inject({
    method: "POST",
    url: "/internal/v1/conversations/conv-1/outbound-messages?sellerAccountExternalId=seller-1",
    headers: authHeaders,
    payload: { content: "Hello from web" }
  });
  assert.equal(parseCollectorWsMessage(await available).type, "outbound.available");

  const claimed = nextMessage(ws);
  ws.send(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "claim-1",
        type: "outbound.claim",
        sentAt: "2026-06-01T00:00:01.000Z",
        payload: { limit: 10, leaseMs: 120000 }
      })
    )
  );
  const claimedMessage = parseCollectorWsMessage(await claimed);
  assert.equal(claimedMessage.type, "outbound.claimed");
  assert.equal(claimedMessage.payload.messages.length, 1);

  const ack = nextMessage(ws);
  ws.send(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "delivery-1",
        type: "outbound.delivery.report",
        sentAt: "2026-06-01T00:00:02.000Z",
        payload: {
          outboundMessageId: claimedMessage.payload.messages[0].id,
          status: "sent",
          externalMessageId: "onetalk-msg-1",
          deliveredAt: "2026-06-01T00:00:02.000Z"
        }
      })
    )
  );
  assert.equal(parseCollectorWsMessage(await ack).type, "ack");
});

async function createInternalAuthHeaders(app: Awaited<ReturnType<typeof createServer>>) {
  const loginResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/auth/login",
    payload: { email: "admin@example.com", password: "secret" }
  });
  assert.equal(loginResponse.statusCode, 200);
  return { authorization: `Bearer ${loginResponse.json().token}` };
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
npm run test -w @wangwang/server -- collector-ws.test.ts
```

预期：FAIL，`outbound.available` 没有发出。

- [ ] **步骤 3：实现 internal outbound 创建后的通知**

修改 `apps/server/src/server.ts`，确保 `realtimeHub` 在 `createServer()` 作用域内可被 internal route 使用。找到 `/internal/v1/conversations/:externalConversationId/outbound-messages` 成功创建 message 后，在 audit log 后、return 前加入：

```ts
realtimeHub.notifyOutboundAvailable(message.sellerAccountExternalId, 1);
```

- [ ] **步骤 4：确认 HTTP fallback 仍可工作**

在 `apps/server/test/sync-batches.test.ts` 现有 outbound 测试中，claim 一条消息后确认 `GET /collector/v1/outbound-messages` 不返回 active claim；再用过期 lease 的 store 层测试覆盖重新领取。HTTP route 不新增强制 release 行为。

```ts
const claimed = await store.claimPendingOutboundMessages({
  sellerAccountExternalId: "seller-1",
  deviceId: "device-1",
  leaseMs: 120000,
  limit: 10
});
assert.equal(claimed.length, 1);

const listAfterClaim = await app.inject({
  method: "GET",
  url: "/collector/v1/outbound-messages",
  headers: { authorization: `Bearer ${token}` }
});
assert.equal(listAfterClaim.json().messages.length, 0);
```

- [ ] **步骤 5：运行 server 测试**

运行：

```bash
npm run test -w @wangwang/server
```

预期：PASS。

- [ ] **步骤 6：Commit**

```bash
git add apps/server/src/server.ts apps/server/test/collector-ws.test.ts apps/server/test/sync-batches.test.ts
git commit -m "feat(server): 推送 outbound 可用事件"
```

## 任务 6：实现插件端 WS client

**文件：**
- 修改：`apps/chrome-extension/package.json`
- 修改：`package-lock.json`
- 创建：`apps/chrome-extension/src/background/tradebridge-ws-client.ts`
- 创建：`apps/chrome-extension/test/tradebridge-ws-client.test.ts`

- [ ] **步骤 1：安装插件协议依赖**

运行：

```bash
npm install @wangwang/collector-protocol -w @wangwang/chrome-extension
```

预期：`apps/chrome-extension/package.json` 和 `package-lock.json` 更新。

- [ ] **步骤 2：编写失败的 WS client 测试**

创建 `apps/chrome-extension/test/tradebridge-ws-client.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCollectorWsMessage, buildCollectorWsMessage } from "@wangwang/collector-protocol";
import { TradeBridgeWsClient, tradebridgeWsUrl } from "../src/background/tradebridge-ws-client.js";

test("tradebridgeWsUrl maps http and https server urls to ws urls", () => {
  assert.equal(tradebridgeWsUrl("http://127.0.0.1:5032"), "ws://127.0.0.1:5032/collector/v1/ws");
  assert.equal(tradebridgeWsUrl("https://example.com/base"), "wss://example.com/collector/v1/ws");
});

test("TradeBridgeWsClient sends hello and handles ready", async () => {
  const sockets: FakeWebSocket[] = [];
  const client = new TradeBridgeWsClient({
    socketFactory: (url) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
    now: () => new Date("2026-06-01T00:00:00.000Z"),
    nextId: () => "client-msg-1",
    setInterval: () => 1,
    clearInterval: () => undefined
  });

  const ready = client.connect({
    serverUrl: "http://127.0.0.1:5032",
    collectorToken: "collector-token",
    sellerAccountExternalId: "seller-1",
    deviceId: "device-1",
    deviceName: "Chrome Extension"
  });
  sockets[0].open();
  const hello = parseCollectorWsMessage(sockets[0].sent[0]);
  assert.equal(hello.type, "collector.hello");
  assert.equal(hello.payload.collectorToken, "collector-token");

  sockets[0].message(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "server-1",
        type: "collector.ready",
        sentAt: "2026-06-01T00:00:00.000Z",
        payload: {
          sessionId: "session-1",
          sellerAccountExternalId: "seller-1",
          deviceId: "device-1",
          heartbeatIntervalMs: 20000,
          serverTime: "2026-06-01T00:00:00.000Z"
        }
      })
    )
  );

  assert.equal((await ready).sessionId, "session-1");
  assert.equal(client.state.kind, "connected");
});

class FakeWebSocket {
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  message(data: string) {
    this.onmessage?.({ data });
  }
}
```

- [ ] **步骤 3：运行测试验证失败**

运行：

```bash
npm run build -w @wangwang/collector-protocol
npm run test -w @wangwang/chrome-extension -- tradebridge-ws-client.test.ts
```

预期：FAIL，报错包含 `Cannot find module '../src/background/tradebridge-ws-client.js'`。

- [ ] **步骤 4：实现 WS client**

创建 `apps/chrome-extension/src/background/tradebridge-ws-client.ts`：

```ts
import {
  buildCollectorWsMessage,
  parseCollectorWsMessage,
  serializeCollectorWsMessage,
  type CollectorReadyMessage,
  type CollectorWsMessage
} from "@wangwang/collector-protocol";
import type { ExtensionConfig } from "../shared/sync-types.js";

const SOCKET_OPEN = 1;
const KEEPALIVE_MS = 20_000;

export interface BrowserWebSocketLike {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export interface TradeBridgeWsClientOptions {
  socketFactory?: (url: string) => BrowserWebSocketLike;
  now?: () => Date;
  nextId?: () => string;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
  onMessage?: (message: CollectorWsMessage) => void | Promise<void>;
  onStateChange?: (state: TradeBridgeWsState) => void | Promise<void>;
}

export type TradeBridgeWsState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected"; sessionId: string }
  | { kind: "closed"; reason?: string }
  | { kind: "error"; error: string };

export class TradeBridgeWsClient {
  state: TradeBridgeWsState = { kind: "idle" };
  private socket: BrowserWebSocketLike | null = null;
  private keepaliveId: ReturnType<typeof globalThis.setInterval> | null = null;

  constructor(private readonly options: TradeBridgeWsClientOptions = {}) {}

  connect(config: ExtensionConfig): Promise<CollectorReadyMessage["payload"]> {
    this.close();
    this.setState({ kind: "connecting" });
    const socket = this.options.socketFactory?.(tradebridgeWsUrl(config.serverUrl)) || new WebSocket(tradebridgeWsUrl(config.serverUrl));
    this.socket = socket as BrowserWebSocketLike;

    return new Promise((resolve, reject) => {
      socket.onopen = () => {
        this.send({
          id: this.nextId(),
          type: "collector.hello",
          sentAt: this.now().toISOString(),
          payload: {
            collectorToken: config.collectorToken,
            deviceId: config.deviceId,
            deviceName: config.deviceName,
            capabilities: ["outbound.claim", "delivery.report", "collector.status"]
          }
        });
        this.startKeepalive();
      };
      socket.onmessage = (event) => {
        try {
          const message = parseCollectorWsMessage(event.data);
          if (message.type === "collector.ready") {
            this.setState({ kind: "connected", sessionId: message.payload.sessionId });
            resolve(message.payload);
          } else {
            void this.options.onMessage?.(message);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "collector_ws_parse_failed";
          this.setState({ kind: "error", error: message });
          reject(error);
        }
      };
      socket.onerror = () => {
        this.setState({ kind: "error", error: "collector_ws_socket_error" });
        reject(new Error("collector_ws_socket_error"));
      };
      socket.onclose = () => {
        this.stopKeepalive();
        this.setState({ kind: "closed" });
      };
    });
  }

  send(message: Omit<CollectorWsMessage, "v">): void {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) throw new Error("collector_ws_not_connected");
    this.socket.send(serializeCollectorWsMessage(buildCollectorWsMessage(message)));
  }

  close(): void {
    this.stopKeepalive();
    this.socket?.close();
    this.socket = null;
  }

  private startKeepalive(): void {
    const setIntervalFn = this.options.setInterval || globalThis.setInterval;
    this.keepaliveId = setIntervalFn(() => {
      if (!this.socket || this.socket.readyState !== SOCKET_OPEN) return;
      this.send({
        id: this.nextId(),
        type: "heartbeat.pong",
        sentAt: this.now().toISOString(),
        payload: { nonce: this.nextId(), status: "alive" }
      });
    }, KEEPALIVE_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveId == null) return;
    const clearIntervalFn = this.options.clearInterval || globalThis.clearInterval;
    clearIntervalFn(this.keepaliveId);
    this.keepaliveId = null;
  }

  private setState(state: TradeBridgeWsState): void {
    this.state = state;
    void this.options.onStateChange?.(state);
  }

  private now(): Date {
    return this.options.now?.() || new Date();
  }

  private nextId(): string {
    return this.options.nextId?.() || crypto.randomUUID();
  }
}

export function tradebridgeWsUrl(serverUrl: string): string {
  const url = new URL("/collector/v1/ws", serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
```

- [ ] **步骤 5：运行插件 WS client 测试**

运行：

```bash
npm run build -w @wangwang/collector-protocol
npm run test -w @wangwang/chrome-extension -- tradebridge-ws-client.test.ts
```

预期：PASS。

- [ ] **步骤 6：Commit**

```bash
git add package-lock.json apps/chrome-extension/package.json apps/chrome-extension/src/background/tradebridge-ws-client.ts apps/chrome-extension/test/tradebridge-ws-client.test.ts
git commit -m "feat(extension): 新增 TradeBridge WS 客户端"
```

## 任务 7：抽出 OneTalk 发送函数供 HTTP 与 WS 复用

**文件：**
- 修改：`apps/chrome-extension/src/background/outbound-orchestrator.ts`
- 修改：`apps/chrome-extension/test/outbound-orchestrator.test.ts`

- [ ] **步骤 1：编写失败的 send-only 测试**

在 `apps/chrome-extension/test/outbound-orchestrator.test.ts` 中 import 增加 `sendOutboundMessagesViaOneTalk`，追加：

```ts
test("sendOutboundMessagesViaOneTalk sends provided messages and returns delivery reports", async () => {
  const reports = await sendOutboundMessagesViaOneTalk({
    chromeApi: fakeChromeApi({
      tabs: [{ id: 3, url: "https://onetalk.alibaba.com/" }]
    }),
    messages: [outboundMessage()]
  });

  assert.deepEqual(reports, [
    {
      outboundMessageId: "outbound-1",
      status: "sent",
      externalMessageId: "onetalk-msg-1"
    }
  ]);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
npm run test -w @wangwang/chrome-extension -- outbound-orchestrator.test.ts
```

预期：FAIL，报错包含 `sendOutboundMessagesViaOneTalk` 未导出。

- [ ] **步骤 3：抽出 send-only 函数**

修改 `apps/chrome-extension/src/background/outbound-orchestrator.ts`：

```ts
export interface OutboundDeliveryReport {
  outboundMessageId: string;
  status: "sent" | "failed";
  externalMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export async function sendOutboundMessagesViaOneTalk(options: {
  chromeApi: ChromeApi;
  messages: OutboundMessage[];
}): Promise<OutboundDeliveryReport[]> {
  const reports: OutboundDeliveryReport[] = [];
  for (const message of options.messages) {
    const result = await sendViaOneTalkTab(options.chromeApi, message);
    reports.push({
      outboundMessageId: message.id,
      status: result.ok ? "sent" : "failed",
      externalMessageId: result.externalMessageId,
      errorCode: result.ok ? undefined : result.error || "onetalk_send_failed",
      errorMessage: result.ok ? undefined : result.error || "OneTalk send failed"
    });
  }
  return reports;
}
```

修改 `runOutboundDelivery()` 中 for-loop，先调用 send-only 函数，再逐条 HTTP 回写：

```ts
const reports = await sendOutboundMessagesViaOneTalk({ chromeApi: options.chromeApi, messages });
for (const report of reports) {
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

- [ ] **步骤 4：运行 outbound 测试**

运行：

```bash
npm run test -w @wangwang/chrome-extension -- outbound-orchestrator.test.ts
```

预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add apps/chrome-extension/src/background/outbound-orchestrator.ts apps/chrome-extension/test/outbound-orchestrator.test.ts
git commit -m "refactor(extension): 复用 OneTalk 出站发送逻辑"
```

## 任务 8：实现插件 realtime orchestrator

**文件：**
- 创建：`apps/chrome-extension/src/background/realtime-orchestrator.ts`
- 创建：`apps/chrome-extension/test/realtime-orchestrator.test.ts`

- [ ] **步骤 1：编写失败的 orchestrator 测试**

创建 `apps/chrome-extension/test/realtime-orchestrator.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCollectorWsMessage, parseCollectorWsMessage } from "@wangwang/collector-protocol";
import { createRealtimeOrchestrator } from "../src/background/realtime-orchestrator.js";
import type { OutboundMessage } from "../src/shared/sync-types.js";

test("realtime orchestrator claims outbound messages and reports delivery", async () => {
  const sent: string[] = [];
  const orchestrator = createRealtimeOrchestrator({
    now: () => new Date("2026-06-01T00:00:00.000Z"),
    nextId: () => "client-msg-1",
    sendWsMessage: (message) => sent.push(JSON.stringify(message)),
    sendOutboundMessagesViaOneTalk: async () => [
      {
        outboundMessageId: "outbound-1",
        status: "sent",
        externalMessageId: "onetalk-msg-1"
      }
    ],
    runSyncNow: async () => ({ ok: true, acceptedCount: 1, rejectedCount: 0 })
  });

  await orchestrator.handleMessage(
    buildCollectorWsMessage({
      id: "server-1",
      type: "outbound.available",
      sentAt: "2026-06-01T00:00:00.000Z",
      payload: { sellerAccountExternalId: "seller-1", pendingCount: 1 }
    })
  );

  assert.equal(parseCollectorWsMessage(sent[0]).type, "outbound.claim");

  await orchestrator.handleMessage(
    buildCollectorWsMessage({
      id: "server-2",
      type: "outbound.claimed",
      sentAt: "2026-06-01T00:00:00.000Z",
      payload: {
        requestId: "client-msg-1",
        leaseMs: 120000,
        messages: [outboundMessage()]
      }
    })
  );

  const report = parseCollectorWsMessage(sent[1]);
  assert.equal(report.type, "outbound.delivery.report");
  assert.equal(report.payload.outboundMessageId, "outbound-1");
  assert.equal(report.payload.status, "sent");
});

function outboundMessage(): OutboundMessage {
  return {
    id: "outbound-1",
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1",
    externalConversationId: "conv-1",
    content: "Hello",
    status: "queued",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z"
  };
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
npm run build -w @wangwang/collector-protocol
npm run test -w @wangwang/chrome-extension -- realtime-orchestrator.test.ts
```

预期：FAIL，报错包含 `Cannot find module '../src/background/realtime-orchestrator.js'`。

- [ ] **步骤 3：实现 orchestrator**

创建 `apps/chrome-extension/src/background/realtime-orchestrator.ts`：

```ts
import {
  buildCollectorWsMessage,
  type CollectorWsMessage,
  type OutboundClaimedMessage
} from "@wangwang/collector-protocol";
import type { OutboundDeliveryReport } from "./outbound-orchestrator.js";
import type { OutboundMessage, SyncNowResponse } from "../shared/sync-types.js";

const DEFAULT_CLAIM_LIMIT = 10;
const DEFAULT_LEASE_MS = 120_000;

export interface RealtimeOrchestratorOptions {
  now?: () => Date;
  nextId?: () => string;
  sendWsMessage(message: CollectorWsMessage): void;
  sendOutboundMessagesViaOneTalk(input: { messages: OutboundMessage[] }): Promise<OutboundDeliveryReport[]>;
  runSyncNow(): Promise<SyncNowResponse>;
}

export function createRealtimeOrchestrator(options: RealtimeOrchestratorOptions) {
  const now = options.now || (() => new Date());
  const nextId = options.nextId || (() => crypto.randomUUID());

  return {
    async handleMessage(message: CollectorWsMessage): Promise<void> {
      if (message.type === "outbound.available") {
        options.sendWsMessage(
          buildCollectorWsMessage({
            id: nextId(),
            type: "outbound.claim",
            sentAt: now().toISOString(),
            payload: { limit: DEFAULT_CLAIM_LIMIT, leaseMs: DEFAULT_LEASE_MS }
          })
        );
        return;
      }

      if (message.type === "outbound.claimed") {
        await deliverClaimed(message);
        return;
      }

      if (message.type === "sync.request") {
        await options.runSyncNow();
      }
    }
  };

  async function deliverClaimed(message: OutboundClaimedMessage): Promise<void> {
    const reports = await options.sendOutboundMessagesViaOneTalk({ messages: message.payload.messages });
    for (const report of reports) {
      options.sendWsMessage(
        buildCollectorWsMessage({
          id: nextId(),
          type: "outbound.delivery.report",
          sentAt: now().toISOString(),
          payload: {
            outboundMessageId: report.outboundMessageId,
            status: report.status,
            externalMessageId: report.externalMessageId,
            errorCode: report.errorCode,
            errorMessage: report.errorMessage,
            deliveredAt: now().toISOString()
          }
        })
      );
    }
  }
}
```

- [ ] **步骤 4：运行 orchestrator 测试**

运行：

```bash
npm run test -w @wangwang/chrome-extension -- realtime-orchestrator.test.ts
```

预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add apps/chrome-extension/src/background/realtime-orchestrator.ts apps/chrome-extension/test/realtime-orchestrator.test.ts
git commit -m "feat(extension): 新增实时投递编排器"
```

## 任务 9：接入插件 background 生命周期与状态

**文件：**
- 修改：`apps/chrome-extension/src/background/index.ts`
- 修改：`apps/chrome-extension/src/background/storage.ts`
- 修改：`apps/chrome-extension/src/shared/chrome-api.ts`
- 修改：`apps/chrome-extension/src/shared/extension-messages.ts`
- 修改：`apps/chrome-extension/src/shared/sync-types.ts`
- 修改：`apps/chrome-extension/src/options/options.ts`
- 修改：`apps/chrome-extension/src/popup/popup.ts`
- 修改：`apps/chrome-extension/test/manifest.test.ts`
- 修改：`apps/chrome-extension/public/manifest.json`

- [ ] **步骤 1：编写失败的 manifest 测试**

修改 `apps/chrome-extension/test/manifest.test.ts`，追加：

```ts
test("manifest supports websocket service worker runtime", () => {
  assert.equal(manifest.minimum_chrome_version, "116");
  assert.ok(manifest.host_permissions?.includes("ws://127.0.0.1:5032/*"));
});
```

- [ ] **步骤 2：运行 manifest 测试验证失败**

运行：

```bash
npm run test -w @wangwang/chrome-extension -- manifest.test.ts
```

预期：FAIL，`minimum_chrome_version` 或 WS host permission 缺失。

- [ ] **步骤 3：扩展状态类型**

修改 `apps/chrome-extension/src/shared/sync-types.ts`：

```ts
export interface ExtensionRealtimeStatus {
  state: "idle" | "connecting" | "connected" | "closed" | "error";
  sessionId?: string;
  connectedAt?: string;
  disconnectedAt?: string;
  reconnectCount?: number;
  lastError?: string;
}

export interface ExtensionStatus {
  lastSyncedAt?: string;
  nextCursor?: string | null;
  lastDiagnostics?: SyncDiagnostics;
  realtime?: ExtensionRealtimeStatus;
  lastError?: {
    code: string;
    message: string;
  };
}
```

- [ ] **步骤 4：接入 background**

修改 `apps/chrome-extension/src/background/index.ts`：

```ts
import { createRealtimeOrchestrator } from "./realtime-orchestrator.js";
import { TradeBridgeWsClient } from "./tradebridge-ws-client.js";
import { sendOutboundMessagesViaOneTalk } from "./outbound-orchestrator.js";
```

在模块作用域创建：

```ts
let realtimeClient: TradeBridgeWsClient | null = null;
let reconnectCount = 0;
```

新增：

```ts
async function startRealtimeConnection(): Promise<void> {
  const config = await stateStore.getConfig();
  if (!config) return;

  const orchestrator = createRealtimeOrchestrator({
    sendWsMessage: (message) => realtimeClient?.send(message),
    sendOutboundMessagesViaOneTalk: ({ messages }) =>
      sendOutboundMessagesViaOneTalk({ chromeApi, messages }),
    runSyncNow: runDefaultSyncAndOutbound
  });

  realtimeClient = new TradeBridgeWsClient({
    onMessage: orchestrator.handleMessage,
    onStateChange: async (state) => {
      const previous = await stateStore.getStatus();
      await stateStore.saveStatus({
        ...previous,
        realtime: {
          state: state.kind,
          sessionId: state.kind === "connected" ? state.sessionId : previous.realtime?.sessionId,
          connectedAt: state.kind === "connected" ? new Date().toISOString() : previous.realtime?.connectedAt,
          disconnectedAt: state.kind === "closed" ? new Date().toISOString() : previous.realtime?.disconnectedAt,
          reconnectCount,
          lastError: state.kind === "error" ? state.error : previous.realtime?.lastError
        }
      });
    }
  });

  try {
    await realtimeClient.connect(config);
  } catch {
    reconnectCount += 1;
  }
}
```

在模块底部启动：

```ts
void startRealtimeConnection();
```

在 `onInstalled` 中保留 alarm，并新增 watchdog：

```ts
chromeApi.alarms.create("tradebridge-realtime-watchdog", { periodInMinutes: 1 });
```

在 `onAlarm` 中新增：

```ts
if (alarm.name === "tradebridge-realtime-watchdog") {
  void startRealtimeConnection();
}
```

在 `runtime.onMessage` 中新增：

```ts
if (typed.type === "realtime-reconnect") {
  void startRealtimeConnection().then(() => sendResponse({ ok: true }));
  return true;
}
```

- [ ] **步骤 5：扩展 options 保存后重连**

修改 `apps/chrome-extension/src/shared/extension-messages.ts`：

```ts
| { type: "realtime-reconnect" }
```

修改 `apps/chrome-extension/src/options/options.ts`，保存 config 后加入：

```ts
await getChrome().runtime.sendMessage({ type: "realtime-reconnect" });
```

- [ ] **步骤 6：更新 manifest**

修改 `apps/chrome-extension/public/manifest.json`：

```json
{
  "minimum_chrome_version": "116",
  "host_permissions": [
    "https://onetalk.alibaba.com/*",
    "https://*.alibaba.com/*",
    "http://127.0.0.1:5032/*",
    "ws://127.0.0.1:5032/*"
  ]
}
```

- [ ] **步骤 7：更新 popup 状态展示**

修改 `apps/chrome-extension/src/popup/popup.ts`，在读取 status 后显示：

```ts
setText("#realtime-status", status.realtime ? `实时连接：${status.realtime.state}` : "实时连接：未启动");
```

如果当前 HTML 没有 `#realtime-status`，在 `apps/chrome-extension/src/popup/popup.html` 增加一行：

```html
<p id="realtime-status">实时连接：读取中...</p>
```

- [ ] **步骤 8：运行插件测试**

运行：

```bash
npm run build -w @wangwang/collector-protocol
npm run test -w @wangwang/chrome-extension
npm run build -w @wangwang/chrome-extension
```

预期：PASS。

- [ ] **步骤 9：Commit**

```bash
git add apps/chrome-extension
git commit -m "feat(extension): 接入 collector 实时连接"
```

## 任务 10：端到端验证 WS outbound 主路径

**文件：**
- 创建：`test/e2e/collector-websocket-outbound.test.ts`
- 修改：`package.json`

- [ ] **步骤 1：编写失败的 e2e 测试**

创建 `test/e2e/collector-websocket-outbound.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore } from "@wangwang/database";
import { buildCollectorWsMessage, parseCollectorWsMessage } from "@wangwang/collector-protocol";
import { hashPassword } from "../../apps/server/src/auth.js";
import { createServer } from "../../apps/server/src/server.js";

test("web-created outbound message is delivered through collector websocket", async (t) => {
  const store = new InMemorySyncStore();
  await store.createInternalUser({
    email: "admin@example.com",
    displayName: "Admin User",
    passwordHash: await hashPassword("secret"),
    roles: ["admin"]
  });
  await store.registerCollectorDevice({
    sellerAccountExternalId: "seller-1",
    externalDeviceId: "device-1",
    deviceName: "Chrome Extension",
    token: "device-token"
  });
  const app = await createServer({ store });
  t.after(() => app.close());
  await app.ready();

  await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: "Bearer device-token" },
    payload: {
      sellerAccount: { externalAccountId: "seller-1" },
      device: { deviceId: "device-1" },
      customers: [{ externalCustomerId: "customer-1" }],
      conversations: [{ externalConversationId: "conv-1", externalCustomerId: "customer-1" }]
    }
  });

  const ws = await app.injectWS("/collector/v1/ws");
  t.after(() => ws.close());
  const ready = nextMessage(ws);
  ws.send(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "hello-1",
        type: "collector.hello",
        sentAt: "2026-06-01T00:00:00.000Z",
        payload: { collectorToken: "device-token", deviceId: "device-1", capabilities: ["outbound.claim"] }
      })
    )
  );
  assert.equal(parseCollectorWsMessage(await ready).type, "collector.ready");

  const authHeaders = await login(app);
  const available = nextMessage(ws);
  await app.inject({
    method: "POST",
    url: "/internal/v1/conversations/conv-1/outbound-messages?sellerAccountExternalId=seller-1",
    headers: authHeaders,
    payload: { content: "Quote is ready." }
  });
  assert.equal(parseCollectorWsMessage(await available).type, "outbound.available");

  const claimed = nextMessage(ws);
  ws.send(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "claim-1",
        type: "outbound.claim",
        sentAt: "2026-06-01T00:00:01.000Z",
        payload: { limit: 1, leaseMs: 120000 }
      })
    )
  );
  const claimedMessage = parseCollectorWsMessage(await claimed);
  assert.equal(claimedMessage.type, "outbound.claimed");
  const outboundId = claimedMessage.payload.messages[0].id;

  const ack = nextMessage(ws);
  ws.send(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "delivery-1",
        type: "outbound.delivery.report",
        sentAt: "2026-06-01T00:00:02.000Z",
        payload: {
          outboundMessageId: outboundId,
          status: "sent",
          externalMessageId: "onetalk-msg-1",
          deliveredAt: "2026-06-01T00:00:02.000Z"
        }
      })
    )
  );
  assert.equal(parseCollectorWsMessage(await ack).type, "ack");

  const outboundMessages = await store.listOutboundMessages({
    sellerAccountExternalId: "seller-1",
    externalConversationId: "conv-1"
  });
  assert.equal(outboundMessages[0].status, "sent");
  assert.equal(outboundMessages[0].externalMessageId, "onetalk-msg-1");
});

async function login(app: Awaited<ReturnType<typeof createServer>>) {
  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/auth/login",
    payload: { email: "admin@example.com", password: "secret" }
  });
  assert.equal(response.statusCode, 200);
  return { authorization: `Bearer ${response.json().token}` };
}

function nextMessage(ws: { once(event: "message", listener: (data: Buffer) => void): void }): Promise<string> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(data.toString()));
  });
}
```

- [ ] **步骤 2：运行 e2e 测试**

运行：

```bash
npm run build -w @wangwang/env
npm run build -w @wangwang/collector-protocol
npm run build -w @wangwang/database
npm run build -w @wangwang/server
node --import tsx --test test/e2e/collector-websocket-outbound.test.ts
```

预期：PASS。

- [ ] **步骤 3：运行全量验证**

运行：

```bash
npm run typecheck
npm run build
npm run test:e2e
```

预期：PASS。

- [ ] **步骤 4：Commit**

```bash
git add test/e2e/collector-websocket-outbound.test.ts package.json
git commit -m "test(e2e): 覆盖 collector WS 出站链路"
```

## 手工验收

- 启动 server 和 web：

```bash
npm run dev
```

- 构建 Chrome 插件：

```bash
npm run build -w @wangwang/chrome-extension
```

- 在 Chrome 加载 `apps/chrome-extension/dist`。
- 在插件选项页激活 collector，确认 popup 显示 `实时连接：connected`。
- 在 Web 端对已有会话发送一条文本 outbound。
- 预期：插件无需等待 1 分钟 alarm，几秒内通过 OneTalk 页面发送，并且 Web outbound 状态变为 `sent`。
- 关闭 server 后，popup 显示 `closed` 或 `error`；重启 server 后 1 分钟 watchdog 内恢复连接。

## 回滚策略

- 保留现有 HTTP collector endpoints 和 alarm 轮询，因此 WS 出现问题时可临时关闭 background 的 `startRealtimeConnection()` 调用。
- 数据库新增 claim 字段不破坏旧数据；旧 HTTP 轮询只会看到未 active claim 或 claim 已过期的 queued 消息。
- 若 Chrome 版本低于 116，manifest 会阻止安装新版插件；需要兼容旧 Chrome 时，恢复 manifest 最低版本并禁用 WS client。

## 自检结果

- 规格覆盖度：协议、数据库 claim、server hub、server WS route、server outbound push、插件 WS client、插件编排、background 接入、端到端验证均有任务。
- 占位符扫描：未发现禁止占位词或空泛错误处理步骤。
- 类型一致性：`outbound.claim`、`outbound.claimed`、`outbound.delivery.report` 在协议、server 和插件测试中字段一致。
- 风险控制：大批量 sync upload 不进入第一版 WS；HTTP fallback、alarm watchdog、claim lease 均保留。
