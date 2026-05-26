# Chrome 插件接入 OneTalk 同步设计开发文档

日期：2026-05-26

## 1. 背景

TradeBridge 当前已经具备一条桌面采集链路：在卖家本机已登录 AliSupplier/OneTalk 的前提下，采集端解析本机登录态，读取 OneTalk 会话缓存，调用消息接口，并通过 `/collector/v1/sync-batches` 上传去敏后的客户、会话、消息数据。

本设计评估并定义一条新的 Chrome 插件采集链路。目标不是把 OneTalk 鉴权迁移到 TradeBridge 服务端，而是让用户在自己的 Chrome 登录态下授权插件读取 OneTalk 会话和聊天记录，再按现有同步协议写入 TradeBridge。

## 2. 结论

推荐建设：

> Chrome 插件作为新的采集端形态，复用 TradeBridge 的 collector sync protocol，只上传去敏后的 `customers`、`conversations`、`messages`，禁止上传 OneTalk Cookie、CSRF token、`chatToken`、原始请求头和浏览器安全存储密钥。

第一版应定位为内部试运行插件，不做公开 Chrome Web Store 发布。公开发布需要补齐隐私政策、最小权限声明、用户数据披露、审核材料和企业合规评估。

## 3. 目标

- 用户在 Chrome 中登录 `https://onetalk.alibaba.com/` 后，插件能识别 OneTalk 登录状态。
- 插件能拉取最近会话和聊天记录，并转换为 TradeBridge `SyncBatch`。
- 插件使用 TradeBridge collector device token 上传同步批次。
- 服务端继续使用现有 `/collector/v1/sync-batches` 接收数据。
- Web 工作台能看到插件同步来的客户、会话和消息。
- 全链路不保存、不上传、不日志打印 OneTalk 登录鉴权。

## 4. 非目标

- 不通过 TradeBridge 服务端代持 OneTalk Cookie。
- 不在 TradeBridge Web 平台直接发送 OneTalk 消息。
- 不自动化操作 AliSupplier/OneTalk 页面 UI。
- 不绕过 OneTalk 登录、验证码、风控或权限控制。
- 第一版不做公开商店上架。
- 第一版不做多渠道客服聚合。

## 5. 推荐链路

```text
Chrome 用户登录 OneTalk
        |
        v
Chrome Extension
  - content script 检测 OneTalk 页面和登录状态
  - background/service worker 编排同步任务
  - 调用 OneTalk 会话与消息接口
  - 本地转换、去敏、游标管理
        |
        v
TradeBridge Collector API
POST /collector/v1/sync-batches
Authorization: Bearer <collector_device_token>
        |
        v
TradeBridge Server
  - 设备 token 校验
  - sync batch 校验
  - 幂等写入 PostgreSQL
        |
        v
TradeBridge Web
  - 客户列表
  - 会话时间线
  - 跟进协作
  - AI 摘要和回复建议
```

## 6. 架构决策

### 6.1 第一版采用插件直接采集

第一版推荐插件直接完成采集和上传，不依赖 Native Messaging。原因是安装链路短、内部试运行成本低，也更符合“通过 Chrome 插件获取浏览器登录态”的目标。

插件直接采集必须满足两个约束：

- OneTalk 鉴权只用于本机请求 OneTalk，不进入 TradeBridge 服务端。
- 插件上传的数据结构必须与现有 `SyncBatch` 兼容。

### 6.2 Native Messaging 作为增强路径

如果第一版遇到浏览器跨域、SameSite Cookie、后台 Service Worker 生命周期、接口权限或稳定性问题，再引入 Native Messaging：

```text
Chrome Extension
        |
        | chrome.runtime.connectNative
        v
Native Host / Collector Desktop
        |
        | 复用 @wangwang/onetalk-adapter 和 collector core
        v
TradeBridge Server
```

Native Messaging 的价值是复用现有 Electron/Node 采集能力，并绕开部分浏览器扩展环境限制。代价是安装复杂度更高，需要注册 native host manifest，并绑定固定 extension id。

## 7. Chrome 插件权限设计

第一版 Manifest V3 权限建议：

