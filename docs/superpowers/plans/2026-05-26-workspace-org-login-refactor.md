# TradeBridge 工作空间登录改造实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将当前登录前手填 `Org` 的模式改造成“登录只认证用户，工作空间在登录后由成员关系推导或选择”的模式，同时保持现有采集端按 `orgId` 同步数据的能力。

**架构：** 复用现有 `org` 表作为底层数据隔离键，并把它包装成用户可理解的“工作空间”。服务端登录接口允许省略 `orgId`：单空间用户直接登录，多空间用户在密码验证成功后返回空间选择。Web 端隐藏原始 `Org` 输入，业务 API 默认从 session 推导当前 `orgId`，采集端、Chrome 插件、桌面端仍可继续使用机器配置里的 `orgId`。

**技术栈：** TypeScript、Fastify、React/Vite、Node test runner、tsx、PostgreSQL SQL migration、现有 `@wangwang/database` store 抽象。

---

## 范围边界

本计划只改造内部 Web 登录和服务端 session 工作空间解析，不改变采集端同步协议。`SyncBatch.orgId`、桌面采集端 `WANGWANG_ORG_ID`、Chrome 插件 options 里的 `orgId` 在本计划中保持兼容，因为它们属于机器端租户路由，不是销售用户登录体验。

本计划不引入 Better Auth，也不把现有 `app_user` 拆成全局身份表加 membership 表。当前阶段采用较小改动：同一邮箱在多个 `org` 下存在多个 `app_user` 时，视为该邮箱拥有多个工作空间成员身份。

## 参考实现

- `trade-mind` 登录页只认证用户，不展示空间输入：`/Users/wait9yan/projects/app/xiezi/trade-mind/apps/web/src/features/auth/sign-in-form.tsx`
- `trade-mind` 使用 session 中的 `activeWorkspaceId` 和 membership 推导当前空间：`/Users/wait9yan/projects/app/xiezi/trade-mind/apps/web/src/features/workspace/workspace-service.ts`
- `trade-mind` 空间切换器调用 `/api/workspaces/active`：`/Users/wait9yan/projects/app/xiezi/trade-mind/apps/web/src/components/shell/workspace-switcher.tsx`

## 文件结构

- 修改：`packages/database/src/sync-types.ts`
  - 新增内部工作空间摘要、按邮箱查找登录候选、切换 session 工作空间的输入类型。
- 修改：`packages/database/src/sync-store.ts`
  - 在内存 store 中维护 `org` 名称摘要。
  - 新增按邮箱列出用户工作空间、按邮箱列出登录候选、切换 session 当前 org 的方法。
- 修改：`packages/database/src/postgres-sync-store.ts`
  - 新增 PostgreSQL 版本的工作空间查询、登录候选查询、session org 切换方法。
- 创建：`packages/database/migrations/002_workspace_login_facade.sql`
  - 给 `app_user.email` 和 `internal_session.user_id` 增加索引，支撑省略 org 的登录和空间切换。
- 修改：`packages/database/src/migrations.ts`
  - 按顺序导出第 2 个 migration。
- 修改：`packages/database/test/migrations.test.ts`
  - 覆盖第 2 个 migration 和索引。
- 修改：`packages/database/test/sync-store.test.ts`
  - 覆盖内存 store 的工作空间候选和 session 切换行为。
- 修改：`packages/database/test/postgres-sync-store.test.ts`
  - 覆盖 PostgreSQL store 的同等行为。
- 修改：`apps/server/src/server.ts`
  - 扩展 `SyncStore` 接口。
  - 登录接口支持省略 `orgId`。
  - 新增当前用户工作空间列表和切换接口。
  - 内部业务接口默认从 session 推导 `orgId`。
- 修改：`apps/server/test/auth-routes.test.ts`
  - 覆盖无 org 登录、多空间选择、切换当前空间。
- 修改：`apps/server/test/internal-query-routes.test.ts`
  - 覆盖查询接口省略 `orgId` 时使用 session org。
- 修改：`apps/server/test/customer-collaboration-routes.test.ts`
  - 覆盖协作接口省略 `orgId` 的最小路径。
- 修改：`apps/web/src/types.ts`
  - 登录入参 `orgId` 改为可选。
  - 新增工作空间摘要、空间选择错误、Web client 的工作空间方法。
- 修改：`apps/web/src/internal-api.ts`
  - 支持无 org 登录。
  - 解析 `workspace_selection_required` 响应。
  - 增加 `listWorkspaces()`、`switchWorkspace()`。
  - 业务读取方法允许省略 `orgId`。
- 修改：`apps/web/src/App.tsx`
  - 登录页隐藏 `Org`。
  - `API` 移到高级连接设置。
  - 多空间登录冲突时展示空间选择按钮。
  - 登录成功后用 session 用户的 `orgId` 初始化工作台。
- 修改：`apps/web/test/internal-api.test.ts`
  - 覆盖无 org 登录、空间选择错误、业务 API 省略 org。
- 修改：`apps/web/test/customer-workflow.test.tsx`
  - 覆盖登录页不展示 `Org` 输入、多空间选择、切换配置清理 session。
- 修改：`docs/ENVIRONMENT.md`
  - 更新本地运行说明：普通登录只填邮箱密码，`org_internal` 作为开发默认空间。
- 修改：`docs/internal-trial-runbook.md`
  - 更新 curl 示例：登录可省略 `orgId`，多空间场景再传 `orgId`。

---

### 任务 1：数据库层暴露工作空间成员关系

**文件：**
- 修改：`packages/database/src/sync-types.ts`
- 修改：`packages/database/src/sync-store.ts`
- 修改：`packages/database/src/postgres-sync-store.ts`
- 创建：`packages/database/migrations/002_workspace_login_facade.sql`
- 修改：`packages/database/src/migrations.ts`
- 测试：`packages/database/test/migrations.test.ts`
- 测试：`packages/database/test/sync-store.test.ts`
- 测试：`packages/database/test/postgres-sync-store.test.ts`

