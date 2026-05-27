# 采集端账号密码激活流程实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让 Chrome 插件和桌面采集端通过管理员账号密码完成首次激活，由服务端返回设备级 collector token，采集端之后只保存并使用 collector token 调用采集接口。

**架构：** Web 管理后台继续使用 internal session token 访问 `/internal/v1/*`。采集端新增激活登录接口，客户端提交邮箱、密码和设备信息，服务端验证管理员权限后创建或更新采集设备并返回 collector token。同步接口 `/collector/v1/sync-batches` 继续只接受 collector token，不接受账号密码或 internal session token。

**技术栈：** Fastify、React、Chrome Extension Manifest V3、Electron、Node test runner、PostgreSQL、`@wangwang/database`。

---

## 当前状态与目标差距

当前 Web 管理后台已经符合“邮箱密码登录，服务端返回 token，后续接口用 Bearer token”的模式，但返回的是 internal session token。Chrome 插件不符合目标流程：它没有账号密码登录页面，也不会向服务端换取 collector token，而是要求用户手动填写 `collectorToken`。

当前服务端已经具备两类 token：

- internal session token：由 `/internal/v1/auth/login` 签发，用于 Web 管理后台。
- collector token：由 `/internal/v1/collector-devices` 生成，用于 `/collector/v1/sync-batches`。

本计划要补齐“采集端账号密码激活”入口，并让 Chrome 插件和桌面采集端都通过该入口获取 collector token。

## 文件结构

- 修改：`packages/database/migrations/001_internal_sync_schema.sql`
  - 明确 `collector_device` 的设备身份字段和 token hash 字段，避免把 `deviceId` 当成 token hash。
- 修改：`packages/database/src/sync-types.ts`
  - 增加采集设备外部 ID 和激活结果类型。
- 修改：`packages/database/src/sync-store.ts`
  - 内存存储支持按设备外部 ID 创建、更新和认证采集设备。
- 修改：`packages/database/src/postgres-sync-store.ts`
  - Postgres 存储支持按设备外部 ID 写入心跳，collector token 只用于鉴权。
- 修改：`packages/database/test/sync-store.test.ts`
  - 覆盖设备身份和 token 分离。
- 修改：`packages/database/test/postgres-sync-store.test.ts`
  - 覆盖 SQL 参数不暴露原始 token，且同步不会创建重复设备。
- 修改：`apps/server/src/server.ts`
  - 新增 `/collector/v1/auth/login` 激活接口。
  - 删除 `deviceTokens`、`envDeviceTokens` 和环境变量静态采集 token 认证分支。
- 修改：`apps/server/test/auth-routes.test.ts`
  - 覆盖采集端激活登录、权限校验和错误码。
- 修改：`apps/server/test/collector-device-routes.test.ts`
  - 调整设备注册断言，确认设备外部 ID 和 token hash 不泄露。
- 修改：`apps/server/test/sync-batches.test.ts`
  - 改为先注册采集设备，再使用返回 token 上传。
- 修改：`apps/server/test/customer-collaboration-routes.test.ts`
  - 改为先注册采集设备，再使用返回 token 上传测试数据。
- 修改：`apps/server/test/customer-assignment-routes.test.ts`
  - 改为先注册采集设备，再使用返回 token 上传测试数据。
- 修改：`apps/server/test/internal-query-routes.test.ts`
  - 改为先注册采集设备，再使用返回 token 上传测试数据。
- 修改：`apps/server/test/ai-routes.test.ts`
  - 改为先注册采集设备，再使用返回 token 上传测试数据。
- 修改：`apps/server/test/server-bootstrap.test.ts`
  - 删除依赖 `deviceTokens` 的启动测试。
- 修改：`apps/chrome-extension/src/shared/sync-types.ts`
  - 增加插件激活配置和响应类型。
- 修改：`apps/chrome-extension/src/background/tradebridge-client.ts`
  - 增加调用采集端激活接口的客户端函数。
- 修改：`apps/chrome-extension/src/background/storage.ts`
  - 保存激活后的 collector token、设备 ID 和卖家账号。
- 修改：`apps/chrome-extension/src/options/options.html`
  - 将手动 token 表单改为账号密码激活表单。
- 修改：`apps/chrome-extension/src/options/options.ts`
  - 提交账号密码激活请求并保存返回配置。
