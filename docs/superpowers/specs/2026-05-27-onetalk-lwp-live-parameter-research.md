# OneTalk LWP 实测参数研究

日期：2026-05-27

## 结论

本轮实测确认：客户自然名、登录 ID、头像等客户/会话资料不应该从 DOM 取，也不必只依赖原始 LWP 会话结构。OneTalk 页面主运行时的 `IcbuIM.IMBaaSSDK.default.getConversationService().getConversationListByPagination` 会返回规范化会话列表，字段包含 `name`、`loginId`、`accountIdEncrypt`、`aliIdEncrypt`、`contact`、`latestMessage` 等，可作为客户列表和客户自然名的优先来源。

消息正文主路由仍是 WebSocket LWP：

```txt
/r/MessageManager/listUserMessages
```

可用请求体形态：

```js
[conversationCode, false, 9007199254740991, 20, false]
```

其中 `conversationCode` 对应会话 `cid`，第三个参数是初始游标，第四个参数是拉取数量。该参数在同一条注册成功的 LWP WebSocket 会话中曾返回 `code=200` 和 `body.userMessageModels`。

## 已验证入口

### IM Token

页面桥通过 MTop 获取 IM WebSocket token：

```txt
mtop.alibaba.icbu.im.login.token.get
```

请求关键参数：

```js
{
  appKey,
  deviceId
}
```

返回对象含：

- `accessToken`
- `refreshToken`
- `accessTokenExpiredMillSeconds`

注意：token、refresh token、sign、cookie 不落盘，不进入日志。

### LWP 注册

WebSocket：

```txt
wss://wss-icbu.dingtalk.com/
```

注册帧：

```js
{
  lwp: "/reg",
  headers: {
    mid,
    "app-key": appKey,
    did: deviceId,
    token: accessToken,
    ua,
    dt: "j",
    wv: "im:3,au:3,sy:6",
    sync: "0,0;0;0;",
    "cache-header": "app-key token ua wv"
  }
}
```

注册成功响应：

- `code=200`
- header keys 包含 `sid`、`reg-sid`、`reg-uid`
- body keys 包含 `unitName`、`cookie`、`timestamp`、`isFromChina`

这些 header/body 中的会话类字段只能内存使用，必须从上传数据和日志中剔除。

### 同步状态

```js
{ lwp: "/r/SyncStatus/getState", body: [{ topic: "sync" }] }
```

响应 body keys：

- `channel`
- `highPts`
- `pipeline`
- `pts`
- `seq`
- `timestamp`
- `tooLong2Tag`
- `topic`

ack：

```js
{ lwp: "/r/SyncStatus/ackDiff", body: [stateBody] }
```

### 原始 LWP 会话列表

```js
{ lwp: "/r/Conversation/listNewestPagination", body: [Date.now(), 100] }
```

响应：

- `body.userConvs`
- `body.nextCursor`
- `body.hasMore`

单条原始会话关键字段：

- `singleChatUserConversation.singleChatConversation.cid`
- `singleChatUserConversation.singleChatConversation.pairFirst`
- `singleChatUserConversation.singleChatConversation.pairSecond`
- `singleChatUserConversation.lastMessage.message`
- `singleChatUserConversation.user_extension.custom`

原始 LWP 会话里客户自然名不稳定，不作为 displayName 的优先来源。

### 页面 SDK 会话列表

页面主运行时入口：

```js
const sdk = window.IcbuIM.IMBaaSSDK.default;
const conversationService = sdk.getConversationService();
await conversationService.getConversationListByPagination({
  cursor: Date.now(),
  count: 20
});
```

实测返回：

```txt
top keys: hasMore, list, nextCursor
list length: 6
```

单条 list item keys：

- `cid`
- `name`
- `loginId`
- `loginIdEncrypt`
- `accountId`
- `accountIdEncrypt`
- `aliId`
- `aliIdEncrypt`
- `contact`
- `latestMessage`
- `unreadCount`
- `fullPortrait`
- `lastContactTimeLong`

这是当前最适合作为客户列表、客户自然名、loginId、头像、最近消息摘要来源的接口。它来自页面 SDK，不是 DOM。

### LWP 消息列表

路由：

```txt
/r/MessageManager/listUserMessages
```

HAR 与实测可用参数：

```js
[
  conversationCode,
  false,
  Number.MAX_SAFE_INTEGER,
  20,
  false
]
```

成功响应 body keys：

- `degradeFailover`
- `hasMore`
- `nextCursor`
- `userMessageModels`

单条消息模型 keys：

- `message`
- `msgStatus`
- `readStatus`
- `recallFeature`
- `userExtension`

消息主体 keys：

- `messageId`
- `cid`
- `createAt`
- `content`
- `searchableContent`
- `sender`
- `receivers`
- `receiverCount`
- `displayStyle`
- `unreadCount`

## 关键约束

同一个 token/deviceId 不适合反复开新 WebSocket 注册。实测现象：

- 第一次 `/reg`：`code=200`
- 复用同一 token 再开新 WebSocket 注册：`code=401`
- 随后的 `getState`、会话、消息请求：多为 `code=400`

因此插件必须把 `fetchWeblite()` 和 `getChatMessages()` 放在同一个注册成功的 LWP transport 生命周期内执行，避免每个会话或每个消息页重新注册。

另外，自建 WebSocket 与页面原生 IM SDK 同时存在时，消息路由出现过间歇性超时；页面 SDK 会话分页稳定返回。因此当前建议：

1. 客户/会话资料优先走页面 SDK `getConversationListByPagination({ cursor, count })`。
2. 消息正文继续用已知 LWP `listUserMessages` 参数，但加强单 socket 生命周期、超时重试和诊断。
3. 后续若要进一步降低自建 WebSocket 的不稳定性，可继续研究 `getMessageServiceV2().listMessageWithConversationCode`，其参数面包含 `conversationCode`、`cursor`、`sendTime`、`count`、`fetchType`、`dataCallback`、`errorCallBack`；本轮 `sendTime` 形态已返回成功但样本数据为 0。

## 调试脚本

本轮新增的本地诊断脚本：

- `tools/probe_chrome_onetalk_full_data.mjs`
- `tools/probe_chrome_onetalk_lwp_params.mjs`
- `tools/probe_chrome_onetalk_sdk_surface.mjs`
- `tools/probe_chrome_onetalk_sdk_calls.mjs`

这些脚本只输出字段名、类型、数量、状态码和错误摘要，不打印真实 token、cookie、chatToken、会话 ID、客户名或消息正文。

## 下一步实现建议

Chrome 插件可重构为两条来源：

1. 页面 SDK 资料源：通过内容脚本主运行时 bridge 调 `getConversationListByPagination`，返回去敏后的规范化客户/会话列表。
2. LWP 消息源：在 background 中单次 token、单次 `/reg`、同一 WebSocket 内完成会话消息拉取；请求参数使用 `[cid, false, Number.MAX_SAFE_INTEGER, pageSize, false]`，后续分页优先使用响应 `nextCursor` 再验证。

上传前必须继续执行现有 sanitizer，剔除 `chatToken`、`sid`、`reg-sid`、`reg-uid`、`cookie`、`token`、`sign` 等敏感字段。
