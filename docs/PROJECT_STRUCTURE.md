# 项目结构

短期技术栈：

```text
Node.js + Fastify + Vite React + TypeScript + SCSS
```

长期目标：

```text
Electron + Vite + React + TypeScript + SCSS
```

## 目录

```text
apps/
  api/              Fastify 本机 API
  web/              Vite React UI
packages/
  shared/           前后端共享类型
docs/               设计与调研文档
exports/            本地导出文件
tools/              已验证的 Python 探针
```

## API

默认监听：

```text
http://127.0.0.1:5031
```

接口：

```http
GET  /health
GET  /api/v1/conversations?refresh=false
GET  /api/v1/conversations/:id/messages?before={sendTime}&limit=50
GET  /api/v1/conversations/:id/customer
POST /api/v1/export
```

## 安全边界

- Cookie、CSRF、`chatToken` 只在 API 进程内存中使用。
- 前端只拿本机生成的会话 ID 和消息内容。
- API 默认绑定 `127.0.0.1`。
- 可选环境变量 `WANGWANG_API_TOKEN` 开启 Bearer token 保护。

## 开发命令

```powershell
npm.cmd install
npm.cmd run dev
```

如果 PowerShell 执行策略阻止 `npm`，使用 `npm.cmd`。
