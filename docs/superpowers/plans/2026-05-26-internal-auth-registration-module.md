# 内部登录与账号管理模块实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 建立只依赖邮箱密码登录的内部账号体系，覆盖首个管理员初始化、管理员创建用户、邀请激活、登录、登出、禁用、重置密码和 Web 用户管理。

**架构：** `apps/server` 是唯一内部鉴权边界，`packages/database` 负责保存用户、角色、邀请和会话状态。删除开发管理 token 登录路径，内部 API 只能接受登录后签发的 session token；`WANGWANG_SETUP_TOKEN` 只用于创建第一个管理员，初始化完成后应删除或置空。前端只保留账号密码登录、首次初始化和管理员用户管理界面。

**技术栈：** TypeScript、Fastify、PostgreSQL、React/Vite、`node:test`、Node `crypto.scrypt`、现有 `packages/database` Store 接口。

---

## 文件结构

- 修改：`packages/database/src/sync-types.ts`
  - 增加内部用户凭据、用户更新、会话吊销、邀请创建/接受等类型。
- 修改：`packages/database/src/sync-store.ts`
  - 增加内存版用户列表、凭据查询、用户更新、会话吊销、邀请创建/查询/接受。
- 修改：`packages/database/src/postgres-sync-store.ts`
  - 增加 PostgreSQL 版用户列表、凭据查询、用户更新、会话吊销、邀请创建/查询/接受。
- 修改：`packages/database/migrations/001_internal_sync_schema.sql`
  - 增加 `user_invitation` 表和邀请查询索引。
- 修改：`packages/database/test/sync-store.test.ts`
  - 覆盖内存 Store 的用户生命周期和邀请流程。
- 修改：`packages/database/test/postgres-sync-store.test.ts`
  - 覆盖 PostgreSQL Store 的 SQL 形态。
- 修改：`packages/database/test/migrations.test.ts`
  - 断言邀请表和索引进入迁移。
- 修改：`apps/server/src/auth.ts`
  - 将 SHA-256 密码哈希替换为带版本前缀的 `scrypt` 哈希与校验。
- 修改：`apps/server/src/server.ts`
  - 删除 `internalTokens`、`envInternalTokens()`、`WANGWANG_INTERNAL_API_TOKENS` 读取和 `bootstrapAuthContext()`。
  - 登录改为读取已存密码哈希并校验。
  - 增加登出、首个管理员初始化、用户管理和邀请 API。
- 修改：`apps/server/test/auth-routes.test.ts`
  - 覆盖登录、登出、首个管理员初始化、用户管理、邀请接受、遗留开发 token 拒绝。
- 修改：`apps/server/test/ai-routes.test.ts`
- 修改：`apps/server/test/collector-device-routes.test.ts`
- 修改：`apps/server/test/customer-assignment-routes.test.ts`
- 修改：`apps/server/test/customer-collaboration-routes.test.ts`
- 修改：`apps/server/test/internal-query-routes.test.ts`
  - 将 `Bearer internal-token` / `Bearer bootstrap-token` 全部改为真实账号登录后拿到的 session token。
- 修改：`apps/web/src/types.ts`
  - 增加设置管理员、内部用户、邀请、用户管理客户端类型。
- 修改：`apps/web/src/internal-api.ts`
  - 增加 setup、logout、用户管理、邀请相关客户端方法。
- 修改：`apps/web/src/App.tsx`
  - 删除开发 token 登录表单，增加首次初始化和管理员用户管理界面。
- 修改：`apps/web/src/styles.scss`
  - 增加初始化页和用户管理区样式。
- 修改：`apps/web/test/internal-api.test.ts`
  - 覆盖新增 Web API client 方法。
- 修改：`apps/web/test/customer-workflow.test.tsx`
  - 覆盖纯账号密码登录、初始化管理员、用户管理渲染。
- 修改：`.env.example`
  - 删除 `WANGWANG_INTERNAL_API_TOKENS`，增加 `WANGWANG_SETUP_TOKEN`。
- 修改：`docs/ENVIRONMENT.md`
  - 删除内部 API 管理 token 文档，改为说明首个管理员初始化与登录。
- 修改：`docs/internal-trial-runbook.md`
  - 删除 `dev-admin-token` 流程，改为首个管理员初始化和账号密码登录流程。

---

### 任务 1：补齐数据库账号和会话契约

**文件：**
- 修改：`packages/database/src/sync-types.ts`
- 修改：`packages/database/src/sync-store.ts`
- 修改：`packages/database/test/sync-store.test.ts`

- [ ] **步骤 1：编写失败的内存 Store 测试**

在 `packages/database/test/sync-store.test.ts` 追加：

```ts
test("internal users can be listed, updated, disabled, reset, and resolved for credential checks", async () => {
  const store = new InMemorySyncStore();
  const created = await store.createInternalUser({
    orgId: "org_internal",
    email: "Admin@Example.com",
    displayName: "Admin User",
    passwordHash: "scrypt$hash-1",
    roles: ["admin"]
  });

  assert.equal(created.email, "admin@example.com");

  const credentials = await store.getInternalUserCredentials({
    orgId: "org_internal",
    email: "ADMIN@example.com"
  });
  assert.equal(credentials?.passwordHash, "scrypt$hash-1");

  const users = await store.listInternalUsers("org_internal");
  assert.equal(users.length, 1);
  assert.equal(users[0].email, "admin@example.com");
  assert.equal("passwordHash" in users[0], false);

  const disabled = await store.updateInternalUser({
    orgId: "org_internal",
    userId: created.id,
    status: "disabled"
  });
  assert.equal(disabled.status, "disabled");

  await assert.rejects(
    () =>
      store.issueInternalSession({
        orgId: "org_internal",
        email: "admin@example.com",
        passwordHash: "scrypt$hash-1"
      }),
    /invalid_credentials/
  );

  const reset = await store.updateInternalUser({
    orgId: "org_internal",
    userId: created.id,
    passwordHash: "scrypt$hash-2",
    status: "active",
    roles: ["supervisor", "sales"]
  });
  assert.deepEqual(reset.roles, ["supervisor", "sales"]);
  assert.equal(
    (await store.getInternalUserCredentials({ orgId: "org_internal", email: "admin@example.com" }))?.passwordHash,
    "scrypt$hash-2"
  );

  const session = await store.issueInternalSession({
    orgId: "org_internal",
    email: "admin@example.com",
    passwordHash: "scrypt$hash-2",
    token: "session-token"
  });
  assert.equal(session.token, "session-token");
  assert.equal(await store.revokeInternalSession({ token: "session-token" }), true);
  assert.equal(await store.getInternalSession("session-token"), null);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
npm test -w @wangwang/database
```

