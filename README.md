# TradeBridge

TradeBridge 是一个以 Chrome 浏览器插件为核心的多渠道网页消息桥。它面向跨境销售、客服和运营团队，把第三方网页沟通平台里的客户、会话和消息同步到内部系统，再由内部销售团队在 Web 工作台中统一查看客户上下文、协作跟进、创建回复，并由 Chrome 插件把回复投递回原始网页渠道。

当前第一条真实链路是阿里国际站消息通道：

```text
渠道：阿里国际站消息通道
渠道 ID：alibaba-im
业务别名：TM / TradeManager / 国际版旺旺 / 旺旺
当前实现面：OneTalk Web
当前页面：onetalk.alibaba.com
```

OneTalk 不应和 TM 拆成两个平级渠道。OneTalk 是阿里国际站消息通道当前优先接入的 Web 实现面。

## 产品定位

TradeBridge 的核心价值是把分散的网页沟通入口变成统一的内部销售协作系统：

- Chrome 插件贴近第三方网页页面，借用用户已登录的页面上下文读取和发送消息。
- 服务端负责 collector token、internal session、安全校验、同步入库、外发队列和审计。
- 数据库沉淀客户、渠道账号、会话、消息、备注、标签、任务和外发状态。
- Web 工作台给销售、主管和管理员使用。

未来产品不做桌面监听，不做 Electron 采集端，不读取本机应用日志、缓存、Cookie 数据库或本机安全存储。

## 当前能力

- 内部账号初始化、邮箱密码登录、用户管理和邀请注册。
- Chrome 插件从已登录的 OneTalk Web 页面同步阿里国际站消息通道的客户、会话和消息。
- 服务端接收同步批次，按 collector token 绑定的卖家和设备身份入库。
- PostgreSQL 或内存 store 持久化客户、会话、消息、备注、标签、任务和外发消息。
- Web 工作台查看客户、会话、消息，并进行内部协作。
- Web 创建外发回复，Chrome 插件领取后通过 OneTalk Web 页面投递。
- 服务端提供客户总结和回复建议 API，默认使用本地确定性 AI fallback。

## 系统结构

```mermaid
flowchart LR
  Alibaba["阿里国际站消息通道<br/>alibaba-im / OneTalk Web"] --> ChromeExt["Chrome 插件"]
  ChromeExt --> Server["Fastify 服务端"]
  Web["React Web 工作台"] --> Server
  Server --> DB["PostgreSQL / InMemory Store"]
  Server --> AI["AI Provider / Queue"]
```

核心链路：

1. 管理员在服务端创建内部账号。
2. 管理员在 Chrome 插件设置页激活 collector device。
3. 插件读取已登录网页渠道的数据，映射为同步批次。
4. 服务端校验 collector token，并覆盖上传体中的 seller/device scope。
5. 数据库按外部消息 ID 或内容哈希去重入库。
6. Web 工作台用 internal session token 读取内部数据。
7. Web 创建外发消息进入队列。
8. Chrome 插件领取外发消息，并回到原始网页渠道发送。
9. 插件把投递结果回写服务端。

## 代码目录

| 路径 | 说明 |
| --- | --- |
| `apps/chrome-extension` | Chrome 插件，负责网页渠道桥接、同步上传、外发投递 |
| `apps/server` | Fastify 服务端，提供 collector API、internal API、认证、AI 入口 |
| `apps/web` | React/Vite 内部销售工作台 |
| `packages/collector-protocol` | 插件与服务端之间的实时协议 |
| `packages/database` | 领域类型、内存 store、Postgres store、迁移和 SQL client |
| `packages/onetalk-adapter` | 阿里国际站消息通道当前 OneTalk Web 实现面的协议适配 |
| `packages/env` | `.env.local` / `.env` 加载 |
| `docs` | 产品设计、环境说明、试运行手册、实施方案 |
| `test/e2e` | 端到端试运行测试 |

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
```

如果不配置 `DATABASE_URL`，服务端会使用内存存储，重启后数据会丢失。

### 3. 可选：启动 PostgreSQL

需要持久化数据时启动本仓库提供的 PostgreSQL：

```bash
docker compose -f docker-compose.postgres.yml up -d
```

`.env.local` 中配置：

```bash
DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/tradebridge
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

## Chrome 插件激活