- 修改：`apps/chrome-extension/test/tradebridge-client.test.ts`
  - 覆盖激活接口请求和错误映射。
- 修改：`apps/chrome-extension/test/sync-orchestrator.test.ts`
  - 覆盖未激活时返回 `collector_activation_required`。
- 修改：`apps/collector-desktop/src/electron-main.ts`
  - 增加采集端激活配置读取和状态展示入口。
- 修改：`apps/collector-desktop/src/collector.ts`
  - 保持同步只使用 collector token。
- 修改：`apps/collector-desktop/test/collector.test.ts`
  - 覆盖激活后 token 驱动的同步。
- 修改：`docs/ENVIRONMENT.md`
  - 删除静态采集 token 的说明，改为账号密码激活采集端。
- 修改：`docs/chrome-extension-trial-runbook.md`
  - 更新 Chrome 插件测试流程。
- 修改：`.env.example`
  - 删除 `WANGWANG_DEVICE_TOKENS`，保留采集端激活后写入的 `WANGWANG_COLLECTOR_TOKEN` 示例。

## 移除 `WANGWANG_DEVICE_TOKENS` 的合理性

彻底移除 `WANGWANG_DEVICE_TOKENS` 是合理的。账号密码激活采集端之后，系统已经具备唯一、可审计、可撤销的设备授权来源：数据库里的 collector token。继续保留环境变量静态 token 会带来三个问题：

- 它绕过 `/collector/v1/auth/login` 和 `/internal/v1/collector-devices`，导致测试和本地使用可以不经过账号密码激活。
- 它是进程级全局密钥，无法对应到具体设备、卖家账号、心跳和撤销记录。
- 它容易被误带到共享环境或生产环境，形成一个不在数据库审计范围内的上传入口。

代价是本地开发和自动化测试必须先创建或激活采集设备，再用返回的 collector token 调用 `/collector/v1/sync-batches`。这个成本可以接受，并且正好强化最终产品流程。

## 接口目标

新增采集端激活接口：

```http
POST /collector/v1/auth/login
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "change-me-password",
  "sellerAccountExternalId": "seller-demo",
  "deviceExternalId": "chrome-extension-demo",
  "deviceName": "Chrome Extension"
}
```

成功响应：

```json
{
  "ok": true,
  "token": "collector-token-returned-once",
  "device": {
    "id": "collector_device_1",
    "externalDeviceId": "chrome-extension-demo",
    "sellerAccountExternalId": "seller-demo",
    "deviceName": "Chrome Extension",
    "status": "active"
  }
}
```

错误响应：

```json
{ "ok": false, "error": "invalid_credentials" }
```

```json
{ "ok": false, "error": "forbidden" }
```

```json
{ "ok": false, "error": "invalid_collector_login_request" }
```

## 任务 1：统一采集设备身份模型

**文件：**
- 修改：`packages/database/migrations/001_internal_sync_schema.sql`
- 修改：`packages/database/src/sync-types.ts`
- 修改：`packages/database/src/sync-store.ts`
- 修改：`packages/database/src/postgres-sync-store.ts`
- 测试：`packages/database/test/sync-store.test.ts`
- 测试：`packages/database/test/postgres-sync-store.test.ts`

- [x] **步骤 1：编写失败的内存存储测试**

在 `packages/database/test/sync-store.test.ts` 增加测试：

```ts
test("collector devices separate external device id from collector token", async () => {
  const store = new InMemorySyncStore();
  const registered = await store.registerCollectorDevice({
    sellerAccountExternalId: "seller-demo",
    externalDeviceId: "chrome-extension-demo",
    deviceName: "Chrome Extension",
    token: "collector-token"
  });

  assert.equal(registered.externalDeviceId, "chrome-extension-demo");
  assert.equal(registered.token, "collector-token");
  assert.notEqual(registered.tokenHash, "collector-token");
  const authenticated = await store.authenticateCollectorDevice("collector-token");
  assert.equal(authenticated?.externalDeviceId, "chrome-extension-demo");
  assert.equal(authenticated?.id, registered.id);
});
```

- [x] **步骤 2：运行测试验证失败**

运行：

```bash
node --import tsx --test packages/database/test/sync-store.test.ts
```

预期：FAIL，TypeScript 提示 `externalDeviceId` 不存在或断言失败。

