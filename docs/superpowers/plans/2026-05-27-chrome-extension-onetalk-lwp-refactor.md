# Chrome 插件 OneTalk LWP 重构实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [x]`）语法来跟踪进度。

**目标：** 将 Chrome 插件的 OneTalk 同步主路径从 HTTP 兼容接口迁移到 WebSocket LWP，并继续复用现有 TradeBridge collector sync/outbound 协议。

**架构：** `@wangwang/onetalk-adapter/browser` 新增 browser-safe 的 LWP 协议构造、响应解析和 LWP 数据规范化能力；Chrome 扩展新增页面 MTop token 桥、WebSocket RPC 客户端和 LWP 同步客户端。`sync-orchestrator` 保持上传协议不变，只把默认 OneTalk client 切换到 LWP 主路径，HTTP/page snapshot 只作为客户名补充和兼容诊断来源。

**技术栈：** TypeScript、Chrome Extension Manifest V3、WebSocket、Vite、Node test runner、`@wangwang/onetalk-adapter/browser`。

---

## 范围决策

- 一期同步方式：手动同步 + 现有 alarm 定时同步，允许分钟级延迟，不做常驻实时推送。
- 一期消息类型：文本消息优先，非文本保留 `messageType` 和去敏 raw 结构，正文无法可靠解析时不伪造内容。
- 一期分页上限：会话每次最多 100 条；每个会话默认拉 1 页消息，每页 20 条，保留 `maxPagesPerConversation` 参数继续用于测试和调优。
- 一期客户资料：主路径来自 LWP 会话；页面快照作为展示名补充；MTop/CRM 标签补充不阻塞本计划。
- 一期发送：继续使用 OneTalk 页面 SDK 代发人工文本消息；页面 SDK 不返回 messageId 时允许回写 `sent` 且 `externalMessageId` 为空。

## 文件结构

- 创建：`packages/onetalk-adapter/src/lwp-protocol.ts`
  - 负责 LWP 路由常量、帧解析、请求构造、注册/同步/会话/消息/心跳 frame builder。
- 创建：`packages/onetalk-adapter/src/lwp-normalizer.ts`
  - 负责从 LWP 响应中提取 `userConvs`、`userMessageModels`、`nextCursor`、`hasMore` 和注册 uid。
- 修改：`packages/onetalk-adapter/src/browser.ts`
  - 通过 browser-safe 入口导出 LWP 协议和规范化工具。
- 修改：`packages/onetalk-adapter/src/sync-mapper.ts`
  - 支持 LWP 嵌套会话、嵌套消息、`content.text.content`、`sender.uid` 和 pairFirst/pairSecond 方向判断。
- 测试：`packages/onetalk-adapter/test/lwp-protocol.test.ts`
  - 覆盖 LWP frame builder 和 frame parser。
- 测试：`packages/onetalk-adapter/test/lwp-normalizer.test.ts`
  - 覆盖 LWP 会话/消息响应提取。
- 测试：`packages/onetalk-adapter/test/sync-mapper.test.ts`
  - 覆盖 LWP conversation/message 到 `SyncBatch` 的映射。

- 创建：`apps/chrome-extension/src/background/onetalk-token-client.ts`
  - 负责通过已打开的 OneTalk tab 请求页面上下文执行 MTop token 获取。
- 创建：`apps/chrome-extension/src/background/lwp-rpc-client.ts`
  - 负责 WebSocket 连接、`mid` 请求关联、超时、心跳和关闭。
- 创建：`apps/chrome-extension/src/background/onetalk-lwp-client.ts`
  - 组合 token client、LWP RPC client 和 adapter normalizer，实现 `fetchWeblite()`、`getChatMessages()`。
- 修改：`apps/chrome-extension/src/background/index.ts`
  - 默认同步 client 从 HTTP `BrowserOnetalkClient` 切到 `BrowserOnetalkLwpClient`。
- 修改：`apps/chrome-extension/src/background/sync-orchestrator.ts`
  - 保存 LWP route 诊断，并在 LWP 同步失败时保留原有错误处理语义。
- 修改：`apps/chrome-extension/src/background/sanitizer.ts`
  - 增加 LWP session 相关敏感字段阻断。
- 修改：`apps/chrome-extension/src/content/onetalk-page-bridge.ts`
  - 增加 `get-onetalk-im-token` 消息处理，通过 page bridge 请求页面脚本。
- 修改：`apps/chrome-extension/src/content/onetalk-page-script.ts`
  - 增加页面侧 MTop token 请求处理，优先使用 `window.lib.mtop.request`。
- 修改：`apps/chrome-extension/src/shared/extension-messages.ts`
  - 增加 token 请求消息类型。
- 修改：`apps/chrome-extension/src/shared/sync-types.ts`
  - 扩展 `SyncDiagnostics`，记录 LWP route 状态。
- 修改：`apps/chrome-extension/src/popup/popup.ts`
  - 在现有诊断摘要中显示 LWP 会话/消息请求结果。
- 测试：`apps/chrome-extension/test/onetalk-token-client.test.ts`
  - 覆盖 OneTalk tab 缺失、页面响应无效、token 返回成功。
- 测试：`apps/chrome-extension/test/lwp-rpc-client.test.ts`
  - 覆盖 WebSocket open、request/response、timeout、heartbeat。
- 测试：`apps/chrome-extension/test/onetalk-lwp-client.test.ts`
  - 覆盖 LWP fetchWeblite/getChatMessages 行为。
- 测试：`apps/chrome-extension/test/sync-orchestrator.test.ts`
  - 覆盖 LWP 诊断落库。
- 测试：`apps/chrome-extension/test/sanitizer.test.ts`
  - 覆盖 LWP token/session 字段阻断。
- 测试：`apps/chrome-extension/test/outbound-orchestrator.test.ts`
  - 覆盖发送成功但无 externalMessageId 的回执语义。

## 任务 1：新增 LWP 协议工具

**文件：**
- 创建：`packages/onetalk-adapter/src/lwp-protocol.ts`
- 修改：`packages/onetalk-adapter/src/browser.ts`
- 测试：`packages/onetalk-adapter/test/lwp-protocol.test.ts`

- [x] **步骤 1：编写失败的测试**

创建 `packages/onetalk-adapter/test/lwp-protocol.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LWP_ROUTES,
  buildAckDiffFrame,
  buildConversationListFrame,
  buildGetStateFrame,
  buildHeartbeatFrame,
  buildMessageListFrame,
  buildRegisterFrame,
  parseLwpFrame
} from "../src/browser.js";

test("LWP frame builders match OneTalk HAR route shapes", () => {
  assert.deepEqual(JSON.parse(buildGetStateFrame("mid-state")), {
    lwp: "/r/SyncStatus/getState",
    headers: { mid: "mid-state" },
    body: [{ topic: "sync" }]
  });

  assert.deepEqual(JSON.parse(buildConversationListFrame("mid-conv", 1779862804977, 100)), {
    lwp: "/r/Conversation/listNewestPagination",
    headers: { mid: "mid-conv" },
    body: [1779862804977, 100]
  });

  assert.deepEqual(JSON.parse(buildMessageListFrame("mid-msg", "buyer-seller#11011@icbu", 9007199254740991, 20)), {
    lwp: "/r/MessageManager/listUserMessages",
    headers: { mid: "mid-msg" },
    body: ["buyer-seller#11011@icbu", false, 9007199254740991, 20, false]
  });

  assert.deepEqual(JSON.parse(buildHeartbeatFrame("mid-heartbeat")), {
    lwp: "/!",
    headers: { mid: "mid-heartbeat" }
  });

  assert.deepEqual(
    JSON.parse(
      buildRegisterFrame({
        mid: "mid-reg",
        appKey: "12574478",
        deviceId: "chrome-device",
        accessToken: "access-token",
        userAgent: "Mozilla/5.0"
      })
    ),
    {
      lwp: "/reg",
      headers: {
        mid: "mid-reg",
        "app-key": "12574478",
        did: "chrome-device",
        token: "access-token",
        ua: "Mozilla/5.0",
        dt: "j",
        wv: "im:1",
        sync: "1",
        "cache-header": "app-key did token ua"
      }
    }
  );

  assert.equal(LWP_ROUTES.messages, "/r/MessageManager/listUserMessages");
});

test("parseLwpFrame returns structured frame data", () => {
  const parsed = parseLwpFrame(
    JSON.stringify({
      code: 200,
      headers: { mid: "mid-1", sid: "sid-value" },
      body: { hasMore: false, nextCursor: "cursor-1", userConvs: [] }
    })
  );

  assert.deepEqual(parsed, {
    code: 200,
    route: undefined,
    mid: "mid-1",
    headers: { mid: "mid-1", sid: "sid-value" },
    body: { hasMore: false, nextCursor: "cursor-1", userConvs: [] },
    raw: {
      code: 200,
      headers: { mid: "mid-1", sid: "sid-value" },
      body: { hasMore: false, nextCursor: "cursor-1", userConvs: [] }
    }
  });
});

test("parseLwpFrame rejects non JSON frames", () => {
  assert.throws(() => parseLwpFrame("not-json"), /lwp_frame_invalid_json/);
});
```

