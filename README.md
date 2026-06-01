# TradeBridge

TradeBridge 是一个面向阿里国际站卖家消息场景的内部销售工作台。

它把卖家在 OneTalk/旺旺里的客户、会话和消息同步到自有系统中，让内部销售团队可以统一查看客户上下文、做备注、打标签、建跟进任务，并把回复先放入队列，再由采集端回到 OneTalk 页面中发送。

## 组成部分

阿里页面负责真实登录态和真实发消息能力，采集端负责同步和投递，服务端负责安全边界和业务 API，数据库负责沉淀客户沟通数据，Web 工作台负责给销售使用。

### Chrome 插件

负责“贴着阿里页面取数据”。用户需要先登录 onetalk.alibaba.com，插件借用这个已登录页面的能力去拿会话、客户资料和聊天消息。它不保存阿里账号密码。

### 服务端

它是系统的关口。采集端上传数据前必须先激活拿到 collector token。服务端会校验 token，并且强制用 token 绑定的卖家和设备身份入库，避免伪造数据来源。

### 数据库

它存卖家、采集设备、客户、会话、消息、备注、标签、任务、外发消息等数据。消息会做去重，所以重复同步不会反复插入同一条消息。

### Web 工作台

这是销售看到的界面。登录后可以看客户列表、聊天记录、备注、标签、任务，也可以输入回复。回复不会由 Web 直接发给阿里，而是先进入系统队列，再由 Chrome 插件拿去 OneTalk 页面里发送。

## 当前能力

- 内部账号初始化、邮箱密码登录、用户管理和邀请注册。
- Chrome 插件从已登录的 OneTalk 页面同步客户、会话和消息。
- 桌面采集端从本机 AliWorkbench/AliSupplier 登录态采集数据。
- 服务端接收同步批次，按采集设备绑定的卖家身份入库。
- PostgreSQL 持久化客户、会话、消息、备注、标签、任务和外发消息。
- Web 工作台查看客户、会话、消息，并进行内部协作。
- Web 创建外发回复，Chrome 插件领取后通过 OneTalk 页面投递。
- 服务端提供客户总结和回复建议 API，默认使用本地确定性 AI fallback。

## 系统结构

```mermaid
flowchart LR
  OneTalk["阿里 OneTalk 页面"] --> ChromeExt["Chrome 插件"]
  OneTalk --> Desktop["桌面采集端"]
  ChromeExt --> Server["Fastify 服务端"]
  Desktop --> Server
  Web["React Web 工作台"] --> Server
  Server --> DB["PostgreSQL / InMemory Store"]
  Server --> AI["AI Provider / Queue"]
```

核心链路：

1. 管理员在服务端创建内部账号，并激活采集设备。
2. Chrome 插件或桌面采集端拿到 collector token。
3. 采集端读取 OneTalk/旺旺数据，映射为统一 `SyncBatch`。
4. 服务端校验 collector token，强制使用 token 绑定的 seller/device scope。
5. 数据库按外部消息 ID 或内容哈希去重入库。
6. Web 工作台用 internal session token 读取内部数据。
7. Web 创建的外发消息进入队列，由 Chrome 插件领取并发送回 OneTalk。

## 代码目录

| 路径                       | 说明                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| `apps/server`              | Fastify 服务端，提供 collector API、internal API、认证、AI 入口  |
| `apps/web`                 | React/Vite 内部销售工作台                                        |
| `apps/chrome-extension`    | Chrome 插件，负责 OneTalk 页面桥接、LWP 拉取、同步上传、外发投递 |
| `apps/collector-desktop`   | Electron 桌面采集端，负责本机登录态采集和手动同步                |
| `packages/database`        | 领域类型、内存 store、Postgres store、迁移和 SQL client          |
| `packages/onetalk-adapter` | OneTalk/LWP 协议适配、页面数据解析、同步数据映射                 |
| `packages/env`             | `.env.local` / `.env` 加载                                       |
| `docs`                     | 环境说明、试运行手册、设计文档                                   |
| `test/e2e`                 | 端到端试运行测试                                                 |

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 准备环境变量

```bash
cp .env.example .env.local
```

最小本地配置：

```bash
WANGWANG_SERVER_HOST=127.0.0.1
WANGWANG_SERVER_PORT=5032
WANGWANG_SERVER_URL=http://127.0.0.1:5032
```

如果不配置 `DATABASE_URL`，服务端会使用内存存储，重启后数据会丢失。

### 3. 可选：启动 PostgreSQL

需要持久化数据时启动本仓库提供的 PostgreSQL：

```bash
docker compose -f docker-compose.postgres.yml up -d
```

`.env.local` 中配置：

```bash
DATABASE_URL=postgres://wait9yan:Weite123@127.0.0.1:5432/tradebridge
```

### 4. 启动服务端和 Web 工作台

```bash
npm run dev
```

启动后访问：

- 服务端健康检查：`http://127.0.0.1:5032/health`
- Web 工作台：`http://127.0.0.1:5173`

也可以分开启动：

```bash
npm run dev:server
npm run dev:web
```

### 5. 初始化管理员

首次打开 Web 工作台后，选择“初始化首个管理员”，填写邮箱、显示名称和密码。

也可以直接调用接口：