预期：失败信息包含 `getInternalUserCredentials`、`listInternalUsers`、`updateInternalUser` 或 `revokeInternalSession` 未定义。

- [ ] **步骤 3：增加数据库类型**

在 `packages/database/src/sync-types.ts` 的 `CreateInternalUserInput` 后加入：

```ts
export interface InternalUserCredentials extends InternalUser {
  passwordHash: string;
}

export interface GetInternalUserCredentialsInput {
  orgId: string;
  email: string;
}

export interface UpdateInternalUserInput {
  orgId: string;
  userId: string;
  displayName?: string;
  passwordHash?: string;
  roles?: InternalRole[];
  status?: "pending" | "active" | "disabled";
}

export interface RevokeInternalSessionInput {
  token: string;
}
```

- [ ] **步骤 4：实现内存 Store 方法**

在 `packages/database/src/sync-store.ts` 中导入新增类型，并加入方法：

```ts
async listInternalUsers(orgId: string): Promise<InternalUser[]> {
  return Array.from(this.internalUsers.values())
    .filter((user) => user.orgId === orgId)
    .map(toPublicInternalUser)
    .sort((left, right) => left.email.localeCompare(right.email));
}

async getInternalUserCredentials(input: GetInternalUserCredentialsInput): Promise<InternalUserCredentials | null> {
  const user = this.internalUsers.get(internalUserKey(input.orgId, input.email.trim().toLowerCase()));
  return user ? { ...toPublicInternalUser(user), passwordHash: user.passwordHash } : null;
}

async updateInternalUser(input: UpdateInternalUserInput): Promise<InternalUser> {
  const existing = Array.from(this.internalUsers.values()).find(
    (user) => user.orgId === input.orgId && user.id === input.userId
  );
  if (!existing) throw new Error("internal_user_not_found");

  const updated: InternalUser & { passwordHash: string } = {
    ...existing,
    displayName: input.displayName ?? existing.displayName,
    passwordHash: input.passwordHash ?? existing.passwordHash,
    roles: input.roles ?? existing.roles,
    status: input.status ?? existing.status,
    updatedAt: new Date().toISOString()
  };
  this.internalUsers.set(internalUserKey(updated.orgId, updated.email), updated);
  return toPublicInternalUser(updated);
}

async revokeInternalSession(input: RevokeInternalSessionInput): Promise<boolean> {
  return this.internalSessions.delete(hashContent(input.token));
}
```

同时将 `createInternalUser()` 的开头改为邮箱归一化后的完整赋值：

```ts
async createInternalUser(input: CreateInternalUserInput): Promise<InternalUser> {
  const now = new Date().toISOString();
  const normalizedEmail = input.email.trim().toLowerCase();
  const key = internalUserKey(input.orgId, normalizedEmail);
  const existing = this.internalUsers.get(key);
  const user: InternalUser & { passwordHash: string } = {
    id: existing?.id || this.nextInternalUserId(),
    orgId: input.orgId,
    email: normalizedEmail,
    displayName: input.displayName,
    status: input.status || "active",
    roles: input.roles ?? ["sales"],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    passwordHash: input.passwordHash
  };
  this.internalUsers.set(key, user);
  return toPublicInternalUser(user);
}
```

- [ ] **步骤 5：运行数据库测试并提交**

运行：

```bash
npm test -w @wangwang/database
```

预期：新增内存 Store 测试通过。

提交：

```bash
git add packages/database/src/sync-types.ts packages/database/src/sync-store.ts packages/database/test/sync-store.test.ts
git commit -m "feat: add internal user lifecycle store methods"
```

---

### 任务 2：增加邀请存储和 PostgreSQL 实现

**文件：**
- 修改：`packages/database/migrations/001_internal_sync_schema.sql`
- 修改：`packages/database/src/sync-types.ts`
- 修改：`packages/database/src/sync-store.ts`
- 修改：`packages/database/src/postgres-sync-store.ts`
- 修改：`packages/database/test/sync-store.test.ts`
- 修改：`packages/database/test/postgres-sync-store.test.ts`
- 修改：`packages/database/test/migrations.test.ts`

- [ ] **步骤 1：编写邀请流程测试**

在 `packages/database/test/sync-store.test.ts` 追加：

```ts
test("internal user invitations can be created, inspected, and accepted once", async () => {
  const store = new InMemorySyncStore();
  const invitation = await store.createUserInvitation({
    orgId: "org_internal",
    email: "Invitee@Example.com",
    displayName: "Invitee",
    roles: ["sales"],
    createdByUserId: "admin-1",
    token: "invite-token",
    expiresAt: "2030-01-01T00:00:00.000Z"
  });

  assert.equal(invitation.email, "invitee@example.com");
  assert.equal(invitation.token, "invite-token");
  assert.equal("tokenHash" in invitation, false);

  const inspected = await store.getUserInvitation("invite-token");
  assert.equal(inspected?.email, "invitee@example.com");

  const accepted = await store.acceptUserInvitation({
    token: "invite-token",
    passwordHash: "scrypt$password"
  });
  assert.equal(accepted.user.email, "invitee@example.com");
  assert.equal(accepted.invitation.acceptedAt !== undefined, true);

  await assert.rejects(
    () => store.acceptUserInvitation({ token: "invite-token", passwordHash: "scrypt$password" }),
    /invitation_already_accepted/
  );
});
```

