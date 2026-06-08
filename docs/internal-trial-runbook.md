# 内部试运行手册

本文用于在本机完整跑通 TradeBridge 内部试运行流程：PostgreSQL、内部服务端、Web 工作台、Chrome 插件，以及端到端自动化验证。

## 1. 前置条件

- macOS、Linux 或 Windows。
- Node.js 20+。
- npm。
- Chrome 浏览器。
- 可选：Docker Desktop，用于本地 PostgreSQL。
- 已安装项目依赖：

```bash
npm install
```

## 2. 环境变量

Node 启动入口会自动读取项目根目录下的 `.env.local` 和 `.env`，不需要在启动前手动 `source`。

本地试运行至少需要：

```bash
WANGWANG_SERVER_HOST=127.0.0.1
WANGWANG_SERVER_PORT=5032
```

如果使用本仓库提供的 PostgreSQL Docker Compose，建议使用：

```bash
DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/tradebridge
```

如果使用你本机已有 PostgreSQL，请让 `DATABASE_URL` 和实际用户名、密码、数据库名保持一致。

## 3. 启动 PostgreSQL

```bash
docker compose -f docker-compose.postgres.yml up -d
```

检查容器状态：

```bash
docker compose -f docker-compose.postgres.yml ps
```

停止 PostgreSQL：

```bash
docker compose -f docker-compose.postgres.yml down
```

需要清空本地数据时再执行：

```bash
docker compose -f docker-compose.postgres.yml down -v
```

## 4. 启动服务端和 Web 工作台

```bash
npm run dev
```

启动后确认：

- 内部服务端：`http://127.0.0.1:5032`
- Web 工作台：`http://127.0.0.1:5173`

健康检查：

```bash
curl http://127.0.0.1:5032/health
```

## 5. 初始化管理员和内部登录

可以在 Web 工作台切换到初始化模式创建首个管理员，也可以直接调用初始化接口：

```bash
curl -X POST http://127.0.0.1:5032/internal/v1/setup/admin \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin@example.com",
    "displayName": "Admin User",
    "password": "change-me-password"
  }'
```

创建完成后，可以直接用邮箱密码登录：

```bash
curl -X POST http://127.0.0.1:5032/internal/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin@example.com",
    "password": "change-me-password"
  }'
```

打开 `http://127.0.0.1:5173/` 后直接输入邮箱和密码。

说明：

- 内部工作台只支持邮箱密码登录。
- 初始化接口只允许在当前实例尚无管理员时创建首个管理员。
- 后续管理员和普通内部用户由已登录管理员在工作台中创建。

## 6. 构建和安装 Chrome 插件

构建插件：

```bash
npm run build -w @wangwang/chrome-extension
```

构建产物在：

```text
apps/chrome-extension/dist
```

安装方式：

1. 打开 `chrome://extensions`。
2. 开启 Developer mode。
3. 点击 Load unpacked。
4. 选择 `apps/chrome-extension/dist`。

## 7. 激活 Chrome 插件

Chrome 插件必须通过管理员邮箱密码激活，由服务端创建或更新设备并返回 collector token。

在插件设置页填写：

- Server URL：`http://127.0.0.1:5032`
- 邮箱：管理员邮箱
- 密码：管理员密码
- 同步间隔：默认 30 分钟
- 启用历史消息回补：默认开启
- 每会话回补条数：默认 20 条，最大 100 条

点击“保存并激活”后，Chrome 会按 Server URL 申请 TradeBridge 服务端访问权限。激活成功后，插件会把 collector token 保存到 Chrome storage。响应里的 token 只返回一次，插件不会保存管理员密码。

也可以用接口验证激活流程：

```bash
curl -X POST http://127.0.0.1:5032/collector/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin@example.com",
    "password": "change-me-password"
  }'
```

## 8. 阿里国际站消息通道验证

当前首个真实渠道是阿里国际站消息通道：

```text
channel: alibaba-im
surface: onetalk-web
页面: https://onetalk.alibaba.com/
```

手工验证：

1. Chrome 打开 `https://onetalk.alibaba.com/`。
2. 确认 OneTalk Web 页面已登录。
3. 打开插件设置页并完成激活。
4. 点击插件弹窗里的同步按钮。
5. 确认插件弹窗显示实时连接、最近同步、抓取诊断和历史回补摘要。
6. 打开 TradeBridge Web 工作台。
7. 确认客户、会话和消息可见。

## 9. 客户视角验证

打开：

```text
http://127.0.0.1:5173
```

确认：

- 能加载客户列表。
- 选择客户后能看到会话和消息。
- 可以新增备注。
- 可以新增标签。
- 可以新增跟进任务。
- 使用采集 token 访问内部 API 会被拒绝。

采集 token 隔离验证：

```bash
curl http://127.0.0.1:5032/internal/v1/customers \
  -H 'Authorization: Bearer <激活接口返回的 token>'
```

期望返回 `401`。

## 10. 敏感信息验证

插件不应把第三方 Cookie、CSRF token、IM token 或原始请求头上传到服务端。

试运行时至少检查服务端返回的消息内容里不应出现以下字段或值：

- `cookie2`
- `ctoken`
- `_tb_token_`
- `sgcookie`
- `x5sec`
- `chatToken`
- `Cookie`
- `Authorization`
- `Set-Cookie`

`.env.local` 不要提交到 Git。

自动化端到端测试也覆盖了“采集端 fixture 中的 cookie 不会出现在 Web 读取到的消息数据里”。

## 11. 自动化端到端验证

```bash
npm run test:e2e
```

该命令会构建相关 workspace，并运行 `test/e2e` 下的端到端测试。

当前 E2E 覆盖：

- 启动内部服务端实例。
- 使用 fixture 数据上传同步批次。
- Web API client 读取客户、会话、消息。
- Web workflow 创建备注、标签、跟进任务。
- 采集 token 不能读取内部 API。
- OneTalk cookie fixture 不会出现在 Web 消息数据中。
- 项目结构不再包含桌面采集端。

## 12. 常见问题

### 服务端启动时报数据库连接失败

检查 `.env.local` 的 `DATABASE_URL` 是否和 PostgreSQL 实际账号密码一致。使用本仓库 compose 时应为：

```bash
DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/tradebridge
```

### Web 显示未授权

确认页面使用的是内部用户账号：

```text
邮箱: admin@example.com
密码: change-me-password
```

普通账号登录只需要邮箱和密码。需要切换后端地址时，点击登录页的“连接设置”填写 API 地址。

不要把采集端 token 填到 Web 工作台。

### 插件没有真实数据

确认 Chrome 中的 `https://onetalk.alibaba.com/` 已登录，并且插件有对应页面权限。没有真实登录态时，可以先用 `npm run test:e2e` 验证内部链路。
