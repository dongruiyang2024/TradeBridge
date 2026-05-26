# 环境变量配置

本项目的 Node 启动入口会自动读取项目根目录下的 `.env.local` 和 `.env`，加载顺序为：

1. `.env.local`
2. `.env`

已有的 shell 环境变量优先级最高，dotenv 文件不会覆盖它们。也就是说，如果你在终端里已经设置了 `WANGWANG_SERVER_PORT=6000`，`.env.local` 里的同名变量不会把它改掉。

新机器首次配置时，可以从模板复制：

```bash
cp .env.example .env.local
```

## 本地试运行默认值

已提交的 `.env.example` 记录了项目支持的环境变量。当前工作区里的 `.env.local` 已加入 `.gitignore`，用于本机开发：

- 内部 API 管理 token：`dev-admin-token`
- 采集端兜底 token：`dev-device-token`
- 组织 ID：`org_internal`
- 内部服务端：`http://127.0.0.1:5032`
- Web 工作台：`http://127.0.0.1:5173`

## 常用启动方式

终端 1，启动内部服务端：

```bash
npm run dev:server
```

终端 2，启动 Web 工作台：

```bash
npm run dev:web
```

打开 `http://127.0.0.1:5173`，页面顶部输入：

- Org：`org_internal`
- API：留空
- Token：`dev-admin-token`

终端 3，启动桌面采集端：

```bash
npm run electron -w @wangwang/collector-desktop
```

如果你要在当前终端里直接执行 `curl` 或其他脚本，并希望它们也拿到 `.env.local` 里的变量，可以手动加载：

```bash
set -a
source .env.local
set +a
```

## 持久化服务

默认情况下，内部服务端使用内存存储，服务重启后数据会丢失。如需持久化数据，配置 PostgreSQL：

```bash
DATABASE_URL=postgres://wait9yan:Weite123@127.0.0.1:5432/tradebridge
```

AI 任务默认走本地同步 fallback。如需使用 Redis/BullMQ 队列，配置：

```bash
REDIS_URL=redis://127.0.0.1:6379/0
```

## 敏感变量

不要提交真实值：

- `WANGWANG_INTERNAL_API_TOKENS`
- `WANGWANG_DEVICE_TOKENS`
- `WANGWANG_COLLECTOR_TOKEN`
- `DATABASE_URL`
- `REDIS_URL`
- `WANGWANG_CHROMIUM_SAFE_STORAGE_PASSWORD`