- [ ] **步骤 2：增加邀请类型**

在 `packages/database/src/sync-types.ts` 加入：

```ts
export interface CreateUserInvitationInput {
  orgId: string;
  email: string;
  displayName: string;
  roles: InternalRole[];
  createdByUserId?: string;
  token?: string;
  expiresAt?: string;
}

export interface StoredUserInvitation {
  id: string;
  orgId: string;
  email: string;
  displayName: string;
  roles: InternalRole[];
  token?: string;
  createdByUserId?: string;
  expiresAt: string;
  acceptedAt?: string;
  createdAt: string;
}

export interface AcceptUserInvitationInput {
  token: string;
  passwordHash: string;
}

export interface AcceptUserInvitationResult {
  invitation: StoredUserInvitation;
  user: InternalUser;
}
```

- [ ] **步骤 3：加入数据库迁移**

在 `packages/database/migrations/001_internal_sync_schema.sql` 的 `internal_session` 表后加入：

```sql
CREATE TABLE IF NOT EXISTS user_invitation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  roles TEXT[] NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, email, token_hash)
);

CREATE INDEX IF NOT EXISTS idx_user_invitation_email ON user_invitation (org_id, email);
CREATE INDEX IF NOT EXISTS idx_user_invitation_token_hash ON user_invitation (token_hash);
```

- [ ] **步骤 4：实现内存和 PostgreSQL 邀请方法**

在 `InMemorySyncStore` 加入 `userInvitations` Map，并实现：

```ts
async createUserInvitation(input: CreateUserInvitationInput): Promise<StoredUserInvitation> {
  const now = new Date().toISOString();
  const token = input.token || crypto.randomBytes(32).toString("hex");
  const invitation = {
    id: this.nextInternalUserId().replace("user_", "inv_"),
    orgId: input.orgId,
    email: input.email.trim().toLowerCase(),
    displayName: input.displayName,
    roles: input.roles,
    token,
    tokenHash: hashContent(token),
    createdByUserId: input.createdByUserId,
    expiresAt: input.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now
  };
  this.userInvitations.set(invitation.tokenHash, invitation);
  const { tokenHash, ...publicInvitation } = invitation;
  return publicInvitation;
}

async getUserInvitation(token: string): Promise<StoredUserInvitation | null> {
  const invitation = this.userInvitations.get(hashContent(token));
  if (!invitation || invitation.acceptedAt || Date.parse(invitation.expiresAt) <= Date.now()) return null;
  const { tokenHash, token: rawToken, ...publicInvitation } = invitation;
  return publicInvitation;
}

async acceptUserInvitation(input: AcceptUserInvitationInput): Promise<AcceptUserInvitationResult> {
  const tokenHash = hashContent(input.token);
  const invitation = this.userInvitations.get(tokenHash);
  if (!invitation) throw new Error("invitation_not_found");
  if (invitation.acceptedAt) throw new Error("invitation_already_accepted");
  if (Date.parse(invitation.expiresAt) <= Date.now()) throw new Error("invitation_expired");

  const user = await this.createInternalUser({
    orgId: invitation.orgId,
    email: invitation.email,
    displayName: invitation.displayName,
    passwordHash: input.passwordHash,
    roles: invitation.roles,
    status: "active"
  });
  invitation.acceptedAt = new Date().toISOString();
  const { tokenHash: hiddenHash, token: rawToken, ...publicInvitation } = invitation;
  return { invitation: publicInvitation, user };
}
```

在 `PostgresSyncStore` 中使用 SQL 注释标记 `/* create_user_invitation */`、`/* get_user_invitation */`、`/* accept_user_invitation */`，并保证返回值不包含 `tokenHash`。

- [ ] **步骤 5：补充 PostgreSQL SQL 形态测试**

在 `packages/database/test/postgres-sync-store.test.ts` 加入测试，断言 SQL 标记出现：

```ts
test("PostgresSyncStore supports internal user management and invitations", async () => {
  const client = new FakeSqlClient();
  const store = new PostgresSyncStore(client);

  client.queueRows("list_internal_users", []);
  await store.listInternalUsers("org_internal");

  client.queueRows("get_internal_user_credentials", []);
  await store.getInternalUserCredentials({ orgId: "org_internal", email: "admin@example.com" });

  client.queueRows("create_user_invitation", [{
    id: "inv-1",
    orgId: "org_internal",
    email: "invitee@example.com",
    displayName: "Invitee",
    roles: ["sales"],
    expiresAt: "2030-01-01T00:00:00.000Z",
    acceptedAt: null,
    createdAt: "2026-05-26T00:00:00.000Z"
  }]);
  await store.createUserInvitation({
    orgId: "org_internal",
    email: "invitee@example.com",
    displayName: "Invitee",
    roles: ["sales"],
    token: "invite-token"
  });

  assert.match(client.sqlText(), /list_internal_users/);
  assert.match(client.sqlText(), /get_internal_user_credentials/);
  assert.match(client.sqlText(), /create_user_invitation/);
});
```

- [ ] **步骤 6：运行数据库测试并提交**

运行：

```bash
npm test -w @wangwang/database
```

预期：数据库包测试全部通过。

提交：

```bash
git add packages/database/migrations/001_internal_sync_schema.sql packages/database/src/sync-types.ts packages/database/src/sync-store.ts packages/database/src/postgres-sync-store.ts packages/database/test/sync-store.test.ts packages/database/test/postgres-sync-store.test.ts packages/database/test/migrations.test.ts
git commit -m "feat: add internal user invitation storage"
```

