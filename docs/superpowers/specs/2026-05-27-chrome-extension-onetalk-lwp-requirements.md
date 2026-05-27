# Chrome 插件 OneTalk LWP 重构需求说明

日期：2026-05-27

## 1. 背景

本需求基于两类输入整理：

- 原始 HAR：`/Users/wait9yan/Downloads/onetalk.alibaba.com.har`
- 网络分析文档：`docs/superpowers/specs/2026-05-27-onetalk-network-har-analysis.md`
- 现有代码：`apps/chrome-extension`、`packages/onetalk-adapter`、`apps/server`、`apps/web`

核心结论：现有 Chrome 插件仍主要依赖 `weblitePWA.htm` 和 `getChatMessageList.htm` 这条 HTTP 兼容链路；HAR 证据显示 OneTalk 当前会话列表与聊天正文的主数据源应迁移到 WebSocket LWP：

- WebSocket endpoint：`wss://wss-icbu.dingtalk.com/`
- 会话列表路由：`/r/Conversation/listNewestPagination`
- 消息列表路由：`/r/MessageManager/listUserMessages`
- 同步状态路由：`/r/SyncStatus/getState`、`/r/SyncStatus/ackDiff`
- 心跳路由：`/!`

本阶段只明确需求，不直接实现。

## 2. 重构目标

重构后的 Chrome 插件应成为阿里卖家 OneTalk 的本机采集与代发端，能力包括：

1. 在用户已经登录 `onetalk.alibaba.com` 的 Chrome 环境中识别登录状态。
2. 使用本机登录态获取 OneTalk IM WebSocket token，并在本机短期使用。
3. 通过 WebSocket LWP 获取卖家会话列表、客户列表基础信息和聊天记录。
4. 将客户、会话、消息转换为现有 TradeBridge `SyncBatch` 并上传。
5. 支持 Web 工作台创建人工回复后，由 Chrome 插件在 OneTalk 页面上下文中发送。
6. 支持发送回执，将 sent/failed 状态回写 TradeBridge。
7. 不把 OneTalk Cookie、CSRF token、MTop sign、chatToken、WebSocket token、refresh token 上传或保存到 TradeBridge 服务端。

## 3. 当前实现差距

当前已有能力：

- 插件有 options/popup/background/content 基础结构。
- `BrowserOnetalkClient` 可读取 `weblitePWA.htm`，解析页面缓存和页面快照。
- `getChatMessages()` 仍调用 `POST /message/getChatMessageList.htm`。
- `sync-orchestrator` 已能组装并上传 `SyncBatch`。
- `outbound-orchestrator` 已能领取 queued outbound message，并通过 OneTalk 页面桥发送文本。
- 服务端已有 `/collector/v1/sync-batches`、`/collector/v1/outbound-messages`、delivery 回执。
- `sync-mapper` 测试中已经覆盖一部分 LWP conversation/message 模型映射。

主要缺口：

- 没有 WebSocket LWP client。
- 没有 IM WebSocket token 获取封装。
- 没有 `/reg`、同步状态、分页会话、分页消息、心跳、重连的协议层抽象。
- 当前 HTTP 消息接口不应继续作为消息正文主路径。
- 客户资料补全仍不完整，需要明确 MTop/CRM/页面快照的优先级。
- 发送链路只验证了页面 SDK 方向，尚未通过 HAR 捕获发送文本、图片、附件的完整协议证据。

## 4. 功能需求

### 4.1 登录态与本机鉴权

- 插件必须依赖用户自己的 Chrome OneTalk 登录态。
- 未登录、登录过期、验证码、风控页面必须返回明确错误码，不做绕过。
- 插件应在本机上下文调用 `mtop.alibaba.icbu.im.login.token.get` 获取 IM WebSocket token。
- token、refresh token、MTop sign、CSRF token 只能在内存中短期使用。
- `chrome.storage`、TradeBridge payload、console、popup、options、server log 均不得出现上述敏感值。

### 4.2 WebSocket LWP 连接

插件需要新增 OneTalk IM/LWP 客户端，最小能力：

- 连接 `wss://wss-icbu.dingtalk.com/`。
- 发送 `/reg` 注册帧。
- 处理注册成功、注册失败、登录过期、token 过期、网络断开。
- 发送 `/!` 心跳并处理心跳响应。
- 支持请求/响应关联，至少按 `mid` 或等价字段匹配一次请求结果。
- 断线后可重连；重连时不得复用已过期 token。
- 连接生命周期应适配 Manifest V3 service worker，长连接不稳定时允许退化为短连接拉取。