- [x] **步骤 3：更新类型定义**

在 `packages/database/src/sync-types.ts` 的 `CollectorDevice` 和 `RegisterCollectorDeviceInput` 增加字段：

```ts
export interface CollectorDevice {
  id: string;
  externalDeviceId?: string;
  sellerAccountExternalId?: string;
  deviceName?: string;
  status: string;
  lastHeartbeatAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterCollectorDeviceInput {
  sellerAccountExternalId?: string;
  externalDeviceId?: string;
  deviceName?: string;
  token?: string;
  status?: string;
}
```

- [x] **步骤 4：更新内存存储**

在 `packages/database/src/sync-store.ts` 的 `registerCollectorDevice` 中保存 `externalDeviceId`，并让 `authenticateCollectorDevice` 返回公开设备信息：

```ts
const device: CollectorDevice & { tokenHash: string } = {
  id: this.nextCollectorDeviceId(),
  externalDeviceId: input.externalDeviceId,
  sellerAccountExternalId: input.sellerAccountExternalId,
  deviceName: input.deviceName,
  status: input.status || "active",
  createdAt: now,
  updatedAt: now,
  tokenHash
};
```

- [x] **步骤 5：更新 Postgres 初始 schema**

在 `packages/database/migrations/001_internal_sync_schema.sql` 的 `collector_device` 表增加设备外部 ID：

```sql
external_device_id TEXT,
UNIQUE (external_device_id),
UNIQUE (device_token_hash)
```

保持 `device_token_hash` 只表示 collector token 的 hash。

- [x] **步骤 6：更新 Postgres 存储**

在 `packages/database/src/postgres-sync-store.ts` 的 `registerCollectorDevice` 中写入 `external_device_id`，并在 `listCollectorDevices`、`authenticateCollectorDevice`、`mapCollectorDevice` 中读出 `externalDeviceId`。

`acceptSyncBatch` 内部的 `upsertCollectorDevice` 改为优先按 `batch.device.deviceId` 匹配 `external_device_id`，不能再把 `batch.device.deviceId` 写入 `device_token_hash`。

- [x] **步骤 7：编写 Postgres 查询测试**

在 `packages/database/test/postgres-sync-store.test.ts` 增加断言：

```ts
test("PostgresSyncStore uses external device id separately from collector token hash", async () => {
  const client = new RecordingSqlClient();
  const store = new PostgresSyncStore(client);

  await store.registerCollectorDevice({
    sellerAccountExternalId: "seller-demo",
    externalDeviceId: "chrome-extension-demo",
    deviceName: "Chrome Extension",
    token: "collector-token"
  });

  const registerQuery = client.queries.find((query) => /register_collector_device/i.test(query.sql));
  assert.ok(registerQuery);
  assert.equal(registerQuery.params.includes("chrome-extension-demo"), true);
  assert.equal(registerQuery.params.includes("collector-token"), false);
});
```

- [x] **步骤 8：运行数据库测试验证通过**

运行：

```bash
npm test -w @wangwang/database
```

预期：PASS。

- [x] **步骤 9：Commit**

```bash
git add packages/database/migrations/001_internal_sync_schema.sql packages/database/src/sync-types.ts packages/database/src/sync-store.ts packages/database/src/postgres-sync-store.ts packages/database/test/sync-store.test.ts packages/database/test/postgres-sync-store.test.ts
git commit -m "refactor(database): 拆分采集设备身份和密钥"
```

## 任务 2：新增采集端账号密码激活接口

**文件：**
- 修改：`apps/server/src/server.ts`
- 测试：`apps/server/test/auth-routes.test.ts`
- 测试：`apps/server/test/collector-device-routes.test.ts`
- 测试：`apps/server/test/sync-batches.test.ts`
- 测试：`apps/server/test/customer-collaboration-routes.test.ts`
- 测试：`apps/server/test/customer-assignment-routes.test.ts`
- 测试：`apps/server/test/internal-query-routes.test.ts`
- 测试：`apps/server/test/ai-routes.test.ts`
- 测试：`apps/server/test/server-bootstrap.test.ts`

- [x] **步骤 1：编写失败的服务端测试**

在 `apps/server/test/auth-routes.test.ts` 增加测试：