```json
{
  "manifest_version": 3,
  "name": "TradeBridge OneTalk Collector",
  "permissions": ["storage", "alarms", "cookies"],
  "host_permissions": [
    "https://onetalk.alibaba.com/*",
    "https://*.alibaba.com/*",
    "http://127.0.0.1:5032/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://onetalk.alibaba.com/*"],
      "js": ["content-onetalk.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html"
  },
  "options_page": "options.html"
}
```

权限说明：

- `storage`：保存 TradeBridge server URL、collector token、seller account id、同步游标和最近错误。
- `alarms`：支持定时增量同步。
- `cookies`：仅用于检测 OneTalk 登录态和必要的本机请求上下文，不把 Cookie 值上传到服务端。
- `host_permissions`：限制在 OneTalk、Alibaba 相关域名和本地 TradeBridge server。

第一版不申请：

- `<all_urls>`：权限过大，不符合最小权限原则。
- `webRequest`：非必要不读取网络请求明细。
- `webRequestBlocking`：Manifest V3 下多数扩展不可用，也不适合本场景。
- `tabs`：除非后续需要主动打开 OneTalk 标签页，否则不申请。

## 8. 模块设计

建议新增：

```text
apps/chrome-extension/
  package.json
  manifest.json
  vite.config.ts
  tsconfig.json
  src/
    background/
      index.ts
      sync-orchestrator.ts
      onetalk-client.ts
      tradebridge-client.ts
      storage.ts
      sanitizer.ts
    content/
      onetalk-page-bridge.ts
    popup/
      popup.html
      popup.ts
    options/
      options.html
      options.ts
    shared/
      extension-messages.ts
      sync-types.ts
  test/
    sync-orchestrator.test.ts
    sanitizer.test.ts
    tradebridge-client.test.ts
```

建议调整：

```text
packages/onetalk-adapter/
  src/browser.ts
  src/browser-client.ts
  src/sync-mapper.ts
```

### 8.1 `content/onetalk-page-bridge.ts`

职责：

- 只在 `onetalk.alibaba.com` 页面运行。
- 判断当前页面是否是 OneTalk 登录后页面。
- 向 background 发送页面状态，例如 `page-ready`、`login-required`、`sync-clicked`。
- 在必要时执行同源 OneTalk 请求，并把响应交给 background。

注意：

- content script 与页面 JS 是隔离环境，不能依赖直接读取页面全局变量作为主路径。
- 可以读取 DOM 和发起同源请求，但不应抓取密码框、验证码、用户输入框等登录相关内容。

### 8.2 `background/sync-orchestrator.ts`

职责：

- 统一编排一次同步。
- 读取本地配置和游标。
- 拉取会话列表。
- 按会话分页拉取消息。
- 调用 `sync-mapper` 转换为 `SyncBatch`。
- 调用 `sanitizer` 去敏。
- 上传 TradeBridge。
- 写入下一次同步游标和错误状态。

### 8.3 `background/onetalk-client.ts`

职责：

- 封装 OneTalk HTTP 请求。
- 支持 `fetchWeblite()`、`getChatMessages()`、`getChatDataSummary()`。
- 使用 `credentials: "include"` 让浏览器在允许的上下文中带上用户本机 Cookie。
- 检测重定向登录、HTML 登录页、非 JSON 响应和接口限流。

接口形态：

```ts
export interface BrowserOnetalkClient {
  fetchWeblite(): Promise<WebliteData>;
  getChatMessages(request: ChatMessageRequest): Promise<ChatMessageResponse>;
  getChatDataSummary(request: ChatDataSummaryRequest): Promise<ChatDataSummaryResponse>;
}
```

### 8.4 `background/tradebridge-client.ts`

职责：

- 封装 `/collector/v1/sync-batches`。
- 只使用 TradeBridge collector token 鉴权。
- 不接收 OneTalk Cookie/token 参数。
- 将服务端错误转换为插件可展示的错误码。

接口形态：

```ts
export interface TradeBridgeClient {
  uploadSyncBatch(batch: SyncBatch): Promise<SyncBatchResult>;
}
```

### 8.5 `background/storage.ts`

职责：

- 保存插件配置：
  - `serverUrl`
  - `collectorToken`
  - `orgId`
  - `sellerAccountExternalId`
  - `deviceId`
  - `syncIntervalMinutes`
- 保存同步状态：
  - `lastSyncedAt`
  - `nextCursor`
  - `lastError`

