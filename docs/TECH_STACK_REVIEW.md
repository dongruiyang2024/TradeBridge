# 本机聊天记录查看器技术栈审查

日期：2026-05-21

## 目标边界

当前目标不是替代 TradeManager，而是先做一个本机只读查看器：

- 后端复用已验证链路：`weblitePWA.htm` 缓存会话 + `getChatMessageList.htm` 消息接口。
- 前端展示会话列表、消息流、翻页、搜索、导出。
- Cookie、CSRF、账号字段只留在本机后端，不能直接暴露给浏览器前端。
- 先支持缓存会话范围；完整会话列表后续接 `IMBaaSSDK` 运行态。
- 默认绑定 `127.0.0.1`，不做公网服务。

## 推荐方案

推荐先用：

```text
Python FastAPI + SQLite + Vite React TypeScript
```

理由：

- 现有探针已经是 Python，迁移成本最低。
- FastAPI 适合做本机 API，自动生成接口文档，便于我们快速调试。
- Vite + React + TypeScript 适合快速做聊天 UI、虚拟滚动、状态管理和导出按钮。
- SQLite 足够保存导出快照、会话索引、消息去重记录，不引入外部数据库。
- 以后要打包桌面应用，可以把同一套前端迁进 Tauri 或 Electron。

如果后端改用 Node.js，推荐改成：

```text
Node.js + Fastify + SQLite + Vite React TypeScript
```

这个方案也可行，而且在几个方向上更顺：

- 前后端统一 TypeScript，接口类型、数据模型、工具链可以共用。
- Node 24 已在本机可用，内置 `fetch` 能直接请求 onetalk，不需要额外 HTTP 客户端。
- 后续如果走 Electron，Node 后端可以更自然地嵌入主进程或本机 sidecar。
- 如果要做 CDP/Chromium 运行态验证，Node 生态更贴近浏览器自动化。

代价是：现有 Python 探针和导出器需要迁移；cookie 提取、HTML 解析、分页导出逻辑要重写一遍。我的判断是，如果目标是做长期产品化查看器，Node 后端值得；如果目标是最快出 MVP，Python 后端仍然更快。

Node 后端具体建议：

- Web 框架：Fastify，优先于 Express。Fastify 的 schema、插件和 TypeScript 体验更适合本项目的本机 API。
- 数据库：SQLite。初期可以用 `better-sqlite3` 做同步本地读写；如果希望减少原生依赖，也可以评估 Node 官方 `node:sqlite`。
- 配置：用 `.env` 或本地 JSON 配置，但不要把 cookie/token 持久化。
- 请求层：封装 `OnetalkClient`，统一设置 AliWorkbench UA、CSRF、Cookie、Referer。
- 前端仍然用 Vite React TypeScript，不受后端语言影响。

## 架构草图

```text
Browser UI at 127.0.0.1
  |
  | fetch /api/conversations
  | fetch /api/conversations/:id/messages
  v
Local backend
  - extracts local AliWorkbench session cookies in memory
  - fetches https://onetalk.alibaba.com/message/weblitePWA.htm
  - parses window.__VMFsConv__cache__
  - calls POST /message/getChatMessageList.htm
  - stores optional local snapshot in SQLite
  |
  v
onetalk.alibaba.com
```

## 候选技术栈对比

| 方案 | 组成 | 优点 | 风险/缺点 | 适合阶段 |
| --- | --- | --- | --- | --- |
| A | FastAPI + Vite React + SQLite | 最贴近现有 Python 探针；调试快；本地 API 清晰；前后端分离 | 需要同时跑 Python 服务和前端 dev server | 最快 MVP |
| B | Flask + Vite React + SQLite | 更轻，概念少 | 类型提示、接口文档、请求模型不如 FastAPI 顺手 | 极简原型 |
| C | Node.js Fastify + Vite React + SQLite | 前后端同 TypeScript；后续接 Electron/CDP 更自然；长期产品化更统一 | 现有 Python cookie/接口探针需要重写；SQLite 驱动选择要确认 | Node 路线推荐 |
| D | Tauri + Rust/Python sidecar + React | 体积小；桌面应用形态好；本机权限边界清楚 | 初期工程复杂度高；Rust/sidecar 调试成本高 | MVP 稳定后 |
| E | Electron + React + Node backend | Chromium 能力强；后续接 CDP/页面运行态方便 | 包体大；安全配置要更谨慎；资源占用高 | 需要强浏览器运行态时 |