### 4.3 会话与客户列表

主路径：

- 通过 `/r/Conversation/listNewestPagination` 拉取会话分页。
- 响应中的 `body.userConvs` 是客户列表和会话列表的主来源。
- 支持 `nextCursor`、`hasMore` 分页。

字段映射需求：

- `externalConversationId` 优先取 `singleChatUserConversation.singleChatConversation.cid` 或消息中的 `message.cid`。
- `externalCustomerId` 优先取单聊 pair 中非当前卖家的 uid/account 标识；若无法判断，保守标记为 unknown 并记录诊断，不上传错误归属。
- `lastMessageAt` 取 `singleChatUserConversation.lastMessage.message.createAt`，兜底 `modifyTime`。
- 客户展示名优先级：MTop 联系人资料、CRM 客户资料、OneTalk 页面快照、会话内可用字段。
- 客户国家、loginId、标签可通过辅助接口补充，但不得阻塞主同步。

### 4.4 聊天记录

主路径：

- 通过 `/r/MessageManager/listUserMessages` 按会话分页拉取消息。
- 响应中的 `body.userMessageModels` 是消息正文主来源。
- 支持 `nextCursor`、`hasMore`、分页方向和历史消息翻页。

字段映射需求：

- `externalMessageId` 取 `message.messageId`。
- `externalConversationId` 取 `message.cid`。
- `sentAt` 取 `message.createAt`。
- 文本内容优先取 `message.content.text.content`，兜底 `message.searchableContent.summary`。
- `direction` 通过 `message.sender.uid` 与当前卖家 uid 对比判断。
- `messageType` 根据 `content.contentType`、`displayStyle` 或扩展字段映射。
- `rawSanitized` 可保留去敏后的结构，用于排查字段变化。

第一版必须支持文本消息；图片、文件、订单卡片、商品卡片、撤回、已读状态作为后续增强，除非补充 HAR 证据后确认字段稳定。

### 4.5 增量同步与接收消息

最低要求：

- 支持用户点击手动同步。
- 支持定时增量同步。
- 保存安全游标，包括 TradeBridge `nextCursor`、LWP 会话分页 cursor、每个会话消息分页 cursor 或最后消息时间。
- 游标中不得保存 token、cookie、session id。
- 同步失败时不得推进游标。
- 重复同步必须幂等，依赖服务端 existing message key 或 `externalMessageId` 去重。

实时接收要求待确认：

- 如果一期要求近实时接收，需要保持 OneTalk 页面打开，并评估 WebSocket 长连接与 MV3 service worker 生命周期。
- 如果一期允许分钟级延迟，则以 alarm/手动同步为主，WebSocket 可按需短连接拉取。

### 4.6 发信息

现阶段发送链路继续采用“TradeBridge Web 排队、Chrome 插件本机代发、服务端记录回执”：

```text
TradeBridge Web
  -> POST internal outbound message
Chrome Extension
  -> GET collector outbound queue
OneTalk page context
  -> 页面 SDK 发送
Chrome Extension
  -> POST delivery sent/failed
```

第一版发送范围：

- 仅支持人工输入的单条文本消息。
- 必须要求用户已登录并打开 OneTalk 页面，或能可靠唤起/定位 OneTalk 页面。
- 插件不得自动批量群发、自动营销、绕过人工确认。
- 发送成功后尽量回填 OneTalk `externalMessageId`；如果页面 SDK 不返回消息 ID，需要明确是否允许以 deliveredAt 作为成功回执。
- 发送失败必须记录稳定错误码，例如 `onetalk_tab_required`、`onetalk_send_unavailable`、`onetalk_send_timeout`、`onetalk_send_failed`。

待补证据后再做：

- 图片发送。
- 文件发送。
- 商品/订单卡片发送。
- 通过 LWP 路由直接发送。

### 4.7 客户资料补充

辅助接口分层：

- 第二优先级：`mtop.alibaba.icbu.im.getUserInfoByParams`、`mtop.alibaba.icbu.im.queryMembersInfoByLoginId`。
- 第二优先级：`alicrm.customerPluginQueryServiceI.queryCustomerInfo`、`queryCustomerTag`。
- 第二优先级：OneTalk 标签接口 `mtop.alibaba.icbu.tag.*`、`/message/getTargetTagList.htm`。
- 第三优先级：设备能力、推荐动作、翻译设置、会话关系事件。

