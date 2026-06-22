# WhatsApp Integration Plan

日期：2026-06-22
分支：`codex/whatsapp-integration-analysis`
状态：方案分析

说明：本文件保留 Cloud API 与 WhatsApp Web 的路线对比。当前阶段用户已决策先走 WhatsApp Web 页面运行时 Hook 路线，实施方案以 `2026-06-22-whatsapp-web-sdk-hook-plan.md` 为准。

## 1. 结论

建议先把 TradeBridge 的多渠道核心补完整，然后优先以 WhatsApp Business Platform Cloud API 接入生产链路。

原因：

- Cloud API 是 Meta 官方接口，入站通过 Webhook，出站通过 Graph API `/{Phone-Number-ID}/messages`，稳定性和合规性都优于页面注入。
- WhatsApp Web 插件适配可以复用当前 Chrome extension 的 OneTalk 模式，但它依赖 WhatsApp Web 页面结构或页面运行时，风险更接近“网页自动化/逆向适配”，适合验证，不适合作为长期生产主链路。
- 当前 repo 已经有 `channel_account`、`ChannelSyncBatch`、`BUILT_IN_CHANNEL_IDS` 和 `whatsapp-web` 预留，但 outbound queue、WebSocket claim、Postgres outbound 映射和 Web scope 还没有完整按 channel 路由。无论选 Cloud API 还是 WhatsApp Web，这一层都要先补。

如果业务明确要求“用员工已登录的 WhatsApp Web 页面收发”，则走 `whatsapp-web` 适配器路线；如果目标是正式接入客户 WhatsApp 沟通，建议走 Cloud API，并把渠道命名调整为更清晰的 `whatsapp-business` 或 `whatsapp` + `surface=cloud-api`。

## 2. 当前代码基础

已经具备的能力：

- `packages/collector-protocol/src/index.ts` 已定义 `BUILT_IN_CHANNEL_IDS`，其中包括 `whatsapp-web`。
- `packages/database/migrations/005_channel_dimension.sql` 已给 `sync_batch`、`customer`、`conversation`、`message`、`outbound_message` 加了 `channel` 和 `channel_account_id`。
- `packages/onetalk-adapter/src/sync-mapper.ts` 已把 OneTalk 映射成统一 `ChannelSyncBatch`，当前为 `channel=alibaba-im`、`surface=onetalk-web`。
- Chrome 插件现有收发闭环已经可复用：同步上传、外发领取、投递回执、实时 WS 通知。

需要先补齐的问题：

- `apps/server/src/server.ts` 的 collector outbound HTTP/WS 领取只按 seller 过滤，没有 channel 过滤。
- `packages/database/src/postgres-sync-store.ts` 的 `createOutboundMessage`、`listPendingOutboundMessages`、`claimPendingOutboundMessages`、`listOutboundMessages` 和 `markOutboundMessageDelivered` 没有完整写入/返回/过滤 outbound channel 字段。
- `packages/collector-protocol/src/index.ts` 的 WS outbound payload 还没有把 channel/channelAccount 带给 collector。
- `apps/web/src/internal-api.ts` 的 scope query 只带 `sellerAccountExternalId`，没有 channel/channelAccount；`dashboard-state.ts` 选中 key 仍可能在多渠道同 ID 时冲突。
- `apps/server/src/server.ts` 中 TradeMind provision 默认 `channel=onetalk`，与产品文档中 `alibaba-im` 的口径不一致，建议收口。

## 3. 推荐架构：Cloud API 路线

### 3.1 入站

新增服务端 webhook：

- `GET /webhooks/whatsapp`：处理 Meta webhook verification。校验 `hub.verify_token`，返回 `hub.challenge`。
- `POST /webhooks/whatsapp`：校验 `X-Hub-Signature-256`，解析 `object=whatsapp_business_account`、`entry[].changes[]`。
- 对 `field=messages` 的 payload：
  - `value.metadata.phone_number_id` -> channel account。
  - `contacts[].wa_id` 或 message `from` -> customer external id。
  - message `id` -> external message id。
  - message `timestamp` -> sentAt。
  - text/image/document/audio/video/interactive/status 等按类型映射到统一 `SyncBatch`。
- webhook 没有历史回拉能力，必须落原始 event id/message id 做幂等和重试去重。

### 3.2 出站

新增 WhatsApp delivery worker 或 server-side channel sender：

- Web 仍创建 `outbound_message`。
- 对 `channel=whatsapp-business/cloud-api` 的 outbound，不再让 Chrome 插件领取，而由服务端调用 Graph API。
- MVP 先支持 text message：
  - `POST https://graph.facebook.com/{version}/{phoneNumberId}/messages`
  - `Authorization: Bearer <access_token>`
  - body 包含 `messaging_product=whatsapp`、`recipient_type=individual`、`to`、`type=text`、`text.body`。
- API 返回 WhatsApp message id 后写入 `externalMessageId`，后续 delivery/read/failed 通过 status webhook 回写。

### 3.3 24 小时窗口与模板

Cloud API 不能简单照搬 OneTalk 的自由回复模型：