- [ ] **步骤 1：编写 migration 失败测试**

在 `packages/database/test/migrations.test.ts` 追加：

```ts
test("workspace login facade migration is exported after the initial schema", () => {
  assert.equal(INTERNAL_SYNC_MIGRATIONS.length, 2);
  assert.equal(INTERNAL_SYNC_MIGRATIONS[1].id, "002_workspace_login_facade");
  assert.equal(INTERNAL_SYNC_MIGRATIONS[1].filename, "002_workspace_login_facade.sql");
});

test("workspace login facade migration adds lookup indexes for email login and session switching", () => {
  const normalized = INTERNAL_SYNC_MIGRATIONS[1].sql.replace(/\s+/g, " ").toLowerCase();

  assert.match(normalized, /create index if not exists idx_app_user_email on app_user \(email\)/);
  assert.match(normalized, /create index if not exists idx_internal_session_user_id on internal_session \(user_id\)/);
});
```

- [ ] **步骤 2：运行 migration 测试验证失败**

运行：`npm test -w @wangwang/database -- --test-name-pattern "workspace login facade"`

预期：FAIL，报错包含 `Expected values to be strictly equal: 1 !== 2` 或 `002_workspace_login_facade` 不存在。

- [ ] **步骤 3：新增 migration 文件并导出**

创建 `packages/database/migrations/002_workspace_login_facade.sql`：

```sql
CREATE INDEX IF NOT EXISTS idx_app_user_email ON app_user (email);
CREATE INDEX IF NOT EXISTS idx_internal_session_user_id ON internal_session (user_id);
```

修改 `packages/database/src/migrations.ts`：

```ts
export const INTERNAL_SYNC_MIGRATIONS: DatabaseMigration[] = [
  loadMigration("001_internal_sync_schema", "001_internal_sync_schema.sql"),
  loadMigration("002_workspace_login_facade", "002_workspace_login_facade.sql")
];
```

- [ ] **步骤 4：运行 migration 测试验证通过**

运行：`npm test -w @wangwang/database -- --test-name-pattern "workspace login facade"`

预期：PASS，两个 workspace login facade 测试通过。

- [ ] **步骤 5：编写内存 store 失败测试**

在 `packages/database/test/sync-store.test.ts` 追加：

```ts
test("internal workspace lookup lists active memberships for an email", async () => {
  const store = new InMemorySyncStore();
  await store.createInternalUser({
    orgId: "org_internal",
    email: "sales@example.com",
    displayName: "Sales Internal",
    passwordHash: "hash-1",
    roles: ["sales"]
  });
  await store.createInternalUser({
    orgId: "org_other",
    email: "sales@example.com",
    displayName: "Sales Other",
    passwordHash: "hash-2",
    roles: ["supervisor"]
  });
  await store.createInternalUser({
    orgId: "org_disabled",
    email: "sales@example.com",
    displayName: "Disabled",
    passwordHash: "hash-3",
    roles: ["sales"],
    status: "disabled"
  });

  const memberships = await store.listInternalUserWorkspacesByEmail(" Sales@Example.COM ");

  assert.deepEqual(
    memberships.map((item) => ({
      orgId: item.orgId,
      name: item.name,
      roles: item.roles
    })),
    [
      { orgId: "org_internal", name: "org_internal", roles: ["sales"] },
      { orgId: "org_other", name: "org_other", roles: ["supervisor"] }
    ]
  );
});

test("internal session can switch to another workspace for the same email", async () => {
  const store = new InMemorySyncStore();
  await store.createInternalUser({
    orgId: "org_internal",
    email: "sales@example.com",
    displayName: "Sales Internal",
    passwordHash: "hash-1",
    roles: ["sales"]
  });
  await store.createInternalUser({
    orgId: "org_other",
    email: "sales@example.com",
    displayName: "Sales Other",
    passwordHash: "hash-2",
    roles: ["supervisor"]
  });
  const session = await store.issueInternalSession({
    orgId: "org_internal",
    email: "sales@example.com",
    passwordHash: "hash-1",
    token: "session-token"
  });

  const switched = await store.switchInternalSessionOrg({
    token: session.token,
    orgId: "org_other"
  });

  assert.equal(switched.orgId, "org_other");
  assert.equal(switched.displayName, "Sales Other");
  assert.deepEqual(switched.roles, ["supervisor"]);
  assert.equal((await store.getInternalSession("session-token"))?.orgId, "org_other");
});
```

- [ ] **步骤 6：运行内存 store 测试验证失败**

运行：`npm test -w @wangwang/database -- --test-name-pattern "internal workspace"`

预期：FAIL，TypeScript 或运行时报错包含 `listInternalUserWorkspacesByEmail is not a function`。

- [ ] **步骤 7：扩展数据库类型**

在 `packages/database/src/sync-types.ts` 的 `InternalUserCredentials` 后追加：

```ts
export interface InternalWorkspaceSummary {
  orgId: string;
  name: string;
  userId: string;
  email: string;
  displayName: string;
  roles: InternalRole[];
}

export interface GetInternalUserCredentialsByEmailInput {
  email: string;
}

export interface SwitchInternalSessionOrgInput {
  token: string;
  orgId: string;
}
```

- [ ] **步骤 8：实现内存 store 工作空间方法**

在 `packages/database/src/sync-store.ts` 顶部 import 类型处加入：

```ts
  GetInternalUserCredentialsByEmailInput,
  InternalWorkspaceSummary,
  SwitchInternalSessionOrgInput,
```

在 `InMemorySyncStore` 字段区加入：

```ts
  private readonly orgs = new Map<string, { id: string; name: string }>();
```

在 `createInternalUser()` 开头、生成 `now` 后加入：

```ts
    this.ensureOrg(input.orgId);
```

在 class 内加入：

