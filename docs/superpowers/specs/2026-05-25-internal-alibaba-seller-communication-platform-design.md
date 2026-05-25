# 阿里国际站卖家团队客户沟通平台设计

日期：2026-05-25

## 1. 背景

当前项目已经验证了一个关键能力：在卖家 Mac 已登录 AliSupplier/OneTalk 的情况下，本机服务可以解析 AliWorkbench/AliSupplier 的登录态，读取 `weblitePWA.htm` 会话缓存，并调用 OneTalk 消息接口拉取聊天记录。

下一阶段目标是把项目从“本机聊天记录查看器”升级为“面向阿里国际站卖家团队的内部客户沟通平台”。第一版采用单公司内部版，不做多租户 SaaS，也不在 Web 平台直接代发旺旺/OneTalk 消息。

## 2. 产品定位

第一版定位：

> 销售协作 + 回复建议平台。桌面采集端同步旺旺/OneTalk 沟通记录；销售在 Web 平台查看客户沟通历史、协作跟进、生成回复建议；最终消息仍由销售回到旺旺/OneTalk 发送。

这个定位的核心收益是沉淀团队客户沟通资产，提升销售协作、客户交接和跟进效率，同时避开直接代发消息带来的账号风控和协议稳定性风险。

## 3. 范围

### 3.1 第一版包含

- 桌面采集端检测本机 AliSupplier/OneTalk 登录态。
- 卖家账号与内部平台账号绑定。
- 同步最近会话、消息、客户辅助信息。
- 服务端保存客户、会话、消息、备注、标签、跟进任务。
- 销售在 Web 平台查看客户沟通时间线。
- 销售为客户添加标签、备注、负责人、跟进状态。
- 根据沟通记录生成客户摘要、意向判断、回复建议。
- 提供复制回复建议或打开旺旺/OneTalk 继续沟通的入口。
- 主管查看销售跟进状态、未跟进客户、响应效率等基础看板。
- 管理员查看采集端状态和同步失败原因。

### 3.2 第一版不包含

- Web 平台直接发送旺旺/OneTalk 消息。
- 多公司多租户 SaaS。
- 计费、套餐、公开注册。
- 复杂审批流。
- 全渠道客服聚合。
- 对 AliSupplier 客户端的自动化 UI 操作。

## 4. 角色

- 管理员：管理内部用户、角色、卖家账号、采集设备和系统配置。
- 主管：查看团队客户沟通情况、分配客户、查看看板。
- 销售：查看自己负责的客户、沟通记录、回复建议，维护备注和跟进任务。
- 采集端：运行在卖家电脑上的桌面程序，负责同步 OneTalk 数据到内部服务端。

## 5. 总体架构

```text
AliSupplier/OneTalk Desktop App
        |
        | 本机登录态、Cookies DB、缓存 URL、OneTalk 接口
        v
Desktop Collector
        |
        | HTTPS 上传同步批次
        v
Internal API Server
        |
        | PostgreSQL / Redis / Object Storage
        v
Web Platform
        |
        | 客户沟通工作台、搜索、分析、回复建议
        v
Sales Team
```

建议仓库演进为：

```text
apps/
  collector-desktop/       Electron/Node 桌面采集端
  server/                  内部业务 API
  web/                     销售协作 Web 平台
packages/
  onetalk-adapter/         OneTalk 采集适配层
  shared/                  共享类型、接口协议
  database/                数据库 schema 和迁移
```

当前项目里的 `session.ts`、`onetalk-client.ts`、`weblite-parser.ts` 应抽到 `packages/onetalk-adapter`，作为采集端复用的核心能力。

## 6. 模块设计

### 6.1 桌面采集端

职责：

- 登录内部平台并绑定设备。
- 检测 AliSupplier/OneTalk 是否已登录。
- 读取本机 AliWorkbench/AliSupplier 日志、缓存文件和 Chromium Cookies DB。
- 解密 OneTalk 所需 Cookie，并只在本机内存中使用。
- 调用 OneTalk 接口获取会话、消息、客户上下文。
- 做增量同步，生成同步批次并上传到内部服务端。
- 维护本地上传队列，支持断网重试。
- 展示最近同步时间、账号状态、失败原因。

安全要求：

