# OneTalk Network HAR Analysis

日期：2026-05-27

## 1. 范围

本文件基于本地 HAR 文件重新解析：

- `/Users/wait9yan/Downloads/onetalk.alibaba.com.har`

解析目标是确认 `onetalk.alibaba.com` 页面中客户、会话、聊天消息、同步状态和辅助业务信息的数据来源，并给 TradeBridge 后续采集实现提供依据。

安全边界：

- 不记录 Cookie、OAuth token、CSRF token、MTop `sign`、`chatToken`、设备 ID、IP、账号 ID 原值。
- 不展开聊天正文、客户真实名称、联系人账号等业务内容。
- 文档只保留接口路径、路由、计数、字段结构和实现判断。

## 2. 总体结论

OneTalk 的会话列表和聊天消息主数据源不是传统 HTTP 消息列表接口，而是 WebSocket：

- WebSocket endpoint：`wss://wss-icbu.dingtalk.com/`
- 协议形态：JSON 文本帧，LWP 路由
- 会话列表路由：`/r/Conversation/listNewestPagination`
- 消息列表路由：`/r/MessageManager/listUserMessages`
- 同步点位路由：`/r/SyncStatus/getState`、`/r/SyncStatus/ackDiff`
- 心跳路由：`/!`

HTTP/MTop 接口仍然重要，但主要承担登录 token 获取、联系人资料、标签、CRM 侧栏、翻译设置、推荐操作等辅助能力。

## 3. HAR 概览

HAR 总量：

| 项 | 数量 |
| --- | ---: |
| 请求总数 | 267 |
| WebSocket 连接 | 1 |
| WebSocket 消息帧 | 16 |
| `acs.h.alibaba.com` MTop 调用 | 29 |
| `onetalk.alibaba.com` 业务调用 | 13 |

按资源类型：

| 类型 | 数量 |
| --- | ---: |
| image | 121 |
| script | 38 |
| xhr | 37 |
| fetch | 32 |
| ping | 18 |
| stylesheet | 11 |
| other | 4 |
| font | 3 |
| document | 2 |
| websocket | 1 |

主要域名：

| 域名 | 数量 | 判断 |
| --- | ---: | --- |
| `aplus.alibaba.com` | 96 | 埋点，不作为业务数据源 |
| `s.alicdn.com` | 44 | 静态资源 |
| `acs.h.alibaba.com` | 29 | MTop 业务/配置 API |
| `px.effirst.com` | 21 | 监控/风控相关，不作为业务数据源 |
| `onetalk.alibaba.com` | 13 | OneTalk 业务 HTTP API |
| `sc04.alicdn.com` | 11 | 静态资源 |
| `img.alicdn.com` | 10 | 图片资源 |
| `fourier.alibaba.com` | 9 | 风控/监控相关 |
| `g.alicdn.com` | 6 | 静态资源 |
| `alicrm.alibaba.com` | 5 | CRM 客户资料/标签 |
| `message.alibaba.com` | 4 | 消息域辅助配置/API |
| `wss-icbu.dingtalk.com` | 1 | IM 主数据 WebSocket |

## 4. 主数据源

### 4.1 WebSocket 登录 token

| 用途 | 接口 |
| --- | --- |
| 获取 IM WebSocket token | `GET https://acs.h.alibaba.com/h5/mtop.alibaba.icbu.im.login.token.get/1.0/` |

请求特征：

- MTop query 中包含 `api`、`appKey`、`data`、`sign`、`t` 等标准参数。
- `data` 结构包含 `appKey`、`deviceId`。

响应结构证据：

- `data.object.accessToken`
- `data.object.refreshToken`
- `data.object.accessTokenExpiredMillSeconds`

实现判断：

- 这是建立 `wss://wss-icbu.dingtalk.com/` 连接前的关键凭据来源。
- TradeBridge 服务端不能接收或保存这些 token。
- Chrome 插件或页面上下文可以短暂使用 token 建立本机 WebSocket 会话。