```ts
  async getInternalUserCredentialsByEmail(
    input: GetInternalUserCredentialsByEmailInput
  ): Promise<InternalUserCredentials[]> {
    const normalizedEmail = input.email.trim().toLowerCase();
    return Array.from(this.internalUsers.values())
      .filter((user) => user.email === normalizedEmail && user.status === "active")
      .map((user) => ({ ...toPublicInternalUser(user), passwordHash: user.passwordHash }))
      .sort((left, right) => left.orgId.localeCompare(right.orgId));
  }

  async listInternalUserWorkspacesByEmail(email: string): Promise<InternalWorkspaceSummary[]> {
    const normalizedEmail = email.trim().toLowerCase();
    return Array.from(this.internalUsers.values())
      .filter((user) => user.email === normalizedEmail && user.status === "active")
      .map((user) => ({
        orgId: user.orgId,
        name: this.orgs.get(user.orgId)?.name || user.orgId,
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async switchInternalSessionOrg(input: SwitchInternalSessionOrgInput): Promise<InternalSession> {
    const tokenHash = hashContent(input.token);
    const existingSession = this.internalSessions.get(tokenHash);
    if (!existingSession) throw new Error("internal_session_not_found");

    const targetUser = this.internalUsers.get(internalUserKey(input.orgId, existingSession.email));
    if (!targetUser || targetUser.status !== "active") {
      throw new Error("workspace_not_found");
    }

    const switched: InternalSession = {
      ...existingSession,
      orgId: targetUser.orgId,
      userId: targetUser.id,
      displayName: targetUser.displayName,
      roles: targetUser.roles
    };
    this.internalSessions.set(tokenHash, switched);
    return switched;
  }

  private ensureOrg(orgId: string): void {
    if (!this.orgs.has(orgId)) {
      this.orgs.set(orgId, { id: orgId, name: orgId });
    }
  }
```

在 `acceptSyncBatch(batch)` 开头加入：

```ts
    this.ensureOrg(batch.orgId);
```

- [ ] **步骤 9：运行内存 store 测试验证通过**

运行：`npm test -w @wangwang/database -- --test-name-pattern "internal workspace"`

预期：PASS，新增两个内存 store 测试通过。

- [ ] **步骤 10：编写 PostgreSQL store 失败测试**

在 `packages/database/test/postgres-sync-store.test.ts` 中找到现有内部用户测试区域，追加与内存 store 同名行为测试。测试数据使用现有 test client 的 `queueRows` 模式时，至少断言 SQL marker：

```ts
test("postgres store exposes workspace lookup and session switching queries", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresSyncStore(client);

  await store.getInternalUserCredentialsByEmail({ email: "sales@example.com" });

  await store.listInternalUserWorkspacesByEmail("sales@example.com");

  await store.switchInternalSessionOrg({ token: "session-token", orgId: "org_other" });

  const sql = client.queries.map((query) => query.sql).join("\n");
  assert.match(sql, /get_internal_user_credentials_by_email/);
  assert.match(sql, /list_internal_user_workspaces_by_email/);
  assert.match(sql, /switch_internal_session_org_current/);
  assert.match(sql, /switch_internal_session_org_target/);
  assert.match(sql, /switch_internal_session_org_update/);
});
```

- [ ] **步骤 11：运行 PostgreSQL store 测试验证失败**

运行：`npm test -w @wangwang/database -- --test-name-pattern "postgres store exposes workspace"`

预期：FAIL，报错包含 `getInternalUserCredentialsByEmail is not a function`。

- [ ] **步骤 12：实现 PostgreSQL store 方法**

在 `packages/database/src/postgres-sync-store.ts` 中加入与内存 store 相同的 public 方法，SQL 使用下面 marker：

```ts
  async getInternalUserCredentialsByEmail(
    input: GetInternalUserCredentialsByEmailInput
  ): Promise<InternalUserCredentials[]> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const result = await this.client.query<InternalUserCredentialsRow>(
      `
      /* get_internal_user_credentials_by_email */
      SELECT
        u.id::text AS "id",
        u.org_id AS "orgId",
        u.email,
        u.display_name AS "displayName",
        u.password_hash AS "passwordHash",
        u.status,
        COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles,
        u.created_at::text AS "createdAt",
        u.updated_at::text AS "updatedAt"
      FROM app_user u
      LEFT JOIN user_role ur ON ur.org_id = u.org_id AND ur.user_id = u.id
      LEFT JOIN role r ON r.id = ur.role_id
      WHERE u.email = $1 AND u.status = 'active'
      GROUP BY u.id
      ORDER BY u.org_id
      `,
      [normalizedEmail]
    );
    return result.rows.map(mapInternalUserCredentialsRow);
  }

  async listInternalUserWorkspacesByEmail(email: string): Promise<InternalWorkspaceSummary[]> {
    const normalizedEmail = email.trim().toLowerCase();
    const result = await this.client.query<InternalWorkspaceSummaryRow>(
      `
      /* list_internal_user_workspaces_by_email */
      SELECT
        o.id AS "orgId",
        o.name,
        u.id::text AS "userId",
        u.email,
        u.display_name AS "displayName",
        COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
      FROM app_user u
      INNER JOIN org o ON o.id = u.org_id
      LEFT JOIN user_role ur ON ur.org_id = u.org_id AND ur.user_id = u.id
      LEFT JOIN role r ON r.id = ur.role_id
      WHERE u.email = $1 AND u.status = 'active'
      GROUP BY o.id, u.id
      ORDER BY o.name
      `,
      [normalizedEmail]
    );
    return result.rows.map((row) => ({
      orgId: row.orgId,
      name: row.name,
      userId: row.userId,
      email: row.email,
      displayName: row.displayName,
      roles: normalizeRoles(row.roles)
    }));
  }
```

再加入 `switchInternalSessionOrg()`，使用 `hashContent(input.token)` 查当前 session，按当前 session email 找目标 org 的 active user，更新 `internal_session.org_id` 与 `user_id`，返回 `InternalSession`。错误名称保持 `internal_session_not_found` 和 `workspace_not_found`。