```ts
test("POST /collector/v1/auth/login activates a collector device for admin users", async () => {
  const { app } = await createAuthApp();
  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/auth/login",
    payload: {
      email: "admin@example.com",
      password: "secret",
      sellerAccountExternalId: "seller-demo",
      deviceExternalId: "chrome-extension-demo",
      deviceName: "Chrome Extension"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(typeof response.json().token, "string");
  assert.equal(response.json().device.externalDeviceId, "chrome-extension-demo");
  assert.equal("tokenHash" in response.json().device, false);
});
```

- [x] **步骤 2：运行测试验证失败**

运行：

```bash
npm run build -w @wangwang/env
npm run build -w @wangwang/database
node --import tsx --test apps/server/test/auth-routes.test.ts
```

预期：FAIL，返回 404。

- [x] **步骤 3：实现请求字段读取**

在 `apps/server/src/server.ts` 增加请求字段：

```ts
const email = bodyStringField(request.body, "email");
const password = bodyStringField(request.body, "password");
const sellerAccountExternalId = bodyStringField(request.body, "sellerAccountExternalId");
const deviceExternalId = bodyStringField(request.body, "deviceExternalId");
const deviceName = bodyStringField(request.body, "deviceName");
```

当 `email`、`password`、`sellerAccountExternalId`、`deviceExternalId` 任一缺失时返回：

```ts
return reply.code(400).send({ ok: false, error: "invalid_collector_login_request" });
```

- [x] **步骤 4：实现凭据和角色校验**

复用 `getInternalUserCredentials`、`verifyPassword` 和 `requireRole` 的规则。只允许 `admin` 激活采集设备：

```ts
const credentials = await store.getInternalUserCredentials({ email });
if (!credentials || !(await verifyPassword(password, credentials.passwordHash))) {
  await appendLoginFailedAuditLog(store, email);
  return reply.code(401).send({ ok: false, error: "invalid_credentials" });
}

if (!credentials.roles.some((role) => adminRoles.includes(role))) {
  return reply.code(403).send({ ok: false, error: "forbidden" });
}
```

- [x] **步骤 5：创建设备并返回 collector token**

调用 `store.registerCollectorDevice`：

```ts
const registered = await store.registerCollectorDevice({
  sellerAccountExternalId,
  externalDeviceId: deviceExternalId,
  deviceName: deviceName || undefined
});

return {
  ok: true,
  token: registered.token,
  device: publicCollectorDevice(registered)
};
```

- [x] **步骤 6：补充错误路径测试**

在 `apps/server/test/auth-routes.test.ts` 增加两条测试：

```ts
test("POST /collector/v1/auth/login rejects invalid credentials", async () => {
  const { app } = await createAuthApp();
  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/auth/login",
    payload: {
      email: "admin@example.com",
      password: "wrong",
      sellerAccountExternalId: "seller-demo",
      deviceExternalId: "chrome-extension-demo"
    }
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false, error: "invalid_credentials" });
});

test("POST /collector/v1/auth/login rejects non-admin users", async () => {
  const { app, store } = await createAuthApp();
  await store.createInternalUser({
    email: "sales@example.com",
    displayName: "Sales User",
    passwordHash: await hashPassword("secret"),
    roles: ["sales"]
  });

  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/auth/login",
    payload: {
      email: "sales@example.com",
      password: "secret",
      sellerAccountExternalId: "seller-demo",
      deviceExternalId: "chrome-extension-demo"
    }
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { ok: false, error: "forbidden" });
});
```

- [x] **步骤 7：移除静态采集 token 认证分支**

在 `apps/server/src/server.ts` 中删除 `CreateServerOptions` 和 `CreateServerFromEnvOptions` 上的 `deviceTokens` 字段，删除 `envDeviceTokens` 和 `isBearerAuthorized`。`/collector/v1/sync-batches` 改为只通过数据库中的 collector token 认证：

```ts
app.post("/collector/v1/sync-batches", async (request, reply) => {
  if (!(await isCollectorAuthorized(request.headers.authorization || "", store))) {
    return reply.code(401).send({ ok: false, error: "unauthorized" });
  }

  const batch = request.body as SyncBatch;
  if (!isValidSyncBatch(batch)) {
    return reply.code(400).send({ ok: false, error: "invalid_sync_batch" });
  }

  const result = await store.acceptSyncBatch(batch);
  return {
    ok: true,
    ...result
  };
});
```

