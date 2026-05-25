# 本机 API 接口说明

默认服务地址：

```text
http://127.0.0.1:5031
```

在线接口文档：

```text
http://127.0.0.1:5031/docs
```

OpenAPI JSON：

```text
http://127.0.0.1:5031/openapi.json
```

## 鉴权

如果没有配置 `WANGWANG_API_TOKEN`，本机 API 默认不要求 Bearer token。

如果配置了 `WANGWANG_API_TOKEN`，除 `/health` 和文档页外，业务接口都需要请求头：

```http
Authorization: Bearer <WANGWANG_API_TOKEN>
```

## macOS 阿里登录态

macOS 下服务会默认读取：

- `~/Library/Application Support/AliWorkbenchTemp/cef.log`
- `~/Library/Application Support/AliWorkbenchTemp/*/Cookies`
- `~/Library/Application Support/AliWorkbenchTemp/*/Cache/Cache_Data`
- `~/Library/Application Support/AliWorkbenchTemp/*/Code Cache/js`
- `~/Library/Keychains/login.keychain-db`

日志里可直接解析 `xman_us_t` 并得到 `ctoken`；AliWorkbench 缓存 URL 里也可能带有 `_tb_token_` 和 `ctoken`，服务会作为兜底读取。账号目录下的 Chromium `Cookies` 数据库会通过 macOS Chromium `v10` Cookie 解密流程读取 `cookie2`、`sgcookie` 等登录 Cookie。当前 macOS AliSupplier 进程带有 `--use-mock-keychain` 时，服务会优先使用 Chromium mock keychain 密钥解密；如果不适用，再尝试系统 Keychain。整个过程不会把 token 打印到日志。

可选覆盖项：

| 环境变量 | 说明 |
|---|---|
| `WANGWANG_LOG_PATHS` | 覆盖日志路径，多个路径按系统 path delimiter 分隔。 |
| `WANGWANG_COOKIE_DB_PATHS` | 覆盖 Chromium Cookies DB 路径。 |
| `WANGWANG_CHROMIUM_SAFE_STORAGE_SERVICE` | 覆盖 Keychain service 名称，默认优先尝试 `Chromium Safe Storage`。 |
| `WANGWANG_KEYCHAIN_TIMEOUT_MS` | 覆盖单次 Keychain 读取超时，默认 `10000`。 |
| `WANGWANG_CHROMIUM_SAFE_STORAGE_PASSWORD` | 直接提供 Chromium safe-storage 密钥，仅建议临时调试使用，不要写入持久配置。 |

## GET /health

检查 Fastify API 服务是否已经启动。

这个接口只返回服务状态、版本和服务端时间，不会读取阿里会话，也不会触发消息接口请求。

## GET /api/v1/session/status

检查当前 API 进程能解析到哪些阿里登录态字段。

接口只返回 Cookie 名称和布尔状态，不返回任何 Cookie/token 值。排查 `/api/v1/conversations` 被 `onetalk` 重定向到登录页时，先看这里：

| 字段 | 说明 |
|---|---|
| `cookieNames` | 当前可解析出的 Cookie 名称。 |
| `hasCtoken` | 是否能得到 `ctoken`。 |
| `hasTbToken` | 是否能得到 `_tb_token_`。 |
| `hasCookie2` | 是否能得到 `cookie2`；通常需要 Keychain 授权。 |
| `hasSgcookie` | 是否能得到 `sgcookie`；通常需要 Keychain 授权。 |

## GET /api/v1/conversations

获取当前可探测的缓存会话列表。

接口会复用本机已登录 AliWorkbench/旺旺留下的会话 Cookie，访问 `weblitePWA.htm`，并解析页面启动数据里的缓存会话。返回的 `id` 是本机生成的会话 ID，用于后续拉取消息，不是阿里原始账号 ID。

查询参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `refresh` | `"true"` / `"false"` | 否 | 传 `true` 时重新请求 `weblitePWA.htm`；不传时优先使用 API 进程内缓存。 |

关键返回字段：

| 字段 | 说明 |
|---|---|
| `conversationCacheCount` | 页面缓存中可探测会话数量。 |
| `conversations[].id` | 本机生成的会话 ID。 |
| `conversations[].displayName` | 前端展示用的联系人或会话名称。 |
| `conversations[].lastMessagePreview` | 缓存里携带的最后一条消息预览。 |
| `conversations[].lastMessageTime` | 最后一条缓存消息时间戳，单位毫秒。 |
| `conversations[].unreadCount` | 缓存里记录的未读数。 |

## GET /api/v1/conversations/:id/messages

分页拉取指定会话的一页消息。

第一次调用可以不传 `before`，服务会从当前时间向前拉取。继续拉更早消息时，把上一次响应里的 `nextBefore` 作为下一次请求的 `before`。

