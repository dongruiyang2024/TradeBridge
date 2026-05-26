# TradeBridge 单租户移除 Org 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 TradeBridge 改造成单租户应用，彻底移除 `org` / `orgId` / `org_id` / 工作空间选择概念。

**架构：** 一个 TradeBridge 实例只服务一个业务主体，数据隔离不再依赖租户键。重写当前初始 schema，删除 `org` 表和所有 `org_id` 列；同步协议、Server API、Web client、桌面采集端、Chrome 扩展全部不再发送或接收 `orgId`。

**技术栈：** TypeScript、Fastify、React/Vite、Node test runner、tsx、PostgreSQL SQL migration、现有 `@wangwang/database` store 抽象。

---

## 范围边界

本计划采用方案 B：项目当前没有需要保留的生产 PostgreSQL 数据，可以重建本地库。执行后，已有包含 `org_id` 的本地数据库需要删除数据目录或重新初始化；本计划不提供多组织历史数据迁移。

本计划同时清理“工作空间”登录改造留下的 API 和 UI：`/internal/v1/workspaces`、`/internal/v1/workspaces/active`、`workspace_selection_required`、`WorkspaceSelectionRequiredError` 全部删除。CSS 类名中的布局词 `workspace-grid` 可作为页面布局命名保留，不属于组织概念；业务类型名 `WorkspaceState` 建议在本计划中重命名为 `DashboardState`，避免后续继续传播空间语义。

## 文件结构

- 修改：`packages/database/migrations/001_internal_sync_schema.sql`
  - 删除 `org` 表、所有 `org_id` 列、所有 `REFERENCES org(id)`、所有包含 `org_id` 的唯一约束和索引。
- 删除：`packages/database/migrations/002_workspace_login_facade.sql`
  - 该 migration 只服务多工作空间登录，单租户后不再需要。
- 修改：`packages/database/src/migrations.ts`
  - 只导出 `001_internal_sync_schema`。
- 修改：`packages/database/src/sync-types.ts`
  - 删除所有模型和输入类型中的 `orgId`。
  - 删除 `InternalWorkspaceSummary`、`SwitchInternalSessionOrgInput`。
  - 调整 `GetInternalUserCredentialsInput`、`IssueInternalSessionInput`、`CreateInternalUserInput`、协作 scope 类型。
- 修改：`packages/database/src/sync-store.ts`
  - 删除 `orgs` map、`ensureOrg()`、所有 key 里的 `orgId`。
  - 删除 `listInternalUserWorkspacesByEmail()`、`switchInternalSessionOrg()`。
- 修改：`packages/database/src/postgres-sync-store.ts`
  - 删除所有 SQL 的 `org_id` 字段、参数、过滤条件和返回映射。
  - 删除 `ensureOrg()`、workspace lookup、session org 切换。
- 修改：`apps/server/src/server.ts`
  - 删除 `SyncStore` 接口里的 org scoped 方法签名。
  - 登录、初始化、用户管理、采集设备、客户查询、协作和 AI 路由全部不再接收 `orgId`。
  - 删除 workspace endpoints 和 org scope helpers。
- 修改：`apps/web/src/types.ts`
  - 删除所有业务类型里的 `orgId`。
  - 删除工作空间选择相关类型和 client 方法。
- 修改：`apps/web/src/internal-api.ts`
  - 删除 `WorkspaceSelectionRequiredError`、`listWorkspaces()`、`switchWorkspace()`。
  - 所有请求不再拼接 `orgId` query/body。
- 修改：`apps/web/src/workspace-state.ts`
  - 重命名为 `dashboard-state.ts`，删除 state 里的 `orgId`。
- 修改：`apps/web/src/App.tsx`
  - 删除 `DEFAULT_ORG_ID`、`wangwang.orgId`、`orgId` state、工作空间选择 UI、初始化页 `Org` 输入、用户管理页 org 展示。
- 修改：`packages/onetalk-adapter/src/sync-mapper.ts`
  - mapper input/output 删除 `orgId`。
- 修改：`apps/collector-desktop/src/collector.ts`
  - 采集配置删除 `orgId`。
- 修改：`apps/collector-desktop/src/electron-main.ts`
  - 删除 `WANGWANG_ORG_ID` 必填环境变量。
- 修改：`apps/chrome-extension/src/shared/sync-types.ts`
  - 删除 `orgId`。
- 修改：`apps/chrome-extension/src/options/options.ts`
  - 删除 `orgId` 配置读取和校验。
- 修改：`apps/chrome-extension/src/options/options.html`
  - 删除 `Org ID` 输入。
- 修改：`.env.example`
  - 删除 `WANGWANG_DEFAULT_ORG_ID`、`WANGWANG_ORG_ID`。
- 修改：`docs/ENVIRONMENT.md`
  - 改为单实例说明。
- 修改：`docs/internal-trial-runbook.md`
  - curl 示例不再传 `orgId`。