`createServerFromEnv` 不再读取环境变量静态 token：

```ts
return createServer({
  store,
  aiJobQueue,
  logger: options.logger
});
```

`isCollectorAuthorized` 只查数据库设备：

```ts
async function isCollectorAuthorized(authorization: string, store: SyncStore): Promise<boolean> {
  const token = bearerToken(authorization);
  if (!token) return false;

  return Boolean(await store.authenticateCollectorDevice(token));
}
```

- [x] **步骤 8：更新服务端测试移除静态 token 依赖**

在 `apps/server/test/sync-batches.test.ts` 中新增测试辅助函数，所有成功上传都先注册设备：

```ts
async function createCollectorToken(store: InMemorySyncStore): Promise<string> {
  const registered = await store.registerCollectorDevice({
    sellerAccountExternalId: "seller-1",
    externalDeviceId: "device-1",
    deviceName: "Test Device",
    token: "device-token"
  });
  return registered.token;
}
```

每个成功上传测试改为：

```ts
const store = new InMemorySyncStore();
const token = await createCollectorToken(store);
const app = await createServer({ store });

const response = await app.inject({
  method: "POST",
  url: "/collector/v1/sync-batches",
  headers: { authorization: `Bearer ${token}` },
  payload
});
```

对 `apps/server/test/customer-collaboration-routes.test.ts`、`apps/server/test/customer-assignment-routes.test.ts`、`apps/server/test/internal-query-routes.test.ts` 和 `apps/server/test/ai-routes.test.ts` 执行同样替换：删除 `createServer({ store, deviceTokens: ["device-token"] })`，在创建 app 前调用测试辅助函数注册设备，上传测试数据时使用返回的 collector token。

示例替换：

```ts
const token = await createCollectorToken(store);
const app = await createServer({ store });
await app.inject({
  method: "POST",
  url: "/collector/v1/sync-batches",
  headers: { authorization: `Bearer ${token}` },
  payload: syncPayload
});
```

在 `apps/server/test/auth-routes.test.ts` 中，`session tokens can access internal APIs while collector tokens cannot` 测试也先注册 collector token，再验证 collector token 仍不能访问 `/internal/v1/customers`。

删除 `apps/server/test/collector-device-routes.test.ts` 中的测试：

```ts
test("static collector device tokens remain available as a development fallback", async () => {
  // delete this test
});
```

在 `apps/server/test/server-bootstrap.test.ts` 中删除 `deviceTokens` 参数。`createServerFromEnv` 的测试只验证 store 选择、migration 执行和 `/health`，不再依赖静态 token 上传：

```ts
const app = await createServerFromEnv({ env: {} });
const response = await app.inject({ method: "GET", url: "/health" });
assert.equal(response.statusCode, 200);
```

- [x] **步骤 9：运行服务端测试验证通过**

运行：

```bash
npm test -w @wangwang/server
```

预期：PASS。

- [x] **步骤 10：Commit**

```bash
git add apps/server/src/server.ts apps/server/test/auth-routes.test.ts apps/server/test/collector-device-routes.test.ts apps/server/test/sync-batches.test.ts apps/server/test/customer-collaboration-routes.test.ts apps/server/test/customer-assignment-routes.test.ts apps/server/test/internal-query-routes.test.ts apps/server/test/ai-routes.test.ts apps/server/test/server-bootstrap.test.ts
git commit -m "feat(server): 支持采集端账号密码激活"
```

## 任务 3：改造 Chrome 插件激活页

**文件：**
- 修改：`apps/chrome-extension/src/shared/sync-types.ts`
- 修改：`apps/chrome-extension/src/background/tradebridge-client.ts`
- 修改：`apps/chrome-extension/src/background/storage.ts`
- 修改：`apps/chrome-extension/src/options/options.html`
- 修改：`apps/chrome-extension/src/options/options.ts`
- 测试：`apps/chrome-extension/test/tradebridge-client.test.ts`
- 测试：`apps/chrome-extension/test/sync-orchestrator.test.ts`

- [x] **步骤 1：编写失败的激活客户端测试**

在 `apps/chrome-extension/test/tradebridge-client.test.ts` 增加测试：

