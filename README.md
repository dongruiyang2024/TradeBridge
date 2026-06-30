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
- Chrome 插件从已登录的 OneTalk Web 页面同步阿里国际站消息通道的客户、会话和消息，并通过后台定时器和页面事件触发自动同步。
- 服务端接收同步批次，按 collector token 绑定的卖家和设备身份入库。
- PostgreSQL 持久化客户、会话、消息、备注、标签、任务和外发消息。
- Web 工作台查看客户、会话、消息，并进行内部协作。
- Web 创建外发回复，Chrome 插件通过轮询和实时连接领取后，经 OneTalk Web 页面投递。
- 插件支持 Trade-Mind 托管激活码、绑定确认、心跳上报和绑定状态校验。
- 服务端提供客户总结和回复建议 API，默认使用本地确定性 AI fallback。

## 系统结构

```mermaid
flowchart LR
  Alibaba["阿里国际站消息通道<br/>alibaba-im / OneTalk Web"] --> ChromeExt["Chrome 插件"]
  ChromeExt --> Server["Fastify 服务端"]
  Web["React Web 工作台"] --> Server
  Server --> DB["PostgreSQL"]
  Server --> AI["AI Provider / Queue"]
```

核心链路：

1. 管理员初始化内部账号，并登录 Web 工作台。
2. Trade-Mind 或管理员创建 collector 激活凭据。
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
| `packages/database` | 领域类型、测试用内存 store、Postgres store、迁移和 SQL client |
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

服务端和 Web 工作台的最小本地配置：

```bash
WANGWANG_SERVER_HOST=127.0.0.1
WANGWANG_SERVER_PORT=5032
```

`WANGWANG_SERVER_HOST` / `WANGWANG_SERVER_PORT` 控制服务端监听地址。Chrome 插件的本地 development 构建默认连接 `http://127.0.0.1:5032`；测试和生产构建必须通过 `TRADEBRIDGE_SERVER_URL` 指定 HTTPS TradeBridge 服务地址。

为了避免每次构建手动拼环境变量，插件支持按 Vite mode 读取环境文件：

```bash
# 本地包，使用 development mode，未配置时默认 http://127.0.0.1:5032
npm run build -w @wangwang/chrome-extension

# 测试包，读取 .env.test.local，必须配置 TRADEBRIDGE_SERVER_URL
npm run build:test -w @wangwang/chrome-extension

# 生产包，读取 .env.production.local，必须配置 TRADEBRIDGE_SERVER_URL
npm run build:production -w @wangwang/chrome-extension
```

需要把同步批次转发到 Trade-Mind 沟通助手时，再配置：

```bash
TRADEMIND_INGEST_URL=http://127.0.0.1:3001/api/ingest/conversations
TRADEMIND_BRIDGE_SECRET=和 Trade-Mind 的 TRADEMIND_BRIDGE_SECRET 保持一致
```

需要在插件激活、心跳和打开面板时自动同步 Trade-Mind 绑定状态，再配置：

```bash
TRADEMIND_BINDING_CONFIRM_URL=http://127.0.0.1:3001/api/communication/binding/bridge-confirm
TRADEMIND_BINDING_HEALTH_URL=http://127.0.0.1:3001/api/communication/binding/bridge-health
TRADEMIND_BINDING_VALIDATE_URL=http://127.0.0.1:3001/api/communication/binding/validate
TRADEMIND_BRIDGE_SECRET=和 Trade-Mind 的 TRADEMIND_BRIDGE_SECRET 保持一致
```

Trade-Mind 调用 `/collector/v1/trademind/provision` 生成插件激活码、TradeBridge 转发同步批次、绑定确认/心跳/校验和 Trade-Mind 入站外发消息都统一使用 `TRADEMIND_BRIDGE_SECRET`。

`DATABASE_URL` 是必填项。服务端启动时必须连接 PostgreSQL，不再回退到内存存储。

### 3. 准备 PostgreSQL

可以使用本机或外部 PostgreSQL。需要临时启动一个本地容器时：

```bash
docker run --name tradebridge-postgres \
  -e POSTGRES_USER=USER \
  -e POSTGRES_PASSWORD=PASSWORD \
  -e POSTGRES_DB=tradebridge \
  -p 5432:5432 \
  -d postgres:18-alpine
```

`.env.local` 中配置：

```bash
DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/tradebridge
```

如果暂不准备 PostgreSQL，服务端将无法启动；请先准备数据库并把 `DATABASE_URL` 改成真实连接地址。

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

Chrome 插件不能使用内部登录 token。插件必须通过 collector 激活流程获取 collector token。当前设置页只填写 Trade-Mind 激活码，不再填写管理员邮箱、密码、OneTalk 密码、Cookie 或 Token。

当前主流程是在 Trade-Mind 沟通页点击“重新绑定账号/生成激活码”。Trade-Mind 会先在自身数据库创建 `bindingToken` 对应的绑定会话，再向 TradeBridge 申请一次性激活码：