- 修改：测试文件
  - `packages/database/test/*.test.ts`
  - `apps/server/test/*.test.ts`
  - `apps/web/test/*.test.ts`
  - `apps/web/test/*.test.tsx`
  - `apps/collector-desktop/test/*.test.ts`
  - `apps/chrome-extension/test/*.test.ts`
  - `packages/onetalk-adapter/test/*.test.ts`
  - `test/e2e/internal-trial.test.ts`

---

### 任务 1：重写数据库 schema 测试和 migration 出口

**文件：**
- 修改：`packages/database/test/migrations.test.ts`
- 修改：`packages/database/test/migration-runner.test.ts`
- 修改：`packages/database/migrations/001_internal_sync_schema.sql`
- 删除：`packages/database/migrations/002_workspace_login_facade.sql`
- 修改：`packages/database/src/migrations.ts`

- [ ] **步骤 1：编写失败的 migration 测试**

将 `packages/database/test/migrations.test.ts` 中关于 `org`、`org_id`、`workspace login facade` 的断言替换为单租户断言：

```ts
test("initial schema does not contain organization tables or columns", () => {
  const normalized = INTERNAL_SYNC_MIGRATIONS[0].sql.replace(/\s+/g, " ").toLowerCase();

  assert.doesNotMatch(normalized, /create table if not exists org/);
  assert.doesNotMatch(normalized, /\borg_id\b/);
  assert.doesNotMatch(normalized, /references org\(id\)/);
});

test("initial schema defines single-tenant uniqueness constraints", () => {
  const normalized = INTERNAL_SYNC_MIGRATIONS[0].sql.replace(/\s+/g, " ").toLowerCase();

  assert.match(normalized, /unique \(email\)/);
  assert.match(normalized, /unique \(name\)/);
  assert.match(normalized, /primary key \(user_id, role_id\)/);
  assert.match(normalized, /unique \(external_account_id\)/);
  assert.match(normalized, /unique \(device_token_hash\)/);
  assert.match(normalized, /unique \(seller_account_id, external_customer_id\)/);
  assert.match(normalized, /unique \(seller_account_id, external_conversation_id\)/);
  assert.match(normalized, /unique \(seller_account_id, conversation_id, external_message_id\)/);
  assert.match(normalized, /unique \(conversation_id, sent_at, direction, content_hash\)/);
  assert.match(normalized, /unique \(seller_account_id, source_batch_key\)/);
});

test("single-tenant schema is the only exported migration", () => {
  assert.equal(INTERNAL_SYNC_MIGRATIONS.length, 1);
  assert.equal(INTERNAL_SYNC_MIGRATIONS[0].id, "001_internal_sync_schema");
});
```

在 `packages/database/test/migration-runner.test.ts` 中，把对 `002_workspace_login_facade` 的参数断言改成：

```ts
assert.deepEqual(client.queries.at(-1)?.params, ["001_internal_sync_schema"]);
```

- [ ] **步骤 2：运行 migration 测试验证失败**

运行：`npm test -w @wangwang/database -- --test-name-pattern "schema|migration"`

预期：FAIL，输出包含 `create table if not exists org`、`org_id` 或 `002_workspace_login_facade` 相关断言失败。

- [ ] **步骤 3：重写初始 schema**

在 `packages/database/migrations/001_internal_sync_schema.sql` 中删除 `CREATE TABLE IF NOT EXISTS org` 整段，并按下面模式修改核心表：

```sql
CREATE TABLE IF NOT EXISTS app_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS role (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS user_role (
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS internal_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token_hash)
);
```

同步相关表使用如下约束形态：

```sql
UNIQUE (external_account_id)
UNIQUE (device_token_hash)
UNIQUE (seller_account_id, source_batch_key)
UNIQUE (seller_account_id, external_customer_id)
UNIQUE (seller_account_id, external_conversation_id)
UNIQUE (seller_account_id, conversation_id, external_message_id)
UNIQUE (conversation_id, sent_at, direction, content_hash)
UNIQUE (customer_id, user_id)
UNIQUE (customer_id, tag)
```

索引改成：

```sql
CREATE INDEX IF NOT EXISTS idx_message_conversation_sent_at ON message (conversation_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_customer_owner ON customer (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_task_due ON follow_up_task (status, due_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_user_invitation_email ON user_invitation (email);
CREATE INDEX IF NOT EXISTS idx_user_invitation_token_hash ON user_invitation (token_hash);
CREATE INDEX IF NOT EXISTS idx_app_user_email ON app_user (email);
CREATE INDEX IF NOT EXISTS idx_internal_session_user_id ON internal_session (user_id);
```

- [ ] **步骤 4：删除 workspace facade migration 并更新导出**

删除 `packages/database/migrations/002_workspace_login_facade.sql`。

修改 `packages/database/src/migrations.ts`：