## 三条主路线深入对比

这里把最可能采用的三条路线单独展开：

```text
1. Next.js 全栈
2. Node.js + Fastify + Vite React
3. Python + FastAPI + Vite React
```

### 评分矩阵

分数越高越适合当前目标，满分 5。

| 维度 | Next.js 全栈 | Node + Fastify | Python + FastAPI |
| --- | ---: | ---: | ---: |
| 最快复用现有探针 | 2 | 3 | 5 |
| 前后端类型统一 | 5 | 5 | 3 |
| 本机 API 边界清晰 | 3 | 5 | 5 |
| UI 开发效率 | 5 | 4 | 4 |
| Cookie/token 隔离 | 3 | 5 | 5 |
| 长任务/批量导出 | 3 | 5 | 5 |
| 后续接 Electron/CDP | 4 | 5 | 3 |
| 后续接 Tauri | 3 | 4 | 4 |
| 工程复杂度可控 | 4 | 4 | 4 |
| 部署/启动简单 | 4 | 4 | 3 |

综合判断：

| 排名 | 方案 | 判断 |
| --- | --- | --- |
| 1 | Node + Fastify + Vite React | 最均衡，适合作为长期主线 |
| 2 | Next.js 全栈 | UI 和 API 一体化很舒服，但本项目的本机代理/长任务边界略不如 Fastify 清晰 |
| 3 | Python + FastAPI + Vite React | 最快出 MVP，最能复用现有代码，但长期前后端语言割裂 |

### Next.js 全栈

形态：

```text
Next.js App Router
  app/page.tsx
  app/conversations/page.tsx
  app/api/conversations/route.ts
  app/api/conversations/[id]/messages/route.ts
  app/api/export/route.ts
```

优点：

- 一个框架同时处理页面和 API，目录结构集中。
- App Router、Server Components、Route Handlers 对这种“本机管理台”很合适。
- 前端体验最好，React 页面、路由、加载状态、错误页都在同一套体系里。
- 后续如果要做“本地网页应用”，Next.js 的工程体验比 Vite 裸项目更完整。
- Route Handlers 支持 `GET/POST/PUT/PATCH/DELETE` 等方法，能承载本机 API。

缺点：

- 它的 API 层更偏 Backend-for-Frontend，不是独立后端服务。我们的代理层涉及 cookie 提取、阿里接口请求、批量导出、未来 CDP/SDK 运行态，放进 Next API 会变得偏重。
- Next 有缓存、渲染、Server/Client Component 边界。做纯本机动态代理时要额外注意所有 API 都必须是动态运行，避免被缓存或预渲染误伤。
- 长时间导出任务不适合直接塞在普通 Route Handler 里，最好额外做 job queue 或本机 worker。
- 如果未来要 Electron 主进程深度控制浏览器/CDP，Next 本身帮不上太多，仍要额外写 Node 服务或主进程逻辑。

适合场景：

- 你希望第一版就是一个完整、漂亮、工程化的本机 Web App。
- API 主要服务 UI，不打算让后端成为可独立复用的模块。
- 导出规模不大，任务都能在一次请求里完成。

不适合场景：

- 后端代理逻辑会越来越重。
- 要把 cookie/session、CDP、SDK 运行态、SQLite job、导出任务做成长期核心能力。
- 后续还想让另一个 UI 或桌面壳复用同一套后端。

结论：

Next.js 可以用，但我不建议把所有后端能力都塞进 Next。更推荐两种折中：

