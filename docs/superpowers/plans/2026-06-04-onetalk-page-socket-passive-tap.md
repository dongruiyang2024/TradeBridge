# Chrome 插件 OneTalk 消息抓取改造：页面 socket 被动监听

> 日期：2026-06-04
> 状态：已批准，执行中
> 关联：`docs/superpowers/plans/2026-06-02-Chrome插件多渠道消息桥重构实施方案.md`（多渠道宏观方案，本文是其中 `alibaba-im` 渠道消息抓取面的具体落地）

## 1. 背景与问题

当前插件用**两条来源**拼出同步数据：

1. 页面 SDK 源（content script，MAIN world）：会话列表、客户资料、发消息，走页面自有 `IcbuIM.IMBaaSSDK`。健康。
2. LWP 消息源（background）：页面 mtop 拿 `accessToken` → 回传 background → background **另开一条 WebSocket** 连 `wss://wss-icbu.dingtalk.com/`，用 token 重新 `/reg` 注册，再调 `listUserMessages` 拉消息正文。

第 2 条是封号风险根因。本仓库调研文档 `2026-05-27-onetalk-lwp-live-parameter-research.md` 已实测：
- 复用 token 再开新 WebSocket 注册返回 `code=401`；
- 自建 socket 与页面原生 IM SDK 并存时，消息路由间歇性超时。

**真正风险是同一账号出现两条并行 IM 长连接**，这是风控最易识别的异常指纹。Codex 提出的「token 不离开页面」只是数据卫生，治标不治本。

## 2. 目标

把消息正文抓取从「background 另开 socket 主动拉」改为「被动监听页面自有 socket」。

- 不再开第二条 IM 连接，token 不再离开页面。
- 实时新消息：监听页面 socket 上的 `/s/` 服务端推送帧，零额外网络行为。
- 历史消息：接受「实时 + 页面已加载/用户滚动加载」的范围（用户已确认「实时增量为主」）。本轮**不做**主动驱动翻历史。

## 3. 已验证前提（探针实测）

`tools/probe_chrome_onetalk_ws_tap.mjs` 在真机确认：

| 验证项 | 结果 |
|---|---|
| patch `WebSocket.prototype.send` 挂上页面自有 IM socket | ✅ 抓到出站 `/!` 心跳 |
| 在活 socket 上 `addEventListener("message")` 抓入站帧 | ✅ `inbound.parsed:1`，`code 200` |
| 帧格式 = string，`JSON.parse` 干净解析 | ✅ 可直接复用 adapter `parseLwpFrame` |

机制成立。`/s/` 推送与 `listUserMessages` 响应是同一条 socket 上的另一种入站帧，走同一记录路径；其内容在该 socket 上流动已由现有 LWP client 工作（research 文档）佐证。

## 4. 架构

```
页面原生 WebSocket（页面自己注册的那条，唯一一条）
        │ ① 被动旁路：document_start 包裹 window.WebSocket 构造器 + patch prototype.send
        ▼
  message-tap（MAIN world，page-script 内）：parseLwpFrame → 过滤消息帧 → postMessage
        │ ② window.postMessage(source=tradebridge-onetalk-page)
        ▼
  content bridge（ISOLATED world）：转发 chrome.runtime.sendMessage
        │ ③
        ▼
  background message buffer：按 externalConversationId 攒消息（去重、上限、TTL）
        │ ④ 同步时读取 buffer 而非主动拉
        ▼
  sync-orchestrator → mapWebliteToSyncBatch(messagesByConversationId=buffer) → sanitizer → 上传
```

关键解耦点：`mapWebliteToSyncBatch` 的消息入参是 `messagesByConversationId: Record<string, Record<string,unknown>[]>`，与「消息怎么拿到」无关。改来源**不需要动 mapper**。

## 5. 代码组织（迁入 channels/alibaba-im）

按多渠道宏观方案，把 OneTalk 实现面迁入渠道目录。本轮只迁「消息抓取相关」文件，避免与宏观重构的渠道注册表任务冲突（那部分单独推进）。

新增目录：`apps/chrome-extension/src/channels/alibaba-im/`

迁入（git mv 保留历史）：
- `content/onetalk-page-bridge.ts` → `channels/alibaba-im/onetalk-page-bridge.ts`
- `content/onetalk-page-script.ts` → `channels/alibaba-im/onetalk-page-script.ts`
- `content/onetalk-conversation.ts` → `channels/alibaba-im/onetalk-conversation.ts`
- `content/onetalk-customer-profile.ts` → `channels/alibaba-im/onetalk-customer-profile.ts`

新增：
- `channels/alibaba-im/onetalk-message-tap.ts`（页面 socket 旁路 + LWP 消息帧过滤）
- `background/onetalk-message-buffer.ts`（按会话攒消息）

注意：`content/onetalk-im-token.ts` 随旧链路删除（见 §7）。manifest 与 vite 输入路径同步更新。

## 6. 新增实现细节

### 6.1 `onetalk-message-tap.ts`（MAIN world）

在 page-script 顶部、尽早执行（content script 配 `document_start`，page-script 由 bridge 在 `document_start` 注入，抢在 SDK new WebSocket 之前）：

```ts
// 伪代码
const NativeWS = window.WebSocket;
const original = NativeWS.prototype.send;
function tapInbound(ws) {
  if (ws.__tbTapped) return;
  ws.__tbTapped = true;
  ws.addEventListener("message", (e) => { if (typeof e.data === "string") onFrame(e.data); });
}
// 包裹构造器 → 新建 socket 立即挂入站监听
// patch prototype.send → 兜底已存在 socket，首次发帧时补挂入站监听
function onFrame(text) {
  let frame; try { frame = parseLwpFrame(text); } catch { return; }
  // 消息帧：route 含 listUserMessages（响应）或 /s/ 推送且 body.userMessageModels / 单条消息
  const messages = lwpMessagesPageFromFrame(frame).messages;  // 复用 adapter
  if (!messages.length) return;
  for (const m of messages) postMessageToBridge(m);  // 仅消息正文，按 cid 分组
}
```

要点：
- 只 `parseLwpFrame` + 读取，绝不调用 `.send()` 发任何帧 —— 纯被动。
- 帧格式探针确认是 string；保留对 Blob/ArrayBuffer 的兜底解码（异步），但主路径是 string。
- 复用 `@wangwang/onetalk-adapter/browser` 的 `parseLwpFrame`、`lwpMessagesPageFromFrame`，解析层零重写。
- 失败静默（页面其它 WebSocket、非 LWP 帧、解析失败）—— 不能影响页面。
- 从每条消息提取 `cid`（`message.cid` 或顶层）作为 `externalConversationId` 分组键。

### 6.2 bridge 转发（page-bridge.ts）

page-script 通过 `window.postMessage({ source:"tradebridge-onetalk-page", type:"onetalk-message-tapped", message, cid })` 发出；content bridge 监听并 `chrome.runtime.sendMessage({ type:"onetalk-messages-observed", cid, messages })` 转给 background。沿用现有 `source` 约定与 isRecord 校验。

### 6.3 `onetalk-message-buffer.ts`（background）

```ts
interface BufferedMessages { byConversationId: Record<string, Record<string,unknown>[]>; }
```
- `add(cid, messages)`：按 `externalMessageId`（或 messageId）去重后追加。
- 每会话上限（如 500 条）+ 全局会话数上限，FIFO 淘汰，防 service worker 内存膨胀。
- 持久化到 `chrome.storage.local`（service worker 可能被回收）；读写做防抖。
- `drain()` / `read()`：同步时取出，喂给 mapper。
- TTL：超过 N 天的消息可清理（可选，本轮先不做）。

### 6.4 sync-orchestrator 改造

现状：`fetchWeblite()` 走 LWP 注册 + listNewestPagination 拿会话，再逐会话 `getChatMessages()` 拉消息。

改造后：
- 会话/客户资料：继续走页面 SDK（`requestOneTalkConversations` / `requestOneTalkCustomerProfiles`），不变。
- 消息：从 message buffer 读取 `messagesByConversationId`，不再 `getChatMessages()`。
- `WebliteData` 的 `conversations` 仍来自页面 SDK；`messagesByConversationId` 来自 buffer。
- `SyncOnetalkClient` 接口：去掉 `getChatMessages`，`fetchWeblite` 只返回会话+资料（消息走 buffer 单独传入 mapper）。

## 7. 删除旧链路（直接删，git 可恢复）