```ts
export const INTERNAL_SYNC_MIGRATIONS: DatabaseMigration[] = [
  loadMigration("001_internal_sync_schema", "001_internal_sync_schema.sql")
];
```

- [ ] **步骤 5：运行 migration 测试验证通过**

运行：`npm test -w @wangwang/database -- --test-name-pattern "schema|migration"`

预期：PASS，migration 相关测试全部通过。

- [ ] **步骤 6：Commit**

```bash
git add packages/database/migrations packages/database/src/migrations.ts packages/database/test/migrations.test.ts packages/database/test/migration-runner.test.ts
git commit -m "refactor(database): remove org from initial schema"
```

---

### 任务 2：移除数据库类型和内存 store 的 org 维度

**文件：**
- 修改：`packages/database/src/sync-types.ts`
- 修改：`packages/database/src/sync-store.ts`
- 修改：`packages/database/test/sync-store.test.ts`
- 修改：`packages/database/test/audit-log.test.ts`

- [ ] **步骤 1：编写失败的类型和内存 store 测试**

在 `packages/database/test/sync-store.test.ts` 中删除 workspace lookup 和 session switch 测试，替换为单租户认证测试：

```ts
test("internal users are unique by email in single-tenant mode", async () => {
  const store = new InMemorySyncStore();
  const first = await store.createInternalUser({
    email: " Admin@Example.com ",
    displayName: "Admin",
    passwordHash: "hash-1",
    roles: ["admin"]
  });
  const second = await store.createInternalUser({
    email: "admin@example.com",
    displayName: "Admin Updated",
    passwordHash: "hash-2",
    roles: ["supervisor"]
  });

  assert.equal(second.id, first.id);
  assert.equal(second.email, "admin@example.com");
  assert.deepEqual(second.roles, ["supervisor"]);
  assert.equal((await store.listInternalUsers()).length, 1);
});

test("internal sessions resolve users without organization scope", async () => {
  const store = new InMemorySyncStore();
  await store.createInternalUser({
    email: "sales@example.com",
    displayName: "Sales",
    passwordHash: "hash",
    roles: ["sales"]
  });

  const session = await store.issueInternalSession({
    email: "sales@example.com",
    passwordHash: "hash",
    token: "session-token"
  });

  assert.equal(session.email, "sales@example.com");
  assert.deepEqual(session.roles, ["sales"]);
  assert.equal((await store.getInternalSession("session-token"))?.userId, session.userId);
});
```

在 `packages/database/test/audit-log.test.ts` 中把创建和查询改成不传 `orgId`：

```ts
await store.appendAuditLog({
  actorUserId: "user-1",
  action: "auth.login",
  targetType: "user",
  targetId: "user-1",
  metadata: { email: "admin@example.com" }
});

const logs = await store.listAuditLogs();
assert.equal(logs[0].action, "auth.login");
```

- [ ] **步骤 2：运行内存 store 测试验证失败**

运行：`npm test -w @wangwang/database -- --test-name-pattern "single-tenant|internal sessions|audit logs"`

预期：FAIL，TypeScript 或运行时报错包含 `orgId` 缺失、`listInternalUsers` 参数不匹配或 `issueInternalSession` 输入不匹配。

- [ ] **步骤 3：修改 `sync-types.ts`**

从以下接口删除 `orgId` 字段：`SyncBatch`、`StoredSellerAccount`、`StoredCustomer`、`StoredConversation`、`StoredMessage`、`ConversationCustomerScope`、`CustomerScope`、协作输入/输出、AI 输入/输出、`InternalUser`、`CreateInternalUserInput`、`InternalUserCredentials`、`StoredUserInvitation`、`InternalSession`、`CollectorDevice`。

将认证相关类型改成：

```ts
export interface GetInternalUserCredentialsInput {
  email: string;
}

export interface CreateInternalUserInput {
  email: string;
  displayName: string;
  passwordHash: string;
  roles?: InternalRole[];
  status?: string;
}

export interface IssueInternalSessionInput {
  email: string;
  passwordHash: string;
  token?: string;
  expiresAt?: string;
}

export interface InternalSession {
  token: string;
  tokenHash: string;
  userId: string;
  email: string;
  displayName: string;
  roles: InternalRole[];
  createdAt: string;
  expiresAt: string;
}
```

删除这些类型：`InternalWorkspaceSummary`、`SwitchInternalSessionOrgInput`。

- [ ] **步骤 4：修改 `sync-store.ts`**

删除：

```ts
private readonly orgs = new Map<string, { id: string; name: string }>();
private ensureOrg(...)
listInternalUserWorkspacesByEmail(...)
switchInternalSessionOrg(...)
```

把 key helper 改成不含 org：