```text
折中 A：Next.js UI + 独立 Fastify 本机 API
折中 B：先 Next.js 全栈 MVP，后端变复杂后拆出 Fastify
```

### Node.js + Fastify + Vite React

形态：

```text
apps/web        Vite React UI
apps/api        Fastify local API
packages/shared shared TypeScript types
```

优点：

- 前后端同 TypeScript，但后端仍然是独立服务，边界清楚。
- Fastify 适合做本机 API：路由、schema、插件、错误处理、日志都比较轻。
- Node 24 内置 `fetch`，请求 onetalk 不需要额外 HTTP 客户端。
- 后续接 Electron 主进程、CDP、WebSocket、SDK 运行态更自然。
- 批量导出、后台任务、SQLite 快照更适合放在独立 API 服务里。
- 前端可替换：今天 Vite React，未来 Next/Tauri/Electron 都能复用 API。

缺点：

- 比 Next.js 多一个服务进程，开发时要同时跑 UI 和 API。
- 要把现有 Python 探针迁移到 TypeScript。
- SQLite 驱动要选型：`better-sqlite3` 简单好用但有原生依赖；Node 官方 `node:sqlite` 可以评估，但生态资料相对少。

适合场景：

- 想做长期维护的本机工具。
- 需要清晰隔离 cookie/token，不让前端碰认证材料。
- 后续要接完整会话列表、CDP、Electron 或桌面封装。

结论：

这是我目前最推荐的长期路线。它比 Next.js 少一点“一体化爽感”，但换来更干净的后端边界。

### Python + FastAPI + Vite React

形态：

```text
backend/ FastAPI
frontend/ Vite React
tools/ existing Python probes
```

优点：

- 现有可用代码最多：cookie 提取、页面解析、消息 API、导出器都已经是 Python。
- FastAPI 能快速把探针包装成本机 API，并自动生成 OpenAPI/Swagger 文档。
- Python 标准库已有 `sqlite3`，本地快照不用先处理 Node 原生依赖。
- 适合最快验证产品形态：几乎可以把现有导出器拆成 API。

缺点：

- 前端 TypeScript，后端 Python，类型不能天然共享。
- 后续接 Electron/CDP 仍会回到 Node 生态，可能形成 Python + Node 双后端。
- 如果目标是长期产品化，维护两套语言会增加认知成本。

适合场景：

- 想尽快把现有验证成果做成可点的 UI。
- 先验证业务价值，再决定是否重构到 Node。
- 后端主要是代理和导出，暂时不做复杂运行态控制。

结论：

这是最快 MVP 路线，但不是我心里最好的长期路线。

## 针对本项目的最终建议

## WeFlow 参考分析

参考仓库：https://github.com/hicccc77/WeFlow

WeFlow 是一个本地微信聊天记录查看、分析和导出工具。它和我们的目标非常接近：都属于“本机读取聊天数据、本机展示、本机导出、可选暴露本地 HTTP API”的应用。

### 它的技术栈

从仓库配置看，WeFlow 采用的是：

```text
Electron + Vite + React + TypeScript + SCSS
```

关键组成：

- 桌面壳：Electron。
- 前端构建：Vite。
- UI：React、React Router、SCSS。
- 状态管理：Zustand。
- 图表：ECharts。
- 大列表：react-virtuoso。
- 图标：lucide-react。
- 打包：electron-builder。
- Electron/Vite 集成：vite-plugin-electron、vite-plugin-electron-renderer。
- 本机存储/数据库能力：better-sqlite3、WCDB 相关服务、原生 `.node` 模块。
- Native/FFI：koffi。
- 导出能力：exceljs、jszip、HTML 导出。
- 媒体处理：ffmpeg-static、silk-wasm、sharp。
- 语音/模型：sherpa-onnx-node。

它不是 Next.js 路线，也不是独立 Fastify/Express 后端路线。它的后端能力主要在 Electron main process 的 services 目录里，通过 IPC 暴露给渲染进程。

### 它的本机 HTTP API 设计