- [x] **步骤 2：运行测试验证失败**

运行：

```bash
npm test -w @wangwang/onetalk-adapter -- lwp-protocol.test.ts
```

预期：FAIL，报错包含 `does not provide an export named 'LWP_ROUTES'`。

- [x] **步骤 3：编写最少实现代码**

创建 `packages/onetalk-adapter/src/lwp-protocol.ts`：

```ts
export const LWP_ROUTES = {
  register: "/reg",
  getState: "/r/SyncStatus/getState",
  ackDiff: "/r/SyncStatus/ackDiff",
  conversations: "/r/Conversation/listNewestPagination",
  messages: "/r/MessageManager/listUserMessages",
  heartbeat: "/!"
} as const;

export interface ParsedLwpFrame {
  code?: number;
  route?: string;
  mid?: string;
  headers: Record<string, unknown>;
  body?: unknown;
  raw: Record<string, unknown>;
}

export interface RegisterFrameInput {
  mid: string;
  appKey: string;
  deviceId: string;
  accessToken: string;
  userAgent: string;
}

export function buildRegisterFrame(input: RegisterFrameInput): string {
  return JSON.stringify({
    lwp: LWP_ROUTES.register,
    headers: {
      mid: input.mid,
      "app-key": input.appKey,
      did: input.deviceId,
      token: input.accessToken,
      ua: input.userAgent,
      dt: "j",
      wv: "im:1",
      sync: "1",
      "cache-header": "app-key did token ua"
    }
  });
}

export function buildGetStateFrame(mid: string): string {
  return buildLwpFrame(mid, LWP_ROUTES.getState, [{ topic: "sync" }]);
}

export function buildAckDiffFrame(mid: string, state: Record<string, unknown>): string {
  return buildLwpFrame(mid, LWP_ROUTES.ackDiff, [state]);
}

export function buildConversationListFrame(mid: string, cursor: number, pageSize: number): string {
  return buildLwpFrame(mid, LWP_ROUTES.conversations, [cursor, pageSize]);
}

export function buildMessageListFrame(mid: string, cid: string, cursor: number, pageSize: number): string {
  return buildLwpFrame(mid, LWP_ROUTES.messages, [cid, false, cursor, pageSize, false]);
}

export function buildHeartbeatFrame(mid: string): string {
  return JSON.stringify({
    lwp: LWP_ROUTES.heartbeat,
    headers: { mid }
  });
}

export function parseLwpFrame(text: string): ParsedLwpFrame {
  const raw = parseRecord(text);
  const headers = isRecord(raw.headers) ? raw.headers : {};
  const mid = typeof headers.mid === "string" ? headers.mid : undefined;
  const code = typeof raw.code === "number" ? raw.code : undefined;
  const route = typeof raw.lwp === "string" ? raw.lwp : undefined;
  return {
    code,
    route,
    mid,
    headers,
    body: raw.body,
    raw
  };
}

function buildLwpFrame(mid: string, route: string, body: unknown): string {
  return JSON.stringify({
    lwp: route,
    headers: { mid },
    body
  });
}

function parseRecord(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    if (isRecord(value)) return value;
  } catch {
    throw new Error("lwp_frame_invalid_json");
  }
  throw new Error("lwp_frame_invalid_shape");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
```

修改 `packages/onetalk-adapter/src/browser.ts`：

```ts
export * from "./lwp-protocol.js";
export { buildPayload } from "./payload.js";
export { extractJsonAfter, pageBootstrap } from "./weblite-parser.js";
export type {
  ChatDataSummaryResponse,
  ChatMessageRequest,
  ChatMessageResponse,
  WebliteData,
  WeblitePageConversation,
  WeblitePageSnapshot
} from "./onetalk-client.js";
export * from "./sync-mapper.js";
```

- [x] **步骤 4：运行测试验证通过**

运行：

```bash
npm test -w @wangwang/onetalk-adapter -- lwp-protocol.test.ts
```

预期：PASS，3 个测试通过。

- [x] **步骤 5：Commit**

```bash
git add packages/onetalk-adapter/src/lwp-protocol.ts packages/onetalk-adapter/src/browser.ts packages/onetalk-adapter/test/lwp-protocol.test.ts
git commit -m "feat(onetalk-adapter): add LWP protocol helpers"
```

## 任务 2：新增 LWP 响应规范化

**文件：**
- 创建：`packages/onetalk-adapter/src/lwp-normalizer.ts`
- 修改：`packages/onetalk-adapter/src/browser.ts`
- 测试：`packages/onetalk-adapter/test/lwp-normalizer.test.ts`

- [x] **步骤 1：编写失败的测试**

创建 `packages/onetalk-adapter/test/lwp-normalizer.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  lwpConversationPageFromFrame,
  lwpMessagesPageFromFrame,
  lwpRegisterStateFromFrame,
  parseLwpFrame
} from "../src/browser.js";

test("lwpRegisterStateFromFrame extracts safe registration state", () => {
  const state = lwpRegisterStateFromFrame(
    parseLwpFrame(
      JSON.stringify({
        code: 200,
        headers: { mid: "reg-mid", "reg-uid": "seller-ali", sid: "sid-secret" },
        body: { unitName: "icbu", timestamp: 1779862804977, cookie: "secret-cookie" }
      })
    )
  );

  assert.deepEqual(state, {
    ok: true,
    uid: "seller-ali",
    unitName: "icbu"
  });
});

test("lwpConversationPageFromFrame extracts conversation records and cursor", () => {
  const page = lwpConversationPageFromFrame(
    parseLwpFrame(
      JSON.stringify({
        code: 200,
        headers: { mid: "conv-mid" },
        body: {
          hasMore: true,
          nextCursor: 1779862804000,
          userConvs: [
            {
              singleChatUserConversation: {
                singleChatConversation: { cid: "conv-1", pairFirst: "seller-ali", pairSecond: "buyer-ali" },
                modifyTime: 1779862803000
              }
            }
          ]
        }
      })
    )
  );

  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, 1779862804000);
  assert.equal(page.conversations.length, 1);
  assert.equal(page.conversations[0].singleChatUserConversation?.singleChatConversation?.cid, "conv-1");
});

test("lwpMessagesPageFromFrame unwraps userMessageModels", () => {
  const page = lwpMessagesPageFromFrame(
    parseLwpFrame(
      JSON.stringify({
        code: 200,
        headers: { mid: "msg-mid" },
        body: {
          hasMore: false,
          nextCursor: "cursor-next",
          userMessageModels: [
            {
              message: {
                messageId: "msg-1",
                cid: "conv-1",
                createAt: 1779862801000,
                content: { text: { content: "hello" } },
                sender: { uid: "buyer-ali" }
              }
            }
          ]
        }
      })
    )
  );

  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor, "cursor-next");
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].message?.messageId, "msg-1");
});
```

- [x] **步骤 2：运行测试验证失败**

运行：

```bash
npm test -w @wangwang/onetalk-adapter -- lwp-normalizer.test.ts
```

预期：FAIL，报错包含 `does not provide an export named 'lwpConversationPageFromFrame'`。

- [x] **步骤 3：编写最少实现代码**

创建 `packages/onetalk-adapter/src/lwp-normalizer.ts`：

```ts
import type { ParsedLwpFrame } from "./lwp-protocol.js";

export interface LwpRegisterState {
  ok: boolean;
  uid?: string;
  unitName?: string;
}

export interface LwpConversationPage {
  conversations: Record<string, unknown>[];
  hasMore: boolean;
  nextCursor?: string | number;
}

export interface LwpMessagesPage {
  messages: Record<string, unknown>[];
  hasMore: boolean;
  nextCursor?: string | number;
}

export function lwpRegisterStateFromFrame(frame: ParsedLwpFrame): LwpRegisterState {
  const body = isRecord(frame.body) ? frame.body : {};
  return {
    ok: frame.code === 200,
    uid: stringValue(frame.headers["reg-uid"]),
    unitName: stringValue(body.unitName)
  };
}

export function lwpConversationPageFromFrame(frame: ParsedLwpFrame): LwpConversationPage {
  const body = isRecord(frame.body) ? frame.body : {};
  const conversations = Array.isArray(body.userConvs) ? body.userConvs.filter(isRecord) : [];
  return {
    conversations,
    hasMore: body.hasMore === true,
    nextCursor: cursorValue(body.nextCursor)
  };
}

export function lwpMessagesPageFromFrame(frame: ParsedLwpFrame): LwpMessagesPage {
  const body = isRecord(frame.body) ? frame.body : {};
  const messages = Array.isArray(body.userMessageModels) ? body.userMessageModels.filter(isRecord) : [];
  return {
    messages,
    hasMore: body.hasMore === true,
    nextCursor: cursorValue(body.nextCursor)
  };
}

function cursorValue(value: unknown): string | number | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
```