```ts
test("activateCollectorDevice posts credentials and device metadata", async () => {
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({
      ok: true,
      token: "collector-token",
      device: {
        id: "collector-device-1",
        externalDeviceId: "chrome-extension-demo",
        sellerAccountExternalId: "seller-demo",
        deviceName: "Chrome Extension",
        status: "active"
      }
    });
  };

  const result = await activateCollectorDevice({
    serverUrl: "http://127.0.0.1:5032",
    email: "admin@example.com",
    password: "secret",
    sellerAccountExternalId: "seller-demo",
    deviceExternalId: "chrome-extension-demo",
    deviceName: "Chrome Extension"
  });

  assert.equal(result.token, "collector-token");
  assert.equal(requests[0].url, "http://127.0.0.1:5032/collector/v1/auth/login");
});
```

- [x] **步骤 2：运行测试验证失败**

运行：

```bash
npm run build -w @wangwang/onetalk-adapter
node --import tsx --test apps/chrome-extension/test/tradebridge-client.test.ts
```

预期：FAIL，`activateCollectorDevice` 未导出。

- [x] **步骤 3：增加插件类型**

在 `apps/chrome-extension/src/shared/sync-types.ts` 增加：

```ts
export interface CollectorActivationInput {
  serverUrl: string;
  email: string;
  password: string;
  sellerAccountExternalId: string;
  deviceExternalId: string;
  deviceName?: string;
}

export interface CollectorActivationResult {
  token: string;
  device: {
    id: string;
    externalDeviceId: string;
    sellerAccountExternalId?: string;
    deviceName?: string;
    status: string;
  };
}
```

- [x] **步骤 4：实现激活请求**

在 `apps/chrome-extension/src/background/tradebridge-client.ts` 增加：

```ts
export async function activateCollectorDevice(input: CollectorActivationInput): Promise<CollectorActivationResult> {
  const response = await fetch(new URL("/collector/v1/auth/login", input.serverUrl).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      sellerAccountExternalId: input.sellerAccountExternalId,
      deviceExternalId: input.deviceExternalId,
      deviceName: input.deviceName
    })
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401) throw new Error("invalid_credentials");
  if (response.status === 403) throw new Error("forbidden");
  if (!response.ok || !isActivationResponse(body)) throw new Error("collector_activation_failed");
  return { token: body.token, device: body.device };
}
```

- [x] **步骤 5：更新插件设置页 HTML**

在 `apps/chrome-extension/src/options/options.html` 中将 token 输入替换为账号密码激活表单：

```html
<label>Server URL <input name="serverUrl" value="http://127.0.0.1:5032" /></label>
<label>邮箱 <input name="email" type="email" /></label>
<label>密码 <input name="password" type="password" /></label>
<label>Seller Account <input name="sellerAccountExternalId" /></label>
<label>Device ID <input name="deviceExternalId" /></label>
<label>Device Name <input name="deviceName" /></label>
<button type="submit">激活采集端</button>
```

- [x] **步骤 6：更新插件设置页逻辑**

在 `apps/chrome-extension/src/options/options.ts` 中提交表单后调用 `activateCollectorDevice`，保存返回的 collector token：

```ts
const activation = await activateCollectorDevice({
  serverUrl,
  email,
  password,
  sellerAccountExternalId,
  deviceExternalId,
  deviceName
});

await store.saveConfig({
  serverUrl,
  sellerAccountExternalId,
  deviceId: activation.device.externalDeviceId,
  deviceName: activation.device.deviceName,
  collectorToken: activation.token
});
```

- [x] **步骤 7：更新未激活错误码**

在 `apps/chrome-extension/src/background/storage.ts` 中把配置缺失错误改为更贴近 UI 的名称：

```ts
throw new Error("collector_activation_required");
```

同步更新 `apps/chrome-extension/test/sync-orchestrator.test.ts` 的断言。

- [x] **步骤 8：运行插件测试验证通过**

运行：

```bash
npm test -w @wangwang/chrome-extension
```

预期：PASS。

- [x] **步骤 9：Commit**

```bash
git add apps/chrome-extension/src/shared/sync-types.ts apps/chrome-extension/src/background/tradebridge-client.ts apps/chrome-extension/src/background/storage.ts apps/chrome-extension/src/options/options.html apps/chrome-extension/src/options/options.ts apps/chrome-extension/test/tradebridge-client.test.ts apps/chrome-extension/test/sync-orchestrator.test.ts
git commit -m "feat(chrome-extension): 支持账号密码激活采集端"
```