路径参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | string | 会话列表接口返回的本机会话 ID。 |

查询参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `before` | string | 否 | 毫秒时间戳游标。不传时从当前时间开始。 |
| `limit` | string | 否 | 每页消息数量，默认 `50`。 |

关键返回字段：

| 字段 | 说明 |
|---|---|
| `messages[]` | 本页消息列表。 |
| `messages[].direction` | 消息方向：`received`、`sent` 或 `unknown`。 |
| `messages[].content` | 消息正文。图片、文件等富媒体消息可能仍是原始结构或占位内容。 |
| `messages[].raw` | 脱敏后的原始消息对象，便于后续做字段映射。 |
| `nextBefore` | 下一页游标；没有更多消息时为 `null`。 |
| `page.count` | 本页返回的消息数量。 |

## GET /api/v1/conversations/:id/customer

获取某个聊天会话对应的客户信息。

接口会用会话缓存里的 `contactAccountId`、`contactAliId`、加密账号 ID 等字段，把聊天会话和本机可用的客户资料来源对应起来。目前会返回三类稳定数据：

| 来源 | 说明 |
|---|---|
| `conversation_cache` | weblitePWA 缓存会话里的联系人账号字段。 |
| `app_log_get_account_info_by_token` | 本机 MTOP 日志里 `getAccountInfoByToken` 的账号映射快照。 |
| `app_log_contact_extinfo_get` | 本机 MTOP 日志里 `contact.extinfo.get` 的联系人基础资料，例如公司名、国家、姓名、头像等。 |
| `app_log_get_user_info_by_params` | 本机 MTOP 日志里 `getUserInfoByParams` 的联系人快照，例如 loginId、国家、加入年限等。 |
| `chat_manager_summary` | `chatManager/getChatDataSummary.htm` 返回的互动摘要，例如产品卡片、询盘卡片、报价卡片、待付款订单等数量。 |

路径参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | string | 会话列表接口返回的本机会话 ID。 |

关键返回字段：

| 字段 | 说明 |
|---|---|
| `identity` | 当前会话对应的联系人身份字段。 |
| `mtopProfile` | 本机 MTOP 日志里的联系人快照，可能为 `null`。 |
| `accountTokenProfile` | `chatToken` 到联系人账号的映射快照，响应里不会返回 token 本身。 |
| `contactExtInfo` | 本机 MTOP `contact.extinfo.get` 日志里的联系人基础资料，可能包含公司名、国家、姓名、头像等。 |
| `chatSummary` | 客户互动摘要，可能为 `null`。 |
| `detailStatus` | 完整 alicrm 客户详情接口的当前可用状态。 |
| `matchedSources` | 本次成功匹配到的数据来源。 |

## POST /api/v1/export

把当前缓存会话对应的消息导出到本机 JSON 文件。

接口会遍历指定会话，按 `maxPages` 和 `pageSize` 分页拉取消息，并把结果写入 `exports` 目录。导出内容会保留消息正文和脱敏后的 `raw` 字段，不会写出 Cookie、ctoken、chatToken 等敏感凭据。

请求体：

```json
{
  "maxPages": 2,
  "pageSize": 50,
  "conversationIds": ["conv_xxxxx"]
}
```

参数说明：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `maxPages` | number | 否 | 每个会话最多向前翻多少页，默认 `2`。 |
| `pageSize` | number | 否 | 每页拉取消息数量，默认 `50`，最大 `100`。 |
| `conversationIds` | string[] | 否 | 只导出指定会话；不传则导出当前缓存列表中的全部可探测会话。 |

关键返回字段：

| 字段 | 说明 |
|---|---|
| `output` | 生成的本地 JSON 文件路径。 |
| `exportedConversationCount` | 实际导出的会话数量。 |
| `exportedMessageCount` | 实际导出的消息总数。 |
| `conversationMessageCounts` | 每个导出会话对应的消息数量。 |

## 当前边界

这些接口目前只覆盖 `weblitePWA.htm` 页面缓存里能看到的会话。完整会话列表仍需要后续继续分析 IMBaaSSDK 运行态或更底层的会话同步机制。

右侧客户详情面板里的完整 CRM 资料来自 alicrm JSONP 接口 `customerPluginQueryServiceI/queryCustomerInfo.json`。目前已确认该接口可以按 `requestHelper.jsonp` 形态请求，但在本机可复用参数下返回的 `buyerInfo` / `alicrmCustomerInfo` 仍为空对象；因此当前 API 先合并能稳定匹配的会话身份、MTOP 联系人基础资料、MTOP 联系人快照和 chatManager 摘要。注册时间、业务类型、销售平台、客户分组等字段还需要继续拿到 alicrm 更完整运行态或找到额外本地缓存响应。