---

### 任务 3：移除开发 token 鉴权并强化密码登录

**文件：**
- 修改：`apps/server/src/auth.ts`
- 修改：`apps/server/src/server.ts`
- 修改：`apps/server/test/auth-routes.test.ts`
- 修改：`apps/server/test/ai-routes.test.ts`
- 修改：`apps/server/test/collector-device-routes.test.ts`
- 修改：`apps/server/test/customer-assignment-routes.test.ts`
- 修改：`apps/server/test/customer-collaboration-routes.test.ts`
- 修改：`apps/server/test/internal-query-routes.test.ts`

- [ ] **步骤 1：编写失败的 server 鉴权测试**

在 `apps/server/test/auth-routes.test.ts` 追加：

```ts
test("legacy development bearer tokens cannot access internal APIs", async () => {
  const { app } = await createAuthApp();
  const response = await app.inject({
    method: "GET",
    url: "/internal/v1/me",
    headers: { authorization: "Bearer bootstrap-token" }
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false, error: "internal_unauthorized" });
});

test("POST /internal/v1/auth/logout revokes the current session", async () => {
  const { app } = await createAuthApp();
  const loginResponse = await login(app);
  const token = loginResponse.json().token;

  const logoutResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/auth/logout",
    headers: { authorization: `Bearer ${token}` }
  });
  const meResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/me",
    headers: { authorization: `Bearer ${token}` }
  });

  assert.equal(logoutResponse.statusCode, 200);
  assert.deepEqual(logoutResponse.json(), { ok: true });
  assert.equal(meResponse.statusCode, 401);
});
```

删除现有测试 `bootstrap internal tokens remain available as admin auth during development`。

- [ ] **步骤 2：运行 server 测试确认失败**

运行：

```bash
npm test -w @wangwang/server
```

预期：遗留 token 仍可登录、`hashPassword` 不是异步、`logout` 路由缺失或 Store 接口缺方法。

- [ ] **步骤 3：替换密码哈希实现**

将 `apps/server/src/auth.ts` 改为：

```ts
import crypto from "node:crypto";

const SCRYPT_PREFIX = "scrypt";
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt);
  return `${SCRYPT_PREFIX}$${salt}$${hash}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [version, salt, expected] = storedHash.split("$");
  if (version !== SCRYPT_PREFIX || !salt || !expected) return false;
  const actual = await scrypt(password, salt);
  return timingSafeEqual(actual, expected);
}

async function scrypt(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey.toString("hex"));
    });
  });
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
```

- [ ] **步骤 4：删除 server 内部开发 token 认证路径**

在 `apps/server/src/server.ts` 中执行这些精确变更：

- 从 `CreateServerOptions` 删除 `internalTokens?: string[]`。
- 从 `CreateServerFromEnvOptions` 删除 `internalTokens?: string[]`。
- 删除 `const internalTokens = new Set(options.internalTokens || envInternalTokens());`。
- 删除 `envInternalTokens()` 函数。
- 删除 `bootstrapAuthContext()`。
- 从 `InternalAuthContext` 删除 `bootstrap` 字段。
- 将所有 `requireInternalAuth(request, reply, store, internalTokens, roles)` 改为 `requireInternalAuth(request, reply, store, roles)`。
- 将所有 `requireInternalAuth(request, reply, store, internalTokens)` 改为 `requireInternalAuth(request, reply, store)`。
- 将 `auth.bootstrap ? undefined : auth.user.id` 改为 `auth.user.id`。

新的 `requireInternalAuth()` 应为：

```ts
async function requireInternalAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  store: SyncStore,
  allowedRoles?: InternalRole[]
): Promise<InternalAuthContext | null> {
  const token = bearerToken(request.headers.authorization || "");
  if (!token) {
    reply.code(401).send({ ok: false, error: "internal_unauthorized" });
    return null;
  }

  const auth = await sessionAuthContext(store, token);
  if (!auth) {
    reply.code(401).send({ ok: false, error: "internal_unauthorized" });
    return null;
  }

  if (allowedRoles && !requireRole(auth, allowedRoles)) {
    reply.code(403).send({ ok: false, error: "forbidden" });
    return null;
  }

  return auth;
}
```

- [ ] **步骤 5：修改登录和登出路由**

在 `/internal/v1/auth/login` 中使用 `verifyPassword()`：

```ts
const credentials = await store.getInternalUserCredentials({ orgId, email });
if (!credentials || !(await verifyPassword(password, credentials.passwordHash))) {
  await store.appendAuditLog({
    orgId,
    action: "auth.login.failed",
    targetType: "app_user",
    metadata: { email }
  });
  return reply.code(401).send({ ok: false, error: "invalid_credentials" });
}