- [ ] **步骤 13：运行数据库包测试**

运行：`npm test -w @wangwang/database`

预期：PASS，数据库包所有测试通过。

- [ ] **步骤 14：Commit**

```bash
git add packages/database/src/sync-types.ts packages/database/src/sync-store.ts packages/database/src/postgres-sync-store.ts packages/database/src/migrations.ts packages/database/migrations/002_workspace_login_facade.sql packages/database/test/migrations.test.ts packages/database/test/sync-store.test.ts packages/database/test/postgres-sync-store.test.ts
git commit -m "feat(database): add workspace login facade"
```

---

### 任务 2：服务端登录支持省略 org 并返回空间选择

**文件：**
- 修改：`apps/server/src/server.ts`
- 修改：`apps/server/test/auth-routes.test.ts`

- [ ] **步骤 1：编写无 org 登录和多空间选择失败测试**

在 `apps/server/test/auth-routes.test.ts` 追加：

```ts
test("POST /internal/v1/auth/login infers the workspace when email belongs to one active org", async () => {
  const { app } = await createAuthApp();

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/auth/login",
    payload: {
      email: "admin@example.com",
      password: "secret"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().user.orgId, "org_internal");
  assert.equal(response.json().user.email, "admin@example.com");
});

test("POST /internal/v1/auth/login returns workspace choices after password verification for multi-org email", async () => {
  const { app, store } = await createAuthApp();
  await store.createInternalUser({
    orgId: "org_other",
    email: "admin@example.com",
    displayName: "Other Admin",
    passwordHash: await hashPassword("secret"),
    roles: ["supervisor"]
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/auth/login",
    payload: {
      email: "admin@example.com",
      password: "secret"
    }
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().error, "workspace_selection_required");
  assert.deepEqual(
    response.json().workspaces.map((item: { orgId: string; name: string }) => ({
      orgId: item.orgId,
      name: item.name
    })),
    [
      { orgId: "org_internal", name: "org_internal" },
      { orgId: "org_other", name: "org_other" }
    ]
  );
});
```

- [ ] **步骤 2：运行服务端认证测试验证失败**

运行：`npm test -w @wangwang/server -- --test-name-pattern "workspace"`

预期：FAIL，第一个测试返回 `400 invalid_login_request`，第二个测试没有 `workspace_selection_required`。

- [ ] **步骤 3：扩展 server store 接口和登录响应 envelope**

在 `apps/server/src/server.ts` 的 database import 类型中加入：

```ts
  InternalWorkspaceSummary,
  SwitchInternalSessionOrgInput,
```

在 `interface SyncStore` 中加入：

```ts
  getInternalUserCredentialsByEmail(input: { email: string }): Promise<InternalUserCredentials[]> | InternalUserCredentials[];
  listInternalUserWorkspacesByEmail(email: string): Promise<InternalWorkspaceSummary[]> | InternalWorkspaceSummary[];
  switchInternalSessionOrg(input: SwitchInternalSessionOrgInput): Promise<InternalSession> | InternalSession;
```

新增 helper：

```ts
function publicWorkspaceSummary(workspace: InternalWorkspaceSummary) {
  return {
    orgId: workspace.orgId,
    name: workspace.name,
    roles: workspace.roles
  };
}
```

- [ ] **步骤 4：改造 `/internal/v1/auth/login`**

把登录路由开头改成：

```ts
  app.post("/internal/v1/auth/login", async (request, reply) => {
    const orgId = bodyStringField(request.body, "orgId");
    const email = bodyStringField(request.body, "email");
    const password = bodyStringField(request.body, "password");
    if (!email || !password) {
      return reply.code(400).send({ ok: false, error: "invalid_login_request" });
    }

    if (!orgId) {
      const candidates = await store.getInternalUserCredentialsByEmail({ email });
      const matches: InternalUserCredentials[] = [];
      for (const candidate of candidates) {
        if (await verifyPassword(password, candidate.passwordHash)) {
          matches.push(candidate);
        }
      }
      if (matches.length === 0) {
        for (const candidate of candidates) {
          await appendLoginFailedAuditLog(store, candidate.orgId, email);
        }
        return reply.code(401).send({ ok: false, error: "invalid_credentials" });
      }
      if (matches.length > 1) {
        const workspaces = (await store.listInternalUserWorkspacesByEmail(email)).filter((workspace) =>
          matches.some((match) => match.orgId === workspace.orgId)
        );
        return reply.code(409).send({
          ok: false,
          error: "workspace_selection_required",
          workspaces: workspaces.map(publicWorkspaceSummary)
        });
      }
      const [match] = matches;
      const session = await store.issueInternalSession({
        orgId: match.orgId,
        email,
        passwordHash: match.passwordHash
      });
      await store.appendAuditLog({
        orgId: match.orgId,
        actorUserId: session.userId,
        action: "auth.login.succeeded",
        targetType: "app_user",
        targetId: session.userId
      });
      return {
        ok: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: publicUserFromSession(session)
      };
    }
```

保留原有显式 `orgId` 登录分支，用于多空间选择后的二次提交以及 API 兼容。

- [ ] **步骤 5：运行服务端认证测试验证通过**

运行：`npm test -w @wangwang/server -- --test-name-pattern "workspace"`

预期：PASS，新增两个登录测试通过。

- [ ] **步骤 6：编写当前用户工作空间接口失败测试**

在 `apps/server/test/auth-routes.test.ts` 追加：