### 4.2 WebSocket 注册

WebSocket entry：

```text
wss://wss-icbu.dingtalk.com/
```

注册帧：

| 方向 | LWP 路由 | 响应 |
| --- | --- | --- |
| send | `/reg` | receive `code=200` |

注册响应结构包含：

- `headers.sid`
- `headers.reg-sid`
- `headers.reg-uid`
- `body.unitName`
- `body.cookie`
- `body.timestamp`
- `body.isFromChina`

文档中不记录这些字段的原值。实现上只应在内存中使用必要的 session 信息。

### 4.3 同步状态

| 方向 | LWP 路由 | body 结构 | 响应结构 |
| --- | --- | --- | --- |
| send | `/r/SyncStatus/getState` | array length 1，item 含 `topic` | `pipeline`、`tooLong2Tag`、`channel`、`topic`、`highPts`、`pts`、`seq`、`timestamp` |
| send | `/r/SyncStatus/ackDiff` | array length 1，item 为同步状态对象 | `code=200`，无业务 body |

实现判断：

- `getState` 返回的是同步点位。
- `ackDiff` 用于确认差量/同步状态。
- 如果未来要做更稳定的增量同步，应保存安全的 TradeBridge 游标，但不能保存原始 token/session。

### 4.4 会话列表

| 用途 | LWP 路由 | 响应证据 |
| --- | --- | --- |
| 拉取最新会话分页 | `/r/Conversation/listNewestPagination` | `nextCursor`、`hasMore`、`userConvs` |

请求结构：

- body 为 array length 2。
- 参数值未在文档中展开。

响应结构：

- `body.nextCursor`
- `body.hasMore`
- `body.userConvs`
- 本 HAR 中 `userConvs` 数量为 6。

单个会话 item 结构：

- `singleChatUserConversation.visible`
- `singleChatUserConversation.modifyTime`
- `singleChatUserConversation.redPoint`
- `singleChatUserConversation.joinTime`
- `singleChatUserConversation.lastMessage`
- `singleChatUserConversation.singleChatConversation`
- `singleChatUserConversation.topRank`
- `singleChatUserConversation.muteNotification`
- `singleChatUserConversation.user_extension`
- `type`

实现映射建议：

| TradeBridge 字段 | OneTalk 候选字段 |
| --- | --- |
| `externalConversationId` | `singleChatConversation.cid` 或同级会话 ID 字段 |
| `externalCustomerId` | `singleChatConversation` 中联系人 account/aliId 字段 |
| `lastMessageAt` | `lastMessage` 时间字段、`modifyTime` |
| 客户展示名 | 结合 `lastMessage`、`singleChatConversation` 和用户资料 MTop 补齐 |

### 4.5 聊天消息列表

| 用途 | LWP 路由 | 响应证据 |
| --- | --- | --- |
| 拉取会话消息分页 | `/r/MessageManager/listUserMessages` | `nextCursor`、`hasMore`、`userMessageModels` |

请求结构：

- body 为 array length 5。
- 第一个参数形态为字符串，整体用于指定会话与分页条件。
- 参数值可能包含会话标识，文档不展开。

响应结构：

- `body.nextCursor`
- `body.hasMore`
- `body.degradeFailover`
- `body.userMessageModels`
- 本 HAR 中 `userMessageModels` 数量为 4。

单个消息模型结构：

- `readStatus`
- `userExtension`
- `recallFeature`
- `message`
- `msgStatus`

消息主体字段：

- `message.messageId`
- `message.createAt`
- `message.content`
- `message.searchableContent`
- `message.sender`
- `message.receivers`
- `message.receiverCount`
- `message.cid`
- `message.extension`
- `message.unreadCount`
- `message.displayStyle`
- `message.redPointPolicy`

实现映射建议：