```ts
function sellerAccountKey(externalAccountId: string): string {
  return externalAccountId;
}

function customerKey(sellerAccountExternalId: string, externalCustomerId: string): string {
  return `${sellerAccountExternalId}:${externalCustomerId}`;
}

function conversationKey(sellerAccountExternalId: string, externalConversationId: string): string {
  return `${sellerAccountExternalId}:${externalConversationId}`;
}

function internalUserKey(email: string): string {
  return email.trim().toLowerCase();
}
```

把 store 方法签名改成：

```ts
listSellerAccounts(): StoredSellerAccount[];
listCustomers(): StoredCustomer[];
listConversations(): StoredConversation[];
listMessages(externalConversationId?: string): StoredMessage[];
listInternalUsers(): Promise<InternalUser[]>;
getInternalUserCredentials(input: GetInternalUserCredentialsInput): Promise<InternalUserCredentials | null>;
getInternalUserCredentialsByEmail(input: GetInternalUserCredentialsByEmailInput): Promise<InternalUserCredentials[]>;
listAuditLogs(): Promise<StoredAuditLog[]>;
listCollectorDevices(): Promise<CollectorDevice[]>;
```

- [ ] **步骤 5：运行内存 store 测试验证通过**

运行：`npm test -w @wangwang/database -- --test-name-pattern "InMemory|internal users|internal sessions|audit logs"`

预期：PASS，相关内存 store 测试全部通过。

- [ ] **步骤 6：Commit**

```bash
git add packages/database/src/sync-types.ts packages/database/src/sync-store.ts packages/database/test/sync-store.test.ts packages/database/test/audit-log.test.ts
git commit -m "refactor(database): make in-memory store single tenant"
```

---

### 任务 3：移除 PostgreSQL store SQL 的 org 维度

**文件：**
- 修改：`packages/database/src/postgres-sync-store.ts`
- 修改：`packages/database/test/postgres-sync-store.test.ts`

- [ ] **步骤 1：编写失败的 PostgreSQL store 测试**

在 `packages/database/test/postgres-sync-store.test.ts` 中删除 workspace lookup 和 session switch 测试，替换为 SQL 不含 `org_id` 的断言：

```ts
test("PostgresSyncStore creates internal users without organization columns", async () => {
  const client = new FakeSqlClient();
  const store = new PostgresSyncStore(client);

  await store.createInternalUser({
    email: "admin@example.com",
    displayName: "Admin",
    passwordHash: "hash",
    roles: ["admin"]
  });

  const sql = client.queries.map((query) => query.sql).join("\n").toLowerCase();
  assert.doesNotMatch(sql, /\borg_id\b/);
  assert.match(sql, /insert into app_user \(email, display_name, password_hash, status\)/);
  assert.match(sql, /insert into role \(name\)/);
  assert.match(sql, /insert into user_role \(user_id, role_id\)/);
});

test("PostgresSyncStore stores sync batches without organization parameters", async () => {
  const client = new FakeSqlClient();
  const store = new PostgresSyncStore(client);

  await store.acceptSyncBatch(makeBatch());

  const sql = client.queries.map((query) => query.sql).join("\n").toLowerCase();
  assert.doesNotMatch(sql, /\borg_id\b/);
  assert.doesNotMatch(sql, /ensure_org/);
});
```

把 `makeBatch()` fixture 改成不含 `orgId`。

- [ ] **步骤 2：运行 PostgreSQL store 测试验证失败**

运行：`npm test -w @wangwang/database -- --test-name-pattern "PostgresSyncStore"`

预期：FAIL，输出包含 `org_id` 仍出现在 SQL 中或输入类型要求 `orgId`。

- [ ] **步骤 3：修改查询和写入 SQL**

在 `packages/database/src/postgres-sync-store.ts` 中删除 `ensureOrg()` 方法，并从所有 SQL 移除 `org_id`。核心写入语句改成以下形态：

```sql
INSERT INTO seller_account (external_account_id, display_name, last_seen_at, status)
VALUES ($1, $2, $3, 'active')
ON CONFLICT (external_account_id)
DO UPDATE SET display_name = EXCLUDED.display_name, last_seen_at = EXCLUDED.last_seen_at, updated_at = now()
RETURNING id
```

```sql
INSERT INTO customer (seller_account_id, external_customer_id, login_id, display_name, country, stage)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (seller_account_id, external_customer_id)
DO UPDATE SET login_id = EXCLUDED.login_id, display_name = EXCLUDED.display_name, country = EXCLUDED.country, stage = EXCLUDED.stage, updated_at = now()
RETURNING id
```

```sql
INSERT INTO conversation (seller_account_id, customer_id, external_conversation_id, last_message_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (seller_account_id, external_conversation_id)
DO UPDATE SET customer_id = EXCLUDED.customer_id, last_message_at = EXCLUDED.last_message_at, updated_at = now()
RETURNING id
```

认证写入改成：

```sql
INSERT INTO app_user (email, display_name, password_hash, status)
VALUES ($1, $2, $3, $4)
ON CONFLICT (email)
DO UPDATE SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash, status = EXCLUDED.status, updated_at = now()
RETURNING id, email, display_name, status, created_at, updated_at
```