```ts
test("authenticated users can list and switch their workspaces", async () => {
  const { app, store } = await createAuthApp();
  await store.createInternalUser({
    orgId: "org_other",
    email: "admin@example.com",
    displayName: "Other Admin",
    passwordHash: await hashPassword("secret"),
    roles: ["supervisor"]
  });
  const headers = await createInternalAuthHeaders(app);

  const listResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/workspaces",
    headers
  });
  const switchResponse = await app.inject({
    method: "PATCH",
    url: "/internal/v1/workspaces/active",
    headers,
    payload: { orgId: "org_other" }
  });
  const meResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/me",
    headers
  });

  assert.equal(listResponse.statusCode, 200);
  assert.deepEqual(
    listResponse.json().workspaces.map((item: { orgId: string }) => item.orgId),
    ["org_internal", "org_other"]
  );
  assert.equal(switchResponse.statusCode, 200);
  assert.equal(switchResponse.json().user.orgId, "org_other");
  assert.equal(meResponse.json().user.orgId, "org_other");
});
```

- [ ] **步骤 7：运行当前用户工作空间接口测试验证失败**

运行：`npm test -w @wangwang/server -- --test-name-pattern "list and switch"`

预期：FAIL，返回 `404` 或路由不存在。

- [ ] **步骤 8：实现 `/internal/v1/workspaces` 和 `/internal/v1/workspaces/active`**

在 `apps/server/src/server.ts` 的 `/internal/v1/me` 附近加入：

```ts
  app.get("/internal/v1/workspaces", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply);
    if (!auth) return;

    return {
      ok: true,
      workspaces: (await store.listInternalUserWorkspacesByEmail(auth.user.email)).map(publicWorkspaceSummary)
    };
  });

  app.patch("/internal/v1/workspaces/active", async (request, reply) => {
    const auth = await requireInternalAuth(request, reply);
    if (!auth) return;

    const orgId = bodyStringField(request.body, "orgId");
    if (!orgId) {
      return reply.code(400).send({ ok: false, error: "org_id_required" });
    }

    try {
      const token = bearerToken(request.headers.authorization || "");
      const session = await store.switchInternalSessionOrg({ token, orgId });
      return {
        ok: true,
        user: publicUserFromSession(session)
      };
    } catch (error) {
      if (error instanceof Error && error.message === "workspace_not_found") {
        return reply.code(404).send({ ok: false, error: "workspace_not_found" });
      }
      throw error;
    }
  });
```

- [ ] **步骤 9：运行服务端认证测试**

运行：`npm test -w @wangwang/server -- --test-name-pattern "auth"`

预期：PASS，认证路由测试通过。

- [ ] **步骤 10：Commit**

```bash
git add apps/server/src/server.ts apps/server/test/auth-routes.test.ts
git commit -m "feat(server): infer workspace during login"
```

---

### 任务 3：内部业务 API 默认使用 session org

**文件：**
- 修改：`apps/server/src/server.ts`
- 修改：`apps/server/test/internal-query-routes.test.ts`
- 修改：`apps/server/test/customer-collaboration-routes.test.ts`

- [ ] **步骤 1：编写内部查询省略 org 的失败测试**

在 `apps/server/test/internal-query-routes.test.ts` 追加：

```ts
test("internal query APIs use the authenticated session org when orgId is omitted", async () => {
  const app = await createSeededApp();
  const authHeaders = await createInternalAuthHeaders(app);

  const customersResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/customers",
    headers: authHeaders
  });
  const conversationsResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/conversations",
    headers: authHeaders
  });
  const messagesResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/conversations/conv-1/messages",
    headers: authHeaders
  });

  assert.equal(customersResponse.statusCode, 200);
  assert.equal(customersResponse.json().customers[0].orgId, "org_internal");
  assert.equal(conversationsResponse.statusCode, 200);
  assert.equal(conversationsResponse.json().conversations[0].orgId, "org_internal");
  assert.equal(messagesResponse.statusCode, 200);
  assert.equal(messagesResponse.json().messages[0].orgId, "org_internal");
});
```

- [ ] **步骤 2：运行内部查询测试验证失败**

运行：`npm test -w @wangwang/server -- --test-name-pattern "session org"`

预期：FAIL，返回 `400 org_id_required`。

- [ ] **步骤 3：新增服务端 org 解析 helper**

在 `apps/server/src/server.ts` 的 `queryOrgId()` 附近加入：

```ts
function requestedOrgIdOrSession(query: unknown, auth: InternalAuthContext): string {
  return queryOrgId(query) || auth.user.orgId;
}

function bodyOrgIdOrSession(body: unknown, auth: InternalAuthContext): string {
  return bodyStringField(body, "orgId") || auth.user.orgId;
}
```

- [ ] **步骤 4：改造读取类路由默认 org**

在 `apps/server/src/server.ts` 中替换以下读取路由的 org 获取逻辑：

```ts
const orgId = requestedOrgIdOrSession(request.query, auth);
if (!requireOrgScope(auth, orgId, reply)) return;
```

应用到这些路由：

```ts
GET /internal/v1/users
GET /internal/v1/collector-devices
GET /internal/v1/customers
GET /internal/v1/conversations
GET /internal/v1/conversations/:externalConversationId/messages
GET /internal/v1/audit-logs
```

这些路由仍保留显式 `?orgId=`，用于旧测试和调试，但省略时走 session org。

- [ ] **步骤 5：运行内部查询测试验证通过**

运行：`npm test -w @wangwang/server -- --test-name-pattern "session org"`

预期：PASS，新增内部查询测试通过。

- [ ] **步骤 6：编写协作接口省略 org 的失败测试**

在 `apps/server/test/customer-collaboration-routes.test.ts` 追加：

```ts
test("customer collaboration routes use session org when orgId is omitted", async () => {
  const app = await createSeededApp();
  const headers = await createInternalAuthHeaders(app);

  const notesResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/customers/customer-1/notes?sellerAccountExternalId=seller-1",
    headers
  });
  const tasksResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/customers/customer-1/tasks?sellerAccountExternalId=seller-1",
    headers
  });

  assert.equal(notesResponse.statusCode, 200);
  assert.deepEqual(notesResponse.json().notes, []);
  assert.equal(tasksResponse.statusCode, 200);
  assert.deepEqual(tasksResponse.json().tasks, []);
});
```