要求：

- 主同步不得因为客户资料补充接口失败而失败。
- 辅助资料应可独立诊断和降级。
- CRM/tag 字段进入 TradeBridge 前需要明确字段白名单。

## 5. 非目标

- 不由 TradeBridge 服务端保存或代持 OneTalk 鉴权。
- 不绕过 OneTalk 登录、验证码、权限或风控。
- 不通过 UI 自动化点击页面作为主同步路径。
- 不采集埋点、监控、风控、静态资源请求。
- 第一版不做公开 Chrome Web Store 发布。
- 第一版不做批量营销、群发、自动回复。
- 第一版不保证图片、附件、卡片类消息完整解析，除非补充样本后单独确认。

## 6. 数据与接口边界

继续复用现有 collector sync protocol：

- 上传接口：`POST /collector/v1/sync-batches`
- 待发领取：`GET /collector/v1/outbound-messages`
- 发送回执：`POST /collector/v1/outbound-messages/:id/delivery`

TradeBridge 服务端只接收：

- `sellerAccount`
- `device`
- `customers`
- `conversations`
- `messages`
- 安全 cursor
- 去敏 sourceMeta/diagnostics

TradeBridge 服务端不得接收：

- OneTalk Cookie
- CSRF token
- `_tb_token_`
- `ctoken`
- `sgcookie`
- `x5sec`
- `chatToken`
- MTop `sign`
- WebSocket accessToken/refreshToken
- 原始请求头和响应头

## 7. 诊断需求

插件应记录去敏诊断信息：

- 最近同步时间。
- 会话请求次数、成功数、分页数。
- 消息请求次数、成功数、有消息的会话数。
- LWP 路由级状态：`/reg`、`getState`、`listNewestPagination`、`listUserMessages`、`ackDiff`、heartbeat。
- 每个会话的消息数量、是否 hasMore、是否有 nextCursor。
- 最近错误码和可读提示。

诊断不得包含 token、cookie、sign、chatToken、真实请求头、完整原始响应。

## 8. 验收标准

技术验收：

- 单元测试覆盖 LWP frame 构造、响应解析、字段映射、去敏、同步编排、发送回执。
- 使用去敏 HAR fixture 验证 `/r/Conversation/listNewestPagination` 和 `/r/MessageManager/listUserMessages` 映射。
- `npm test -w @wangwang/onetalk-adapter` 通过。
- `npm test -w @wangwang/chrome-extension` 通过。
- `npm run typecheck` 通过。
- `npm run build -w @wangwang/chrome-extension` 通过。

真实环境验收：

- 用户登录 OneTalk 后，插件能同步至少一页会话。
- 至少一个会话能同步聊天文本消息。
- TradeBridge Web 能显示客户、会话、消息时间线。
- Web 中创建一条人工文本回复后，插件能在 OneTalk 发送并回写 sent/failed。
- 登出 OneTalk 后同步返回登录态错误，而不是上传空数据覆盖正常状态。
- 上传 payload、插件存储、服务端日志均不包含敏感鉴权字段。

## 9. 待确认问题

1. 历史范围：第一版同步最近多少个会话、每个会话最多多少页历史消息？
2. 接收时效：第一版要求近实时接收，还是允许定时同步的分钟级延迟？
3. 消息类型：第一版是否只要求文本，图片/文件/订单卡片是否推后？
4. 客户资料：第一版是否必须同步 CRM 标签、国家、loginId，还是先保证客户名和会话关系？
5. 发送成功标准：如果 OneTalk 页面 SDK 不返回 messageId，是否允许回写 sent 但 externalMessageId 为空？
6. 多账号：第一版是否只支持单 Chrome profile 下一个卖家账号？
7. 安装形态：继续内部 unpacked/企业安装，还是需要预留 Chrome Web Store 合规材料？

## 10. 建议下一步

在以上问题确认后，再进入实现计划拆分。建议按以下顺序：

1. 新增 browser-safe LWP adapter 和去敏 HAR fixture 测试。
2. 将 Chrome 插件同步主路径从 HTTP 消息接口切到 LWP。
3. 保留 HTTP/page snapshot 作为降级和客户名补全。
4. 强化发送链路验收和失败诊断。
5. 做一次真实 OneTalk 内部试运行。