```bash
curl -X POST http://127.0.0.1:5032/collector/v1/trademind/provision \
  -H 'Content-Type: application/json' \
  -H 'x-trademind-bridge-secret: change-me-secret' \
  -d '{
    "workspaceId": "workspace-1",
    "userId": "user-1",
    "userEmail": "seller@example.com",
    "userDisplayName": "Seller User",
    "channel": "onetalk",
    "bindingToken": "trade-mind-binding-token"
  }'
```

这个接口主要给 Trade-Mind 服务端调用，本地手工 curl 时不要随便填写示例里的 `bindingToken`。如果 Trade-Mind 侧没有对应绑定会话，插件激活阶段会在自动确认绑定时失败，并返回类似 `trademind_binding_confirm_failed_400` 的错误。

响应中的 `activationToken` 有 15 分钟有效期。插件设置页会读取该激活码，检测已登录 OneTalk 页面的 Login ID / Ali ID，然后调用激活接口：

```bash
curl -X POST http://127.0.0.1:5032/collector/v1/auth/activate \
  -H 'Content-Type: application/json' \
  -d '{
    "activationToken": "activation-token-from-trade-mind",
    "sellerAccountExternalId": "detected-ali-id",
    "channelAccountExternalId": "detected-login-id",
    "deviceExternalId": "chrome-extension-device-id",
    "deviceName": "Chrome Extension"
  }'
```

响应中的 `token` 只返回一次。插件设置页会自动保存该 token，后续心跳、同步、绑定校验和外发投递只使用 collector token。

服务端仍保留 `POST /collector/v1/auth/login`，用于管理员账号直接激活 collector device；这是兼容和内部调试路径，不是当前插件设置页的主流程。

插件试运行：

1. 构建插件：

    ```bash
    npm run build -w @wangwang/chrome-extension
    ```

2. 在 Chrome 扩展管理页加载 `apps/chrome-extension/dist`。
3. 打开并登录 `https://onetalk.alibaba.com/`。
4. 在插件设置页填写 Trade-Mind 激活码和历史回补设置。本地包默认连接 `http://127.0.0.1:5032`；测试/生产包由 `.env.test.local` 或 `.env.production.local` 的 `TRADEBRIDGE_SERVER_URL` 决定。同步间隔固定为 10 秒，OneTalk Login ID / Ali ID 会从已登录的 OneTalk 页面自动检测。服务端配置自动确认回调后，激活成功会自动完成 Trade-Mind 绑定。
5. 激活成功后保持 OneTalk 页面打开。后台会建立实时连接，并按 10 秒固定间隔和页面新消息事件自动同步。
6. 打开插件弹窗查看账号校验、实时连接、同步、抓取和历史回补状态；实时连接异常时可在弹窗中手动重连。
7. 回到 Web 工作台查看客户、会话和消息。

### 插件自动更新策略

生产环境不要让用户手动替换解压包。插件发布应走 Chrome Web Store Unlisted 或企业 ExtensionInstallForcelist/托管更新通道，让 Chrome 自动下载新版本。

当前扩展内置的更新策略：

- `manifest.version` 按发布递增；当前版本为 `0.1.3`。
- Chrome 下载到新版本并触发 `runtime.onUpdateAvailable` 后，后台会记录 update 状态，并创建 `tradebridge-update-reload` alarm。
- alarm 在 1 分钟后自动调用 `runtime.reload()` 应用新版本，不需要用户点击。
- 开发者模式“加载已解压的扩展”不会自动拉取新包，只适合本地测试。

## 生产部署

生产环境只运行 `tradebridge-server`。本仓库生产部署不启动 Web 工作台、不启动 Chrome 插件构建服务，也不启动 PostgreSQL 容器；`DATABASE_URL` 必须指向外部 PostgreSQL 或已有数据库实例。服务端启动时会连接数据库并自动执行迁移。

服务器上准备 `.env.production`：

```bash
WANGWANG_SERVER_HOST=0.0.0.0
WANGWANG_SERVER_PORT=5032
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/tradebridge
WANGWANG_WEB_ORIGINS=https://trade.xiezi.tech
TRADEMIND_BRIDGE_SECRET=replace-with-the-same-secret-as-trade-mind
TRADEMIND_INGEST_URL=https://trade.xiezi.tech/api/ingest/conversations
TRADEMIND_BINDING_CONFIRM_URL=https://trade.xiezi.tech/api/communication/binding/bridge-confirm
TRADEMIND_BINDING_HEALTH_URL=https://trade.xiezi.tech/api/communication/binding/bridge-health
TRADEMIND_BINDING_VALIDATE_URL=https://trade.xiezi.tech/api/communication/binding/validate
```

