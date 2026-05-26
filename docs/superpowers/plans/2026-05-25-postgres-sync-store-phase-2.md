# Postgres Sync Store Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PostgreSQL-backed sync store implementation and migration runner behind a small SQL client interface.

**Architecture:** `packages/database` exposes `SqlClient`, `runMigrations`, and `PostgresSyncStore`. Tests use a fake SQL client so the behavior is verified without requiring a live database. `apps/server` can continue using `InMemorySyncStore` until a real `SqlClient` is wired in by deployment code.

**Tech Stack:** TypeScript, PostgreSQL SQL, Node test runner with `tsx`.

---

### Task 1: Migration Runner

**Files:**
- Create: `packages/database/src/sql-client.ts`
- Create: `packages/database/src/migration-runner.ts`
- Create: `packages/database/test/migration-runner.test.ts`
- Modify: `packages/database/src/index.ts`

- [x] **Step 1: Write failing tests**

Add tests that pass a fake SQL client to `runMigrations` and assert it creates `schema_migration`, runs pending migration SQL, inserts migration ids, and skips already applied migrations.

- [x] **Step 2: Run tests and verify failure**

Run: `npm test -w @wangwang/database`

Expected: `runMigrations` export is missing.

- [x] **Step 3: Implement `SqlClient` and `runMigrations`**

`SqlClient` only needs `query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>` for now. `runMigrations` should use `INTERNAL_SYNC_MIGRATIONS`, create `schema_migration`, query existing ids, run pending SQL, and insert applied ids.

### Task 2: PostgreSQL Sync Store

**Files:**
- Create: `packages/database/src/postgres-sync-store.ts`
- Create: `packages/database/test/postgres-sync-store.test.ts`
- Modify: `packages/database/src/index.ts`

- [x] **Step 1: Write failing tests**

Add tests that create `PostgresSyncStore` with a fake SQL client and assert `acceptSyncBatch`:

- upserts seller account, device, customers, and conversations.
- inserts messages using `ON CONFLICT DO NOTHING`.
- reports accepted/rejected counts from insert row counts.
- uses `raw_sanitized` and does not store raw credential fields.

- [x] **Step 2: Run tests and verify failure**

Run: `npm test -w @wangwang/database`

Expected: `PostgresSyncStore` export is missing.

- [x] **Step 3: Implement SQL-backed store**

Implement enough SQL for current sync batch semantics. Use CTEs with `RETURNING id` for upserts, and parameterized values for all dynamic content.

### Task 3: Verification

**Files:**
- No additional source files.

- [x] **Step 1: Run focused tests**

Run:

```bash
npm test -w @wangwang/database
npm test -w @wangwang/server
```

- [x] **Step 2: Run full checks**

Run:

```bash
npm run typecheck
npm run build
```