## 任务 4：改造桌面采集端激活配置

**文件：**
- 修改：`apps/collector-desktop/src/collector.ts`
- 修改：`apps/collector-desktop/src/electron-main.ts`
- 修改：`apps/collector-desktop/src/electron-shell.ts`
- 测试：`apps/collector-desktop/test/collector.test.ts`
- 测试：`apps/collector-desktop/test/electron-shell.test.ts`

- [x] **步骤 1：编写 collector 回归测试**

在 `apps/collector-desktop/test/collector.test.ts` 增加测试：

```ts
test("collectOnce uses activated collector token for upload", async () => {
  const uploads: Request[] = [];
  const result = await collectOnce({
    serverUrl: "http://127.0.0.1:5032",
    sellerAccountExternalId: "seller-demo",
    collectorDeviceId: "desktop-demo",
    collectorToken: "collector-token",
    fetchImpl: async (input, init) => {
      uploads.push(new Request(input, init));
      return Response.json({
        ok: true,
        acceptedCount: 0,
        rejectedCount: 0,
        nextCursor: null,
        warnings: []
      });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(uploads[0].headers.get("authorization"), "Bearer collector-token");
});
```

- [x] **步骤 2：运行测试验证当前行为**

运行：

```bash
npm run build -w @wangwang/env
node --import tsx --test apps/collector-desktop/test/collector.test.ts
```

预期：PASS，确认桌面采集端上传仍只依赖 collector token。

- [x] **步骤 3：在桌面入口展示激活状态**

在 `apps/collector-desktop/src/electron-main.ts` 中读取：

```ts
WANGWANG_COLLECTOR_TOKEN
WANGWANG_COLLECTOR_DEVICE_ID
WANGWANG_SELLER_ACCOUNT_ID
```

当 token 缺失时，状态文案显示 `collector_activation_required`，同步按钮不可触发上传。

- [x] **步骤 4：保持同步只使用 collector token**

确认 `apps/collector-desktop/src/collector.ts` 上传时只发送：

```ts
Authorization: Bearer ${collectorToken}
```

不能发送邮箱、密码、internal session token、OneTalk Cookie 或 OneTalk token。

- [x] **步骤 5：运行桌面采集端测试验证通过**

运行：

```bash
npm test -w @wangwang/collector-desktop
```

预期：PASS。

- [x] **步骤 6：Commit**

```bash
git add apps/collector-desktop/src/collector.ts apps/collector-desktop/src/electron-main.ts apps/collector-desktop/src/electron-shell.ts apps/collector-desktop/test/collector.test.ts apps/collector-desktop/test/electron-shell.test.ts
git commit -m "feat(collector-desktop): 明确采集端激活状态"
```

## 任务 5：更新文档和本地试运行流程

**文件：**
- 修改：`docs/ENVIRONMENT.md`
- 修改：`docs/chrome-extension-trial-runbook.md`
- 修改：`docs/internal-trial-runbook.md`
- 修改：`.env.example`

- [x] **步骤 1：更新环境变量文档**

在 `docs/ENVIRONMENT.md` 中写明：

```markdown
项目不再支持 `WANGWANG_DEVICE_TOKENS` 静态采集 token。Chrome 插件和桌面采集端必须通过 `/collector/v1/auth/login` 激活并保存返回的 collector token。
```

- [x] **步骤 2：更新 Chrome 插件手册**

在 `docs/chrome-extension-trial-runbook.md` 中替换手动 token 流程：

```markdown
1. 打开插件设置页。
2. 填写 Server URL、管理员邮箱、管理员密码、Seller Account、Device ID 和 Device Name。
3. 点击“激活采集端”。
4. 插件保存服务端返回的 collector token。
5. 打开 OneTalk 页面并点击插件同步。
```

- [x] **步骤 3：更新完整试运行手册**

在 `docs/internal-trial-runbook.md` 中增加采集端激活接口示例：

```bash
curl -X POST http://127.0.0.1:5032/collector/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin@example.com",
    "password": "change-me-password",
    "sellerAccountExternalId": "seller-demo",
    "deviceExternalId": "chrome-extension-demo",
    "deviceName": "Chrome Extension"
  }'
```