- 不把 Cookie、`ctoken`、`_tb_token_`、`cookie2`、`sgcookie` 上传到服务端。
- 本地如需缓存同步游标，使用 SQLite；敏感配置使用系统 Keychain 或 Electron safeStorage。
- 每台设备使用设备 token，并可在服务端吊销。

### 6.2 内部服务端

职责：

- 用户登录、角色权限、会话管理。
- 采集设备认证和同步批次接收。
- 客户、会话、消息、备注、标签、跟进任务管理。
- 消息去重和增量写入。
- AI 分析任务调度。
- 搜索索引维护。
- 审计日志。

建议技术：

- Node.js + Fastify 或 NestJS。
- PostgreSQL 作为主库。
- Redis + BullMQ 用于同步任务、分析任务、限流和重试。
- 对象存储或本地文件系统保存导出文件和后续附件。

单公司内部版可以先不实现完整租户体系，但数据库建议保留 `org_id`，当前固定为一个内部组织，避免未来扩展时重构主表。

### 6.3 Web 平台

职责：

- 登录和基础权限控制。
- 客户列表、筛选、搜索。
- 客户详情页：基础信息、负责人、标签、备注、跟进任务。
- 会话时间线：按客户聚合消息。
- 回复建议面板：生成草稿、复制、标记采用结果。
- 主管看板：未跟进客户、响应时效、客户活跃度、销售工作量。
- 采集状态页：设备在线状态、最近同步、错误详情。

第一版 UI 应偏 CRM/客服工作台风格，强调信息密度、可搜索、可筛选和高频操作效率。

### 6.4 AI 分析服务

第一版先做异步分析，不阻塞消息同步。

能力：

- 客户沟通摘要。
- 客户意向等级。
- 待跟进原因。
- 下一步动作建议。
- 回复草稿。
- 风险提示，例如长期未回复、客户表达不满、价格敏感、样品/交期反复确认。

AI 输出必须带上更新时间和来源消息范围。销售可以手动重新生成，也可以编辑采用后的回复草稿。

## 7. 数据模型

核心表：

```text
org
user
role
user_role
seller_account
collector_device
sync_job
sync_batch
customer
conversation
message
customer_assignment
customer_tag
customer_note
follow_up_task
ai_summary
reply_suggestion
audit_log
```

关键字段建议：

- `seller_account`：`id`、`org_id`、`external_account_id`、`display_name`、`last_seen_at`、`status`。
- `collector_device`：`id`、`org_id`、`seller_account_id`、`device_name`、`device_token_hash`、`last_heartbeat_at`、`status`。
- `customer`：`id`、`org_id`、`seller_account_id`、`external_customer_id`、`login_id`、`display_name`、`country`、`owner_user_id`、`stage`。
- `conversation`：`id`、`org_id`、`seller_account_id`、`customer_id`、`external_conversation_id`、`last_message_at`。
- `message`：`id`、`org_id`、`conversation_id`、`external_message_id`、`direction`、`message_type`、`content`、`sent_at`、`raw_sanitized`。
- `reply_suggestion`：`id`、`org_id`、`customer_id`、`conversation_id`、`prompt_version`、`suggestion`、`status`、`created_by`。

去重策略：

- `message` 使用 `seller_account_id + conversation_id + external_message_id` 做唯一约束。
- 如果上游没有稳定消息 ID，则用 `conversation_id + sent_at + direction + content_hash` 作为兜底唯一键。

## 8. 同步协议

采集端向服务端上传同步批次：

```text
POST /collector/v1/sync-batches
Authorization: Bearer <device_token>
```

请求体包括：

- `sellerAccount`：卖家账号摘要，不包含 Cookie。
- `device`：设备摘要。
- `cursor`：本次同步游标。
- `conversations`：会话列表。
- `messages`：消息列表。
- `customers`：客户辅助信息。
- `sourceMeta`：AliSupplier 版本、采集端版本、采集时间。

响应体包括：

- `acceptedCount`
- `rejectedCount`
- `nextCursor`
- `warnings`

同步原则：

- 采集端可重复上传同一批次，服务端必须幂等。
- 服务端保存脱敏后的原始字段，禁止保存 Cookie/token。
- 大批量消息按分页上传，避免单次请求过大。
- 同步失败必须可重试，并保留错误码。

## 9. 权限设计

第一版角色：

- 管理员：全部功能。
- 主管：查看所有客户和团队看板，分配客户。
- 销售：查看分配给自己的客户；可写备注、标签、跟进任务；可生成回复建议。