修改 `packages/onetalk-adapter/src/browser.ts`：

```ts
export * from "./lwp-normalizer.js";
export * from "./lwp-protocol.js";
export { buildPayload } from "./payload.js";
export { extractJsonAfter, pageBootstrap } from "./weblite-parser.js";
export type {
  ChatDataSummaryResponse,
  ChatMessageRequest,
  ChatMessageResponse,
  WebliteData,
  WeblitePageConversation,
  WeblitePageSnapshot
} from "./onetalk-client.js";
export * from "./sync-mapper.js";
```

- [x] **步骤 4：运行测试验证通过**

运行：

```bash
npm test -w @wangwang/onetalk-adapter -- lwp-normalizer.test.ts
```

预期：PASS，3 个测试通过。

- [x] **步骤 5：Commit**

```bash
git add packages/onetalk-adapter/src/lwp-normalizer.ts packages/onetalk-adapter/src/browser.ts packages/onetalk-adapter/test/lwp-normalizer.test.ts
git commit -m "feat(onetalk-adapter): normalize OneTalk LWP responses"
```

## 任务 3：增强 SyncBatch 映射以支持 LWP 嵌套模型

**文件：**
- 修改：`packages/onetalk-adapter/src/sync-mapper.ts`
- 测试：`packages/onetalk-adapter/test/sync-mapper.test.ts`

- [x] **步骤 1：编写失败的测试**

在 `packages/onetalk-adapter/test/sync-mapper.test.ts` 追加：

```ts
test("mapWebliteToSyncBatch maps LWP conversation and message models from OneTalk WebSocket", () => {
  const lastMessageAt = Date.parse("2026-05-27T04:33:20.000Z");
  const inboundAt = Date.parse("2026-05-27T04:32:30.000Z");
  const outboundAt = Date.parse("2026-05-27T04:33:10.000Z");

  const batch = mapWebliteToSyncBatch({
    sellerAccount: { externalAccountId: "seller-demo" },
    device: { deviceId: "chrome-extension-demo" },
    collectedAt: "2026-05-27T04:40:00.000Z",
    source: "chrome-extension",
    previousCursor: null,
    weblite: {
      html: "",
      bootstrap: { aliId: "seller-ali" },
      conversations: [
        {
          singleChatUserConversation: {
            modifyTime: lastMessageAt,
            lastMessage: {
              message: {
                cid: "conv-lwp-1",
                createAt: lastMessageAt,
                content: { contentType: 1, text: { content: "latest message" } }
              }
            },
            singleChatConversation: {
              cid: "conv-lwp-1",
              pairFirst: "seller-ali",
              pairSecond: "buyer-ali"
            }
          }
        }
      ]
    },
    messagesByConversationId: {
      "conv-lwp-1": [
        {
          message: {
            messageId: "msg-lwp-in",
            cid: "conv-lwp-1",
            createAt: inboundAt,
            content: { contentType: 1, text: { content: "Hello from buyer" } },
            searchableContent: { summary: "Hello from buyer" },
            sender: { uid: "buyer-ali" },
            receivers: [{ uid: "seller-ali" }]
          }
        },
        {
          message: {
            messageId: "msg-lwp-out",
            cid: "conv-lwp-1",
            createAt: outboundAt,
            content: { contentType: 1, text: { content: "Offer sent" } },
            searchableContent: { summary: "Offer sent" },
            sender: { uid: "seller-ali" },
            receivers: [{ uid: "buyer-ali" }]
          }
        }
      ]
    }
  });

  assert.deepEqual(batch.customers, [{ externalCustomerId: "buyer-ali" }]);
  assert.deepEqual(batch.conversations, [
    {
      externalConversationId: "conv-lwp-1",
      externalCustomerId: "buyer-ali",
      lastMessageAt: "2026-05-27T04:33:20.000Z"
    }
  ]);
  assert.deepEqual(
    batch.messages?.map((message) => ({
      id: message.externalMessageId,
      direction: message.direction,
      content: message.content,
      sentAt: message.sentAt
    })),
    [
      {
        id: "msg-lwp-in",
        direction: "received",
        content: "Hello from buyer",
        sentAt: "2026-05-27T04:32:30.000Z"
      },
      {
        id: "msg-lwp-out",
        direction: "sent",
        content: "Offer sent",
        sentAt: "2026-05-27T04:33:10.000Z"
      }
    ]
  );
});
```

- [x] **步骤 2：运行测试验证失败**

运行：

```bash
npm test -w @wangwang/onetalk-adapter -- sync-mapper.test.ts
```

预期：FAIL，新增测试中 `batch.customers` 为空或消息内容未映射。

- [x] **步骤 3：编写最少实现代码**

修改 `packages/onetalk-adapter/src/sync-mapper.ts`，保留现有导出和类型，加入以下 helper，并在主循环中使用这些 helper。

在主循环开头替换会话 ID 和客户 ID 提取：

```ts
const lwpConversation = lwpSingleChatConversation(conversation);
const externalConversationId =
  firstString(conversation, ["cid", "conversationCode", "conversationId", "id"]) ||
  firstString(lwpConversation, ["cid"]);
const externalCustomerId =
  firstString(conversation, ["contactAccountId", "contactAccountIdEncrypt", "buyerAccountId", "contactAliId"]) ||
  lwpCustomerId(lwpConversation, options.weblite.bootstrap);
```

在 `firstMessageTime()` 的候选字段中加入 LWP 路径：

```ts
function firstMessageTime(conversation: Record<string, unknown>): unknown {
  return firstValue(conversation, [
    "lastMessageTime",
    "lastMessageAt",
    "lastMsgTime",
    "latestMessage.sendTime",
    "latestMessage.time",
    "latestMessage.gmtCreate",
    "latestMessage.createdAt",
    "lastMessage.sendTime",
    "lastMessage.time",
    "lastMessage.gmtCreate",
    "lastMessage.createdAt",
    "singleChatUserConversation.lastMessage.message.createAt",
    "singleChatUserConversation.modifyTime"
  ]);
}
```

在 `mapMessage()` 中先解包 LWP message：

```ts
function mapMessage(
  raw: Record<string, unknown>,
  externalConversationId: string,
  bootstrap: Record<string, string>,
  conversation: Record<string, unknown>
): BrowserSyncMessageInput | null {
  const message = lwpMessage(raw) || raw;
  const sentAt = isoTime(firstValue(message, ["sendTime", "sentAt", "time", "gmtCreate", "createdAt", "createAt"]));
  return compact({
    externalConversationId,
    externalMessageId: firstString(message, ["messageId", "msgId", "messageID", "msgIdStr", "id"]),
    direction: directionOf(message, bootstrap, conversation),
    messageType: firstString(message, ["messageType", "type", "msgType", "content.contentType", "displayStyle"]) || "text",
    content: firstString(message, [
      "content",
      "text",
      "message",
      "summary",
      "messageContent",
      "textContent",
      "showText",
      "plainText",
      "content.text.content",
      "searchableContent.summary"
    ]),
    sentAt,
    rawSanitized: raw
  });
}
```

Replace `directionOf()` with:

```ts
function directionOf(
  message: Record<string, unknown>,
  bootstrap: Record<string, string>,
  conversation: Record<string, unknown>
): MessageDirection {
  const explicit = firstString(message, ["direction"]);
  if (explicit === "sent" || explicit === "received" || explicit === "unknown") return explicit;
  const sender = firstString(message, ["senderAliId", "fromAliId", "senderId", "fromId", "sender.uid"]);
  const self =
    firstString(conversation, ["selfAliId"]) ||
    firstString(lwpSingleChatConversation(conversation), ["pairFirst"]) ||
    bootstrap.aliId;
  if (!sender || !self) return "unknown";
  return sender === self ? "sent" : "received";
}
```

在文件底部 `isRecord()` 前加入：

```ts
function lwpSingleChatConversation(conversation: Record<string, unknown>): Record<string, unknown> {
  const wrapper = valueAtPath(conversation, ["singleChatUserConversation", "singleChatConversation"]);
  return isRecord(wrapper) ? wrapper : {};
}

function lwpCustomerId(lwpConversation: Record<string, unknown>, bootstrap: Record<string, string>): string | undefined {
  const pairFirst = firstString(lwpConversation, ["pairFirst"]);
  const pairSecond = firstString(lwpConversation, ["pairSecond"]);
  const self = bootstrap.aliId;
  if (self && pairFirst === self) return pairSecond;
  if (self && pairSecond === self) return pairFirst;
  return pairSecond || pairFirst;
}

function lwpMessage(raw: Record<string, unknown>): Record<string, unknown> | null {
  const value = raw.message;
  return isRecord(value) ? value : null;
}
```

