# Remaining Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the internal Alibaba seller communication platform from the current server/database MVP toward an internal trial-ready product.

**Architecture:** Keep the long-term split from the design document: `packages/onetalk-adapter` owns OneTalk access, `apps/collector-desktop` uploads sanitized sync batches, `apps/server` owns internal APIs and PostgreSQL writes, and `apps/web` becomes the sales workspace. Finish backend correctness first, then desktop ingestion, then Web workflows, then AI, then end-to-end trial readiness.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, React/Vite, node:test. Redis/BullMQ and Electron are introduced only when the immediately preceding server contracts are tested.

---

## Current Baseline

Already implemented:
- `packages/onetalk-adapter` with `detectSession()`, `fetchConversations()`, and `fetchMessages()`.
- `packages/database` with migrations, in-memory store, PostgreSQL client, transactional sync writes, collaboration records, auth/session records, collector devices, audit logs, and AI records.
- `packages/env` with automatic `.env.local` / `.env` loading for Node entrypoints.
- `apps/server` with collector sync upload, internal auth/RBAC, collector device lifecycle, internal customer/conversation/message APIs, collaboration APIs, AI summary/reply suggestion APIs, and PostgreSQL bootstrap.
- `apps/collector-desktop` with collector core, local cursor/retry state, uploader, and Electron MVP shell.
- `apps/web` as the internal sales workspace connected to `apps/server`.
- `test/e2e/internal-trial.test.ts` and `docs/internal-trial-runbook.md` for local internal trial readiness.

Remaining scope notes:
- Supervisor/admin dashboards were removed from this implementation scope by product decision.
- Production user provisioning beyond bootstrap/internal sessions, deployment packaging, observability, and real AI provider configuration remain future hardening work.
- Real collector data still depends on a valid local AliSupplier/OneTalk session on the operator machine.

## Execution Order

1. Phase 2.5: Server data integrity hardening.
2. Phase 2.6: Auth, roles, device registry, and audit.
3. Phase 3: Desktop collector MVP.
4. Phase 4: Sales Web workspace.
5. Phase 5: AI summaries and reply suggestions.
6. Phase 6: End-to-end internal trial readiness.

---

### Task 1: Server Data Integrity Hardening

**Files:**
- Modify: `packages/database/migrations/001_internal_sync_schema.sql`
- Modify: `packages/database/src/sql-client.ts`
- Modify: `packages/database/src/postgres-sync-store.ts`
- Modify: `packages/database/src/sync-types.ts`
- Modify: `packages/database/src/sync-store.ts`
- Modify: `apps/server/src/server.ts`
- Test: `packages/database/test/migrations.test.ts`
- Test: `packages/database/test/postgres-sync-store.test.ts`
- Test: `apps/server/test/sync-batches.test.ts`

- [x] **Step 1: Normalize org identity before real PostgreSQL usage**

Decision: keep public API field `orgId` as an internal org key string and change the initial schema so `org.id` and all `org_id` columns use `TEXT`. This matches the current server contract and avoids UUID coercion failures when `orgId` is `"org_internal"`.

Run first: `npm test -w @wangwang/database`

Expected RED after adding migration assertions for `org.id TEXT PRIMARY KEY` and all child `org_id TEXT` references.

- [x] **Step 2: Implement org identity migration update**

Update `packages/database/migrations/001_internal_sync_schema.sql` so:
- `org.id TEXT PRIMARY KEY`
- all `org_id` columns are `TEXT NOT NULL REFERENCES org(id)`
- existing unique constraints remain unchanged

Run: `npm test -w @wangwang/database`

Expected GREEN.

- [x] **Step 3: Add runtime sync batch validation**

Add validation tests in `apps/server/test/sync-batches.test.ts` for:
- missing `orgId` returns `400 { ok: false, error: "invalid_sync_batch" }`
- missing `sellerAccount.externalAccountId` returns the same error
- missing `device.deviceId` returns the same error
- message with invalid `direction` returns the same error

Run: `npm test -w @wangwang/server`

Expected RED.

- [x] **Step 4: Implement sync batch validation**

Create a small validator inside `apps/server/src/server.ts` or split to `apps/server/src/sync-validation.ts` if `server.ts` becomes too large. Validate shape before `store.acceptSyncBatch()`.

Run: `npm test -w @wangwang/server`

