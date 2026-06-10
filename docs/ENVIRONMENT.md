# 环境变量配置

本项目的 Node 启动入口会自动读取项目根目录下的 `.env.local` 和 `.env`，加载顺序为：

1. `.env.local`
2. `.env`

已有的 shell 环境变量优先级最高，dotenv 文件不会覆盖它们。新机器首次配置时，可以从模板复制：

```bash
cp .env.example .env.local
```

## 本地试运行默认值

当前产品定位是 Chrome 插件网页消息桥。`.env.local` 主要服务于本地服务端、Web 工作台、数据库和 AI 队列：

- 内部服务端：`http://127.0.0.1:5032`
- Web 工作台：`http://127.0.0.1:5173`
- Chrome 插件：通过设置页激活 collector device，并把 collector token 保存在 Chrome storage 中

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

## Chrome 插件激活

项目不支持静态采集 token。Chrome 插件必须通过 `/collector/v1/auth/login` 激活并保存返回的 collector token。

Chrome 插件会在设置页提交：

- Server URL，例如 `http://127.0.0.1:5032`
- 管理员邮箱
- 管理员密码

设备 ID 自动生成并复用，设备名称默认使用 `Chrome Extension`。激活成功后插件自动保存 collector token，后续同步和投递只使用 token，不保存管理员密码。

## 持久化服务

默认情况下，内部服务端使用内存存储，服务重启后数据会丢失。如需持久化数据，配置 PostgreSQL：

```bash
DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/tradebridge
```

AI 任务默认走本地同步 fallback。如需使用 Redis/BullMQ 队列，配置：

```bash
REDIS_URL=redis://127.0.0.1:6379/0
```

也支持历史兼容变量：

```bash
WANGWANG_REDIS_URL=redis://127.0.0.1:6379/0
```

## 敏感变量

不要提交真实值：

- `DATABASE_URL`
- `REDIS_URL`
- `WANGWANG_REDIS_URL`

collector token 由 Chrome 插件设置页激活后保存在 Chrome storage 中，不应写入 `.env.local` 或共享文档。