Chrome 插件不能使用内部登录 token。插件必须通过 collector 激活流程获取 collector token。

激活接口：

```bash
curl -X POST http://127.0.0.1:5032/collector/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin@example.com",
    "password": "change-me-password"
  }'
```

响应中的 `token` 只返回一次。插件设置页会自动保存该 token，后续同步和外发只使用 collector token，不保存管理员密码。

插件试运行：

1. 构建插件：

    ```bash
    npm run build -w @wangwang/chrome-extension
    ```

2. 在 Chrome 扩展管理页加载 `apps/chrome-extension/dist`。
3. 打开并登录 `https://onetalk.alibaba.com/`。
4. 在插件设置页填写 Server URL、管理员邮箱、密码、同步间隔和历史回补设置，授予服务端访问权限后完成激活。
5. 点击插件弹窗里的同步按钮。
6. 回到 Web 工作台查看客户、会话和消息。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 构建基础包并同时启动服务端和 Web |
| `npm run dev:server` | 启动服务端 |
| `npm run dev:web` | 启动 Web 工作台 |
| `npm run build` | 构建全部 workspace |
| `npm run typecheck` | 对全部 workspace 做类型检查 |
| `npm run test:e2e` | 运行端到端试运行测试 |
| `npm run test -w @wangwang/server` | 运行服务端测试 |
| `npm run test -w @wangwang/web` | 运行 Web 测试 |
| `npm run test -w @wangwang/chrome-extension` | 运行 Chrome 插件测试 |
| `npm run test -w @wangwang/database` | 运行数据库包测试 |
| `npm run test -w @wangwang/onetalk-adapter` | 运行 OneTalk Web 实现面适配层测试 |

## 核心 API

### Collector API

- `POST /collector/v1/auth/login`：使用管理员账号激活 Chrome 插件采集设备。
- `POST /collector/v1/sync-batches`：上传客户、会话和消息同步批次。
- `GET /collector/v1/outbound-messages`：插件领取待发送消息。
- `POST /collector/v1/outbound-messages/:messageId/delivery`：插件回写投递结果。
- `GET /collector/v1/ws`：插件实时连接。

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
- Chrome 插件使用 collector token。
- 两类 token 不能混用。
- 服务端只保存 collector token hash。
- Chrome 插件安装时只固定请求 OneTalk 页面权限，TradeBridge 服务端访问权限由用户在设置页按 Server URL 授权。
- 插件上传前会过滤 cookie、authorization、ctoken、`_tb_token_`、cookie2、sgcookie、chatToken、accessToken、refreshToken 等敏感字段。
- 服务端会用 collector token 绑定的卖家和设备覆盖上传体中的 seller/device，避免伪造归属。
- `.env.local`、真实数据库地址、Redis 地址和 collector token 不要提交。

## 重要文档

- [TradeBridge 产品设计文档](docs/TradeBridge产品设计文档.md)
- [Chrome 插件多渠道消息桥重构实施方案](docs/superpowers/plans/2026-06-02-Chrome插件多渠道消息桥重构实施方案.md)
- [环境变量配置](docs/ENVIRONMENT.md)
- [内部试运行手册](docs/internal-trial-runbook.md)
- [Chrome 插件试运行手册](docs/chrome-extension-trial-runbook.md)
- [Chrome 插件发布清单](docs/chrome-extension-release-checklist.md)
- [Chrome 插件隐私与数据说明](docs/chrome-extension-privacy.md)
- [当前系统设计方案](docs/superpowers/specs/2026-06-01-tradebridge-current-system-design.md)

## 当前已知限制

- Chrome 插件当前更依赖服务端幂等去重，尚未真正使用本地 `nextCursor` 做严格增量同步。
- Chrome 插件默认每个会话回补 20 条历史消息，可在设置页调整到 1 到 100 条；高活跃会话仍可能需要扩展分页策略。
- 阿里国际站消息通道当前通过 OneTalk Web 实现面接入，页面 SDK 和 LWP 协议依赖外部页面运行时，后续需要持续做真实账号 smoke 验证。
- 多渠道架构正在重构中，当前首个真实渠道仍是 `alibaba-im` 的 OneTalk Web 实现面。
- AI provider 当前默认是确定性 fallback，不是正式大模型集成。
- Web 工作台已覆盖主要 CRM 操作，但 AI API 尚未完整接入 UI。