- [x] **步骤 4：运行测试验证通过**

运行：

```bash
npm test -w @wangwang/onetalk-adapter -- sync-mapper.test.ts
```

预期：PASS，现有映射测试和新增 LWP 测试全部通过。

- [x] **步骤 5：Commit**

```bash
git add packages/onetalk-adapter/src/sync-mapper.ts packages/onetalk-adapter/test/sync-mapper.test.ts
git commit -m "feat(onetalk-adapter): map OneTalk LWP models"
```

## 任务 4：通过 OneTalk 页面上下文获取 IM token

**文件：**
- 创建：`apps/chrome-extension/src/background/onetalk-token-client.ts`
- 修改：`apps/chrome-extension/src/content/onetalk-page-bridge.ts`
- 修改：`apps/chrome-extension/src/content/onetalk-page-script.ts`
- 修改：`apps/chrome-extension/src/shared/extension-messages.ts`
- 测试：`apps/chrome-extension/test/onetalk-token-client.test.ts`
- 测试：`apps/chrome-extension/test/manifest.test.ts`

- [x] **步骤 1：编写失败的测试**

创建 `apps/chrome-extension/test/onetalk-token-client.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { requestOneTalkImToken } from "../src/background/onetalk-token-client.js";
import type { ChromeApi } from "../src/shared/chrome-api.js";

test("requestOneTalkImToken sends request to an open OneTalk tab", async () => {
  const sentMessages: unknown[] = [];
  const token = await requestOneTalkImToken({
    chromeApi: fakeChromeApi(sentMessages, {
      ok: true,
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresInMs: 3600000
    }),
    appKey: "12574478",
    deviceId: "chrome-extension-demo"
  });

  assert.equal(token.accessToken, "access-token");
  assert.equal(token.refreshToken, "refresh-token");
  assert.equal(token.expiresInMs, 3600000);
  assert.deepEqual(sentMessages, [
    {
      type: "get-onetalk-im-token",
      appKey: "12574478",
      deviceId: "chrome-extension-demo"
    }
  ]);
});

test("requestOneTalkImToken fails when no OneTalk tab is open", async () => {
  await assert.rejects(
    () =>
      requestOneTalkImToken({
        chromeApi: fakeChromeApi([], { ok: false }, []),
        appKey: "12574478",
        deviceId: "chrome-extension-demo"
      }),
    /onetalk_tab_required/
  );
});

test("requestOneTalkImToken rejects invalid page responses", async () => {
  await assert.rejects(
    () =>
      requestOneTalkImToken({
        chromeApi: fakeChromeApi([], { ok: true, accessToken: "" }),
        appKey: "12574478",
        deviceId: "chrome-extension-demo"
      }),
    /onetalk_token_response_invalid/
  );
});

function fakeChromeApi(sentMessages: unknown[], response: unknown, tabs = [{ id: 9 }]): ChromeApi {
  return {
    runtime: {
      onInstalled: { addListener: () => undefined },
      onMessage: { addListener: () => undefined },
      sendMessage: async () => undefined,
      getURL: (path) => `chrome-extension://id/${path}`,
      openOptionsPage: () => undefined
    },
    storage: { local: { get: async () => ({}), set: async () => undefined } },
    alarms: { create: () => undefined, onAlarm: { addListener: () => undefined } },
    tabs: {
      query: async () => tabs,
      sendMessage: async (_tabId, message) => {
        sentMessages.push(message);
        return response;
      }
    }
  };
}
```

在 `apps/chrome-extension/test/manifest.test.ts` 的 `OneTalk content script stays classic-script compatible` 测试中保留现有断言。这个任务会修改 content bridge，但不能引入 runtime import/export。

- [x] **步骤 2：运行测试验证失败**

运行：

```bash
npm test -w @wangwang/chrome-extension -- onetalk-token-client.test.ts manifest.test.ts
```

预期：FAIL，报错包含 `Cannot find module '../src/background/onetalk-token-client.js'`。

- [x] **步骤 3：编写最少实现代码**

创建 `apps/chrome-extension/src/background/onetalk-token-client.ts`：

```ts
import type { ChromeApi } from "../shared/chrome-api.js";

export interface OneTalkImToken {
  accessToken: string;
  refreshToken?: string;
  expiresInMs?: number;
}

export interface RequestOneTalkImTokenOptions {
  chromeApi: ChromeApi;
  appKey: string;
  deviceId: string;
}

export async function requestOneTalkImToken(options: RequestOneTalkImTokenOptions): Promise<OneTalkImToken> {
  if (!options.chromeApi.tabs) throw new Error("chrome_tabs_unavailable");
  const tabs = await options.chromeApi.tabs.query({ url: "https://onetalk.alibaba.com/*" });
  const tab = tabs.find((item) => typeof item.id === "number");
  if (typeof tab?.id !== "number") throw new Error("onetalk_tab_required");

  const response = await options.chromeApi.tabs.sendMessage(tab.id, {
    type: "get-onetalk-im-token",
    appKey: options.appKey,
    deviceId: options.deviceId
  });
  if (!isTokenResponse(response)) throw new Error("onetalk_token_response_invalid");
  if (!response.ok) throw new Error(response.error || "onetalk_token_fetch_failed");
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    expiresInMs: response.expiresInMs
  };
}

