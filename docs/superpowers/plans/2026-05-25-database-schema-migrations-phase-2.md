# Database Schema Migrations Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the initial PostgreSQL schema contract for the internal sync backend so future persistence work has stable tables, constraints, and migration metadata.

**Architecture:** `packages/database` continues to own the data model. A migration manifest exposes ordered SQL migrations from code, while raw `.sql` files live under `packages/database/migrations` for review and eventual database tooling. Tests assert required tables, idempotency constraints, and the “no cookie/token columns” security boundary.

**Tech Stack:** TypeScript, PostgreSQL SQL dialect, Node test runner with `tsx`.

---

### Task 1: Migration Manifest Test

**Files:**
- Create: `packages/database/test/migrations.test.ts`
- Create: `packages/database/src/migrations.ts`
- Modify: `packages/database/src/index.ts`

- [x] **Step 1: Write the failing migration manifest test**

Add tests that import `INTERNAL_SYNC_MIGRATIONS` from `../src/index.js` and assert:

```ts
assert.equal(INTERNAL_SYNC_MIGRATIONS.length, 1);
assert.equal(INTERNAL_SYNC_MIGRATIONS[0].id, "001_internal_sync_schema");
assert.match(INTERNAL_SYNC_MIGRATIONS[0].sql, /CREATE TABLE IF NOT EXISTS org/);
```

- [x] **Step 2: Run test and verify it fails**

Run: `npm test -w @wangwang/database`

Expected: the export or migration file is missing.

- [x] **Step 3: Implement migration manifest loader**

Create `packages/database/src/migrations.ts` with:

```ts
import fs from "node:fs";
import path from "node:path";

export interface DatabaseMigration {
  id: string;
  filename: string;
  sql: string;
}

export const INTERNAL_SYNC_MIGRATIONS: DatabaseMigration[] = [
  loadMigration("001_internal_sync_schema", "001_internal_sync_schema.sql")
];

function loadMigration(id: string, filename: string): DatabaseMigration {
  const filePath = path.resolve(import.meta.dirname, "../migrations", filename);
  return {
    id,
    filename,
    sql: fs.readFileSync(filePath, "utf8")
  };
}
```

- [x] **Step 4: Export migrations**

Add `export * from "./migrations.js";` to `packages/database/src/index.ts`.

### Task 2: Initial PostgreSQL Schema

**Files:**
- Create: `packages/database/migrations/001_internal_sync_schema.sql`
- Modify: `packages/database/test/migrations.test.ts`

- [x] **Step 1: Write schema contract tests**

Assert the migration includes the core tables from the platform design: `org`, `app_user`, `role`, `user_role`, `seller_account`, `collector_device`, `sync_batch`, `customer`, `conversation`, `message`, `customer_assignment`, `customer_tag`, `customer_note`, `follow_up_task`, `ai_summary`, `reply_suggestion`, and `audit_log`.

- [x] **Step 2: Assert idempotency and security constraints**

Assert the migration includes unique constraints for:

```text
seller_account(org_id, external_account_id)
collector_device(org_id, device_token_hash)
conversation(org_id, seller_account_id, external_conversation_id)
message(org_id, seller_account_id, conversation_id, external_message_id)
message(org_id, conversation_id, sent_at, direction, content_hash)
sync_batch(org_id, seller_account_id, source_batch_key)
```

Also assert the SQL does not contain column names for raw cookies or tokens such as `cookie2`, `sgcookie`, `ctoken`, `_tb_token_`, or `chat_token`.

- [x] **Step 3: Implement the SQL schema**

Create the initial schema with UUID primary keys, `org_id` on business tables, `created_at`/`updated_at` timestamps where useful, `raw_sanitized JSONB`, and `device_token_hash` instead of raw device tokens.

- [x] **Step 4: Run database tests**

Run: `npm test -w @wangwang/database`

Expected: migration and sync store tests pass.

### Task 3: Workspace Verification

**Files:**
- No additional source files.

- [x] **Step 1: Run focused verification**

Run:

```bash
npm test -w @wangwang/database
npm test -w @wangwang/server
```

Expected: both workspaces pass.

- [x] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm run build
```

Expected: all workspaces build and typecheck.