所有 mapper 删除 `orgId: row.orgId`。

- [ ] **步骤 4：运行 PostgreSQL store 测试验证通过**

运行：`npm test -w @wangwang/database -- --test-name-pattern "PostgresSyncStore"`

预期：PASS，PostgreSQL store 测试全部通过。

- [ ] **步骤 5：运行 database 包全量测试**

运行：`npm test -w @wangwang/database`

预期：PASS，database 包 0 fail。

- [ ] **步骤 6：Commit**

```bash
git add packages/database/src/postgres-sync-store.ts packages/database/test/postgres-sync-store.test.ts
git commit -m "refactor(database): make postgres store single tenant"
```

---

### 任务 4：改造 Server API 为单租户接口

**文件：**
- 修改：`apps/server/src/server.ts`
- 修改：`apps/server/test/auth-routes.test.ts`
- 修改：`apps/server/test/internal-query-routes.test.ts`
- 修改：`apps/server/test/customer-collaboration-routes.test.ts`
- 修改：`apps/server/test/customer-assignment-routes.test.ts`
- 修改：`apps/server/test/collector-device-routes.test.ts`
- 修改：`apps/server/test/ai-routes.test.ts`
- 修改：`apps/server/test/sync-batches.test.ts`
- 修改：`apps/server/test/server-bootstrap.test.ts`

- [ ] **步骤 1：编写失败的 auth route 测试**

在 `apps/server/test/auth-routes.test.ts` 中把 setup/login/user management 断言改成单租户：

```ts
test("POST /internal/v1/setup/admin creates the first global admin", async () => {
  const store = new InMemorySyncStore();
  const app = await createServer({ store });

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/setup/admin",
    payload: {
      email: "admin@example.com",
      displayName: "Admin",
      password: "secret"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().user.email, "admin@example.com");
  assert.deepEqual(response.json().user.roles, ["admin"]);
});

test("POST /internal/v1/auth/login ignores organization concepts", async () => {
  const store = new InMemorySyncStore();
  await seedInternalUser(store, { email: "admin@example.com", password: "secret", roles: ["admin"] });
  const app = await createServer({ store });

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/auth/login",
    payload: { email: "admin@example.com", password: "secret" }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().user.email, "admin@example.com");
  assert.equal(Object.hasOwn(response.json().user, "orgId"), false);
});
```

删除这些测试：多 workspace 选择、workspace list、workspace switch、跨 org forbidden。

- [ ] **步骤 2：运行 server auth 测试验证失败**

运行：`npm test -w @wangwang/server -- --test-name-pattern "setup/admin|auth/login|workspace"`

预期：FAIL，输出包含 `invalid_setup_request`、`workspace_selection_required` 或 `orgId` 字段仍存在。

- [ ] **步骤 3：修改 `server.ts` 的认证和用户接口**

删除 `setupOrgLocks` 的 Map 语义，改成单个布尔锁：

```ts
let setupInProgress = false;
```

初始化管理员改成：

```ts
app.post("/internal/v1/setup/admin", async (request, reply) => {
  const email = bodyStringField(request.body, "email");
  const displayName = bodyStringField(request.body, "displayName");
  const password = bodyStringField(request.body, "password");
  if (!email || !displayName || !password) {
    return reply.code(400).send({ ok: false, error: "invalid_setup_request" });
  }

  if (setupInProgress) {
    return reply.code(409).send({ ok: false, error: "setup_in_progress" });
  }

  setupInProgress = true;
  try {
    const existingUsers = await store.listInternalUsers();
    if (existingUsers.some((user) => user.roles.includes("admin"))) {
      return reply.code(409).send({ ok: false, error: "admin_already_exists" });
    }
    if (existingUsers.some((user) => user.email === email.trim().toLowerCase())) {
      return reply.code(409).send({ ok: false, error: "user_already_exists" });
    }

    const user = await store.createInternalUser({
      email,
      displayName,
      passwordHash: await hashPassword(password),
      roles: ["admin"],
      status: "active"
    });
    return { ok: true, user };
  } finally {
    setupInProgress = false;
  }
});
```

登录接口改成只读 `email/password`：

```ts
const credentials = await store.getInternalUserCredentials({ email });
if (!credentials || !(await verifyPassword(password, credentials.passwordHash))) {
  await appendLoginFailedAuditLog(store, email);
  return reply.code(401).send({ ok: false, error: "invalid_credentials" });
}
return { ok: true, ...(await issueLoginSession(store, credentials)) };
```

删除 `/internal/v1/workspaces` 和 `/internal/v1/workspaces/active` 两个路由。

- [ ] **步骤 4：修改业务路由 scope**

删除这些 helpers：`requireOrgScope`、`queryOrgId`、`requestedOrgIdOrSession`、`publicWorkspaceSummary`。

