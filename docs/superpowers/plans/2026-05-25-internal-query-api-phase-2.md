# Internal Query API Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose read-only internal APIs for customers, conversations, and message timelines backed by the sync store.

**Architecture:** Keep collector upload authentication separate from internal read authentication. Reuse `SyncStore` as the server boundary and implement SQL-backed query methods in `PostgresSyncStore`.

**Tech Stack:** TypeScript, Fastify, node:test, PostgreSQL via the existing `SqlClient` abstraction.

---

### Task 1: Postgres Query Methods

**Files:**
- Modify: `packages/database/src/postgres-sync-store.ts`
- Test: `packages/database/test/postgres-sync-store.test.ts`

- [x] **Step 1: Write failing tests**

Add tests proving `listCustomers`, `listConversations`, and `listMessages` issue parameterized SQL and map database rows to stored API types.

- [x] **Step 2: Verify RED**

Run: `npm test -w @wangwang/database`

Expected: FAIL because `PostgresSyncStore` query methods still return empty arrays.

- [x] **Step 3: Implement minimal SQL query methods**

Add SELECT queries with stable marker comments:
- `/* list_customers */`
- `/* list_conversations */`
- `/* list_messages */`

Keep `orgId` as the first parameter and support optional message filtering by `externalConversationId`.

- [x] **Step 4: Verify GREEN**

Run: `npm test -w @wangwang/database`

Expected: PASS.

### Task 2: Internal Read API

**Files:**
- Modify: `apps/server/src/server.ts`
- Test: `apps/server/test/internal-query-routes.test.ts`

- [x] **Step 1: Write failing route tests**

Add tests for:
- `GET /internal/v1/customers?orgId=org_internal`
- `GET /internal/v1/conversations?orgId=org_internal`
- `GET /internal/v1/conversations/conv-1/messages?orgId=org_internal`
- Collector device tokens cannot read internal data.
- Missing `orgId` returns a 400.

- [x] **Step 2: Verify RED**

Run: `npm test -w @wangwang/server`

Expected: FAIL with 404/401 because internal routes and tokens are not implemented yet.

- [x] **Step 3: Implement internal token boundary and routes**

Extend server options with `internalTokens`, parse `WANGWANG_INTERNAL_API_TOKENS`, and add read-only handlers that delegate to the store.

- [x] **Step 4: Verify GREEN**

Run: `npm test -w @wangwang/server`

Expected: PASS.

### Task 3: Full Verification

**Files:**
- None beyond Task 1 and Task 2.

- [x] **Step 1: Typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [x] **Step 2: Build**

Run: `npm run build`

Expected: PASS.