Expected GREEN.

- [x] **Step 5: Make PostgreSQL sync writes transactional**

Add fake-client tests proving `PostgresSyncStore.acceptSyncBatch()` issues `BEGIN`, `COMMIT`, and `ROLLBACK` on failure.

Run: `npm test -w @wangwang/database`

Expected RED.

- [x] **Step 6: Implement transaction wrapper**

In `PostgresSyncStore.acceptSyncBatch()`, wrap all SQL writes in:
- `BEGIN`
- existing entity upsert and message insert logic
- sync batch statistics update
- `COMMIT`
- `ROLLBACK` on thrown error

Run: `npm test -w @wangwang/database`

Expected GREEN.

- [x] **Step 7: Persist sync batch statistics**

Update `insertSyncBatch()` or add `updateSyncBatchResult()` so `sync_batch.accepted_count`, `sync_batch.rejected_count`, and `sync_batch.warnings` reflect the returned `SyncBatchResult`.

Run: `npm test -w @wangwang/database`

Expected GREEN with assertions on SQL params.

### Task 2: Auth, Roles, And Internal Sessions

**Files:**
- Create: `apps/server/src/auth.ts`
- Create: `apps/server/test/auth-routes.test.ts`
- Modify: `apps/server/src/server.ts`
- Modify: `packages/database/src/sync-types.ts`
- Modify: `packages/database/src/sync-store.ts`
- Modify: `packages/database/src/postgres-sync-store.ts`
- Test: `packages/database/test/sync-store.test.ts`
- Test: `packages/database/test/postgres-sync-store.test.ts`

- [x] **Step 1: Add internal user and role store contracts**

Define minimal types:
- `InternalUser`
- `InternalRole = "admin" | "supervisor" | "sales"`
- `CreateInternalUserInput`
- `InternalSession`

Add store methods:
- `createInternalUser(input)`
- `issueInternalSession(input)`
- `getInternalSession(token)`

Use `node:crypto` hashes for tokens. Password verification can start with a deterministic test helper, then move to `crypto.scrypt` before trial.

- [x] **Step 2: Add auth routes**

Implement:
- `POST /internal/v1/auth/login`
- `GET /internal/v1/me`

Keep existing `WANGWANG_INTERNAL_API_TOKENS` as bootstrap/admin fallback during development.

- [x] **Step 3: Add role middleware**

Add route-level helpers:
- `requireInternalAuth`
- `requireRole(["admin"])`
- `requireRole(["admin", "supervisor"])`

Apply to current internal read/write routes so collector tokens still cannot read.

Run: `npm test -w @wangwang/server`

Expected GREEN.

### Task 3: Collector Device Registry And Token Lifecycle

**Files:**
- Create: `apps/server/test/collector-device-routes.test.ts`
- Modify: `apps/server/src/server.ts`
- Modify: `packages/database/src/sync-types.ts`
- Modify: `packages/database/src/sync-store.ts`
- Modify: `packages/database/src/postgres-sync-store.ts`

- [x] **Step 1: Add device registry methods**

Store methods:
- `registerCollectorDevice(input)`
- `listCollectorDevices(orgId)`
- `revokeCollectorDevice(input)`
- `authenticateCollectorDevice(token)`

Persist only token hashes in database.

- [x] **Step 2: Add admin device APIs**

Implement:
- `POST /internal/v1/collector-devices`
- `GET /internal/v1/collector-devices?orgId=...`
- `POST /internal/v1/collector-devices/:id/revoke`

Return the raw token only once on registration.

- [x] **Step 3: Move collector upload authentication to device registry**

Update `POST /collector/v1/sync-batches` so static `WANGWANG_DEVICE_TOKENS` remains a development fallback, while registered device tokens are the production path.

### Task 4: Customer Assignment, Follow-Up Status, And Audit Log

**Files:**
- Create: `apps/server/test/customer-assignment-routes.test.ts`
- Create: `packages/database/test/audit-log.test.ts`
- Modify: `apps/server/src/server.ts`
- Modify: `packages/database/src/sync-types.ts`
- Modify: `packages/database/src/sync-store.ts`
- Modify: `packages/database/src/postgres-sync-store.ts`

- [x] **Step 1: Add assignment APIs**