禁止保存：

- OneTalk Cookie。
- `ctoken`。
- `_tb_token_`。
- `sgcookie`。
- `x5sec`。
- `chatToken`。
- 原始请求头。

### 8.6 `background/sanitizer.ts`

职责：

- 递归扫描 `SyncBatch`。
- 删除敏感字段。
- 对未知 raw 字段做保守过滤。
- 在测试中固定敏感词黑名单。

敏感字段黑名单：

```text
cookie
Cookie
Set-Cookie
Authorization
ctoken
_tb_token_
cookie2
sgcookie
x5sec
chatToken
token
csrf
```

### 8.7 `packages/onetalk-adapter/src/browser.ts`

职责：

- 暴露浏览器安全的 OneTalk 解析和 payload 构造能力。
- 不导入 `node:fs`、`node:crypto`、`node:child_process` 等 Node-only 模块。
- 复用现有 `weblite-parser.ts`、`buildPayload()` 逻辑。

原因：

- 现有 `@wangwang/onetalk-adapter` 默认入口同时导出本机 Cookie 解析能力，包含 Node-only 依赖。
- Chrome 插件 bundle 应使用 browser entry，避免把本机文件系统、Keychain、SQLite 逻辑打包进插件。

## 9. 数据流

### 9.1 配置绑定

管理员在 TradeBridge Web 注册采集设备，得到 collector token。用户在插件 options 页填写：

```text
Server URL: http://127.0.0.1:5032
Org ID: org_internal
Seller Account External ID: seller-demo
Device ID: chrome-extension-<stable-id>
Collector Token: <server issued collector token>
```

插件保存这些 TradeBridge 配置。OneTalk 登录态不需要用户复制，也不能出现在配置页。

### 9.2 会话同步

```text
background alarm 或用户点击同步
        |
        v
检查配置完整性
        |
        v
请求 OneTalk weblite 或会话接口
        |
        v
解析 conversations 和 bootstrap
        |
        v
按会话分页请求 getChatMessageList
        |
        v
映射 customers / conversations / messages
        |
        v
sanitizer 去敏
        |
        v
POST /collector/v1/sync-batches
        |
        v
保存 nextCursor / lastSyncedAt / lastError
```

### 9.3 同步批次

插件上传仍使用现有 `SyncBatch`：

```json
{
  "orgId": "org_internal",
  "sellerAccount": {
    "externalAccountId": "seller-demo",
    "displayName": "Seller Demo",
    "status": "active"
  },
  "device": {
    "deviceId": "chrome-extension-demo",
    "deviceName": "Chrome Extension"
  },
  "cursor": {
    "previousCursor": "2026-05-26T08:00:00.000Z"
  },
  "sourceMeta": {
    "source": "chrome-extension",
    "collectedAt": "2026-05-26T08:10:00.000Z",
    "sourceBatchKey": "seller-demo:chrome-extension-demo:2026-05-26T08:10:00.000Z",
    "extensionVersion": "0.1.0"
  },
  "customers": [],
  "conversations": [],
  "messages": []
}
```

服务端不需要知道 OneTalk Cookie。服务端只校验 collector token、batch 格式、组织和设备状态。

## 10. 错误处理

插件错误码：

| 错误码 | 含义 | 用户提示 |
|---|---|---|
| `config_required` | TradeBridge 配置缺失 | 打开插件设置并填写连接信息 |
| `onetalk_tab_required` | 未打开 OneTalk 页面 | 打开 OneTalk 并登录 |
| `onetalk_login_required` | OneTalk 返回登录页 | 重新登录 OneTalk |
| `onetalk_fetch_failed` | OneTalk 请求失败 | 稍后重试或检查网络 |
| `onetalk_rate_limited` | OneTalk 限流 | 降低同步频率 |
| `sync_batch_empty` | 本次没有可上传数据 | 显示为正常空同步 |
| `tradebridge_unauthorized` | collector token 无效 | 重新注册采集设备 |
| `tradebridge_upload_failed` | 上传失败 | 检查 TradeBridge server |
| `sanitizer_blocked_payload` | 去敏检查发现敏感字段 | 停止上传并显示安全错误 |

错误展示原则：