function isTokenResponse(value: unknown): value is {
  ok: boolean;
  accessToken: string;
  refreshToken?: string;
  expiresInMs?: number;
  error?: string;
} {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    (value.ok === false || (typeof value.accessToken === "string" && value.accessToken.length > 0)) &&
    (value.refreshToken === undefined || typeof value.refreshToken === "string") &&
    (value.expiresInMs === undefined || typeof value.expiresInMs === "number") &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
```

修改 `apps/chrome-extension/src/shared/extension-messages.ts`，扩展 union：

```ts
export type ExtensionMessage =
  | { type: "onetalk-page-ready"; url: string }
  | { type: "onetalk-login-required"; url: string }
  | { type: "onetalk-page-snapshot"; url: string; snapshot: WeblitePageSnapshot }
  | { type: "send-onetalk-message"; message: OutboundMessage }
  | { type: "get-onetalk-im-token"; appKey: string; deviceId: string }
  | { type: "sync-now" }
  | { type: "open-options" }
  | { type: "read-status" };
```

修改 `apps/chrome-extension/src/content/onetalk-page-bridge.ts` 的 `onMessage` listener：

```ts
chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const typed = message as ExtensionMessage;
  if (typed.type === "send-onetalk-message") {
    void sendOutboundMessageToPage(typed.message).then(sendResponse);
    return true;
  }
  if (typed.type === "get-onetalk-im-token") {
    void requestImTokenFromPage(typed.appKey, typed.deviceId).then(sendResponse);
    return true;
  }
  return false;
});
```

在 `sendOutboundMessageToPage()` 下方加入：

```ts
async function requestImTokenFromPage(appKey: string, deviceId: string) {
  const requestId = `tradebridge-token-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      resolve({ ok: false, error: "onetalk_token_timeout" });
    }, 15000);

    function handleMessage(event: MessageEvent): void {
      if (event.source !== window || !isRecord(event.data)) return;
      if (event.data.source !== "tradebridge-onetalk-page") return;
      if (event.data.type !== "get-onetalk-im-token-result" || event.data.requestId !== requestId) return;

      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
      resolve({
        ok: event.data.ok === true,
        accessToken: typeof event.data.accessToken === "string" ? event.data.accessToken : undefined,
        refreshToken: typeof event.data.refreshToken === "string" ? event.data.refreshToken : undefined,
        expiresInMs: typeof event.data.expiresInMs === "number" ? event.data.expiresInMs : undefined,
        error: typeof event.data.error === "string" ? event.data.error : undefined
      });
    }

    window.addEventListener("message", handleMessage);
    window.postMessage(
      {
        source: "tradebridge-extension",
        type: "get-onetalk-im-token",
        requestId,
        appKey,
        deviceId
      },
      window.location.origin
    );
  });
}
```

修改 `apps/chrome-extension/src/content/onetalk-page-script.ts`，扩展 `PageBridgeWindow`：

```ts
interface PageBridgeWindow extends Window {
  IcbuIM?: {
    IMBaaSSDK?: {
      default?: {
        getMessageService?: () => OneTalkMessageService;
      };
    };
  };
  lib?: {
    mtop?: {
      request?: (options: unknown, callback?: (response: unknown) => void) => Promise<unknown> | unknown;
    };
  };
  __tradeBridgeOneTalkPageBridgeInstalled?: boolean;
}
```

替换 `window.addEventListener("message", ...)` 内的分支判断：

```ts
window.addEventListener("message", (event) => {
  if (event.source !== window || !isRecord(event.data)) return;
  if (event.data.source !== "tradebridge-extension") return;
  if (event.data.type === "send-onetalk-message") {
    void handleSendRequest(event.data);
    return;
  }
  if (event.data.type === "get-onetalk-im-token") {
    void handleTokenRequest(event.data);
  }
});
```

在 `handleSendRequest()` 下方加入：

```ts
async function handleTokenRequest(data: Record<string, unknown>): Promise<void> {
  const requestId = typeof data.requestId === "string" ? data.requestId : "";
  const appKey = typeof data.appKey === "string" ? data.appKey : "12574478";
  const deviceId = typeof data.deviceId === "string" ? data.deviceId : "";
  if (!requestId || !deviceId) {
    publishTokenResult(requestId, false, undefined, undefined, undefined, "invalid_token_request");
    return;
  }

  try {
    const result = await requestMtopToken(appKey, deviceId);
    const object = tokenObjectFromMtopResult(result);
    if (!object?.accessToken) throw new Error("onetalk_token_response_invalid");
    publishTokenResult(
      requestId,
      true,
      object.accessToken,
      object.refreshToken,
      object.accessTokenExpiredMillSeconds
    );
  } catch (error) {
    publishTokenResult(
      requestId,
      false,
      undefined,
      undefined,
      undefined,
      error instanceof Error ? error.message : "onetalk_token_fetch_failed"
    );
  }
}

function requestMtopToken(appKey: string, deviceId: string): Promise<unknown> {
  const request = pageWindow.lib?.mtop?.request;
  if (!request) return Promise.reject(new Error("onetalk_mtop_unavailable"));
  const options = {
    api: "mtop.alibaba.icbu.im.login.token.get",
    v: "1.0",
    appKey,
    dataType: "json",
    type: "GET",
    data: { appKey, deviceId }
  };
  return new Promise((resolve, reject) => {
    try {
      const maybePromise = request(options, resolve);
      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === "function") {
        (maybePromise as Promise<unknown>).then(resolve, reject);
      }
    } catch (error) {
      reject(error);
    }
  });
}

function tokenObjectFromMtopResult(value: unknown): {
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiredMillSeconds?: number;
} | null {
  const data = isRecord(value) && isRecord(value.data) ? value.data : null;
  const object = data && isRecord(data.object) ? data.object : null;
  if (!object) return null;
  return {
    accessToken: firstString(object, ["accessToken"]),
    refreshToken: firstString(object, ["refreshToken"]),
    accessTokenExpiredMillSeconds:
      typeof object.accessTokenExpiredMillSeconds === "number" ? object.accessTokenExpiredMillSeconds : undefined
  };
}

function publishTokenResult(
  requestId: string,
  ok: boolean,
  accessToken?: string,
  refreshToken?: string,
  expiresInMs?: number,
  error?: string
): void {
  window.postMessage(
    {
      source: "tradebridge-onetalk-page",
      type: "get-onetalk-im-token-result",
      requestId,
      ok,
      accessToken,
      refreshToken,
      expiresInMs,
      error
    },
    window.location.origin
  );
}
```

- [x] **步骤 4：运行测试验证通过**

运行：

```bash
npm test -w @wangwang/chrome-extension -- onetalk-token-client.test.ts manifest.test.ts
```

预期：PASS，token client 测试通过，content bridge 仍满足 classic-script compatibility。

- [x] **步骤 5：Commit**

```bash
git add apps/chrome-extension/src/background/onetalk-token-client.ts apps/chrome-extension/src/content/onetalk-page-bridge.ts apps/chrome-extension/src/content/onetalk-page-script.ts apps/chrome-extension/src/shared/extension-messages.ts apps/chrome-extension/test/onetalk-token-client.test.ts apps/chrome-extension/test/manifest.test.ts
git commit -m "feat(chrome-extension): request OneTalk IM token from page context"
```

## 任务 5：实现 WebSocket LWP RPC 客户端

**文件：**
- 创建：`apps/chrome-extension/src/background/lwp-rpc-client.ts`
- 测试：`apps/chrome-extension/test/lwp-rpc-client.test.ts`

- [x] **步骤 1：编写失败的测试**

创建 `apps/chrome-extension/test/lwp-rpc-client.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { LwpRpcClient } from "../src/background/lwp-rpc-client.js";

test("LwpRpcClient sends request frames and resolves matching mid responses", async () => {
  const socket = new FakeSocket();
  const client = new LwpRpcClient({
    socketFactory: () => socket as never,
    nextMid: () => "mid-1",
    timeoutMs: 1000
  });

  const opened = client.connect();
  socket.emit("open", {});
  await opened;

  const pending = client.request("/r/SyncStatus/getState", [{ topic: "sync" }]);
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    lwp: "/r/SyncStatus/getState",
    headers: { mid: "mid-1" },
    body: [{ topic: "sync" }]
  });

  socket.emit("message", {
    data: JSON.stringify({ code: 200, headers: { mid: "mid-1" }, body: { topic: "sync" } })
  });

  const frame = await pending;
  assert.equal(frame.code, 200);
  assert.equal(frame.mid, "mid-1");
  assert.deepEqual(frame.body, { topic: "sync" });
});

test("LwpRpcClient rejects requests on timeout", async () => {
  const socket = new FakeSocket();
  const client = new LwpRpcClient({
    socketFactory: () => socket as never,
    nextMid: () => "mid-timeout",
    timeoutMs: 1
  });

  const opened = client.connect();
  socket.emit("open", {});
  await opened;

  await assert.rejects(() => client.request("/r/SyncStatus/getState", [{ topic: "sync" }]), /lwp_request_timeout/);
});

test("LwpRpcClient can send heartbeat frames", async () => {
  const socket = new FakeSocket();
  const client = new LwpRpcClient({
    socketFactory: () => socket as never,
    nextMid: () => "mid-heartbeat",
    timeoutMs: 1000
  });

  const opened = client.connect();
  socket.emit("open", {});
  await opened;

  client.heartbeat();
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    lwp: "/!",
    headers: { mid: "mid-heartbeat" }
  });
});

test("LwpRpcClient sends raw frames without dropping custom headers", async () => {
  const socket = new FakeSocket();
  const client = new LwpRpcClient({
    socketFactory: () => socket as never,
    timeoutMs: 1000
  });

  const opened = client.connect();
  socket.emit("open", {});
  await opened;

  const pending = client.requestFrame(
    JSON.stringify({
      lwp: "/reg",
      headers: {
        mid: "mid-reg",
        token: "access-token",
        "app-key": "12574478"
      }
    })
  );
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    lwp: "/reg",
    headers: {
      mid: "mid-reg",
      token: "access-token",
      "app-key": "12574478"
    }
  });

  socket.emit("message", {
    data: JSON.stringify({ code: 200, headers: { mid: "mid-reg", "reg-uid": "seller-ali" }, body: { unitName: "icbu" } })
  });

  const frame = await pending;
  assert.equal(frame.mid, "mid-reg");
  assert.equal(frame.headers["reg-uid"], "seller-ali");
});

class FakeSocket {
  sent: string[] = [];
  readyState = 0;
  private listeners = new Map<string, Array<(event: unknown) => void>>();

  addEventListener(type: string, callback: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), callback]);
  }

  removeEventListener(type: string, callback: (event: unknown) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter((item) => item !== callback)
    );
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.emit("close", {});
  }

  emit(type: string, event: unknown) {
    if (type === "open") this.readyState = 1;
    for (const callback of this.listeners.get(type) || []) callback(event);
  }
}
```

- [x] **步骤 2：运行测试验证失败**

运行：

```bash
npm test -w @wangwang/chrome-extension -- lwp-rpc-client.test.ts
```

预期：FAIL，报错包含 `Cannot find module '../src/background/lwp-rpc-client.js'`。

- [x] **步骤 3：编写最少实现代码**

创建 `apps/chrome-extension/src/background/lwp-rpc-client.ts`：

```ts
import { buildHeartbeatFrame, parseLwpFrame, type ParsedLwpFrame } from "@wangwang/onetalk-adapter/browser";

const LWP_ENDPOINT = "wss://wss-icbu.dingtalk.com/";

interface SocketLike {
  readyState: number;
  addEventListener(type: "open" | "message" | "error" | "close", callback: (event: Event | MessageEvent) => void): void;
  removeEventListener(type: "open" | "message" | "error" | "close", callback: (event: Event | MessageEvent) => void): void;
  send(data: string): void;
  close(): void;
}

export interface LwpRpcClientOptions {
  socketFactory?: () => SocketLike;
  nextMid?: () => string;
  timeoutMs?: number;
}

export class LwpRpcClient {
  private socket: SocketLike | null = null;
  private sequence = 0;
  private readonly pending = new Map<string, { resolve(frame: ParsedLwpFrame): void; reject(error: Error): void; timer: number }>();

  constructor(private readonly options: LwpRpcClientOptions = {}) {}

  connect(): Promise<void> {
    const socket = this.options.socketFactory?.() || new WebSocket(LWP_ENDPOINT);
    this.socket = socket;
    socket.addEventListener("message", this.handleMessage);
    return new Promise((resolve, reject) => {
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error("lwp_socket_open_failed"));
      };
      const cleanup = () => {
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleError);
      };
      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleError);
    });
  }

  request(route: string, body: unknown): Promise<ParsedLwpFrame> {
    const mid = this.nextMid();
    const frame = JSON.stringify({ lwp: route, headers: { mid }, body });
    return this.requestFrame(frame);
  }

  requestFrame(frameText: string): Promise<ParsedLwpFrame> {
    const socket = this.requireOpenSocket();
    const parsed = parseLwpFrame(frameText);
    if (!parsed.mid) throw new Error("lwp_request_mid_missing");
    const timeoutMs = this.options.timeoutMs || 15000;
    return new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.pending.delete(parsed.mid || "");
        reject(new Error("lwp_request_timeout"));
      }, timeoutMs) as unknown as number;
      this.pending.set(parsed.mid, { resolve, reject, timer });
      socket.send(frameText);
    });
  }

  heartbeat(): void {
    this.requireOpenSocket().send(buildHeartbeatFrame(this.nextMid()));
  }

  close(): void {
    for (const [mid, pending] of this.pending) {
      globalThis.clearTimeout(pending.timer);
      pending.reject(new Error("lwp_socket_closed"));
      this.pending.delete(mid);
    }
    this.socket?.close();
    this.socket = null;
  }

  private readonly handleMessage = (event: Event | MessageEvent): void => {
    const data = "data" in event && typeof event.data === "string" ? event.data : "";
    if (!data) return;
    const frame = parseLwpFrame(data);
    if (!frame.mid) return;
    const pending = this.pending.get(frame.mid);
    if (!pending) return;
    globalThis.clearTimeout(pending.timer);
    this.pending.delete(frame.mid);
    pending.resolve(frame);
  };

  private requireOpenSocket(): SocketLike {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("lwp_socket_not_open");
    }
    return this.socket;
  }

  private nextMid(): string {
    if (this.options.nextMid) return this.options.nextMid();
    this.sequence += 1;
    return `tradebridge-${Date.now()}-${this.sequence}`;
  }
}
```

- [x] **步骤 4：运行测试验证通过**

运行：

```bash
npm test -w @wangwang/chrome-extension -- lwp-rpc-client.test.ts
```

预期：PASS，4 个测试通过。

- [x] **步骤 5：Commit**

```bash
git add apps/chrome-extension/src/background/lwp-rpc-client.ts apps/chrome-extension/test/lwp-rpc-client.test.ts
git commit -m "feat(chrome-extension): add OneTalk LWP RPC client"
```

## 任务 6：实现 LWP 同步客户端

**文件：**
- 创建：`apps/chrome-extension/src/background/onetalk-lwp-client.ts`
- 测试：`apps/chrome-extension/test/onetalk-lwp-client.test.ts`

- [x] **步骤 1：编写失败的测试**

创建 `apps/chrome-extension/test/onetalk-lwp-client.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { LWP_ROUTES, parseLwpFrame } from "@wangwang/onetalk-adapter/browser";
import { BrowserOnetalkLwpClient } from "../src/background/onetalk-lwp-client.js";

test("BrowserOnetalkLwpClient fetchWeblite registers and loads LWP conversations", async () => {
  const requests: Array<{ route: string; body: unknown }> = [];
  const client = new BrowserOnetalkLwpClient({
    appKey: "12574478",
    deviceId: "chrome-extension-demo",
    userAgent: "Mozilla/5.0",
    tokenProvider: async () => ({ accessToken: "access-token", expiresInMs: 3600000 }),
    rpcFactory: () => fakeRpc(requests, {
      [LWP_ROUTES.register]: { code: 200, headers: { mid: "reg", "reg-uid": "seller-ali" }, body: { unitName: "icbu" } },
      [LWP_ROUTES.getState]: { code: 200, headers: { mid: "state" }, body: { topic: "sync", pts: 1 } },
      [LWP_ROUTES.conversations]: {
        code: 200,
        headers: { mid: "conv" },
        body: {
          hasMore: false,
          nextCursor: 1779862804000,
          userConvs: [
            {
              singleChatUserConversation: {
                singleChatConversation: { cid: "conv-1", pairFirst: "seller-ali", pairSecond: "buyer-ali" }
              }
            }
          ]
        }
      },
      [LWP_ROUTES.ackDiff]: { code: 200, headers: { mid: "ack" } }
    })
  });

  const result = await client.fetchWeblite();

  assert.equal(result.bootstrap.aliId, "seller-ali");
  assert.equal(result.conversations.length, 1);
  assert.equal(result.conversations[0].singleChatUserConversation?.singleChatConversation?.cid, "conv-1");
  assert.deepEqual(
    requests.map((item) => item.route),
    ["/reg", "/r/SyncStatus/getState", "/r/Conversation/listNewestPagination", "/r/SyncStatus/ackDiff"]
  );
});

test("BrowserOnetalkLwpClient getChatMessages loads messages for a conversation", async () => {
  const requests: Array<{ route: string; body: unknown }> = [];
  const client = new BrowserOnetalkLwpClient({
    appKey: "12574478",
    deviceId: "chrome-extension-demo",
    userAgent: "Mozilla/5.0",
    tokenProvider: async () => ({ accessToken: "access-token", expiresInMs: 3600000 }),
    rpcFactory: () => fakeRpc(requests, {
      [LWP_ROUTES.register]: { code: 200, headers: { mid: "reg", "reg-uid": "seller-ali" }, body: { unitName: "icbu" } },
      [LWP_ROUTES.messages]: {
        code: 200,
        headers: { mid: "msg" },
        body: {
          hasMore: false,
          nextCursor: 9007199254740000,
          userMessageModels: [
            {
              message: {
                messageId: "msg-1",
                cid: "conv-1",
                createAt: 1779862801000,
                content: { text: { content: "hello" } },
                sender: { uid: "buyer-ali" }
              }
            }
          ]
        }
      }
    })
  });

  const response = await client.getChatMessages({
    conversation: {
      singleChatUserConversation: {
        singleChatConversation: { cid: "conv-1", pairFirst: "seller-ali", pairSecond: "buyer-ali" }
      }
    },
    bootstrap: { aliId: "seller-ali" },
    before: null,
    pageSize: 20
  });

  assert.equal(response.status, 200);
  assert.equal(response.messages.length, 1);
  const firstMessage = response.messages[0].message as Record<string, unknown>;
  assert.equal(firstMessage.messageId, "msg-1");
  assert.equal(response.diagnostics?.listPath, "body.userMessageModels");
  assert.deepEqual(
    requests.map((item) => item.route),
    ["/reg", "/r/MessageManager/listUserMessages"]
  );
  assert.deepEqual(requests[1].body, ["conv-1", false, 9007199254740991, 20, false]);
});

function fakeRpc(requests: Array<{ route: string; body: unknown }>, frames: Record<string, Record<string, unknown>>) {
  return {
    connect: async () => undefined,
    requestFrame: async (frameText: string) => {
      const frame = parseLwpFrame(frameText);
      requests.push({ route: frame.route || "", body: frame.body });
      return parseLwpFrame(JSON.stringify(frames[frame.route || ""]));
    },
    request: async (route: string, body: unknown) => {
      requests.push({ route, body });
      return parseLwpFrame(JSON.stringify(frames[route]));
    },
    close: () => undefined
  };
}
```

- [x] **步骤 2：运行测试验证失败**

运行：

```bash
npm test -w @wangwang/chrome-extension -- onetalk-lwp-client.test.ts
```

预期：FAIL，报错包含 `Cannot find module '../src/background/onetalk-lwp-client.js'`。

- [x] **步骤 3：编写最少实现代码**

创建 `apps/chrome-extension/src/background/onetalk-lwp-client.ts`：

```ts
import {
  LWP_ROUTES,
  buildRegisterFrame,
  lwpConversationPageFromFrame,
  lwpMessagesPageFromFrame,
  lwpRegisterStateFromFrame,
  type ChatMessageResponse,
  type ParsedLwpFrame,
  type WebliteData
} from "@wangwang/onetalk-adapter/browser";
import { readLatestOnetalkPageSnapshot } from "./onetalk-page-snapshot.js";
import { LwpRpcClient } from "./lwp-rpc-client.js";

export interface TokenProviderResult {
  accessToken: string;
  refreshToken?: string;
  expiresInMs?: number;
}

export interface LwpTransport {
  connect(): Promise<void>;
  request(route: string, body: unknown): Promise<ParsedLwpFrame>;
  requestFrame(frameText: string): Promise<ParsedLwpFrame>;
  close(): void;
}

export interface BrowserOnetalkLwpClientOptions {
  appKey: string;
  deviceId: string;
  userAgent: string;
  tokenProvider(): Promise<TokenProviderResult>;
  rpcFactory?: () => LwpTransport;
  now?: () => Date;
}

export class BrowserOnetalkLwpClient {
  private transport: LwpTransport | null = null;
  private bootstrap: Record<string, string> = {};

  constructor(private readonly options: BrowserOnetalkLwpClientOptions) {}

  async fetchWeblite(): Promise<WebliteData> {
    const transport = await this.ensureTransport();
    const state = await transport.request(LWP_ROUTES.getState, [{ topic: "sync" }]);
    const conversations = lwpConversationPageFromFrame(
      await transport.request(LWP_ROUTES.conversations, [this.options.now?.().getTime() || Date.now(), 100])
    );
    if (isRecord(state.body)) {
      await transport.request(LWP_ROUTES.ackDiff, [state.body]);
    }
    const pageSnapshot = await readLatestOnetalkPageSnapshot();
    return {
      html: "",
      bootstrap: this.bootstrap,
      conversations: conversations.conversations,
      pageSnapshot
    };
  }

  async getChatMessages(request: {
    conversation: Record<string, unknown>;
    bootstrap: Record<string, string>;
    before: number | null;
    pageSize: number;
  }): Promise<ChatMessageResponse> {
    const transport = await this.ensureTransport();
    const cid = conversationId(request.conversation);
    if (!cid) throw new Error("onetalk_conversation_id_missing");
    const cursor = request.before || Number.MAX_SAFE_INTEGER;
    const frame = await transport.request(LWP_ROUTES.messages, [cid, false, cursor, request.pageSize, false]);
    const page = lwpMessagesPageFromFrame(frame);
    return {
      status: frame.code || 0,
      contentType: "application/lwp+json",
      code: frame.code || null,
      raw: frame.raw,
      messages: page.messages,
      diagnostics: {
        status: frame.code || 0,
        contentType: "application/lwp+json",
        code: frame.code || null,
        listLength: page.messages.length,
        listPath: "body.userMessageModels",
        topLevelKeys: Object.keys(frame.raw).sort(),
        dataKeys: isRecord(frame.body) ? Object.keys(frame.body).sort() : []
      }
    };
  }

  close(): void {
    this.transport?.close();
    this.transport = null;
  }

  private async ensureTransport(): Promise<LwpTransport> {
    if (this.transport) return this.transport;
    const token = await this.options.tokenProvider();
    const transport = this.options.rpcFactory?.() || new LwpRpcClient();
    await transport.connect();
    const registerFrame = await registerWithTransport(transport, {
      appKey: this.options.appKey,
      deviceId: this.options.deviceId,
      userAgent: this.options.userAgent,
      accessToken: token.accessToken
    });
    const registerState = lwpRegisterStateFromFrame(registerFrame);
    if (!registerState.ok) throw new Error("onetalk_lwp_register_failed");
    this.bootstrap = registerState.uid ? { aliId: registerState.uid } : {};
    this.transport = transport;
    return transport;
  }
}

async function registerWithTransport(
  transport: LwpTransport,
  input: { appKey: string; deviceId: string; userAgent: string; accessToken: string }
): Promise<ParsedLwpFrame> {
  return transport.requestFrame(
    buildRegisterFrame({
    mid: `tradebridge-reg-${Date.now()}`,
    appKey: input.appKey,
    deviceId: input.deviceId,
    userAgent: input.userAgent,
    accessToken: input.accessToken
    })
  );
}

function conversationId(conversation: Record<string, unknown>): string | undefined {
  return (
    firstString(conversation, ["cid", "conversationCode", "conversationId", "id"]) ||
    firstString(valueAtPath(conversation, ["singleChatUserConversation", "singleChatConversation"]), ["cid"])
  );
}

function firstString(source: unknown, keys: string[]): string | undefined {
  if (!isRecord(source)) return undefined;
  for (const key of keys) {
    const value = source[key];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
```

- [x] **步骤 4：运行测试验证通过**

运行：

```bash
npm test -w @wangwang/chrome-extension -- onetalk-lwp-client.test.ts
```

预期：PASS，2 个测试通过。

- [x] **步骤 5：Commit**

```bash
git add apps/chrome-extension/src/background/onetalk-lwp-client.ts apps/chrome-extension/test/onetalk-lwp-client.test.ts
git commit -m "feat(chrome-extension): add LWP OneTalk sync client"
```

## 任务 7：将默认同步入口切换到 LWP

**文件：**
- 修改：`apps/chrome-extension/src/background/index.ts`
- 修改：`apps/chrome-extension/src/background/sync-orchestrator.ts`
- 修改：`apps/chrome-extension/src/shared/sync-types.ts`
- 修改：`apps/chrome-extension/src/popup/popup.ts`
- 测试：`apps/chrome-extension/test/sync-orchestrator.test.ts`

- [x] **步骤 1：编写失败的测试**

在 `apps/chrome-extension/test/sync-orchestrator.test.ts` 的第一个测试中，将 mock `fetchWeblite()` 返回 LWP 会话，`getChatMessages()` 返回 LWP message wrapper，并断言 diagnostics：

```ts
assert.equal(store.status.lastDiagnostics?.conversations, 1);
assert.deepEqual(store.status.lastDiagnostics?.messageRequests.map((item) => [item.conversationId, item.status, item.listLength]), [
  ["conv-1", 200, 1]
]);
assert.deepEqual(store.status.lastDiagnostics?.lwpRoutes?.map((item) => item.route), [
  "/r/Conversation/listNewestPagination",
  "/r/MessageManager/listUserMessages"
]);
```

在同一个 mock `fetchWeblite()` 中使用：

```ts
conversations: [
  {
    singleChatUserConversation: {
      singleChatConversation: { cid: "conv-1", pairFirst: "self-ali", pairSecond: "buyer-ali" }
    }
  }
]
```

在 mock `getChatMessages()` 中使用：

```ts
messages: [
  {
    message: {
      messageId: "m1",
      cid: "conv-1",
      sender: { uid: "buyer-ali" },
      content: { text: { content: "hello" } },
      createAt: 1779706200000
    }
  }
],
diagnostics: {
  status: 200,
  contentType: "application/lwp+json",
  code: 200,
  listLength: 1,
  listPath: "body.userMessageModels",
  topLevelKeys: ["body", "code", "headers"],
  dataKeys: ["hasMore", "nextCursor", "userMessageModels"]
}
```

- [x] **步骤 2：运行测试验证失败**

运行：

```bash
npm test -w @wangwang/chrome-extension -- sync-orchestrator.test.ts
```

预期：FAIL，`lastDiagnostics.lwpRoutes` 为 `undefined`。

- [x] **步骤 3：编写最少实现代码**

修改 `apps/chrome-extension/src/shared/sync-types.ts`：

```ts
export interface SyncDiagnostics {
  conversations: number;
  messageRequests: MessageRequestDiagnostic[];
  lwpRoutes?: LwpRouteDiagnostic[];
}

export interface LwpRouteDiagnostic {
  route: string;
  status: number;
  listLength?: number;
  hasMore?: boolean;
}
```

修改 `apps/chrome-extension/src/background/sync-orchestrator.ts`，在 `fetchMessagesByConversation()` 返回 diagnostics 时加入 LWP route：

```ts
return {
  messagesByConversationId: output,
  diagnostics: {
    conversations,
    messageRequests: diagnostics,
    lwpRoutes: [
      { route: "/r/Conversation/listNewestPagination", status: 200, listLength: conversations },
      ...diagnostics.map((item) => ({
        route: "/r/MessageManager/listUserMessages",
        status: item.status,
        listLength: item.listLength
      }))
    ]
  }
};
```

修改 `apps/chrome-extension/src/background/index.ts`：

```ts
import { BrowserOnetalkLwpClient } from "./onetalk-lwp-client.js";
import { requestOneTalkImToken } from "./onetalk-token-client.js";
```

替换 `runDefaultSync()`：

```ts
async function runDefaultSync() {
  const config = await stateStore.getConfig();
  return runSyncOnce({
    stateStore,
    onetalkClient: new BrowserOnetalkLwpClient({
      appKey: "12574478",
      deviceId: config?.deviceId || "chrome-extension",
      userAgent: navigator.userAgent,
      tokenProvider: async () =>
        requestOneTalkImToken({
          chromeApi,
          appKey: "12574478",
          deviceId: config?.deviceId || "chrome-extension"
        })
    }),
    uploadSyncBatch
  });
}
```

修改 `apps/chrome-extension/src/popup/popup.ts`，替换 `diagnosticSummary()`：

```ts
function diagnosticSummary(diagnostics?: SyncDiagnostics): string {
  if (!diagnostics) return "";
  const lines: string[] = [];
  const requests = diagnostics.messageRequests.length;
  const withMessages = diagnostics.messageRequests.filter((item) => item.listLength > 0).length;
  lines.push(`消息接口：${withMessages}/${requests || diagnostics.conversations} 个会话有消息`);
  const lwpRoutes = diagnostics.lwpRoutes || [];
  if (lwpRoutes.length) {
    lines.push(`LWP：${lwpRoutes.filter((item) => item.status === 200).length}/${lwpRoutes.length} 个请求成功`);
  }
  return lines.join("\n");
}
```

- [x] **步骤 4：运行测试验证通过**

运行：

```bash
npm test -w @wangwang/chrome-extension -- sync-orchestrator.test.ts
```

预期：PASS，LWP route diagnostics 断言通过。

- [x] **步骤 5：Commit**

```bash
git add apps/chrome-extension/src/background/index.ts apps/chrome-extension/src/background/sync-orchestrator.ts apps/chrome-extension/src/shared/sync-types.ts apps/chrome-extension/src/popup/popup.ts apps/chrome-extension/test/sync-orchestrator.test.ts
git commit -m "feat(chrome-extension): use LWP sync client by default"
```

## 任务 8：强化 LWP 敏感字段去敏

**文件：**
- 修改：`apps/chrome-extension/src/background/sanitizer.ts`
- 测试：`apps/chrome-extension/test/sanitizer.test.ts`

- [x] **步骤 1：编写失败的测试**

在 `apps/chrome-extension/test/sanitizer.test.ts` 追加：

```ts
test("sanitizeForUpload removes OneTalk LWP token and session fields", () => {
  const sanitized = sanitizeForUpload({
    sourceMeta: {
      accessToken: "secret-access",
      refreshToken: "secret-refresh",
      sid: "secret-sid",
      "reg-sid": "secret-reg-sid",
      "reg-uid": "secret-reg-uid",
      route: "/r/Conversation/listNewestPagination"
    },
    messages: [
      {
        content: "hello",
        rawSanitized: {
          headers: {
            sid: "secret-header-sid",
            mid: "safe-mid"
          }
        }
      }
    ]
  });

  assert.deepEqual(sanitized, {
    sourceMeta: {
      route: "/r/Conversation/listNewestPagination"
    },
    messages: [
      {
        content: "hello",
        rawSanitized: {
          headers: {
            mid: "safe-mid"
          }
        }
      }
    ]
  });
});

test("assertNoSensitiveFields blocks raw LWP token text", () => {
  assert.throws(
    () => assertNoSensitiveFields({ diagnostics: "accessToken=secret-value; refreshToken=secret-refresh" }),
    /sanitizer_blocked_payload/
  );
});
```

- [x] **步骤 2：运行测试验证失败**

运行：

```bash
npm test -w @wangwang/chrome-extension -- sanitizer.test.ts
```

预期：FAIL，`sid`、`reg-sid` 或 `reg-uid` 仍存在。

- [x] **步骤 3：编写最少实现代码**

修改 `apps/chrome-extension/src/background/sanitizer.ts` 的 `SENSITIVE_KEY_PATTERNS`：

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
  /^sid$/i,
  /^reg-sid$/i,
  /^reg-uid$/i,
  /^accesstoken$/i,
  /^refreshtoken$/i,
  /token/i,
  /csrf/i
];
```

修改 `SENSITIVE_TEXT_PATTERNS`：

```ts
const SENSITIVE_TEXT_PATTERNS = [
  /(?:^|[?&;"'\s])ctoken=/i,
  /(?:^|[?&;"'\s])_tb_token_=/i,
  /(?:^|[?&;"'\s])cookie2=/i,
  /(?:^|[?&;"'\s])sgcookie=/i,
  /(?:^|[?&;"'\s])x5sec=/i,
  /(?:^|[?&;"'\s])chatToken=/i,
  /(?:^|[?&;"'\s])accessToken=/i,
  /(?:^|[?&;"'\s])refreshToken=/i,
  /Authorization:\s*/i,
  /Cookie:\s*/i,
  /Set-Cookie:\s*/i
];
```

- [x] **步骤 4：运行测试验证通过**

运行：

```bash
npm test -w @wangwang/chrome-extension -- sanitizer.test.ts
```

预期：PASS，LWP 去敏测试通过。

- [x] **步骤 5：Commit**

```bash
git add apps/chrome-extension/src/background/sanitizer.ts apps/chrome-extension/test/sanitizer.test.ts
git commit -m "fix(chrome-extension): sanitize OneTalk LWP session fields"
```

## 任务 9：确认 outbound 文本发送无 messageId 时仍可回执

**文件：**
- 修改：`apps/chrome-extension/test/outbound-orchestrator.test.ts`
- 修改：`apps/chrome-extension/src/background/outbound-orchestrator.ts`

- [x] **步骤 1：编写失败的测试**

在 `apps/chrome-extension/test/outbound-orchestrator.test.ts` 追加：

```ts
test("runOutboundDelivery marks sent when OneTalk page reports success without external message id", async () => {
  const store = new MemoryStateStore();
  const delivered: Array<{ outboundMessageId: string; status: string; externalMessageId?: string }> = [];

  const result = await runOutboundDelivery({
    stateStore: store,
    chromeApi: fakeChromeApi([], { ok: true }),
    listOutboundMessages: async () => [outboundMessage()],
    markOutboundMessageDelivered: async (options) => {
      delivered.push(options);
      return { ...outboundMessage(), status: options.status, externalMessageId: options.externalMessageId };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.sentCount, 1);
  assert.equal(delivered[0].status, "sent");
  assert.equal(delivered[0].externalMessageId, undefined);
});
```

- [x] **步骤 2：运行测试验证失败或记录已通过**

运行：

```bash
npm test -w @wangwang/chrome-extension -- outbound-orchestrator.test.ts
```

预期：如果当前实现已经允许无 `externalMessageId` 成功，则 PASS；如果失败，错误会显示 `onetalk_send_response_invalid` 或 delivery 参数断言不匹配。

- [x] **步骤 3：编写最少实现代码**

如果步骤 2 失败，修改 `apps/chrome-extension/src/background/outbound-orchestrator.ts` 的 `isPageSendResponse()`，确保 `externalMessageId` 可省略：

```ts
function isPageSendResponse(value: unknown): value is PageSendResponse {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    (value.externalMessageId === undefined || typeof value.externalMessageId === "string") &&
    (value.error === undefined || typeof value.error === "string")
  );
}
```

- [x] **步骤 4：运行测试验证通过**

运行：

```bash
npm test -w @wangwang/chrome-extension -- outbound-orchestrator.test.ts
```

预期：PASS，所有 outbound orchestrator 测试通过。

- [x] **步骤 5：Commit**

```bash
git add apps/chrome-extension/src/background/outbound-orchestrator.ts apps/chrome-extension/test/outbound-orchestrator.test.ts
git commit -m "test(chrome-extension): cover outbound success without OneTalk message id"
```

## 任务 10：端到端定向验证

**文件：**
- 修改：`docs/superpowers/plans/2026-05-27-chrome-extension-onetalk-lwp-refactor.md`

- [x] **步骤 1：运行 adapter 测试**

运行：

```bash
npm test -w @wangwang/onetalk-adapter
```

预期：PASS，`lwp-protocol.test.ts`、`lwp-normalizer.test.ts`、`sync-mapper.test.ts` 均通过。

- [x] **步骤 2：运行 Chrome 扩展测试**

运行：

```bash
npm test -w @wangwang/chrome-extension
```

预期：PASS，新增 LWP/token/sanitizer/outbound/sync tests 均通过。

- [x] **步骤 3：运行全仓类型检查**

运行：

```bash
npm run typecheck
```

预期：PASS，所有 workspace typecheck 通过。

- [x] **步骤 4：构建 Chrome 扩展**

运行：

```bash
npm run build -w @wangwang/chrome-extension
```

预期：PASS，生成 `apps/chrome-extension/dist`，manifest、background、content、popup、options 均成功打包。

- [x] **步骤 5：运行 e2e 回归**

运行：

```bash
npm run test:e2e
```

预期：PASS，现有内部同步、outbound queue 和 Web 工作台回归不受影响。

- [x] **步骤 6：更新计划复选框并 Commit**

将本文件中已完成的复选框改为 `[x]`，然后运行：

```bash
git add docs/superpowers/plans/2026-05-27-chrome-extension-onetalk-lwp-refactor.md
git commit -m "docs: update OneTalk LWP refactor plan progress"
```

预期：生成文档进度 commit。

## 自检

- 规格覆盖度：本计划覆盖 LWP token 获取、WebSocket `/reg`、同步状态、会话分页、消息分页、诊断、去敏、发送回执和现有 collector 协议复用。
- 占位符扫描：没有使用空泛步骤；每个代码变更步骤包含目标文件、代码片段、命令和预期结果。
- 类型一致性：LWP route 常量、`ParsedLwpFrame`、`LwpTransport`、`BrowserOnetalkLwpClient`、`SyncDiagnostics.lwpRoutes` 在引入后被后续任务按同名使用。