Implement:
- `POST /internal/v1/customers/:externalCustomerId/assignment`
- `GET /internal/v1/customers/:externalCustomerId/assignment`

Scope by `orgId`, `sellerAccountExternalId`, and `externalCustomerId`.

- [x] **Step 2: Add follow-up task status update**

Implement:
- `PATCH /internal/v1/follow-up-tasks/:id`

Allow updating `status`, `assignedToUserId`, `dueAt`, and `title`.

- [x] **Step 3: Write audit records for sensitive actions**

Audit:
- assignment changes
- follow-up task status changes
- device registration/revocation
- future export actions

### Task 5: Desktop Collector MVP

**Files:**
- Create: `apps/collector-desktop/package.json`
- Create: `apps/collector-desktop/tsconfig.json`
- Create: `apps/collector-desktop/src/collector.ts`
- Create: `apps/collector-desktop/src/local-state.ts`
- Create: `apps/collector-desktop/src/uploader.ts`
- Create: `apps/collector-desktop/test/collector.test.ts`
- Modify: `package.json`

- [x] **Step 1: Build a Node collector core before Electron UI**

Use `packages/onetalk-adapter` to:
- detect session
- fetch conversations
- fetch messages page by page
- map local data into `SyncBatch`
- upload to `/collector/v1/sync-batches`

- [x] **Step 2: Add local cursor and retry state**

Use a local JSON file first for MVP:
- last successful cursor per seller account
- queued failed batches
- last error code and message

Move to SQLite only when the collector core is stable.

- [x] **Step 3: Add Electron shell**

After collector core tests pass, add Electron UI showing:
- session status
- seller account
- device registration state
- last sync time
- last error
- manual sync button

### Task 6: Sales Web Workspace

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/styles.scss`
- Create: `apps/web/src/internal-api.ts`
- Create: `apps/web/src/types.ts`

- [x] **Step 1: Switch from local viewer shell to CRM workspace shell**

First screen:
- customer list
- selected customer detail
- conversation timeline
- right-side collaboration panel for tags, notes, and tasks

- [x] **Step 2: Connect to `apps/server` internal APIs**

Use `Authorization: Bearer <internal token>` from a development token input until real login is wired to UI.

- [x] **Step 3: Add customer workflow tests**

Test:
- customer list renders
- selecting a customer loads conversations and messages
- adding note/tag/task updates panel state

### Task 7: AI Summary And Reply Suggestions

**Files:**
- Create: `apps/server/src/ai-service.ts`
- Create: `apps/server/test/ai-routes.test.ts`
- Modify: `apps/server/src/server.ts`
- Modify: `packages/database/src/sync-types.ts`
- Modify: `packages/database/src/sync-store.ts`
- Modify: `packages/database/src/postgres-sync-store.ts`

- [x] **Step 1: Add provider abstraction**

Define:
- `AiProvider`
- `generateCustomerSummary(input)`
- `generateReplySuggestion(input)`

Start with a deterministic fake provider in tests.

- [x] **Step 2: Add AI routes**

Implement:
- `POST /internal/v1/customers/:externalCustomerId/ai-summary`
- `GET /internal/v1/customers/:externalCustomerId/ai-summary`
- `POST /internal/v1/conversations/:externalConversationId/reply-suggestions`
- `GET /internal/v1/conversations/:externalConversationId/reply-suggestions`

- [x] **Step 3: Add async queue**

Introduce BullMQ/Redis after synchronous fake-provider routes are green. Keep sync fallback for local development.

### Task 8: End-To-End Trial Readiness

**Files:**
- Create: `test/e2e/internal-trial.test.ts`
- Create: `docs/internal-trial-runbook.md`
- Modify: `package.json`

- [x] **Step 1: Add local end-to-end test command**

Add a script that starts:
- `apps/server`
- a test collector core run with fixture data
- `apps/web`

Verify:
- collector uploads a batch
- Web can read customer timeline
- note/tag/task creation works
- collector token cannot read internal routes

- [x] **Step 2: Write internal trial runbook**

Document:
- required environment variables
- how to create admin token/user
- how to register device
- how to start collector
- how to verify no OneTalk cookie/token is sent to server

---

## Immediate Next Step

Start with **Task 1: Server Data Integrity Hardening**. It removes the biggest blocker for real PostgreSQL usage and reduces the chance that later collector/Web work rests on unstable storage semantics.