- [x] **步骤 4：更新 `.env.example`**

删除 `WANGWANG_DEVICE_TOKENS`，并将 `WANGWANG_COLLECTOR_TOKEN` 说明改为激活后写入：

```dotenv
# 使用 /collector/v1/auth/login 返回的 token。
WANGWANG_COLLECTOR_TOKEN=change-me-activated-collector-token
```

- [x] **步骤 5：运行文档关键词检查**

运行：

```bash
rg -n "Org ID|WANGWANG_SETUP_TOKEN|WANGWANG_DEVICE_TOKENS|手动填写 Collector Token|手动填写 collector token" docs .env.example -g '!docs/superpowers/**'
```

预期：除历史计划和规格归档外，不再出现 `Org ID`、`WANGWANG_SETUP_TOKEN`、`WANGWANG_DEVICE_TOKENS` 或过期的 Chrome 插件手动 token 主流程描述。

- [x] **步骤 6：Commit**

```bash
git add docs/ENVIRONMENT.md docs/chrome-extension-trial-runbook.md docs/internal-trial-runbook.md .env.example
git commit -m "docs: 更新采集端激活测试流程"
```

## 任务 6：端到端验证

**文件：**
- 修改：`test/e2e/internal-trial.test.ts`

- [x] **步骤 1：扩展 E2E 流程**

在 `test/e2e/internal-trial.test.ts` 中加入采集端激活请求：

```ts
const activationResponse = await app.inject({
  method: "POST",
  url: "/collector/v1/auth/login",
  payload: {
    email: "admin@example.com",
    password: "change-me-password",
    sellerAccountExternalId: "seller-demo",
    deviceExternalId: "chrome-extension-demo",
    deviceName: "Chrome Extension"
  }
});

assert.equal(activationResponse.statusCode, 200);
const collectorToken = activationResponse.json().token;
```

使用 `collectorToken` 上传 sync batch，不再使用任何静态采集 token。

- [x] **步骤 2：运行 E2E 验证通过**

运行：

```bash
npm run test:e2e
```

预期：PASS。

- [x] **步骤 3：修复 E2E 暴露的集成问题**

如果 E2E 暴露设备字段不一致，统一使用：

```ts
deviceExternalId: "chrome-extension-demo"
device.deviceId: "chrome-extension-demo"
sellerAccount.externalAccountId: "seller-demo"
```

- [x] **步骤 4：运行全量验证**

运行：

```bash
npm test -w @wangwang/database
npm test -w @wangwang/server
npm test -w @wangwang/chrome-extension
npm test -w @wangwang/collector-desktop
npm run typecheck
npm run test:e2e
```

预期：全部 PASS。

- [x] **步骤 5：Commit**

```bash
git add test/e2e/internal-trial.test.ts
git commit -m "test: 覆盖采集端账号密码激活流程"
```

## 验收标准

- Web 管理后台继续通过 `/internal/v1/auth/login` 获取 internal session token。
- Chrome 插件设置页不再要求用户手动粘贴 collector token。
- Chrome 插件通过 `/collector/v1/auth/login` 提交账号密码和设备信息并保存返回的 collector token。
- 桌面采集端同步请求只使用 collector token，不发送账号密码。
- `/collector/v1/sync-batches` 不接受 internal session token。
- `/collector/v1/sync-batches` 不接受环境变量静态 token，只接受数据库中 active 采集设备的 collector token。
- collector token 和设备外部 ID 在数据库中是不同字段。
- 服务端响应不暴露 `tokenHash`。
- 运行代码、测试、当前手册和 `.env.example` 中不再出现 `WANGWANG_DEVICE_TOKENS`；历史 `docs/superpowers/**` 归档不作为运行依据。

## 风险与处理

- 采集端账号密码激活会让插件短暂接触管理员密码。实现时密码只能用于本次请求，不能保存到 `chrome.storage.local`、localStorage、日志或 sync batch。
- 当前 Postgres 同步逻辑存在设备 ID 与 token hash 语义混用风险。任务 1 必须先完成，否则激活流程会生成一个设备，首次同步又可能创建另一个设备。
- 如果真实 OneTalk 请求继续失败，先查看插件 `tradebridgeStatus.lastError.code`。本计划只改 TradeBridge 鉴权流程，不改变 OneTalk 登录态获取策略。
