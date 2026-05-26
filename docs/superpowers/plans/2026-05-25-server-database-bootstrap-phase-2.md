# Server Database Bootstrap Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the internal server choose an in-memory sync store by default and a PostgreSQL-backed sync store when database configuration is provided.

**Architecture:** `createServer` remains the low-level constructor that receives an already-created store. New `createServerFromEnv` reads configuration, builds a store, runs migrations for SQL-backed mode, and then delegates to `createServer`. The SQL client is injected through a factory so tests do not require a live PostgreSQL service or the `pg` package.

**Tech Stack:** TypeScript, Fastify, `@wangwang/database`, Node test runner with `tsx`.

---

### Task 1: Bootstrap Tests

**Files:**
- Create: `apps/server/test/server-bootstrap.test.ts`
- Modify: `apps/server/src/server.ts`

- [x] **Step 1: Write failing tests**

Add tests for:

- `createServerFromEnv({ env: {}, deviceTokens: ["token"] })` uses `InMemorySyncStore` and still accepts sync batches.
- `createServerFromEnv({ env: { DATABASE_URL: "postgres://local/test" }, sqlClientFactory })` calls the factory, runs migrations, and returns a server whose sync route writes through `PostgresSyncStore`.

- [x] **Step 2: Run tests and verify failure**

Run: `npm test -w @wangwang/server`

Expected: `createServerFromEnv` export is missing.

### Task 2: Bootstrap Implementation

**Files:**
- Modify: `apps/server/src/server.ts`

- [x] **Step 1: Define bootstrap options**

Add `CreateServerFromEnvOptions` with `env`, `deviceTokens`, `logger`, and optional `sqlClientFactory`.

- [x] **Step 2: Implement store selection**

If `DATABASE_URL` is present, require `sqlClientFactory`, create a `SqlClient`, run `runMigrations(client)`, then instantiate `PostgresSyncStore`. If missing, instantiate `InMemorySyncStore`.

- [x] **Step 3: Update CLI startup**

Use `createServerFromEnv({ env: process.env, logger: true })` in the executable path.

### Task 3: Verification

**Files:**
- No additional source files.

- [x] **Step 1: Run focused tests**

Run:

```bash
npm test -w @wangwang/server
npm test -w @wangwang/database
```

- [x] **Step 2: Run full checks**

Run:

```bash
npm run typecheck
npm run build
```