手工部署命令：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build server
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate server
curl -fsS http://127.0.0.1:5032/health
```

自动部署参考 `.github/workflows/deploy-production.yml`：推送 `main` 后，GitHub Actions 通过 SSH 进入生产服务器，在 `PROD_DEPLOY_PATH` 拉取最新代码，构建并重启 `server`，最后检查 `/health`。需要在 GitHub 仓库 secrets 中配置：

- `PROD_DEPLOY_HOST`
- `PROD_DEPLOY_USER`
- `PROD_DEPLOY_SSH_PRIVATE_KEY`
- `PROD_DEPLOY_PATH`

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 构建基础包并同时启动服务端和 Web |
| `npm run dev:server` | 启动服务端 |
| `npm run dev:web` | 启动 Web 工作台 |
| `npm run build` | 构建全部 workspace |
| `npm run typecheck` | 对全部 workspace 做类型检查 |
| `npm run test:e2e` | 运行端到端试运行测试 |
| `npm run build:test -w @wangwang/chrome-extension` | 使用 test mode 构建插件，要求配置 `TRADEBRIDGE_SERVER_URL` |
| `npm run build:production -w @wangwang/chrome-extension` | 使用 production mode 构建插件，要求配置 `TRADEBRIDGE_SERVER_URL` |
| `npm run test -w @wangwang/server` | 运行服务端测试 |
| `npm run test -w @wangwang/web` | 运行 Web 测试 |
| `npm run test -w @wangwang/chrome-extension` | 运行 Chrome 插件测试 |
| `npm run test -w @wangwang/database` | 运行数据库包测试 |
| `npm run test -w @wangwang/onetalk-adapter` | 运行 OneTalk Web 实现面适配层测试 |

## 核心 API

### Collector API

- `POST /collector/v1/trademind/provision`：Trade-Mind 生成一次性插件激活码。
- `POST /collector/v1/auth/activate`：使用 Trade-Mind 激活码激活 Chrome 插件采集设备。
- `POST /collector/v1/auth/login`：使用管理员账号直接激活采集设备，主要用于兼容和内部调试。
- `GET /collector/v1/me`：校验 collector token 并读取账号和设备信息。
- `POST /collector/v1/heartbeat`：插件上报心跳、最近同步时间和最近错误。
- `POST /collector/v1/trademind/validate`：插件校验 Trade-Mind 绑定状态。
- `POST /collector/v1/sync-batches`：上传客户、会话和消息同步批次。
- `GET /collector/v1/outbound-messages`：插件领取待发送消息。
- `POST /collector/v1/outbound-messages/:messageId/delivery`：插件回写投递结果。
- `GET /collector/v1/ws`：插件实时连接。

### Internal API

- `POST /internal/v1/setup/admin`：初始化首个管理员。
- `POST /internal/v1/auth/login`：内部用户登录。
- `GET /internal/v1/me`：读取当前内部登录用户。
- `POST /internal/v1/auth/logout`：注销当前内部 session。
- `GET /internal/v1/users`：管理员读取内部用户列表。
- `POST /internal/v1/users`：管理员创建内部用户。
- `POST /internal/v1/users/:userId/disable`：管理员停用内部用户。
- `POST /internal/v1/users/:userId/reset-password`：管理员重置内部用户密码。
- `POST /internal/v1/invitations`：管理员创建邀请。
- `GET /internal/v1/invitations/:token`：读取邀请信息。
- `POST /internal/v1/invitations/:token/accept`：接受邀请并创建登录 session。
- `POST /internal/v1/collector-devices`：管理员创建 collector device。
- `GET /internal/v1/collector-devices`：管理员读取 collector device 列表。
- `POST /internal/v1/collector-devices/:deviceId/revoke`：管理员撤销 collector device。
- `GET /internal/v1/customers`：读取客户列表。
- `GET /internal/v1/conversations`：读取会话列表。
- `GET /internal/v1/conversations/:externalConversationId/messages`：读取会话消息。
- `GET /internal/v1/conversations/:externalConversationId/outbound-messages`：读取会话外发消息。
- `POST /internal/v1/conversations/:externalConversationId/outbound-messages`：创建外发消息。
- `POST /internal/v1/customers/:externalCustomerId/ai-summary`：生成客户 AI 摘要。
- `GET /internal/v1/customers/:externalCustomerId/ai-summary`：读取客户最新 AI 摘要。
- `POST /internal/v1/conversations/:externalConversationId/reply-suggestions`：生成回复建议。
- `GET /internal/v1/conversations/:externalConversationId/reply-suggestions`：读取回复建议。
- `GET /internal/v1/customers/:externalCustomerId/notes`：读取客户备注。
- `POST /internal/v1/customers/:externalCustomerId/notes`：新增客户备注。
- `GET /internal/v1/customers/:externalCustomerId/tags`：读取客户标签。
- `POST /internal/v1/customers/:externalCustomerId/tags`：新增客户标签。
- `GET /internal/v1/customers/:externalCustomerId/assignment`：读取客户负责人。
- `POST /internal/v1/customers/:externalCustomerId/assignment`：分配客户负责人。
- `GET /internal/v1/customers/:externalCustomerId/follow-up-tasks`：读取跟进任务。
- `POST /internal/v1/customers/:externalCustomerId/follow-up-tasks`：新增跟进任务。
- `PATCH /internal/v1/follow-up-tasks/:taskId`：更新跟进任务。

## 安全边界

- 内部用户使用 internal session token。
- Chrome 插件使用 collector token。
- 两类 token 不能混用。
- 服务端只保存 collector token hash。
- Chrome 插件安装时固定请求 OneTalk 页面权限；TradeBridge 服务端访问权限会按构建时的 `TRADEBRIDGE_SERVER_URL` 在设置页激活前动态申请。
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