| TradeBridge 字段 | OneTalk 候选字段 |
| --- | --- |
| `externalMessageId` | `message.messageId` |
| `externalConversationId` | `message.cid` |
| `sentAt` | `message.createAt` |
| `content` | 从 `message.content` 或 `message.searchableContent` 解析文本内容 |
| `direction` | 对比 `message.sender` 与当前登录用户 |
| `rawSanitized` | 仅保存去敏后的结构，不保留 token、账号敏感字段原值 |

### 4.6 心跳

| 方向 | LWP 路由 | 响应 |
| --- | --- | --- |
| send | `/!` | receive `code=200`，响应 header 含 server timestamp |

HAR 中出现 2 次心跳请求，间隔约 15 秒。

## 5. 辅助业务 API

### 5.1 OneTalk HTTP API

| 用途 | 接口 | 响应/说明 |
| --- | --- | --- |
| 页面入口 | `GET /message/weblitePWA.htm` | HTML，query 含 `activeAccountId`、`activeAccountIdEncrypt`、`chatToken` |
| CSRF token | `POST /csrf/getToken.htm` | `headerName`、`parameterName`、`token` |
| 标签权限 | `POST /message/opTagAuthority.htm` | `code`、`data`、`message` |
| 转接记录 | `GET /message/manager/subTransferRec.htm` | `code`、`data`、`message` |
| 会话关系事件 | `POST /chatRelation/getChatRelationEvent.htm` | 事件 ID、事件类型、时间、账号关系字段 |
| 消息附加状态 | `POST /message/getChatMessageListExtra.htm` | `contactDisabled`、`existEnableFAQ` |
| 目标标签列表 | `POST /message/getTargetTagList.htm` | 标签相关响应 |
| 会话修复判断 | `POST /chatConversationFix/checkConversationNeedFix.htm` | `needFix`、`contactDisabled`、`inContactBlockList`、`unReplyInquiryNum` |

判断：

- `/message/getChatMessageListExtra.htm` 不是消息正文主数据源，只是附加状态。
- `/message/weblitePWA.htm` 可作为页面 bootstrap，但不能依赖 query 中的敏感值进入服务端。

### 5.2 message.alibaba.com

| 用途 | 接口 | 响应/说明 |
| --- | --- | --- |
| CSRF token | `GET /message/ajax/csrftoken.htm` | `data.headerName`、`data.parameterName`、`data.token` |
| 翻译设置 | `POST /msgsend/ajax/languageTranslateInfo.htm` | 翻译开关、源/目标语言、支持语言对 |

### 5.3 CRM API

| 用途 | 接口 | query 结构 | 响应/说明 |
| --- | --- | --- | --- |
| 客户标签 | `GET https://alicrm.alibaba.com/jsonp/customerPluginQueryServiceI/queryCustomerTag.json` | `_tb_token_`、`ctoken`、`buyerAccountId`、`buyerLoginId` 等 | `success`、`code`、`data.data` |
| CRM 灰度 | `GET /jsonp/alicrmCommonServiceI/isInGray.json` | `_tb_token_`、`ctoken`、`pageType` | 灰度判断 |
| 客户资料 | `GET /jsonp/customerPluginQueryServiceI/queryCustomerInfo.json` | `_tb_token_`、`ctoken`、`buyerAccountId`、`buyerLoginId`、`lang` 等 | `success`、`code`、`data.data` |
| 国家/地区多语言 | `GET /jsonp/mulLangCountriesServiceI/queryCLDRCountries.json` | `_tb_token_`、`ctoken`、`locale` | 国家/地区字典 |

判断：

- CRM API 可用于补充客户资料和标签。
- query 中包含 token 类参数，插件实现必须只在本机浏览器上下文使用，不上传 TradeBridge。

### 5.4 MTop API 清单