WeFlow 额外提供本机 HTTP API：

```text
默认监听：127.0.0.1
默认端口：5031
接口前缀：/api/v1
支持：messages、sessions、contacts、group-members、media、SSE push
```

源码中 HTTP 服务使用 Node 原生 `http.createServer`，不是 Fastify/Express。它做了几个值得参考的点：

- 默认只监听本机地址。
- 除健康检查外，API 需要 access token。
- 支持 Bearer token、query token、body token。
- 支持 SSE 推送新消息。
- CORS 只允许 localhost/127.0.0.1 来源。
- 媒体文件接口做了路径穿越检查。
- API 文档按 `/api/v1/messages`、`/api/v1/sessions`、`/api/v1/media/*` 组织。

这些设计非常适合我们借鉴。

### 对我们的启发

值得直接参考：

- “桌面壳 + 本机服务 + 渲染层”的三层结构。
- IPC 只暴露受控能力，不让前端直接拿敏感路径、cookie、token。
- 本地 HTTP API 默认绑定 `127.0.0.1`。
- API token 保护，即使是本机服务也不裸奔。
- SSE 为将来实时消息推送预留接口。
- 导出任务独立 worker 化，避免阻塞 UI。
- 大消息列表使用虚拟滚动。
- 多格式导出从一开始留接口：JSON、HTML、CSV、ChatLab 风格结构。

不建议照搬：

- 一开始就上 Electron。我们的第一阶段还没有完整会话列表，也没有实时运行态，直接桌面化会增加复杂度。
- 用 Node 原生 `http` 手写全部路由。WeFlow 是成熟项目，手写服务可控；我们早期用 Fastify 会更清晰。
- 一次性做媒体解密、年度报告、AI 分析。我们当前核心是先把聊天查看和导出链路跑稳。

### 和我们选型的关系

WeFlow 实际上支持我的推荐排序：

```text
短期：Node + Fastify + Vite React
中期：保留 Fastify 本机 API，补 SQLite/导出/虚拟列表
长期：如果要桌面化，再迁到 Electron + Vite React
```

如果我们直接参考 WeFlow 的最终形态，可以把长期目标调整为：

```text
Electron + Vite React + TypeScript
  renderer: 聊天 UI
  main process: onetalk/session/API/export/CDP
  local HTTP API: 127.0.0.1 + token + SSE
```

但第一步仍建议从独立 `Node + Fastify + Vite React` 开始。这样后端能力能先跑通，未来迁进 Electron main process 时也比较自然。

### 可借鉴 API 草案

参考 WeFlow 后，我们的 API 可以改成更标准的版本前缀：

```http
GET  /health
GET  /api/v1/conversations
GET  /api/v1/conversations/:id/messages
POST /api/v1/export
GET  /api/v1/exports
GET  /api/v1/push/messages
GET  /api/v1/media/*
```

MVP 先实现前四个，`push/messages` 和 `media/*` 预留。

## 针对本项目的最终建议

如果我们按“长期可演进”来选：

```text
首选：Node.js + Fastify + Vite React + SQLite
```

如果你很喜欢 Next.js 的开发体验：

```text
可选：Next.js UI + Fastify 本机 API
```

我不建议一开始就用纯 Next.js 全栈承载所有逻辑，除非我们明确只做一个轻量本机查看器，不打算把后端代理、导出、CDP/SDK 运行态做深。

如果按“最快拿到可用界面”来选：

```text
最快：Python + FastAPI + Vite React
```

我的偏好排序：

```text
1. Node + Fastify + Vite React
2. Next.js UI + Fastify API
3. Python + FastAPI + Vite React
4. 纯 Next.js 全栈
```

## 推荐模块拆分

后端模块：

- `session.py`：从本机日志提取 cookie，仅内存使用。
- `onetalk_client.py`：封装 `fetch_weblite()`、`get_chat_messages()`。
- `conversation_cache.py`：解析 `window.__VMFsConv__cache__`，生成内部会话 ID。
- `storage.py`：SQLite 快照、消息去重、导出记录。
- `api.py`：本机 HTTP API。

