# OneTalk 抓取层改造：从 hook socket 改为 hook SDK 事件总线

> 日期：2026-06-04
> 状态：第一版已实施（待真机确认事件名后收紧过滤）
> 关联：`docs/superpowers/plans/2026-06-04-onetalk-page-socket-passive-tap.md`（被推翻的 socket 方案）

## 1. 背景：为什么推翻 socket 方案

被动监听页面 socket（已实现并合并）经四轮真机探针证否：

- 消息正文（自发、历史、实时推送）都**不以明文流经页面 WebSocket**。socket 上只有心跳/ack 空帧。
- `getMessageServiceV2()` 返回**空壳实例**（`delegateList` 空、无有效 `notifyReceiveMsg`），不是页面真正在用的那个。

探针逐步定位到真实消息入口（`probe_chrome_onetalk_*` 系列）：

- 活实例：`IcbuIM.IMBaaSSDK.IcbuMessageServiceImpl.instance`（非空 delegateList）。
- **消息到达时真正触发的是 SDK 事件总线**：`IcbuIM.IMBaaSSDK.IcbuEventServiceImpl.instance.emitter.emit(eventName, payload)`。`receive_fire` 探针实测 `firedLabels` 含 `eventEmitter.emit`，payload 带完整消息结构。

## 2. 实测确认的消息结构（来自 receive_fire）

`emit(eventName, payload)` 的 payload 有两种与消息相关的形态：

**形态 A（messageModel，最干净）：**
```
payload.messageModel.cid
payload.messageModel.messageId / payload.messageModel.uuid
payload.messageModel.content.contentType
payload.messageModel.content.text.content        ← 正文
payload.messageModel.createAt                     ← 时间
payload.messageModel.sender.uid                   ← 发送方
payload.messageModel.receivers
```

**形态 B（带 contact，含客户资料）：**
```
payload.conversationCode
payload.messageId / payload.uuid
payload.content / payload.msgType / payload.messageType
payload.sender / payload.receiver / payload.owner
payload.sendTime
payload.contact.{name, loginId, accountId, accountIdEncrypt, aliId...}  ← 客户资料随消息带来
```

## 3. 关键未知（第一版要解决）

`emit` 第一个参数是**事件名字符串**，但探针只看键名、没看到字符串值。我们**不知道哪个事件名 = 新消息到达**。若不知道，会把已读回执、输入状态、会话同步等噪音也当消息抓。

**对策**：第一版**不按事件名过滤**，而按 **payload 结构**过滤（含 `messageModel.content` 或顶层 `content`+`conversationCode`/`messageId` 才算消息）；同时**记录所有出现过的事件名**并通过调试面板暴露，真机看到真实事件名后，第二版再按事件名精确收紧。

## 4. 架构（沿用现有下游，只换"抓取源"）

```
IcbuEventServiceImpl.instance.emitter.emit(eventName, payload)
        │ ① 包裹 emit（透传），按结构识别消息事件
        ▼
  onetalk-message-tap（MAIN world）：从 payload 提取规范化消息 + cid → postMessage
        │ ② window.postMessage(source=tradebridge-onetalk-page, type=onetalk-messages-observed)
        ▼
  content bridge → chrome.runtime（已存在，不动）
        ▼
  background message buffer → sync → 上传（已存在，不动）
```

下游（bridge 转发、buffer、sync-orchestrator、mapper、发送链路）**全部复用，不改**。只重写 `onetalk-message-tap.ts` 的抓取来源，和 page-script 的安装调用保持不变。

## 5. 改动清单

### 5.1 重写 `channels/alibaba-im/onetalk-message-tap.ts`

- 删除 socket 包裹（WebSocket 构造器 + prototype.send）整套。
- 新增：定位 `IcbuIM.IMBaaSSDK.IcbuEventServiceImpl.instance.emitter`，包裹其 `emit`（透传）。
  - emitter 可能注入时还没初始化 → 用**轮询重试**（如每 500ms 试 20 次）直到拿到 emitter 再包裹；包裹幂等（打 tag 防重复）。
  - 兜底：同时也尝试 `IcbuMessageServiceImpl.instance` 上的相关方法（次要，主路径是 emitter）。
- `emit` 包裹里：对每次调用，
  1. 记录 eventName 到一个有限的 `seenEventNames` 集合（调试用，名字本身不敏感）；
  2. 用 `extractMessage(payload)` 尝试提取消息：命中形态 A 或 B 则规范化为统一 record，否则忽略（不是消息事件）；
  3. 命中则 `postMessage({ source:"tradebridge-onetalk-page", type:"onetalk-messages-observed", externalConversationId, messages:[record] })`。
- `extractMessage` 输出规范化 record，结构对齐 sync-mapper 的 `mapMessage` 期望（它读 `raw.message` 优先，回落 `raw`）：
  ```
  { message: { messageId, cid, content, sendTime, sender, ... } }
  ```
  - 正文：`messageModel.content.text.content` 或 `payload.content`（按 contentType 处理 text）。
  - id：`messageId` || `uuid`。
  - cid：`messageModel.cid` || `conversationCode`。
  - 时间：`createAt` || `sendTime`。
  - sender：`messageModel.sender.uid` || `payload.sender`（用于方向判断）。
  - contact（形态 B）：附带透传，供后续客户资料富集（mapper/customer 已能消化）。
- 全程 try/catch，绝不因单次异常影响页面;透传 emit 原返回值。

### 5.2 page-script 安装调用

[onetalk-page-script.ts](apps/chrome-extension/src/channels/alibaba-im/onetalk-page-script.ts) 已调 `installOneTalkMessageTap(window)`，签名不变，无需改。

### 5.3 调试面板（插件内，临时）

目标：装上插件后直接看到 hook 状态、真实事件名、抓取计数 —— 取代 osascript 来回跑。

- background 加一个轻量诊断累计：收到 `onetalk-messages-observed` 时计数；新增一种消息让 page→background 上报 `seenEventNames`（节流）。
- 存到 `chrome.storage.local`（或 status）。
- popup 加一块"OneTalk 抓取诊断"：显示 emitter 是否 hook 上、累计抓到消息数、最近事件名列表、最近一条抓取时间。
- 这是**临时调试设施**，事件名确认后可保留或精简。

## 6. 测试

- `onetalk-message-tap.test.ts` 重写：用 fake emitter（带 `emit`）+ 喂形态 A / 形态 B payload，断言：
  - 形态 A/B 都能提取出带 cid + 正文 + id 的规范化 record；
  - 非消息事件（如只含 typing/已读结构）被忽略；
  - emit 透传（原 listener 仍被调、返回值不变）；
  - emitter 延迟出现时轮询重试能最终包裹上；
  - 异常 payload 不抛。
- 下游 buffer/sync/mapper 测试不变（结构对齐后应继续通过）。
- `npm run test/typecheck/build -w @wangwang/chrome-extension`。

## 7. 执行顺序

1. 重写 `onetalk-message-tap.ts`（emitter hook + extractMessage）。
2. 重写 tap 测试。
3. 加调试面板（background 计数 + 上报事件名 + popup 展示）。
4. typecheck / test / build。
5. 交付 dist，真机装上看调试面板：确认抓到消息、记下真实事件名。
6. （第二版）按真实事件名收紧过滤。

## 8. 诚实边界

- **第一版按结构过滤、不按事件名**，可能短暂混入个别非聊天的"带 content 的事件"（如系统卡片）。调试面板拿到真实事件名后立即收紧。第一版宁可宽松（多抓后续可过滤）也不漏抓。
- 历史回填仍不在本轮：emitter 只在消息**到达/变化**时触发，覆盖"实时新消息"。从未打开会话的历史仍需后续用 `searchHistoryMessage`（实例上已确认存在该方法）主动触发，作为下一阶段。
- 发送链路（pacer + 去标记）已完成，不受本次影响。