| API | 次数 | data keys | 主要用途 |
| --- | ---: | --- | --- |
| `mtop.alibaba.icbu.im.login.token.get` | 1 | `appKey`、`deviceId` | 获取 WebSocket token |
| `mtop.alibaba.icbu.im.getUserInfoByParams` | 1 | `chatTokens`、`contactAliIds`、`queryParams`、`queryType` | 批量联系人资料 |
| `mtop.alibaba.icbu.im.queryMembersInfoByLoginId` | 1 | `chatToken`、`contactLoginId`、`queryType` | 按 loginId 查询成员信息 |
| `mtop.alibaba.intl.mobile.interaction.getContactUserDeviceInfo` | 1 | `contactUserAliId` | 联系人设备/端能力 |
| `mtop.alibaba.intl.mobile.interaction.recommendaction.get` | 1 | `appKey`、`contactAliId`、`language`、`scene`、`terminal` | 推荐动作 |
| `mtop.alibaba.icbu.tag.relation.list.get` | 1 | `startVersion`、`userRole` | 标签协议/关系列表 |
| `mtop.alibaba.icbu.tag.feature.query` | 1 | `language`、`userRole` | 标签功能配置 |
| `mtop.alibaba.icbu.tag.color.list` | 1 | `userRole` | 标签颜色 |
| `mtop.alibaba.icbu.chat.account.check` | 2 | `appKey`、`contactAccountIdEncrypt` | 账号能力/可用性检查 |
| `mtop.alibaba.intl.ai.assistant.isInGrayScale` | 2 | `functionNames` | AI 助手灰度 |
| `mtop.alibaba.camel.ai.risk` | 3 | 无显式业务 key | AI/风控相关 |
| `mtop.alibaba.intl.ai.reception.translate.language.query` | 1 | `contactAliId` | 翻译语言查询 |
| `mtop.alibaba.intl.ai.reception.all.translate.language.query` | 1 | 无显式业务 key | 全量翻译语言 |
| `mtop.alibaba.intl.ai.assistant.rcpt.auto.trigger` | 1 | `contactAliId`、`scene` | 自动接待触发 |
| `mtop.alibaba.intl.contact.config.setting.query` | 1 | `configName` | 联系人配置 |
| `mtop.alibaba.intl.im.okki.background.config.query` | 2 | 无显式业务 key | 背景配置 |
| `mtop.alibaba.icbu.ai.auto.reception.open.time.query` | 1 | 无显式业务 key | 自动接待开放时间 |
| `mtop.alibaba.icbu.im.chat.alert.config.query` | 1 | 无显式业务 key | 聊天提醒配置 |
| `mtop.alibaba.icbu.chat.seller.valuation.findValuation` | 1 | `appKey`、`contactAliId` | 商家估值/评分类信息 |
| `mtop.alibaba.icbu.chat.xiaoman.loginurl.get` | 1 | `contactAccountId`、`origin` | Xiaoman 跳转 |
| `mtop.alibaba.intl.live.checkSellerLiveFlag` | 1 | `appKey` | 直播标记 |
| `mtop.alibaba.intl.camel.im.userbehavior.report` | 1 | `aliId`、`clientType`、`contactAliId`、`operateType`、`scene`、`source` | 行为上报 |
| `mtop.alibaba.intl.camel.ai.tradeagent.onboarding.isFatigued` | 1 | 无显式业务 key | AI onboarding 疲劳度 |
| `mtop.alibaba.intl.summary.feedback.check` | 1 | 无显式业务 key | 摘要反馈检查 |

联系人资料响应字段证据：

- `getUserInfoByParams` 的 `data.object` 是数组，本 HAR 中长度为 5。
- item 字段包含 `aliId`、`loginId`、`countryCode`、`countryIcon`、`available`、`joiningYears`、`recentContact`、`potentialScore`。
- `queryMembersInfoByLoginId` 响应字段包含 `available`、`countryCode`、`countryIcon`、`emailValidation`、`joiningYears`、`recentContact`、`supportVideo`、`verified` 等。

## 6. 不建议作为数据源的请求

以下域名在 HAR 中出现较多，但更像埋点、监控、风控或静态资源：