- 用户发来消息或发起通话后，开启 24 小时 customer service window。
- 窗口内可以发送 service messages。
- 窗口外只能发送预先审核的 template messages。
- 因此需要保存或计算每个 WhatsApp customer/conversation 的 `lastInboundAt`，Web 创建自由文本外发时先判断窗口。
- 模板消息建议放到第二阶段：新增 template catalog、参数填写 UI、审批状态同步。

### 3.4 配置与密钥

首个 MVP 可用 env 配置单账号：

- `WHATSAPP_GRAPH_API_VERSION`
- `WHATSAPP_WABA_ID`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_DISPLAY_PHONE_NUMBER`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`

如果要支持多个 WABA/phone number，则需要新增 `channel_account_secret` 或等价密钥表，并做加密存储、轮换和审计。

## 4. 备选架构：WhatsApp Web 插件适配

如果业务必须复用“用户已登录网页”的模式，可新增：

- `apps/chrome-extension/src/channels/whatsapp-web/*`
- manifest 增加 `https://web.whatsapp.com/*`
- page bridge 注入 WhatsApp Web 页面。
- adapter 输出统一 `ChannelSyncBatch`：
  - `channel=whatsapp-web`
  - `surface=whatsapp-web`
  - channel account 可取登录手机号或可稳定识别的本地账号标识。
- outbound 由插件按 channel 路由到 WhatsApp Web adapter。

主要风险：

- WhatsApp Web 没有官方浏览器自动化消息 API。
- 页面结构和内部 store/action 变化会直接影响收发。
- E2E/本地缓存/虚拟列表导致历史同步和附件同步难度高。
- 合规风险明显高于 Cloud API。

因此这条路线建议仅用于内部验证或在业务明确接受风险时推进。

## 5. 分阶段实施

### Phase 0：路线确认

- 确认目标是 WhatsApp Business Cloud API 还是 WhatsApp Web。
- 确认是否已有 Meta Business、WABA、phone number、永久或系统用户 token、可公网访问的 HTTPS webhook URL。
- 确认是否需要模板消息、媒体附件、群组、已读回执。

### Phase 1：多渠道核心补齐

- `CustomerScope`、`ConversationCustomerScope` 增加 `channel` 和 `channelAccountExternalId`。
- internal API query、Web API client、dashboard state 使用完整 channel scope。
- outbound create/list/claim/delivery 在内存和 Postgres 实现中都写入、返回、过滤 channel。
- collector WS protocol 的 outbound claim 加 channel/capability，返回任务带 channel。
- Chrome extension outbound orchestrator 改成按 channel 分发，不再写死 `sendOutboundMessagesViaOneTalk`。
- 修正 `onetalk`/`alibaba-im` 命名差异。

### Phase 2A：Cloud API MVP

- 新增 WhatsApp webhook route 和 payload parser。
- 新增 WhatsApp Cloud API client。
- Webhook inbound 映射成 `SyncBatch` 后复用 `store.acceptSyncBatch`。
- WhatsApp outbound worker 发送 text message，并处理 API error -> `failed`。
- Status webhook 回写 `sent/delivered/read/failed`，至少保证 failed 能回写错误码。
- 单元测试覆盖 webhook verification、签名校验、text inbound、status inbound、text outbound request。

### Phase 2B：WhatsApp Web MVP

- 新增 WhatsApp Web adapter registry。
- 实现 tab detection/login detection。
- MVP 先支持当前打开会话的 text 收发，再扩展会话列表和历史消息。
- 增加 `whatsapp_web_tab_required`、`whatsapp_web_login_required`、`whatsapp_web_send_failed` 等稳定错误码。

### Phase 3：工作台体验

- 客户、会话、消息增加渠道 badge 和筛选。
- 回复框根据 channel 状态显示可发送/不可发送。
- Cloud API 路线下，24 小时窗口外禁用自由文本，提示选择模板。
- outbound 状态区分 queued/sent/delivered/read/failed。

### Phase 4：生产化

- 多 WABA/多 phone number 配置。
- access token 轮换和密钥加密。
- webhook 重试去重、死信/告警。
- 模板管理和模板参数 UI。
- 媒体上传、下载和附件存储策略。
- 运营监控：Webhook 延迟、发送成功率、失败码、窗口外拦截数。

## 6. 验收标准

- OneTalk/alibaba-im 现有收发链路不回归。
- WhatsApp 入站消息进入同一客户/会话/消息查询接口，并带正确 channel/surface。
- WhatsApp outbound 不会被 OneTalk 插件误领，OneTalk outbound 也不会被 WhatsApp sender 误领。
- 同 seller 下不同 channel 的相同 external id 不会互相污染。
- Cloud API 路线下，Webhook 签名校验、重试幂等、24 小时窗口限制都有测试覆盖。

## 7. 官方依据

- Meta WhatsApp Business Platform overview: https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
- Service messages and customer service window: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages/
- WhatsApp Message API reference: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api/
- Webhook endpoint verification and signatures: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint/
- Incoming webhook payload reference: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/webhooks/whatsapp-incoming-webhook-payload/
- Status messages webhook reference: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status/