const session = await store.issueInternalSession({
  orgId,
  email,
  passwordHash: credentials.passwordHash
});
await store.appendAuditLog({
  orgId,
  actorUserId: session.userId,
  action: "auth.login.succeeded",
  targetType: "app_user",
  targetId: session.userId
});
```

在 `/internal/v1/me` 后加入登出路由：

```ts
app.post("/internal/v1/auth/logout", async (request, reply) => {
  const auth = await requireInternalAuth(request, reply, store);
  if (!auth) return;

  const token = bearerToken(request.headers.authorization || "");
  if (token) await store.revokeInternalSession({ token });
  await store.appendAuditLog({
    orgId: auth.user.orgId,
    actorUserId: auth.user.id,
    action: "auth.logout",
    targetType: "app_user",
    targetId: auth.user.id
  });

  return { ok: true };
});
```

- [ ] **步骤 6：把所有 server 测试改为真实登录**

在相关测试文件中新增或复用这个帮助函数：

```ts
async function createInternalAuthHeaders(app: Awaited<ReturnType<typeof createServer>>) {
  const loginResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/auth/login",
    payload: {
      orgId: "org_internal",
      email: "admin@example.com",
      password: "secret"
    }
  });
  assert.equal(loginResponse.statusCode, 200);
  return { authorization: `Bearer ${loginResponse.json().token}` };
}
```

每个测试 app 初始化时创建管理员：

```ts
await store.createInternalUser({
  orgId: "org_internal",
  email: "admin@example.com",
  displayName: "Admin User",
  passwordHash: await hashPassword("secret"),
  roles: ["admin"]
});
```

将 `headers: { authorization: "Bearer internal-token" }` 和 `headers: { authorization: "Bearer bootstrap-token" }` 替换为 `headers: await createInternalAuthHeaders(app)`。每个 `createServer()` 调用的对象参数中只保留 `store`、`deviceTokens`、`aiProvider`、`aiJobQueue`、`logger` 等真实运行选项，删除 `internalTokens` 属性。

- [ ] **步骤 7：运行 server 测试并提交**

运行：

```bash
npm test -w @wangwang/server
```

预期：server 包测试全部通过。

提交：

```bash
git add apps/server/src/auth.ts apps/server/src/server.ts apps/server/test/auth-routes.test.ts apps/server/test/ai-routes.test.ts apps/server/test/collector-device-routes.test.ts apps/server/test/customer-assignment-routes.test.ts apps/server/test/customer-collaboration-routes.test.ts apps/server/test/internal-query-routes.test.ts
git commit -m "feat: require password sessions for internal APIs"
```

---

### 任务 4：实现首个管理员、用户管理和邀请 API

**文件：**
- 修改：`apps/server/src/server.ts`
- 修改：`apps/server/test/auth-routes.test.ts`

- [ ] **步骤 1：编写 setup、用户管理和邀请路由测试**

在 `apps/server/test/auth-routes.test.ts` 追加：

```ts
test("POST /internal/v1/setup/admin creates the first admin when setup token matches", async () => {
  const store = new InMemorySyncStore();
  const app = await createServer({ store, setupToken: "setup-token" });

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/setup/admin",
    headers: { authorization: "Bearer setup-token" },
    payload: {
      orgId: "org_internal",
      email: "owner@example.com",
      displayName: "Owner",
      password: "secret-password"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().user.email, "owner@example.com");
  assert.deepEqual(response.json().user.roles, ["admin"]);
});

test("admin users can create, list, disable, and reset users", async () => {
  const { app } = await createAuthApp();
  const headers = await createInternalAuthHeaders(app);

  const createResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/users",
    headers,
    payload: {
      orgId: "org_internal",
      email: "sales@example.com",
      displayName: "Sales User",
      password: "sales-secret",
      roles: ["sales"]
    }
  });
  const userId = createResponse.json().user.id;

  const listResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/users?orgId=org_internal",
    headers
  });
  const disableResponse = await app.inject({
    method: "POST",
    url: `/internal/v1/users/${userId}/disable`,
    headers,
    payload: { orgId: "org_internal" }
  });
  const resetResponse = await app.inject({
    method: "POST",
    url: `/internal/v1/users/${userId}/reset-password`,
    headers,
    payload: { orgId: "org_internal", password: "new-sales-secret" }
  });

  assert.equal(createResponse.statusCode, 200);
  assert.equal(listResponse.json().users.some((user: { email: string }) => user.email === "sales@example.com"), true);
  assert.equal(disableResponse.json().user.status, "disabled");
  assert.equal(resetResponse.json().user.status, "active");
});

test("admin users can invite users and invitees can accept", async () => {
  const { app } = await createAuthApp();
  const headers = await createInternalAuthHeaders(app);

  const inviteResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/invitations",
    headers,
    payload: {
      orgId: "org_internal",
      email: "invitee@example.com",
      displayName: "Invitee",
      roles: ["sales"]
    }
  });
  const token = inviteResponse.json().invitation.token;

  const inspectResponse = await app.inject({
    method: "GET",
    url: `/internal/v1/invitations/${token}`
  });
  const acceptResponse = await app.inject({
    method: "POST",
    url: `/internal/v1/invitations/${token}/accept`,
    payload: { password: "invitee-secret" }
  });

  assert.equal(inviteResponse.statusCode, 200);
  assert.equal(inspectResponse.json().invitation.email, "invitee@example.com");
  assert.equal(acceptResponse.json().user.email, "invitee@example.com");
  assert.equal(typeof acceptResponse.json().token, "string");
});
```

- [ ] **步骤 2：运行 server 测试确认失败**

运行：

```bash
npm test -w @wangwang/server
```

预期：`setup/admin`、`users`、`invitations` 路由返回 404 或 Store 方法缺失。

- [ ] **步骤 3：实现 setup 路由**

在 `CreateServerOptions` 和 `CreateServerFromEnvOptions` 加入：

```ts
setupToken?: string;
```

在 `createServerFromEnv()` 从环境读取：

```ts
setupToken: options.setupToken || env.WANGWANG_SETUP_TOKEN,
```

加入路由：

```ts
app.post("/internal/v1/setup/admin", async (request, reply) => {
  const setupToken = options.setupToken || "";
  if (!setupToken || bearerToken(request.headers.authorization || "") !== setupToken) {
    return reply.code(401).send({ ok: false, error: "setup_unauthorized" });
  }

  const orgId = bodyStringField(request.body, "orgId");
  const email = bodyStringField(request.body, "email");
  const displayName = bodyStringField(request.body, "displayName");
  const password = bodyStringField(request.body, "password");
  if (!orgId || !email || !displayName || !password) {
    return reply.code(400).send({ ok: false, error: "invalid_setup_request" });
  }

  const existingAdmins = (await store.listInternalUsers(orgId)).filter((user) => user.roles.includes("admin"));
  if (existingAdmins.length > 0) {
    return reply.code(409).send({ ok: false, error: "admin_already_exists" });
  }

  const user = await store.createInternalUser({
    orgId,
    email,
    displayName,
    passwordHash: await hashPassword(password),
    roles: ["admin"],
    status: "active"
  });
  return { ok: true, user };
});
```

- [ ] **步骤 4：实现用户管理和邀请路由**

新增管理员路由：

```ts
app.get("/internal/v1/users", async (request, reply) => {
  const auth = await requireInternalAuth(request, reply, store, adminRoles);
  if (!auth) return;
  const orgId = queryOrgId(request.query);
  if (!orgId) return reply.code(400).send({ ok: false, error: "org_id_required" });
  return { ok: true, users: await store.listInternalUsers(orgId) };
});