- `background/onetalk-lwp-client.ts`（BrowserOnetalkLwpClient）+ `test/onetalk-lwp-client.test.ts`
- `background/lwp-rpc-client.ts`（LwpRpcClient 自建 socket）+ `test/lwp-rpc-client.test.ts`
- `background/onetalk-token-client.ts`（token 回传）+ `test/onetalk-token-client.test.ts`
- `content/onetalk-im-token.ts`（页面 mtop token）+ page-script 内 token handler + `extension-messages.ts` 的 `get-onetalk-im-token`
- `background/index.ts` 中 `BrowserOnetalkLwpClient` 装配，改为 buffer 驱动
- adapter 侧 `BrowserOnetalkLwpClient` 不再被引用；`lwp-rpc-client` 相关导出按需保留（`parseLwpFrame`/`lwpMessagesPageFromFrame` 仍被 tap 使用，**保留**）

保留（仍在用）：
- `@wangwang/onetalk-adapter` 的 `parseLwpFrame`、`lwpMessagesPageFromFrame`、`lwp-protocol`、`mapWebliteToSyncBatch`、`sanitizer`
- 页面 SDK 会话/资料采集、发消息链路

## 8. manifest 收窄

- 去掉 `cookies` 权限（token/cookie 不再被 background 使用；确认 `onetalk-adapter/cookies.ts` 仅 Node OnetalkClient 用，插件不依赖）。
- `host_permissions` 收窄到 `https://onetalk.alibaba.com/*` + 本地 server，去掉宽泛的 `https://*.alibaba.com/*`（需确认客户资料 jsonp 用的 `alicrm.alibaba.com` 是否需要 —— 客户资料走页面 jsonp，在页面上下文执行，不需要插件 host 权限；保留确认）。
- `content_scripts` / `web_accessible_resources` 路径更新为 `channels/alibaba-im/...`。

## 9. 构建与配置同步

- `vite.config.ts` rollup input 路径更新（`content/onetalk-page-bridge` → `channels/alibaba-im/onetalk-page-bridge` 等）。
- 注入路径常量：`onetalk-tab-messaging.ts` 的 `ONETALK_CONTENT_BRIDGE_FILE`、`onetalk-page-bridge.ts` 的 `getURL("content/onetalk-page-script.js")` 同步改为新路径。
- tsconfig 无需改（按目录通配）。

## 10. 测试

新增/改动：
- `test/onetalk-message-tap.test.ts`：用 fake WebSocket + 喂 LWP 帧字符串，断言消息正文被提取并按 cid 分组、非消息帧被忽略、解析失败不抛、不调用 send。
- `test/onetalk-message-buffer.test.ts`：去重、上限淘汰、drain、持久化往返。
- `test/onetalk-page-script.test.ts`：删除 token 用例，保留会话/资料用例（路径更新）。
- sync-orchestrator 测试：数据源改为 buffer 注入。
- `manifest.test.ts`：断言无 `cookies`、路径为 channels/。
- 删除旧链路对应测试文件。

验证命令：
```bash
npm run build -w @wangwang/onetalk-adapter
npm run test -w @wangwang/chrome-extension
npm run typecheck -w @wangwang/chrome-extension
npm run build -w @wangwang/chrome-extension
```

## 11. 执行顺序

1. 写本计划文档（done）。
2. git mv 迁入 channels/alibaba-im，更新 import / vite / manifest 路径，build 通过。
3. 新增 message-tap + buffer，接好 bridge → background 链路。
4. sync-orchestrator 改为 buffer 驱动。
5. 删除旧 LWP/token 链路及测试。
6. manifest 收窄。
7. 全量 test / typecheck / build 通过。

## 12. 边界与风险

- **完整性**：被动监听只覆盖「流经页面 socket 的消息」= 实时 + 已加载历史。从未打开的会话历史不回填（用户已接受）。后续可加「SDK 主动触发翻历史」作为第二阶段，触发后响应仍被 tap 捕获。
- **service worker 生命周期**：buffer 必须持久化，否则 SW 回收丢数据。
- **页面无 onetalk 标签**：无标签时 tap 不工作，同步拿不到新消息 —— 与发消息链路同样依赖页面在线，符合插件定位。
- **多渠道方案冲突**：本轮只迁消息抓取相关文件到 channels/alibaba-im，不实现渠道注册表/adapter 接口（留给宏观方案任务五）。命名与目录与宏观方案一致，不打架。