- popup 显示最近同步状态、最近错误和下一次同步时间。
- options 页显示配置校验结果。
- 不展示 OneTalk Cookie/token 值。
- 不把 OneTalk 原始错误响应全文写入持久日志。

## 11. 安全与合规约束

### 11.1 硬性红线

- 禁止上传 OneTalk Cookie。
- 禁止上传 `ctoken`、`_tb_token_`、`cookie2`、`sgcookie`、`x5sec`。
- 禁止上传 `chatToken`。
- 禁止上传原始 `Cookie`、`Authorization`、`Set-Cookie` 请求头或响应头。
- 禁止在 console、popup、options、TradeBridge server log 中输出上述值。
- 禁止把 OneTalk 鉴权保存到 `chrome.storage`。
- 禁止在服务端新增 OneTalk 鉴权字段。

### 11.2 最小权限

- host permissions 限制到 OneTalk、Alibaba 相关域名和 TradeBridge server。
- 第一版不申请 `<all_urls>`。
- 第一版不申请网络拦截权限。
- 若后续接入远程 TradeBridge server，host permissions 必须显式配置到目标域名。

### 11.3 用户告知

内部试运行也需要在插件 options 或 README 中明确：

- 插件会读取当前 Chrome 登录的 OneTalk 会话和聊天记录。
- 插件会把客户、会话和消息同步到公司内部 TradeBridge。
- 插件不会上传 OneTalk 登录 Cookie 或鉴权 token。
- 用户可以在 TradeBridge 后台撤销采集设备 token。

### 11.4 数据治理

- 聊天记录属于客户沟通资产，应受内部权限控制。
- 采集设备只能上传，不能读取内部客户数据。
- 导出、查看敏感客户、修改负责人等动作应保留审计日志。
- AI 摘要和回复建议必须记录来源消息范围。

## 12. 开发阶段

### Phase 0：技术验证

目标：

- 验证 Manifest V3 插件能在已登录 Chrome 中请求 OneTalk 会话和消息接口。
- 验证 `credentials: "include"`、content script 同源请求和 background 请求三种方式中哪种最稳定。
- 验证不读取 Cookie 值也能完成请求；如果必须使用 `chrome.cookies`，只做本地状态检测。

产出：

- 一个本地 unpacked extension。
- 一份 fixture 化的 OneTalk 响应样本，样本必须去敏。
- 一条从 OneTalk fixture 到 `SyncBatch` 的单元测试。

验收：

- 能识别已登录和未登录状态。
- 能拉取至少一个会话和一页消息。
- payload 经 sanitizer 后不包含敏感字段。

### Phase 1：插件采集端 MVP

目标：

- 新增 `apps/chrome-extension`。
- 实现 options 配置页。
- 实现 popup 同步按钮和状态展示。
- 实现后台同步编排。
- 复用或新增 browser-safe adapter。
- 上传到现有 `/collector/v1/sync-batches`。

验收：

- 使用本地 TradeBridge server 能完成一次真实同步。
- Web 工作台能看到插件同步的数据。
- 采集 token 不能访问内部 API。
- 服务端消息数据不包含 OneTalk 鉴权。

### Phase 2：增量同步和稳定性

目标：

- 增加 `chrome.alarms` 定时同步。
- 增加分页、游标、重试、退避和空同步处理。
- 增加限流保护。
- 增加设备状态上报。

验收：

- 连续多次同步幂等。
- 网络失败后不会丢游标。
- OneTalk 登录过期时能给出明确提示。
- 批次大小在配置上限内。

### Phase 3：内部试运行

目标：

- 提供内部安装说明。
- 固定 extension id 或企业策略安装。
- 管理员注册设备并发放 collector token。
- 收集团队试运行问题。

验收：

- 至少一台销售电脑完成一天试运行。
- TradeBridge 能显示最近同步时间和失败原因。
- 没有敏感鉴权进入服务端、导出文件或日志。

### Phase 4：公开发布评估

目标：

- 评估是否需要 Chrome Web Store 上架。
- 编写隐私政策。
- 准备权限说明和审核材料。
- 评估阿里平台条款、客户数据授权和企业合规要求。

验收：

- 法务/业务确认采集边界。
- 权限声明和用户数据披露完整。
- 插件功能可以解释为用户授权的数据同步工具，而非绕过平台鉴权。

## 13. 测试策略

### 13.1 单元测试