如果采用 Node.js，对应模块可以改成：

- `src/session.ts`：从本机日志提取 cookie，仅内存使用。
- `src/onetalk-client.ts`：封装 `fetchWeblite()`、`getChatMessages()`。
- `src/conversation-cache.ts`：解析 `window.__VMFsConv__cache__`，生成内部会话 ID。
- `src/storage.ts`：SQLite 快照、消息去重、导出记录。
- `src/server.ts`：Fastify 本机 HTTP API。

前端模块：

- `ConversationList`：缓存会话列表、搜索、未读/最新消息摘要。
- `MessageThread`：消息流、时间分组、向上翻页。
- `ExportPanel`：导出 JSON/JSONL/CSV。
- `SettingsPanel`：页大小、最大翻页数、是否脱敏 ID。

## 本机 API 设计草案

```http
GET /api/health
GET /api/conversations?refresh=false
GET /api/conversations/{conversationId}/messages?before={sendTime}&limit=50
POST /api/export
GET /api/exports
GET /api/exports/{fileName}
```

`conversationId` 不直接使用阿里原始 `cid`，建议用本机生成的短 ID 映射，避免前端 URL 暴露真实账号/会话标识。

## 数据模型草案

```text
Conversation
  id: local stable id
  source: vmfs_cache
  displayName
  lastMessagePreview
  lastMessageTime
  rawShape

Message
  id: local stable id
  conversationId
  remoteMessageId
  sendTime
  senderRole
  messageType
  subType
  content
  raw
```

## 安全约束

- 前端永远不接收 cookie、CSRF、`chatToken`。
- 后端响应默认脱敏账号 ID，可在本机设置里关闭。
- 服务只监听 `127.0.0.1`。
- 不实现发送消息接口，至少 MVP 阶段禁止。
- 日志不打印正文、不打印 cookie、不打印 token。
- 导出文件允许包含正文，但不包含认证材料。

## 分阶段路线

### Phase 1：只读 MVP

- FastAPI 后端封装现有导出器逻辑。
- React 页面展示缓存会话和消息。
- 支持点击会话、上翻历史、导出 JSON/JSONL。
- 用当前 3 个缓存会话验证。

### Phase 2：本地快照和搜索

- SQLite 保存导出快照。
- 前端增加全文搜索、按会话/时间过滤。
- 增加 CSV/HTML 导出。

### Phase 3：完整会话列表

- 攻 `IMBaaSSDK.getConversationServiceV2()` 运行态。
- 可选路径：
  - 在真实 AliWorkbench CEF 里注入/调用运行态。
  - 用受控 Chromium + 完整 UA/cookie/运行环境复现 SDK 登录。
  - 继续逆 WebSocket/RPC 协议。

### Phase 4：桌面封装

- 如果只需要查看器，优先 Tauri。
- 如果需要更强浏览器运行态、CDP、页面注入，Electron 更合适。

## 待审查问题

1. MVP 是否只做只读，不做发送消息？
2. 导出文件是否默认保留正文，还是默认脱敏正文？
3. 前端是否需要多账号切换，还是只针对当前登录账号？
4. 是否接受先只覆盖 `weblitePWA` 缓存会话？
5. 后续完整会话列表优先攻 SDK 运行态，还是先逆本地服务/数据库？

## 资料来源

- FastAPI 官方文档：https://fastapi.tiangolo.com/
- Node.js 官方文档：https://nodejs.org/api/
- Fastify 官方文档：https://fastify.dev/docs/latest/
- Next.js 官方文档：https://nextjs.org/docs
- Vite 官方文档：https://vite.dev/guide/
- React 官方文档：https://react.dev/
- SQLite 官方文档：https://www.sqlite.org/docs.html
- Tauri 官方文档：https://tauri.app/
- Electron 官方文档：https://www.electronjs.org/docs/latest/
- Playwright CDP 参考：https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp
