# OneTalk 回复发送：低风险化（去指纹 + 节奏控制）

> 日期：2026-06-04
> 状态：已实施
> 关联：`docs/superpowers/plans/2026-06-04-onetalk-page-socket-passive-tap.md`（被动监听的"另一半"——发送）

## 1. 背景

回复发送链路已存在并能跑：工作台编辑 → server outbound 队列 → 插件经 collector WS 领取 → 页面 SDK `getMessageService().sendUIMessages()` 发出。传输层与"用户点发送"一致（同 socket、header、签名），不开第二条连接。

但代码评估发现两处会**主动暴露自动化指纹**的问题，使"全自动/机器节奏"发送有封号风险。本方案在保留"工作台编辑、人点确认"体验的前提下，修掉这两处。

## 2. 当前链路与风险点（已读代码确认）

发送漏斗（两条投递路径都汇聚于此）：
- 定时投递：`runOutboundDelivery` → `sendOutboundMessagesViaOneTalk`（[outbound-orchestrator.ts:63](apps/chrome-extension/src/background/outbound-orchestrator.ts#L63)）
- 实时投递：`outbound.claimed` → `sendOutboundMessagesViaOneTalk`（[realtime-orchestrator.ts:76](apps/chrome-extension/src/background/realtime-orchestrator.ts#L76)）
- 实际发送：`sendTextMessage` → `sendUIMessages`（[onetalk-page-script.ts:150-167](apps/chrome-extension/src/channels/alibaba-im/onetalk-page-script.ts#L150-L167)）

**风险点 A（内容指纹）：** 发送 payload 自带第三方标记：
```js
ext: { source: "tradebridge", outboundMessageId: message.id }
```
`ext` 随消息上行到阿里服务端，等于自报"第三方工具发的"。

**风险点 B（行为模式）：** 全链路无任何限流/节奏控制。
- 一次领取 10 条（[realtime-orchestrator.ts:10](apps/chrome-extension/src/background/realtime-orchestrator.ts#L10) `DEFAULT_CLAIM_LIMIT = 10`）。
- `sendOutboundMessagesViaOneTalk` 是 `for` 循环逐条 await、**零间隔连发**（[outbound-orchestrator.ts:101-120](apps/chrome-extension/src/background/outbound-orchestrator.ts#L101-L120)）。
- 结果：10 条回复在数百毫秒内机关枪式发出，人类不可能这个节奏 —— 这是封号真正主因。

"人点确认"已部分存在（工作台每条回复是显式点击 [App.tsx:662-680](apps/web/src/App.tsx#L662-L680) 创建 queued 消息），它限制了内容与群发冲动，但**不改变发出那一下的指纹与节奏**。故必须叠加 A、B 的修复。

## 3. 目标

- 去掉 A：发送内容与原生消息不可区分。
- 修复 B：发送节奏像人（随机间隔 + 单账号速率上限），且 service worker 友好。
- 不动传输层、不动 tap、不动工作台回复交互（人点确认保留）。

## 4. 改动设计

### 4.1 去掉 ext 自定义标记（风险点 A）

文件：[onetalk-page-script.ts](apps/chrome-extension/src/channels/alibaba-im/onetalk-page-script.ts) `sendTextMessage`

- 删除 `ext: { source: "tradebridge", outboundMessageId }`。
- `sendUIMessages` 只传原生发送所需字段（`conversationCode`/`cid`/`content`/`text`/`messageType`）。
- 回执对账（`outboundMessageId` ↔ `externalMessageId`）改为**不写进上行 payload**：发送函数已返回结果，`externalMessageIdFromResult` 已从返回值取外部 id（[onetalk-page-script.ts:248](apps/chrome-extension/src/channels/alibaba-im/onetalk-page-script.ts#L248)），`outboundMessageId` 本就在 background 侧 request/response 配对里携带（page bridge 的 requestId 机制），不需要塞进消息体。确认删除后回执链路仍闭合。

### 4.2 发送节奏控制（风险点 B）

新增 `background/outbound-pacer.ts`，在 `sendOutboundMessagesViaOneTalk` 的循环里逐条发送之间插入节奏：

- **随机间隔**：每条发送后等待 `random(minDelayMs, maxDelayMs)`（默认如 3000~15000ms 抖动），避免等间隔这种机器特征。
- **速率上限**：单账号滑动窗口限流（如每分钟 ≤N、每小时 ≤M），超限的消息本轮不发、留待下轮（保持 queued / 续租）。
- **顺序**：保持逐条 await，不并发。
- 间隔实现用 `setTimeout` Promise；注意 service worker 可能在长等待中被回收 —— 单批发送时间不宜过长，超出预算的留到下次 alarm/claim 再发，而不是在一次调用里 sleep 很久。

参数集中可配，先用保守默认值，后续按试运行数据调。

### 4.3 领取节奏（配合 B）

文件：[realtime-orchestrator.ts:10](apps/chrome-extension/src/background/realtime-orchestrator.ts#L10)

- 评估把 `DEFAULT_CLAIM_LIMIT` 从 10 调小（如 3~5），减少单次涌入量，与 pacer 配合。
- lease 时间需覆盖 pacer 可能的延迟，避免发送中租约过期被回收重发。

## 5. 不改动

- 传输层（`sendUIMessages` 调用方式）—— 安全。
- 被动监听 tap、消息 buffer、同步链路。
- 工作台回复 UI（人点确认体验保留）。
- server outbound 队列 / claim 协议（限流放在插件侧漏斗，单点最简；如需服务端兜底限流可作为后续）。

## 6. 测试

- `outbound-pacer.test.ts`：随机间隔落在区间内、速率上限生效（超限留存）、注入假定时器验证不并发、单批预算控制。
- `outbound-orchestrator.test.ts`：补充"逐条之间经过 pacer、零标记 payload"断言。
- `onetalk-page-script.test.ts`：补充/改 send 用例 —— 断言发送 payload **不含** `ext`/`source`/`tradebridge`，回执 externalMessageId 仍正确返回。
- 回执对账闭环测试：删除 ext 后 outboundMessageId↔externalMessageId 仍配对成功。

验证命令：
```bash
npm run test -w @wangwang/chrome-extension
npm run typecheck -w @wangwang/chrome-extension
npm run build -w @wangwang/chrome-extension
```

## 7. 执行顺序

1. 去掉 ext 标记 + 回执闭环确认（风险点 A，改动最小收益最大）。
2. 新增 outbound-pacer（随机间隔 + 速率上限）。
3. 接入 `sendOutboundMessagesViaOneTalk` 漏斗。
4. 调小 claim limit / 校准 lease。
5. 测试 + typecheck + build。

## 8. 诚实边界

- 节奏控制降低"被判定为自动化"的概率，但**不能消除发送本身的风险**。高频、雷同内容、给未先联系的买家群发，仍是高风险模式 —— 这些靠产品策略（人点确认、内容多样性、不主动群发）控制，不是纯技术能兜底的。
- 最敏感的发送场景（如主动开发信）若需更低风险，仍建议保留"预填 OneTalk 原生输入框、真人点发送"的降级模式作为后续选项，本方案不含。