app.post("/internal/v1/users", async (request, reply) => {
  const auth = await requireInternalAuth(request, reply, store, adminRoles);
  if (!auth) return;
  const orgId = bodyStringField(request.body, "orgId");
  const email = bodyStringField(request.body, "email");
  const displayName = bodyStringField(request.body, "displayName");
  const password = bodyStringField(request.body, "password");
  const roles = bodyRolesField(request.body);
  if (!orgId || !email || !displayName || !password || roles.length === 0) {
    return reply.code(400).send({ ok: false, error: "invalid_user_request" });
  }
  const user = await store.createInternalUser({
    orgId,
    email,
    displayName,
    passwordHash: await hashPassword(password),
    roles,
    status: "active"
  });
  return { ok: true, user };
});

app.post("/internal/v1/users/:userId/disable", async (request, reply) => {
  const auth = await requireInternalAuth(request, reply, store, adminRoles);
  if (!auth) return;
  const orgId = bodyStringField(request.body, "orgId");
  const userId = queryStringField(request.params, "userId");
  if (!orgId || !userId) return reply.code(400).send({ ok: false, error: "invalid_user_request" });
  const user = await store.updateInternalUser({ orgId, userId, status: "disabled" });
  return { ok: true, user };
});
```

新增邀请路由：

```ts
app.post("/internal/v1/invitations", async (request, reply) => {
  const auth = await requireInternalAuth(request, reply, store, adminRoles);
  if (!auth) return;
  const orgId = bodyStringField(request.body, "orgId");
  const email = bodyStringField(request.body, "email");
  const displayName = bodyStringField(request.body, "displayName");
  const roles = bodyRolesField(request.body);
  if (!orgId || !email || !displayName || roles.length === 0) {
    return reply.code(400).send({ ok: false, error: "invalid_invitation_request" });
  }
  const invitation = await store.createUserInvitation({
    orgId,
    email,
    displayName,
    roles,
    createdByUserId: auth.user.id
  });
  return { ok: true, invitation };
});
```

同时实现 `GET /internal/v1/invitations/:token`、`POST /internal/v1/invitations/:token/accept`、`POST /internal/v1/users/:userId/reset-password`，接受邀请时创建用户后签发 session token。

- [ ] **步骤 5：运行 server 测试并提交**

运行：

```bash
npm test -w @wangwang/server
```

预期：server 包测试全部通过。

提交：

```bash
git add apps/server/src/server.ts apps/server/test/auth-routes.test.ts
git commit -m "feat: add internal setup and user management APIs"
```

---

### 任务 5：补齐 Web API Client

**文件：**
- 修改：`apps/web/src/types.ts`
- 修改：`apps/web/src/internal-api.ts`
- 修改：`apps/web/test/internal-api.test.ts`

- [ ] **步骤 1：编写失败的 Web API client 测试**

在 `apps/web/test/internal-api.test.ts` 追加：

```ts
test("internal API client supports setup, logout, users, and invitations", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true, token: "token", user: sampleUser(), users: [], invitation: sampleInvitation() }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const client = createInternalApiClient({ baseUrl: "http://server.test", token: "session-token" });
  await client.setupAdmin({ orgId: "org_internal", email: "owner@example.com", displayName: "Owner", password: "secret", setupToken: "setup-token" });
  await client.logout();
  await client.listInternalUsers("org_internal");
  await client.createInternalUser({ orgId: "org_internal", email: "sales@example.com", displayName: "Sales", password: "secret", roles: ["sales"] });
  await client.disableInternalUser({ orgId: "org_internal", userId: "user-1" });
  await client.resetInternalUserPassword({ orgId: "org_internal", userId: "user-1", password: "new-secret" });
  await client.createInvitation({ orgId: "org_internal", email: "invitee@example.com", displayName: "Invitee", roles: ["sales"] });
  await client.getInvitation("invite-token");
  await client.acceptInvitation({ token: "invite-token", password: "invitee-secret" });

  assert.deepEqual(calls.map((call) => call.url.pathname), [
    "/internal/v1/setup/admin",
    "/internal/v1/auth/logout",
    "/internal/v1/users",
    "/internal/v1/users",
    "/internal/v1/users/user-1/disable",
    "/internal/v1/users/user-1/reset-password",
    "/internal/v1/invitations",
    "/internal/v1/invitations/invite-token",
    "/internal/v1/invitations/invite-token/accept"
  ]);
});
```

- [ ] **步骤 2：增加 Web 类型**

在 `apps/web/src/types.ts` 加入：

```ts
export interface InternalInvitation {
  id: string;
  orgId: string;
  email: string;
  displayName: string;
  roles: string[];
  token?: string;
  expiresAt: string;
  acceptedAt?: string;
  createdAt: string;
}