- `sanitizer.test.ts`
  - 输入包含 `cookie2`、`ctoken`、`chatToken`、`Authorization` 的对象。
  - 期望输出删除敏感字段。
  - 期望发现高危字段时阻止上传。
- `sync-orchestrator.test.ts`
  - mock OneTalk client 返回会话和消息。
  - mock TradeBridge client 接收 batch。
  - 断言 batch 的 `sourceMeta.source` 为 `chrome-extension`。
  - 断言游标保存。
- `tradebridge-client.test.ts`
  - 200 响应转换为 `SyncBatchResult`。
  - 401 响应转换为 `tradebridge_unauthorized`。
  - 非 JSON 响应转换为 `tradebridge_upload_failed`。

### 13.2 集成测试

- 使用 fixture HTML 验证 `weblite` 解析。
- 使用 fixture JSON 验证消息分页和方向识别。
- 使用本地 Fastify server 验证 `/collector/v1/sync-batches` 上传。
- 使用安全 fixture 验证服务端读取消息时不出现敏感字段。

### 13.3 手工验收

- Chrome 打开 OneTalk，确认用户已登录。
- 安装 unpacked extension。
- 填写 TradeBridge server URL 和 collector token。
- 点击同步。
- 在 Web 工作台查看客户、会话、消息。
- 退出 OneTalk 后再次同步，确认显示 `onetalk_login_required`。
- 撤销采集设备 token 后同步，确认显示 `tradebridge_unauthorized`。

## 14. 验收清单

- 插件不需要用户手动复制 OneTalk Cookie。
- 插件不会把 OneTalk Cookie/token 写入 TradeBridge。
- 插件能同步最近会话和消息。
- TradeBridge 服务端使用现有 collector token 鉴权。
- Web 工作台能读取同步结果。
- 同步失败有可理解的错误码。
- 敏感字段黑名单有自动化测试覆盖。
- 文档说明插件读取的数据、上传的数据和不上传的数据。

## 15. 主要风险

| 风险 | 影响 | 应对 |
|---|---|---|
| OneTalk 接口字段变化 | 同步失败或字段缺失 | adapter 测试使用 fixture，解析逻辑保守兼容 |
| Chrome 扩展请求不带 OneTalk Cookie | 无法请求消息接口 | POC 验证 content script 同源请求；必要时切换 Native Messaging |
| Service Worker 生命周期中断 | 长同步中断 | 小批次同步、保存进度、下次恢复 |
| 权限审核困难 | 公开发布受阻 | 内部试运行优先，最小权限，不申请 `<all_urls>` |
| 敏感字段误入 raw 数据 | 合规和安全风险 | sanitizer 阻断上传，服务端和 E2E 双重验证 |
| OneTalk 风控 | 账号异常或接口失败 | 限频、只读、用户主动授权、不代发消息 |

## 16. 与现有代码的关系

现有代码可复用：

- `packages/onetalk-adapter/src/weblite-parser.ts`：页面缓存解析。
- `packages/onetalk-adapter/src/onetalk-client.ts`：请求 payload 形态和消息接口字段参考。
- `apps/collector-desktop/src/collector.ts`：`WebliteData` 到 `SyncBatch` 的映射逻辑。
- `apps/collector-desktop/src/uploader.ts`：上传协议参考。
- `apps/server/src/server.ts`：现有 `/collector/v1/sync-batches`。
- `docs/internal-trial-runbook.md`：敏感信息验证口径。

需要谨慎调整：

- `packages/onetalk-adapter` 当前默认入口包含 Node-only session 逻辑，Chrome 插件不能直接使用默认入口。
- `SyncBatch` 类型当前位于 `@wangwang/database`，插件侧长期看更适合从 `@wangwang/shared` 引入同步协议类型。第一版可以先在插件内声明最小兼容类型，避免扩大共享类型重构范围。

## 17. 官方参考

- Chrome cookies API：`https://developer.chrome.com/docs/extensions/reference/cookies`
- Chrome extension cross-origin requests：`https://developer.chrome.com/docs/extensions/develop/concepts/network-requests`
- Chrome native messaging：`https://developer.chrome.com/docs/extensions/mv3/nativeMessaging`
- Chrome Web Store program policies：`https://developer.chrome.com/docs/webstore/program-policies/policies`