```bash
curl -X POST http://127.0.0.1:5032/internal/v1/setup/admin \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin@example.com",
    "displayName": "Admin User",
    "password": "change-me-password"
  }'
```

管理员创建后，用邮箱密码登录 Web 工作台。

## 采集端激活

采集端不能使用内部登录 token。Chrome 插件和桌面采集端都必须通过 collector 激活流程获取 collector token。

激活接口：

```bash
curl -X POST http://127.0.0.1:5032/collector/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin@example.com",
    "password": "change-me-password"
  }'
```

响应中的 `token` 只返回一次。

### Chrome 插件

1. 构建插件：

    ```bash
    npm run build -w @wangwang/chrome-extension
    ```

2. 在 Chrome 扩展管理页加载 `apps/chrome-extension/dist`。
3. 打开并登录 `https://onetalk.alibaba.com/`。
4. 在插件设置页填写 Server URL、管理员邮箱和密码，完成激活。
5. 后续同步只使用 collector token，插件不会保存管理员密码。

### 桌面采集端

将激活返回的 token 写入 `.env.local`：

```bash
WANGWANG_SERVER_URL=http://127.0.0.1:5032
WANGWANG_COLLECTOR_TOKEN=<激活接口返回的 token>
```

启动桌面采集端：

```bash
npm run electron -w @wangwang/collector-desktop
```

桌面采集端依赖本机 AliWorkbench/AliSupplier 登录态。

## 常用命令

| 命令                                         | 说明                             |
| -------------------------------------------- | -------------------------------- |
| `npm run dev`                                | 构建基础包并同时启动服务端和 Web |
| `npm run dev:server`                         | 启动服务端                       |
| `npm run dev:web`                            | 启动 Web 工作台                  |
| `npm run build`                              | 构建全部 workspace               |
| `npm run typecheck`                          | 对全部 workspace 做类型检查      |
| `npm run test:e2e`                           | 运行端到端试运行测试             |
| `npm run test -w @wangwang/server`           | 运行服务端测试                   |
| `npm run test -w @wangwang/web`              | 运行 Web 测试                    |
| `npm run test -w @wangwang/chrome-extension` | 运行 Chrome 插件测试             |
| `npm run test -w @wangwang/database`         | 运行数据库包测试                 |
| `npm run test -w @wangwang/onetalk-adapter`  | 运行 OneTalk 适配层测试          |

## 核心 API

### Collector API

- `POST /collector/v1/auth/login`：使用管理员账号激活采集设备。
- `POST /collector/v1/sync-batches`：上传客户、会话和消息同步批次。
- `GET /collector/v1/outbound-messages`：采集端领取待发送消息。
- `POST /collector/v1/outbound-messages/:messageId/delivery`：采集端回写投递结果。

### Internal API

- `POST /internal/v1/setup/admin`：初始化首个管理员。
- `POST /internal/v1/auth/login`：内部用户登录。
- `GET /internal/v1/customers`：读取客户列表。
- `GET /internal/v1/conversations`：读取会话列表。
- `GET /internal/v1/conversations/:externalConversationId/messages`：读取会话消息。
- `POST /internal/v1/customers/:externalCustomerId/notes`：新增客户备注。
- `POST /internal/v1/customers/:externalCustomerId/tags`：新增客户标签。
- `POST /internal/v1/customers/:externalCustomerId/follow-up-tasks`：新增跟进任务。
- `POST /internal/v1/conversations/:externalConversationId/outbound-messages`：创建外发消息。

## 安全边界

- 内部用户使用 internal session token。
- 采集端使用 collector token。
- 两类 token 不能混用。
- 服务端只保存 collector token hash。
- 采集端上传前会过滤 cookie、authorization、ctoken、`_tb_token_`、cookie2、sgcookie、chatToken、accessToken、refreshToken 等敏感字段。
- 服务端会用 collector token 绑定的卖家和设备覆盖上传体中的 seller/device，避免伪造归属。
- `.env.local`、真实数据库地址、Redis 地址、collector token 和本机 safe-storage 密钥不要提交。

## 重要文档

- [环境变量配置](docs/ENVIRONMENT.md)
- [内部试运行手册](docs/internal-trial-runbook.md)
- [Chrome 插件试运行手册](docs/chrome-extension-trial-runbook.md)
- [当前系统设计方案](docs/superpowers/specs/2026-06-01-tradebridge-current-system-design.md)

## 当前已知限制

- Chrome 插件当前更依赖服务端幂等去重，尚未真正使用本地 `nextCursor` 做严格增量同步。
- Chrome 插件默认每个会话只拉取 1 页消息，高活跃会话可能需要扩展分页策略。
- OneTalk 页面 SDK 和 LWP 协议依赖外部页面运行时，后续需要持续做真实账号 smoke 验证。
- AI provider 当前默认是确定性 fallback，不是正式大模型集成。
- Web 工作台已覆盖主要 CRM 操作，但 AI API 尚未完整接入 UI。

## 推荐阅读顺序

第一次接触项目时建议按这个顺序看：

1. 本 README。
2. `docs/ENVIRONMENT.md`。
3. `docs/internal-trial-runbook.md`。
4. `docs/chrome-extension-trial-runbook.md`。
5. `docs/superpowers/specs/2026-06-01-tradebridge-current-system-design.md`。