- [ ] **步骤 7：运行协作接口测试验证失败**

运行：`npm test -w @wangwang/server -- --test-name-pattern "collaboration routes use session org"`

预期：FAIL，返回 `400 invalid_customer_scope` 或 `org_id_required`。

- [ ] **步骤 8：让 customer scope 支持 session org**

修改 `apps/server/src/server.ts` 中解析 customer scope 的 helper，新增一个认证版：

```ts
function customerScopeFromQueryOrSession(
  query: unknown,
  auth: InternalAuthContext,
  externalCustomerId: string
): CustomerScope | null {
  const sellerAccountExternalId = queryStringField(query, "sellerAccountExternalId");
  if (!sellerAccountExternalId || !externalCustomerId) return null;
  return {
    orgId: requestedOrgIdOrSession(query, auth),
    sellerAccountExternalId,
    externalCustomerId
  };
}
```

将需要 session auth 的客户协作路由从旧 helper 切到 `customerScopeFromQueryOrSession()`。公开邀请路由不使用该 helper。

- [ ] **步骤 9：运行服务端全量测试**

运行：`npm test -w @wangwang/server`

预期：PASS，服务端所有测试通过。

- [ ] **步骤 10：Commit**

```bash
git add apps/server/src/server.ts apps/server/test/internal-query-routes.test.ts apps/server/test/customer-collaboration-routes.test.ts
git commit -m "feat(server): derive org from internal session"
```

---

### 任务 4：Web API client 支持无 org 登录和空间选择

**文件：**
- 修改：`apps/web/src/types.ts`
- 修改：`apps/web/src/internal-api.ts`
- 修改：`apps/web/test/internal-api.test.ts`

- [ ] **步骤 1：编写 Web API client 失败测试**

在 `apps/web/test/internal-api.test.ts` 追加：

```ts
test("login can omit orgId and workspace selection errors expose workspace choices", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const client = createInternalApiClient({
    baseUrl: "",
    token: "",
    fetchImpl: async (input, init = {}) => {
      calls.push({ url: new URL(String(input), "http://local.test"), init });
      return new Response(
        JSON.stringify({
          ok: false,
          error: "workspace_selection_required",
          workspaces: [
            { orgId: "org_internal", name: "org_internal", roles: ["admin"] },
            { orgId: "org_other", name: "org_other", roles: ["sales"] }
          ]
        }),
        { status: 409, headers: { "content-type": "application/json" } }
      );
    }
  });

  await assert.rejects(
    () => client.login({ email: "admin@example.com", password: "secret" }),
    (error: unknown) => {
      assert.equal(error instanceof WorkspaceSelectionRequiredError, true);
      assert.deepEqual((error as WorkspaceSelectionRequiredError).workspaces.map((item) => item.orgId), [
        "org_internal",
        "org_other"
      ]);
      return true;
    }
  );

  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    email: "admin@example.com",
    password: "secret"
  });
});

test("workspace client methods call internal workspace routes", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const client = createInternalApiClient({
    baseUrl: "/base",
    token: "session-token",
    fetchImpl: async (input, init = {}) => {
      calls.push({ url: new URL(String(input), "http://local.test"), init });
      if (String(input).endsWith("/workspaces")) {
        return new Response(JSON.stringify({ ok: true, workspaces: [{ orgId: "org_internal", name: "org_internal", roles: ["admin"] }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ ok: true, user: { id: "u1", orgId: "org_other", email: "admin@example.com", displayName: "Admin", status: "active", roles: ["admin"] } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.equal((await client.listWorkspaces())[0].orgId, "org_internal");
  assert.equal((await client.switchWorkspace("org_other")).orgId, "org_other");
  assert.equal(calls[0].url.pathname, "/base/internal/v1/workspaces");
  assert.equal(calls[1].url.pathname, "/base/internal/v1/workspaces/active");
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), { orgId: "org_other" });
});
```

- [ ] **步骤 2：运行 Web API client 测试验证失败**

运行：`npm test -w @wangwang/web -- --test-name-pattern "workspace"`

预期：FAIL，报错包含 `WorkspaceSelectionRequiredError` 未定义或 `client.listWorkspaces is not a function`。

- [ ] **步骤 3：扩展 Web 类型**

在 `apps/web/src/types.ts` 加入：

```ts
export interface InternalWorkspaceSummary {
  orgId: string;
  name: string;
  roles: InternalRole[];
}
```

修改 `InternalApiClient`：

```ts
  login(input: { orgId?: string; email: string; password: string }): Promise<LoginResult>;
  listWorkspaces(): Promise<InternalWorkspaceSummary[]>;
  switchWorkspace(orgId: string): Promise<InternalUser>;
  listCustomers(orgId?: string): Promise<StoredCustomer[]>;
  listConversations(orgId?: string): Promise<StoredConversation[]>;
  listMessages(orgId: string | undefined, externalConversationId: string): Promise<StoredMessage[]>;
```

- [ ] **步骤 4：实现 Web API client**

在 `apps/web/src/internal-api.ts` import 类型中加入 `InternalWorkspaceSummary`。

在 `ApiEnvelope<T>` 中加入：

```ts
  workspaces?: InternalWorkspaceSummary[];
```

在文件顶部导出错误类：

```ts
export class WorkspaceSelectionRequiredError extends Error {
  readonly workspaces: InternalWorkspaceSummary[];

  constructor(workspaces: InternalWorkspaceSummary[]) {
    super("workspace_selection_required");
    this.name = "WorkspaceSelectionRequiredError";
    this.workspaces = workspaces;
  }
}
```

在 `request()` 的错误处理分支里加入：

```ts
    if (response.status === 409 && data.error === "workspace_selection_required") {
      throw new WorkspaceSelectionRequiredError(data.workspaces || []);
    }
```

在 returned client 中加入：