把内部路由改成不接收 org：

```ts
app.get("/internal/v1/users", async (request, reply) => {
  const auth = await requireInternalAuth(request, reply, store, adminRoles);
  if (!auth) return;
  return { ok: true, users: await store.listInternalUsers() };
});

app.get("/internal/v1/customers", async (request, reply) => {
  const auth = await requireInternalAuth(request, reply, store, internalAccessRoles);
  if (!auth) return;
  return { ok: true, customers: await store.listCustomers() };
});
```

协作和 AI scope helper 改成：

```ts
function customerScopeFromQueryOrSession(query: unknown, params: { externalCustomerId?: string }): CustomerScope | null {
  const sellerAccountExternalId = queryStringField(query, "sellerAccountExternalId");
  if (!sellerAccountExternalId || !params.externalCustomerId) return null;
  return { sellerAccountExternalId, externalCustomerId: params.externalCustomerId };
}
```

- [ ] **步骤 5：运行 server 包测试验证通过**

运行：`npm test -w @wangwang/server`

预期：PASS，server 包 0 fail。

- [ ] **步骤 6：Commit**

```bash
git add apps/server/src/server.ts apps/server/test
git commit -m "refactor(server): remove organization scope from internal api"
```

---

### 任务 5：Web 工作台删除 org 和工作空间选择

**文件：**
- 修改：`apps/web/src/types.ts`
- 修改：`apps/web/src/internal-api.ts`
- 修改：`apps/web/src/api.ts`
- 移动：`apps/web/src/workspace-state.ts` -> `apps/web/src/dashboard-state.ts`
- 修改：`apps/web/src/App.tsx`
- 修改：`apps/web/test/internal-api.test.ts`
- 修改：`apps/web/test/customer-workflow.test.tsx`

- [ ] **步骤 1：编写失败的 Web client 测试**

在 `apps/web/test/internal-api.test.ts` 中删除 workspace selection 测试，新增：

```ts
test("internal API client does not send organization fields", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const client = createInternalApiClient({
    baseUrl: "http://server.test",
    token: "session-token",
    fetchImpl: async (input, init = {}) => {
      calls.push({ url: new URL(String(input)), init });
      return jsonResponse({
        ok: true,
        token: "session-token",
        user: {
          id: "user-1",
          email: "admin@example.com",
          displayName: "Admin",
          status: "active",
          roles: ["admin"],
          createdAt: "2026-05-26T00:00:00.000Z",
          updatedAt: "2026-05-26T00:00:00.000Z"
        },
        customers: [],
        conversations: [],
        messages: [],
        users: []
      });
    }
  });

  await client.login({ email: "admin@example.com", password: "secret" });
  await client.setupAdmin({ email: "admin@example.com", displayName: "Admin", password: "secret" });
  await client.listCustomers();
  await client.listConversations();
  await client.listMessages("conv-1");
  await client.listInternalUsers();

  assert.equal(calls.every((call) => !call.url.searchParams.has("orgId")), true);
  assert.equal(calls.every((call) => !String(call.init.body || "").includes("orgId")), true);
});
```

- [ ] **步骤 2：运行 Web client 测试验证失败**

运行：`npm test -w @wangwang/web -- --test-name-pattern "organization fields|workspace"`

预期：FAIL，输出包含 `orgId` 仍在 query/body 或 workspace 测试仍存在。

- [ ] **步骤 3：修改 Web 类型和 API client**

在 `apps/web/src/types.ts` 中删除 `orgId` 字段和工作空间方法：

```ts
login(input: { email: string; password: string }): Promise<LoginResult>;
setupAdmin(input: SetupAdminInput): Promise<InternalUser>;
listInternalUsers(): Promise<InternalUser[]>;
listCustomers(): Promise<StoredCustomer[]>;
listConversations(): Promise<StoredConversation[]>;
listMessages(externalConversationId: string): Promise<StoredMessage[]>;
```

在 `apps/web/src/internal-api.ts` 中删除 `WorkspaceSelectionRequiredError`、`listWorkspaces()`、`switchWorkspace()`，请求改成：

```ts
async listCustomers() {
  const data = await request<StoredCustomer[]>("/internal/v1/customers");
  return data.customers || [];
}

async listMessages(externalConversationId) {
  const data = await request<StoredMessage[]>(
    `/internal/v1/conversations/${encodeURIComponent(externalConversationId)}/messages`
  );
  return data.messages || [];
}
```

- [ ] **步骤 4：重命名和修改工作台 state**

将 `apps/web/src/workspace-state.ts` 移动为 `apps/web/src/dashboard-state.ts`。

把初始化函数改成：

```ts
export function createInitialDashboardState(): DashboardState {
  return {
    customers: [],
    conversations: [],
    messages: [],
    notes: [],
    tags: [],
    tasks: [],
    status: "等待登录"
  };
}
```