export interface CreateInternalUserInput {
  orgId: string;
  email: string;
  displayName: string;
  password: string;
  roles: string[];
}
```

扩展 `InternalApiClient`，加入测试里调用的全部方法。

- [ ] **步骤 3：实现 Web API client 方法**

在 `apps/web/src/internal-api.ts` 扩展 `ApiEnvelope` 字段：

```ts
users?: InternalUser[];
invitation?: InternalInvitation;
```

先把 `request()` 的入参扩展为支持自定义请求头：

```ts
async function request<T>(
  path: string,
  init: {
    method?: string;
    query?: Record<string, string | undefined>;
    body?: Record<string, unknown>;
    auth?: boolean;
    headers?: Record<string, string>;
  } = {}
): Promise<ApiEnvelope<T>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers || {})
  };
  if (init.auth !== false && options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }

  const response = await fetchImpl(buildUrl(baseUrl, path, init.query), {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as ApiEnvelope<T>) : ({ ok: response.ok } as ApiEnvelope<T>);
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || response.statusText || "internal_api_error");
  }
  return data;
}
```

然后在 `createInternalApiClient()` 的返回对象中加入：

```ts
async logout() {
  await request<void>("/internal/v1/auth/logout", { method: "POST" });
},
async setupAdmin(input) {
  const { setupToken, ...body } = input;
  const data = await request<InternalUser>("/internal/v1/setup/admin", {
    method: "POST",
    auth: false,
    headers: { authorization: `Bearer ${setupToken}` },
    body
  });
  return requireField(data.user, "user");
},
async listInternalUsers(orgId) {
  const data = await request<InternalUser[]>("/internal/v1/users", { query: { orgId } });
  return data.users || [];
},
async createInternalUser(input) {
  const data = await request<InternalUser>("/internal/v1/users", {
    method: "POST",
    body: input
  });
  return requireField(data.user, "user");
},
async disableInternalUser(input) {
  const data = await request<InternalUser>(`/internal/v1/users/${encodeURIComponent(input.userId)}/disable`, {
    method: "POST",
    body: { orgId: input.orgId }
  });
  return requireField(data.user, "user");
},
async resetInternalUserPassword(input) {
  const data = await request<InternalUser>(`/internal/v1/users/${encodeURIComponent(input.userId)}/reset-password`, {
    method: "POST",
    body: { orgId: input.orgId, password: input.password }
  });
  return requireField(data.user, "user");
},
async createInvitation(input) {
  const data = await request<InternalInvitation>("/internal/v1/invitations", {
    method: "POST",
    body: input
  });
  return requireField(data.invitation, "invitation");
},
async getInvitation(token) {
  const data = await request<InternalInvitation>(`/internal/v1/invitations/${encodeURIComponent(token)}`, {
    auth: false
  });
  return requireField(data.invitation, "invitation");
},
async acceptInvitation(input) {
  const data = await request<LoginResult>(`/internal/v1/invitations/${encodeURIComponent(input.token)}/accept`, {
    method: "POST",
    auth: false,
    body: { password: input.password }
  });
  return {
    token: requireField(data.token, "token"),
    expiresAt: data.expiresAt,
    user: requireField(data.user, "user")
  };
}
```

- [ ] **步骤 4：运行 Web API client 测试并提交**

运行：

```bash
npm test -w @wangwang/web
```

预期：Web 测试通过。

提交：

```bash
git add apps/web/src/types.ts apps/web/src/internal-api.ts apps/web/test/internal-api.test.ts
git commit -m "feat: add internal auth web client methods"
```

---

### 任务 6：实现纯登录 Web 界面和用户管理

**文件：**
- 修改：`apps/web/src/App.tsx`
- 修改：`apps/web/src/styles.scss`
- 修改：`apps/web/test/customer-workflow.test.tsx`

- [ ] **步骤 1：修改登录页测试**

将 `apps/web/test/customer-workflow.test.tsx` 中“developer token fallback”相关断言替换为：

```ts
test("login view renders account login without developer token fallback", () => {
  render(<App />);

  assert.ok(screen.getByRole("heading", { name: /登录 TradeBridge/ }));
  assert.ok(screen.getByLabelText("邮箱"));
  assert.ok(screen.getByLabelText("密码"));
  assert.equal(screen.queryByLabelText("开发 Token"), null);
});
```

- [ ] **步骤 2：删除开发 token UI 状态**

在 `apps/web/src/App.tsx` 中删除：

```ts
const [developerToken, setDeveloperToken] = useState("");
```

删除 `handleDeveloperTokenLogin()`，删除 `LoginViewProps` 里的 `developerToken`、`onDeveloperTokenChange`、`onDeveloperTokenLogin`，删除 JSX 里的“或 / 开发 Token / 进入”表单。移除未使用的 `KeyRound` 图标导入。

- [ ] **步骤 3：加入首次初始化视图**

在 `App` 中增加状态：

```ts
const [setupMode, setSetupMode] = useState(false);
const [setupToken, setSetupToken] = useState("");
const [displayName, setDisplayName] = useState("");
```

加入 `SetupAdminView`：

```tsx
function SetupAdminView(props: {
  orgId: string;
  serverBaseUrl: string;
  setupToken: string;
  email: string;
  displayName: string;
  password: string;
  loading: boolean;
  error: string;
  onSetupTokenChange(value: string): void;
  onEmailChange(value: string): void;
  onDisplayNameChange(value: string): void;
  onPasswordChange(value: string): void;
  onSubmit(): void;
  onBack(): void;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-brand">
          <span className="brand-mark">TB</span>
          <div>
            <h1>创建首个管理员</h1>
            <p>初始化内部工作台</p>
          </div>
        </div>
        <form className="auth-form" onSubmit={(event) => { event.preventDefault(); props.onSubmit(); }}>
          <label>初始化 Token<input type="password" value={props.setupToken} onChange={(event) => props.onSetupTokenChange(event.target.value)} /></label>
          <label>邮箱<input type="email" value={props.email} onChange={(event) => props.onEmailChange(event.target.value)} /></label>
          <label>显示名称<input value={props.displayName} onChange={(event) => props.onDisplayNameChange(event.target.value)} /></label>
          <label>密码<input type="password" value={props.password} onChange={(event) => props.onPasswordChange(event.target.value)} /></label>
          <button type="submit" disabled={props.loading}><LogIn size={16} /><span>创建管理员</span></button>
          <button type="button" className="ghost-button" onClick={props.onBack}>返回登录</button>
        </form>
        {props.error && <p className="auth-error">{props.error}</p>}
      </section>
    </main>
  );
}
```

- [ ] **步骤 4：加入用户管理界面**

登录成功后保存当前用户：

```ts
const [currentUser, setCurrentUser] = useState<InternalUser | null>(null);
const [users, setUsers] = useState<InternalUser[]>([]);
const [showUserManagement, setShowUserManagement] = useState(false);
```

仅管理员显示用户管理入口：

```tsx
{currentUser?.roles.includes("admin") && (
  <button type="button" onClick={() => setShowUserManagement((value) => !value)}>
    <UserRound size={16} />
    <span>用户管理</span>
  </button>
)}
```

新增 `UserManagementView`，包含创建用户表单、用户列表、禁用按钮、重置密码按钮。所有操作调用 `apiClient.createInternalUser()`、`apiClient.disableInternalUser()`、`apiClient.resetInternalUserPassword()`，操作完成后重新调用 `apiClient.listInternalUsers(orgId)`。

- [ ] **步骤 5：增加样式**

在 `apps/web/src/styles.scss` 加入：

```scss
.admin-panel {
  display: grid;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}