权限边界：

- 销售默认不能导出全量数据。
- 导出、查看敏感客户、修改负责人应写审计日志。
- 采集设备只能上传数据，不能读取 Web 平台业务数据。

## 10. 错误处理

采集端错误：

- 未检测到 AliSupplier。
- AliSupplier 未登录。
- Cookie 解密失败。
- OneTalk 重定向登录。
- OneTalk 接口限流或网络失败。
- 上传失败。

服务端错误：

- 设备 token 无效。
- 同步批次格式错误。
- 幂等冲突。
- 数据库写入失败。
- AI 分析失败。

Web 显示原则：

- 面向销售显示可操作状态，例如“采集端离线”“最近同步失败”“客户消息仍在分析中”。
- 面向管理员显示详细错误码、设备、时间和重试建议。

## 11. 测试策略

采集端：

- Cookie 解析和解密单元测试。
- OneTalk HTML/JSON 解析 fixture 测试。
- 增量同步游标测试。
- 上传重试和幂等测试。

服务端：

- 同步批次 API 集成测试。
- 消息去重测试。
- 权限测试。
- 审计日志测试。
- AI 分析任务状态测试。

Web：

- 客户列表和筛选测试。
- 会话时间线渲染测试。
- 备注、标签、任务操作测试。
- 回复建议状态测试。

验收测试：

- 一台采集端同步一个卖家账号最近 30 天消息。
- 销售能查看客户完整沟通时间线。
- 主管能分配客户并查看跟进状态。
- AI 能生成客户摘要和回复草稿。
- Cookie/token 不出现在服务端数据库、日志和前端响应中。

## 12. 开发里程碑

### 阶段 1：采集内核抽包

- 新建 `packages/onetalk-adapter`。
- 抽出当前 `session.ts`、`onetalk-client.ts`、`weblite-parser.ts`。
- 提供统一接口：`detectSession()`、`fetchConversations()`、`fetchMessages()`。
- 保留当前本机查看器可运行。

### 阶段 2：内部服务端 MVP

- 新建服务端业务模型和数据库迁移。
- 实现用户登录和角色。
- 实现采集设备注册和 token。
- 实现同步批次接收、幂等写入、客户/会话/消息查询 API。

### 阶段 3：桌面采集端 MVP

- 使用 Electron/Node 包装采集内核。
- 支持登录内部平台、绑定设备、手动同步、自动同步。
- 展示同步状态和错误原因。

### 阶段 4：Web 销售工作台

- 客户列表、客户详情、会话时间线。
- 负责人、标签、备注、跟进任务。
- 基础搜索和筛选。

### 阶段 5：AI 分析和回复建议

- 消息摘要任务。
- 客户意向判断。
- 回复建议生成。
- 销售复制回复草稿并标记采用结果。

### 阶段 6：主管看板

- 未跟进客户。
- 响应时效。
- 客户活跃度。
- 销售工作量。

## 13. 成功标准

第一版满足以下标准即认为可上线内部试用：

- 至少一个卖家账号可稳定同步最近 30 天会话和消息。
- `hasCtoken`、`hasTbToken`、`hasCookie2`、`hasSgcookie` 状态可诊断。
- Web 平台可按客户查看沟通记录。
- 销售可维护负责人、标签、备注和跟进任务。
- AI 可生成摘要和回复建议。
- 所有同步错误可在管理员界面定位。
- Cookie/token 不上传云端、不写数据库、不出现在日志和前端响应。
- Web 平台不具备直接发送旺旺/OneTalk 消息能力。

## 14. 主要风险

- OneTalk 非公开接口可能变更，需要采集适配层隔离变化。
- AliSupplier 客户端升级可能改变 Cookie 存储或加密方式。
- 大量历史消息同步可能触发限流，需要分批、节流和失败重试。
- 客户沟通记录属于敏感业务数据，需要权限、审计和备份策略。
- AI 输出可能不准确，第一版必须作为建议而非自动动作。

## 15. 推荐下一步

先执行阶段 1 和阶段 2：

1. 抽出 `packages/onetalk-adapter`，把采集逻辑从当前 API 中解耦。
2. 设计 PostgreSQL schema 和同步批次 API。
3. 保留现有本机查看器作为回归验证入口。

这样可以在不破坏现有可用能力的前提下，把项目逐步迁移到“采集端 + 服务端 + Web 平台”的长期架构。