删除 `customerScope(orgId, customer)` 中的 org 入参，返回：

```ts
return {
  sellerAccountExternalId: customer.sellerAccountExternalId,
  externalCustomerId: customer.externalCustomerId
};
```

- [ ] **步骤 5：修改 `App.tsx`**

删除：

```ts
const DEFAULT_ORG_ID = ...
STORAGE_KEYS.orgId
const [orgId, setOrgId] = useState(...)
const [workspaceChoices, setWorkspaceChoices] = useState(...)
handleWorkspaceLogin
handleOrgIdChange
isSessionForConfig 中的 org 匹配
```

初始化管理员调用改成：

```ts
await client.setupAdmin({
  email: email.trim(),
  displayName: displayName.trim(),
  password
});
const result = await client.login({ email: email.trim(), password });
setSession({ token: result.token, user: result.user, serverBaseUrl });
```

`SetupAdminView` 删除 `Org` 输入。`UserManagementView` 标题改成：

```tsx
<p>{props.users.length} 个内部用户</p>
```

- [ ] **步骤 6：运行 Web 测试验证通过**

运行：`npm test -w @wangwang/web`

预期：PASS，Web 包 0 fail。

- [ ] **步骤 7：Commit**

```bash
git add apps/web/src apps/web/test
git commit -m "refactor(web): remove organization state from workspace"
```

---

### 任务 6：采集端、Chrome 扩展和 OneTalk mapper 删除 org

**文件：**
- 修改：`packages/onetalk-adapter/src/sync-mapper.ts`
- 修改：`packages/onetalk-adapter/test/sync-mapper.test.ts`
- 修改：`apps/collector-desktop/src/collector.ts`
- 修改：`apps/collector-desktop/src/electron-main.ts`
- 修改：`apps/collector-desktop/test/collector.test.ts`
- 修改：`apps/chrome-extension/src/shared/sync-types.ts`
- 修改：`apps/chrome-extension/src/background/storage.ts`
- 修改：`apps/chrome-extension/src/background/sync-orchestrator.ts`
- 修改：`apps/chrome-extension/src/options/options.ts`
- 修改：`apps/chrome-extension/src/options/options.html`
- 修改：`apps/chrome-extension/test/*.test.ts`

- [ ] **步骤 1：编写失败的 mapper 和 collector 测试**

在 `packages/onetalk-adapter/test/sync-mapper.test.ts` 中断言输出不含 org：

```ts
const batch = mapOneTalkSyncBatch({
  sellerAccountExternalId: "seller-1",
  sellerDisplayName: "Demo Seller",
  deviceId: "device-1",
  conversations: []
});

assert.equal(Object.hasOwn(batch, "orgId"), false);
```

在 `apps/collector-desktop/test/collector.test.ts` 中断言上传 payload 不含 org：

```ts
assert.equal(Object.hasOwn(await requests[0].json(), "orgId"), false);
```

- [ ] **步骤 2：运行采集相关测试验证失败**

运行：`npm test -w @wangwang/onetalk-adapter && npm test -w @wangwang/collector-desktop`

预期：FAIL，输出包含 `orgId` 仍存在或配置缺少 `WANGWANG_ORG_ID`。

- [ ] **步骤 3：修改 OneTalk mapper 和桌面采集端**

`packages/onetalk-adapter/src/sync-mapper.ts` 输入类型删除 `orgId`：

```ts
export interface MapOneTalkSyncBatchOptions {
  sellerAccountExternalId: string;
  sellerDisplayName?: string;
  deviceId: string;
  deviceName?: string;
  conversations: OneTalkConversation[];
}
```

输出 batch 不再设置 `orgId`。

`apps/collector-desktop/src/electron-main.ts` 删除：

```ts
orgId: requiredEnv("WANGWANG_ORG_ID"),
```

`apps/collector-desktop/src/collector.ts` 的 `CollectorOptions` 删除 `orgId`，调用 mapper 时不传 org。

- [ ] **步骤 4：修改 Chrome 扩展配置**

`apps/chrome-extension/src/shared/sync-types.ts` 删除 `orgId`。

`apps/chrome-extension/src/background/storage.ts` 校验改成：

```ts
if (!config?.serverUrl || !config.collectorToken || !config.sellerAccountExternalId || !config.deviceId) {
  return null;
}
```

`apps/chrome-extension/src/options/options.html` 删除：

```html
<label>Org ID <input name="orgId" value="org_internal" /></label>
```

`apps/chrome-extension/src/options/options.ts` 删除 `orgId` 的读取和回填。

- [ ] **步骤 5：运行采集和扩展测试验证通过**

运行：

```bash
npm test -w @wangwang/onetalk-adapter
npm test -w @wangwang/collector-desktop
npm test -w @wangwang/chrome-extension
```

预期：三个包全部 PASS。

- [ ] **步骤 6：Commit**