```ts
    async listWorkspaces() {
      const data = await request<InternalWorkspaceSummary[]>("/internal/v1/workspaces");
      return data.workspaces || [];
    },
    async switchWorkspace(orgId) {
      const data = await request<InternalUser>("/internal/v1/workspaces/active", {
        method: "PATCH",
        body: { orgId }
      });
      return requireField(data.user, "user");
    },
```

修改读取方法，让 `query: { orgId }` 在 `orgId` 为 `undefined` 时不带参数：

```ts
    async listCustomers(orgId) {
      const data = await request<StoredCustomer[]>("/internal/v1/customers", { query: { orgId } });
      return data.customers || [];
    },
```

`listConversations()`、`listMessages()` 使用同样模式。

- [ ] **步骤 5：运行 Web API client 测试验证通过**

运行：`npm test -w @wangwang/web -- --test-name-pattern "workspace"`

预期：PASS，新增 Web API client 测试通过。

- [ ] **步骤 6：Commit**

```bash
git add apps/web/src/types.ts apps/web/src/internal-api.ts apps/web/test/internal-api.test.ts
git commit -m "feat(web): support workspace-aware login client"
```

---

### 任务 5：Web 登录页隐藏 Org 并增加空间选择

**文件：**
- 修改：`apps/web/src/App.tsx`
- 修改：`apps/web/test/customer-workflow.test.tsx`

- [ ] **步骤 1：编写登录页行为失败测试**

在 `apps/web/test/customer-workflow.test.tsx` 追加：

```tsx
test("login view hides raw org input and keeps API in advanced connection settings", () => {
  const html = renderToString(
    <LoginView
      serverBaseUrl=""
      email=""
      password=""
      loading={false}
      error=""
      advancedOpen={false}
      workspaceChoices={[]}
      onAdvancedOpenChange={() => undefined}
      onServerBaseUrlChange={() => undefined}
      onEmailChange={() => undefined}
      onPasswordChange={() => undefined}
      onPasswordLogin={() => undefined}
      onWorkspaceLogin={() => undefined}
      onSetupMode={() => undefined}
    />
  );

  assert.doesNotMatch(html, /Org/);
  assert.doesNotMatch(html, />API</);
  assert.match(html, /连接设置/);
});

test("login view renders workspace choices returned by the server", () => {
  const html = renderToString(
    <LoginView
      serverBaseUrl=""
      email="admin@example.com"
      password="secret"
      loading={false}
      error="请选择要进入的工作空间。"
      advancedOpen={false}
      workspaceChoices={[
        { orgId: "org_internal", name: "内部空间", roles: ["admin"] },
        { orgId: "org_other", name: "其他空间", roles: ["sales"] }
      ]}
      onAdvancedOpenChange={() => undefined}
      onServerBaseUrlChange={() => undefined}
      onEmailChange={() => undefined}
      onPasswordChange={() => undefined}
      onPasswordLogin={() => undefined}
      onWorkspaceLogin={() => undefined}
      onSetupMode={() => undefined}
    />
  );

  assert.match(html, /内部空间/);
  assert.match(html, /其他空间/);
  assert.match(html, /admin/);
  assert.match(html, /sales/);
});
```

- [ ] **步骤 2：运行登录页测试验证失败**

运行：`npm test -w @wangwang/web -- --test-name-pattern "login view"`

预期：FAIL，`LoginView` 缺少 `advancedOpen`、`workspaceChoices` 等 props。

- [ ] **步骤 3：调整 App 状态**

在 `apps/web/src/App.tsx` import 中加入：

```ts
import { WorkspaceSelectionRequiredError } from "./api";
```

将 `DEFAULT_ORG_ID` 改名为开发默认值：

```ts
const DEFAULT_ORG_ID = import.meta.env.VITE_TRADEBRIDGE_ORG_ID || "org_internal";
```

新增 state：

```ts
  const [advancedConnectionOpen, setAdvancedConnectionOpen] = useState(false);
  const [workspaceChoices, setWorkspaceChoices] = useState<InternalWorkspaceSummary[]>([]);
```

`runLogin()` catch 分支改成：

```ts
    } catch (error) {
      if (error instanceof WorkspaceSelectionRequiredError) {
        setWorkspaceChoices(error.workspaces);
        setAuthError("请选择要进入的工作空间。");
      } else {
        setAuthError(errorMessage(error));
      }
```

新增：

```ts
  function handleWorkspaceLogin(nextOrgId: string) {
    setOrgId(nextOrgId);
    setWorkspaceChoices([]);
    void runLogin(async () => {
      const result = await createInternalApiClient({ baseUrl: serverBaseUrl, token: "" }).login({
        orgId: nextOrgId,
        email: email.trim(),
        password
      });
      return { token: result.token, user: result.user };
    });
  }
```

修改 `handlePasswordLogin()`，不再传 `orgId`：

```ts
      const result = await createInternalApiClient({ baseUrl: serverBaseUrl, token: "" }).login({
        email: email.trim(),
        password
      });
```

- [ ] **步骤 4：调整 LoginView props 和 JSX**

把 `LoginViewProps` 改成：

```ts
interface LoginViewProps {
  serverBaseUrl: string;
  email: string;
  password: string;
  loading: boolean;
  error: string;
  advancedOpen: boolean;
  workspaceChoices: InternalWorkspaceSummary[];
  onAdvancedOpenChange(value: boolean): void;
  onServerBaseUrlChange(value: string): void;
  onEmailChange(value: string): void;
  onPasswordChange(value: string): void;
  onPasswordLogin(): void;
  onWorkspaceLogin(orgId: string): void;
  onSetupMode(): void;
}
```

删除登录表单里的 `Org` label。将 `API` label 移到按钮控制的高级区域：