| 域名 | 判断 |
| --- | --- |
| `aplus.alibaba.com` | 埋点 |
| `px.effirst.com` | 监控/风控 |
| `fourier.alibaba.com`、`fourier.taobao.com` | 风控/监控 |
| `gm.mmstat.com` | 统计 |
| `s.alicdn.com`、`g.alicdn.com`、`img.alicdn.com`、`sc04.alicdn.com`、`assets.alicdn.com` | 静态资源 |

## 7. 对 TradeBridge 实现的建议

### 7.1 同步链路应转向 WebSocket LWP

当前基于 HTTP `getChatMessageList.htm` 的采集方式只能拿到附加状态或兼容旧路径，不应继续作为消息正文主路径。

建议新增 OneTalk WebSocket adapter：

1. 在 Chrome 插件内调用 `mtop.alibaba.icbu.im.login.token.get` 获取短期 WS token。
2. 连接 `wss://wss-icbu.dingtalk.com/`。
3. 发送 `/reg` 注册帧。
4. 调用 `/r/SyncStatus/getState` 获取同步状态。
5. 分页调用 `/r/Conversation/listNewestPagination` 获取会话列表。
6. 按会话调用 `/r/MessageManager/listUserMessages` 获取消息列表。
7. 成功处理差量后调用 `/r/SyncStatus/ackDiff`。
8. 维持 `/!` 心跳。

### 7.2 数据映射优先级

第一优先级：

- 会话：`/r/Conversation/listNewestPagination`
- 消息：`/r/MessageManager/listUserMessages`

第二优先级：

- 联系人资料：`mtop.alibaba.icbu.im.getUserInfoByParams`
- loginId 补充：`mtop.alibaba.icbu.im.queryMembersInfoByLoginId`
- CRM 客户资料：`alicrm.customerPluginQueryServiceI.queryCustomerInfo`
- CRM 客户标签：`alicrm.customerPluginQueryServiceI.queryCustomerTag`
- OneTalk 标签：`mtop.alibaba.icbu.tag.*`、`/message/getTargetTagList.htm`

第三优先级：

- 翻译配置、推荐动作、端能力、会话关系事件、会话修复判断。

### 7.3 安全与合规边界

- WebSocket token、refresh token、CSRF token、MTop sign、chatToken 只能在插件/页面本机上下文短期使用。
- TradeBridge 服务端只接收去敏后的 `customers`、`conversations`、`messages`。
- `rawSanitized` 可保留字段结构和非敏感业务字段，但必须删除 token、cookie、sign、chatToken、原始请求头。
- 日志和测试 fixture 不能落真实账号、真实消息正文、真实 token。

### 7.4 仍需补充验证

本 HAR 没有覆盖所有操作。后续如果要实现更完整能力，需要额外捕获并去敏分析：

- WebSocket 分页参数语义：`listNewestPagination` body length 2 的具体 cursor/pageSize 含义。
- `listUserMessages` body length 5 的参数顺序和分页方向。
- 文本发送、图片发送、附件发送时的 LWP 路由或页面 SDK 调用。
- 多会话分页、历史消息向前翻页、撤回消息、已读状态更新。
- 登录过期、token 刷新、WebSocket 重连、风控/验证码场景。

## 8. 当前实现影响

现有 Chrome 插件已经能通过页面上下文和 HTTP 接口同步一部分数据，但 HAR 证据表明：

- 会话和消息正文的稳定主路径应迁移到 WebSocket LWP。
- 现有 HTTP 消息接口诊断仍有价值，可保留用于判断旧接口是否返回附加状态或空数据。
- TradeBridge 的 outbound queue 发送方案仍合理：Web 只排队人工消息，真正发送由用户已登录的 OneTalk 页面/插件上下文完成。

建议下一阶段以本文件为依据，新增 `@wangwang/onetalk-adapter` 的 WebSocket LWP 客户端与去敏 fixture 测试。
