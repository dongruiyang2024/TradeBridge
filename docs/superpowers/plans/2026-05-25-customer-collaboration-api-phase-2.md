# Customer Collaboration API Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-pass customer collaboration records: notes, tags, and follow-up tasks.

**Architecture:** Reuse the existing sync store abstraction as the server boundary. Scope collaboration records by `orgId`, `sellerAccountExternalId`, and `externalCustomerId` so customers from different seller accounts cannot collide.

**Tech Stack:** TypeScript, Fastify, node:test, PostgreSQL via `SqlClient`.

---

### Task 1: Shared Collaboration Types And Memory Store

**Files:**
- Modify: `packages/database/src/sync-types.ts`
- Modify: `packages/database/src/sync-store.ts`
- Test: `packages/database/test/sync-store.test.ts`

- [x] **Step 1: Write failing tests**

Add tests for creating/listing notes, adding/listing tags, and creating/listing follow-up tasks in `InMemorySyncStore`.

- [x] **Step 2: Verify RED**

Run: `npm test -w @wangwang/database`

Expected: FAIL because collaboration methods do not exist yet.

- [x] **Step 3: Implement minimal types and in-memory methods**

Add `CustomerScope`, note, tag, and follow-up task types. Store each record in memory keyed by the customer scope.

- [x] **Step 4: Verify GREEN**

Run: `npm test -w @wangwang/database`

Expected: PASS.

### Task 2: Postgres Collaboration Methods

**Files:**
- Modify: `packages/database/src/postgres-sync-store.ts`
- Test: `packages/database/test/postgres-sync-store.test.ts`

- [x] **Step 1: Write failing tests**

Add fake-client tests for:
- `createCustomerNote`
- `listCustomerNotes`
- `addCustomerTag`
- `listCustomerTags`
- `createFollowUpTask`
- `listFollowUpTasks`

- [x] **Step 2: Verify RED**

Run: `npm test -w @wangwang/database`

Expected: FAIL because Postgres collaboration methods do not exist.

- [x] **Step 3: Implement minimal SQL methods**

Resolve customer IDs by seller account and external customer ID, then insert/list records using parameterized SQL.

- [x] **Step 4: Verify GREEN**

Run: `npm test -w @wangwang/database`

Expected: PASS.

### Task 3: Internal Collaboration Routes

**Files:**
- Modify: `apps/server/src/server.ts`
- Test: `apps/server/test/customer-collaboration-routes.test.ts`

- [x] **Step 1: Write failing route tests**

Add tests for authorized internal create/list endpoints:
- `POST/GET /internal/v1/customers/:externalCustomerId/notes`
- `POST/GET /internal/v1/customers/:externalCustomerId/tags`
- `POST/GET /internal/v1/customers/:externalCustomerId/follow-up-tasks`

Each endpoint requires `orgId`, `sellerAccountExternalId`, and an internal bearer token.

- [x] **Step 2: Verify RED**

Run: `npm test -w @wangwang/server`

Expected: FAIL with 404 because routes are not implemented.

- [x] **Step 3: Implement routes and validation**

Add route handlers that call store methods and return simple `{ ok: true, ... }` payloads.

- [x] **Step 4: Verify GREEN**

Run: `npm test -w @wangwang/server`

Expected: PASS.

### Task 4: Full Verification

**Files:**
- None beyond the tasks above.

- [x] **Step 1: Typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [x] **Step 2: Build**

Run: `npm run build`

Expected: PASS.