```tsx
          <button
            className="text-button"
            type="button"
            onClick={() => props.onAdvancedOpenChange(!props.advancedOpen)}
          >
            <span>连接设置</span>
          </button>
          {props.advancedOpen && (
            <label>
              API
              <input
                placeholder="/internal 代理"
                value={props.serverBaseUrl}
                onChange={(event) => props.onServerBaseUrlChange(event.target.value)}
              />
            </label>
          )}
```

在 error 下方加入空间选择：

```tsx
        {props.workspaceChoices.length > 0 && (
          <div className="workspace-choice-list">
            {props.workspaceChoices.map((workspace) => (
              <button
                key={workspace.orgId}
                type="button"
                onClick={() => props.onWorkspaceLogin(workspace.orgId)}
              >
                <span>{workspace.name}</span>
                <small>{workspace.roles.join(" / ")}</small>
              </button>
            ))}
          </div>
        )}
```

- [ ] **步骤 5：更新 App 调用 LoginView**

在 `App()` 中调用 `LoginView` 时传入：

```tsx
        advancedOpen={advancedConnectionOpen}
        workspaceChoices={workspaceChoices}
        onAdvancedOpenChange={setAdvancedConnectionOpen}
        onWorkspaceLogin={handleWorkspaceLogin}
```

删除 `orgId` 和 `onOrgIdChange` 传入登录页。`SetupAdminView` 保留 `Org`，因为初始化第一个管理员仍需要选择底层空间。

- [ ] **步骤 6：运行登录页测试验证通过**

运行：`npm test -w @wangwang/web -- --test-name-pattern "login view"`

预期：PASS，新增登录页测试通过。

- [ ] **步骤 7：运行 Web 全量测试**

运行：`npm test -w @wangwang/web`

预期：PASS，Web 包所有测试通过。

- [ ] **步骤 8：Commit**

```bash
git add apps/web/src/App.tsx apps/web/test/customer-workflow.test.tsx
git commit -m "feat(web): hide raw org during login"
```

---

### 任务 6：文档更新与完整验证

**文件：**
- 修改：`docs/ENVIRONMENT.md`
- 修改：`docs/internal-trial-runbook.md`

- [ ] **步骤 1：更新环境文档**

在 `docs/ENVIRONMENT.md` 的 Web 登录说明中把“Org 填 `org_internal`，API 留空”改成：

```md
登录页默认只需要邮箱和密码。

- 本地开发默认空间：`org_internal`
- API：默认留空，Web 会通过 Vite proxy 访问同源 `/internal`
- 需要切换后端地址时，点击登录页的“连接设置”，填写服务端地址，例如 `http://127.0.0.1:5032`

初始化首个管理员时仍会显示 `Org`，本地开发填写 `org_internal`。
```

- [ ] **步骤 2：更新内测 runbook**

在 `docs/internal-trial-runbook.md` 的登录 curl 示例中加入无 org 登录：

```bash
curl -X POST http://127.0.0.1:5032/internal/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{
    "email": "owner@example.com",
    "password": "secret-password"
  }'
```

在同一节补充多空间选择时的显式 org 登录：

```bash
curl -X POST http://127.0.0.1:5032/internal/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{
    "orgId": "org_internal",
    "email": "owner@example.com",
    "password": "secret-password"
  }'
```

将 Web 操作说明改成：

```md
打开 `http://127.0.0.1:5173/` 后直接输入邮箱和密码。普通登录页不再要求填写 Org；如果当前邮箱存在于多个工作空间，页面会在密码校验成功后显示工作空间选择。
```

- [ ] **步骤 3：运行文档关键词检查**

运行：`rg -n "登录页.*Org|Org.*登录|API.*登录" docs/ENVIRONMENT.md docs/internal-trial-runbook.md`

预期：不再出现“普通登录必须填写 Org”的描述；允许出现“初始化首个管理员时仍会显示 Org”。

- [ ] **步骤 4：运行分包测试**

运行：

```bash
npm test -w @wangwang/database
npm test -w @wangwang/server
npm test -w @wangwang/web
```

预期：三条命令全部 PASS。

- [ ] **步骤 5：运行类型检查和构建**

运行：

```bash
npm run typecheck
npm run build
```

预期：两条命令全部 PASS。

- [ ] **步骤 6：手工 smoke 流程**

运行项目：

```bash
npm run dev
```

在浏览器访问 `http://127.0.0.1:5173/`，验证：

1. 登录页只显示邮箱、密码、连接设置、初始化首个管理员。
2. 不点击连接设置时，API 地址不显示。
3. 使用只有一个工作空间的账号登录后直接进入销售工作台。
4. 使用同时存在于 `org_internal` 和 `org_other` 的邮箱登录时，页面显示工作空间按钮。
5. 选择一个工作空间后进入工作台，客户列表来自所选空间。
6. 退出登录后再次进入登录页，仍不显示原始 `Org` 输入。

- [ ] **步骤 7：Commit**

```bash
git add docs/ENVIRONMENT.md docs/internal-trial-runbook.md
git commit -m "docs: describe workspace-aware login"
```

---

## 自检

- 规格覆盖度：
  - 普通登录不展示 `Org`：任务 5。
  - `API` 不作为主登录字段：任务 5。
  - 服务端登录可从邮箱密码推导空间：任务 2。
  - 多空间邮箱通过空间选择解决：任务 2、任务 4、任务 5。
  - 业务 API 从 session 推导 `orgId`：任务 3、任务 4。
  - 采集端继续使用 `orgId`：范围边界明确，不修改采集端协议。
  - 文档更新：任务 6。
- 占位符扫描：
  - 计划中没有使用禁止清单中的占位式描述。
  - 每个测试步骤都给出具体测试代码、运行命令和预期结果。
- 类型一致性：
  - 服务端、数据库、Web 统一使用 `InternalWorkspaceSummary`。
  - 底层隔离键继续叫 `orgId`，用户界面文案叫“工作空间”。
  - `WorkspaceSelectionRequiredError` 只存在于 Web API client，服务端仍返回 JSON error `workspace_selection_required`。