.user-table {
  display: grid;
  gap: 8px;
}

.user-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) 110px 100px auto;
  gap: 10px;
  align-items: center;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}
```

- [ ] **步骤 6：运行 Web 验证并提交**

运行：

```bash
npm test -w @wangwang/web
npm run typecheck -w @wangwang/web
npm run build -w @wangwang/web
```

预期：全部通过。

提交：

```bash
git add apps/web/src/App.tsx apps/web/src/styles.scss apps/web/test/customer-workflow.test.tsx
git commit -m "feat: add password-only internal auth UI"
```

---

### 任务 7：更新环境文档并做全量验证

**文件：**
- 修改：`.env.example`
- 修改：`docs/ENVIRONMENT.md`
- 修改：`docs/internal-trial-runbook.md`

- [ ] **步骤 1：更新 `.env.example`**

删除：

```dotenv
WANGWANG_INTERNAL_API_TOKENS=change-me-admin-token
```

加入：

```dotenv
# 首次初始化管理员的一次性 Bearer token，仅用于创建第一个管理员。
# 初始化完成后应删除或置空，后续统一使用邮箱密码登录。
WANGWANG_SETUP_TOKEN=change-me-setup-token
```

- [ ] **步骤 2：更新中文环境文档**

在 `docs/ENVIRONMENT.md` 中将“内部 API 管理 token”替换为：

````md
## 内部工作台登录

内部工作台只支持邮箱密码登录。首次初始化管理员时设置：

```dotenv
WANGWANG_SETUP_TOKEN=change-me-setup-token
```

创建第一个管理员后，删除或置空 `WANGWANG_SETUP_TOKEN`，再通过登录页进入工作台。
````

- [ ] **步骤 3：更新试运行文档**

在 `docs/internal-trial-runbook.md` 中将 token 登录说明替换为：

```md
## 初始化管理员和登录

内部工作台不再支持开发管理 token。所有操作员都通过邮箱密码登录，登录成功后由服务端签发会话。

首次运行流程：

1. 设置 `WANGWANG_SETUP_TOKEN`。
2. 启动 PostgreSQL、server 和 Web。
3. 打开 Web 登录页，进入“创建首个管理员”。
4. 输入 Org、邮箱、显示名称和密码。
5. 使用邮箱密码登录。
6. 在用户管理中创建销售或主管账号。

初始化完成后，应移除或置空 `WANGWANG_SETUP_TOKEN`。
```

- [ ] **步骤 4：扫描遗留开发 token 文本**

运行：

```bash
rg -n "WANGWANG_INTERNAL_API_TOKENS|internalTokens|bootstrapAuthContext|developerToken|dev-admin-token" apps packages .env.example docs/ENVIRONMENT.md docs/internal-trial-runbook.md
```

预期：无输出。

- [ ] **步骤 5：运行全量验证**

运行：

```bash
npm test -w @wangwang/database
npm test -w @wangwang/server
npm test -w @wangwang/web
npm run typecheck
npm run build
```

预期：全部通过。

- [ ] **步骤 6：提交文档与最终清理**

提交：

```bash
git add .env.example docs/ENVIRONMENT.md docs/internal-trial-runbook.md
git commit -m "docs: document password-only internal login"
```

---

## 自检

- 需求覆盖：计划覆盖首个管理员初始化、账号密码登录、登出、会话吊销、管理员创建用户、禁用用户、重置密码、邀请激活、Web 用户管理和中文文档更新。
- 开发 token 清理：计划明确删除 `WANGWANG_INTERNAL_API_TOKENS`、`internalTokens`、`bootstrapAuthContext()`、Web `developerToken` 表单，并要求扫描验证无遗留。
- 范围控制：本轮不包含公开注册、SSO、双因素认证、邮件发送服务、HttpOnly Cookie 迁移和权限矩阵细分。
- 类型一致性：计划中的 Store 方法名为 `getInternalUserCredentials`、`listInternalUsers`、`updateInternalUser`、`revokeInternalSession`、`createUserInvitation`、`getUserInvitation`、`acceptUserInvitation`，server 和 Web 任务均使用这些名称。
