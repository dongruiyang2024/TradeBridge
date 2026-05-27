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

- 内部服务端：`http://127.0.0.1:5032`
- Web 工作台：`http://127.0.0.1:5173`
- 采集端：通过 `/collector/v1/auth/login` 激活后保存服务端返回的 collector token

## 内部工作台登录

内部工作台只支持邮箱密码登录。新环境首次启动时，使用 Web 工作台的初始化入口创建首个管理员账号。项目按单实例运行，不需要配置组织 ID。

初始化接口只允许在当前实例尚无管理员时创建首个管理员。首个管理员创建完成后，后续管理员和普通内部用户由已登录管理员在工作台中创建。

## 常用启动方式

终端 1，启动内部服务端：

```bash
npm run dev:server
```

终端 2，启动 Web 工作台：

```bash
npm run dev:web
```

打开 `http://127.0.0.1:5173`，登录页默认只需要邮箱和密码。

- API：默认留空，Web 会通过 Vite proxy 访问同源 `/internal`
- 需要切换后端地址时，点击登录页的“连接设置”，填写服务端地址，例如 `http://127.0.0.1:5032`

终端 3，启动桌面采集端：

```bash
npm run electron -w @wangwang/collector-desktop
```

## 采集端激活

项目不再支持静态采集 token。Chrome 插件和桌面采集端必须通过 `/collector/v1/auth/login` 激活并保存返回的 collector token。

Chrome 插件会在设置页提交 Server URL、管理员邮箱和管理员密码；设备 ID 自动生成并复用，设备名称默认使用 `Chrome Extension`。激活成功后插件自动保存 collector token，后续同步只使用 token，不保存管理员密码。

桌面采集端当前通过环境变量读取服务端地址和激活后的 token；设备 ID 自动生成，设备名称默认使用本机 hostname：

```bash
WANGWANG_SERVER_URL=http://127.0.0.1:5032
WANGWANG_COLLECTOR_TOKEN=<激活接口返回的 token>
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

- `WANGWANG_COLLECTOR_TOKEN`
- `DATABASE_URL`
- `REDIS_URL`
- `WANGWANG_CHROMIUM_SAFE_STORAGE_PASSWORD`
