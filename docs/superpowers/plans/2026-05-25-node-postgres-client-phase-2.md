# Node Postgres Client Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real `pg` client adapter so `apps/server` can use PostgreSQL automatically when `DATABASE_URL` is configured.

**Architecture:** `packages/database` exposes `NodePostgresClient` and `createNodePostgresClient(databaseUrl)`. The adapter wraps `pg.Pool` behind the existing `SqlClient` interface. `apps/server` keeps accepting an injected factory for tests, but defaults to `createNodePostgresClient` in runtime.

**Tech Stack:** TypeScript, `pg`, `@types/pg`, Fastify, Node test runner with `tsx`.

---

### Task 1: NodePostgresClient Adapter

**Files:**
- Create: `packages/database/test/node-postgres-client.test.ts`
- Create: `packages/database/src/node-postgres-client.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/database/package.json`
- Modify: `package-lock.json`

- [x] **Step 1: Write failing tests**

Add tests that instantiate `NodePostgresClient` with a fake pool and assert:

- `query()` forwards SQL and params.
- `rowCount: null` falls back to `rows.length`.
- `close()` calls `pool.end()`.

- [x] **Step 2: Run tests and verify failure**

Run: `npm test -w @wangwang/database`

Expected: `NodePostgresClient` export is missing.

- [x] **Step 3: Install dependencies**

Run:

```bash
npm install pg -w @wangwang/database
npm install -D @types/pg -w @wangwang/database
```

- [x] **Step 4: Implement adapter**

Create a `PgPoolLike` interface and `NodePostgresClient` class. `createNodePostgresClient(databaseUrl)` should create `new Pool({ connectionString: databaseUrl })`.

### Task 2: Server Runtime Default

**Files:**
- Modify: `apps/server/src/server.ts`
- Modify: `apps/server/test/server-bootstrap.test.ts`

- [x] **Step 1: Keep injectable factory tests**

Existing bootstrap tests keep using a fake SQL client factory.

- [x] **Step 2: Use default factory at runtime**

When `DATABASE_URL` is set and no test factory is supplied, server uses `createNodePostgresClient`.

### Task 3: Verification

**Files:**
- No additional source files.

- [x] **Step 1: Focused tests**

Run:

```bash
npm test -w @wangwang/database
npm test -w @wangwang/server
```

- [x] **Step 2: Full checks**

Run:

```bash
npm run typecheck
npm run build
```