```bash
git add packages/onetalk-adapter apps/collector-desktop apps/chrome-extension
git commit -m "refactor(collector): remove organization from sync protocol"
```

---

### 任务 7：环境文档、E2E 和残留清理

**文件：**
- 修改：`.env.example`
- 修改：`docs/ENVIRONMENT.md`
- 修改：`docs/internal-trial-runbook.md`
- 修改：`test/e2e/internal-trial.test.ts`
- 修改：`package.json`
- 修改：涉及 build/typecheck 的 import 路径

- [ ] **步骤 1：编写失败的残留检查**

运行：

```bash
rg -n "orgId|org_id|WANGWANG_ORG_ID|WANGWANG_DEFAULT_ORG_ID|workspace_selection_required|workspaces/active|/internal/v1/workspaces|requireOrgScope|queryOrgId|requestedOrgIdOrSession" apps packages test docs .env.example -g '!docs/superpowers/**'
```

预期：命中当前待清理残留。执行本任务结束后，该命令只允许命中 `workspace` 作为文件夹、CSS 布局或 npm workspace 语义；不得命中组织语义。

- [ ] **步骤 2：修改环境变量模板**

`.env.example` 删除：

```dotenv
WANGWANG_DEFAULT_ORG_ID=org_internal
WANGWANG_ORG_ID=org_internal
```

保留采集端配置：

```dotenv
WANGWANG_SERVER_URL=http://127.0.0.1:5032
WANGWANG_SELLER_ACCOUNT_ID=seller-demo
WANGWANG_SELLER_DISPLAY_NAME='Demo Seller'
WANGWANG_COLLECTOR_DEVICE_ID=demo-device
WANGWANG_DEVICE_NAME='Demo Mac'
WANGWANG_COLLECTOR_TOKEN=change-me-device-token
```

- [ ] **步骤 3：修改文档**

`docs/ENVIRONMENT.md` 的登录说明改成：

```md
内部工作台只支持邮箱密码登录。新环境首次启动时，使用 Web 工作台的初始化入口创建首个管理员账号。项目按单实例运行，不需要配置组织 ID。
```

`docs/internal-trial-runbook.md` 中所有 curl 示例删除 `orgId`。初始化管理员请求改成：

```json
{
  "email": "admin@example.com",
  "displayName": "Admin",
  "password": "secret"
}
```

- [ ] **步骤 4：修改 E2E 测试**

`test/e2e/internal-trial.test.ts` 删除 `ORG_ID` 常量。同步 batch fixture 删除 `orgId`。登录 payload 改成：

```ts
payload: { email: "trial-admin@example.com", password: "secret" }
```

客户工作流初始化改成：

```ts
let dashboard = await loadCustomerList(createInitialDashboardState(), client);
```

删除跨 org forbidden 请求，替换为 collector token 无法读取内部 API 的断言：

```ts
const forbidden = await fetchImpl(new URL("/internal/v1/customers", baseUrl), {
  headers: { authorization: "Bearer dev-device-token" }
});
assert.equal(forbidden.status, 401);
```

- [ ] **步骤 5：运行残留检查验证通过**

运行：

```bash
rg -n "orgId|org_id|WANGWANG_ORG_ID|WANGWANG_DEFAULT_ORG_ID|workspace_selection_required|workspaces/active|/internal/v1/workspaces|requireOrgScope|queryOrgId|requestedOrgIdOrSession" apps packages test docs .env.example -g '!docs/superpowers/**'
```

预期：exit 1，无输出。

- [ ] **步骤 6：运行全量验证**

运行：

```bash
npm test -w @wangwang/database
npm test -w @wangwang/server
npm test -w @wangwang/web
npm test -w @wangwang/onetalk-adapter
npm test -w @wangwang/collector-desktop
npm test -w @wangwang/chrome-extension
npm run typecheck
npm run build
npm run test:e2e
```

预期：全部 exit 0。`npm run build` 应完成 Web 和 Chrome extension 的 Vite production build。

- [ ] **步骤 7：Commit**

```bash
git add .env.example docs/ENVIRONMENT.md docs/internal-trial-runbook.md test/e2e/internal-trial.test.ts package.json apps packages
git commit -m "chore: document single-tenant runtime"
```

---

## 自检清单

- 数据库初始 schema 不再包含 `org` 表、`org_id` 列、`REFERENCES org(id)`。
- 同步 batch 类型不再包含 `orgId`。
- Server API 不再接受 `orgId` query/body。
- Web UI 不再展示 `Org`、工作空间选择或组织标识。
- 桌面采集端和 Chrome 扩展不再配置组织 ID。
- 环境变量模板不再包含 `WANGWANG_ORG_ID` 和 `WANGWANG_DEFAULT_ORG_ID`。
- 跨组织隔离测试已删除，替换为单租户权限、角色和 collector token 隔离测试。
- 最终残留检查命令无输出。
- 全量测试、类型检查、生产构建、E2E 全部通过。

