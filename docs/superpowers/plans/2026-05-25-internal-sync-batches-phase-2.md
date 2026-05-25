# Internal Sync Batches Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first internal server capability: collector devices can upload OneTalk sync batches and the server can store them idempotently.

**Architecture:** `packages/database` owns domain types, validation-light normalization, content hashing, and an in-memory repository that mirrors the future PostgreSQL write path. `apps/server` owns the HTTP boundary for `POST /collector/v1/sync-batches`, including device token authorization and response shaping. The current local viewer API remains separate.

**Tech Stack:** TypeScript, npm workspaces, Node test runner with `tsx`, Fastify for the internal HTTP server.

---

### Task 1: Database Package Skeleton And Sync Store

**Files:**
- Create: `packages/database/package.json`
- Create: `packages/database/tsconfig.json`
- Create: `packages/database/src/index.ts`
- Create: `packages/database/src/sync-types.ts`
- Create: `packages/database/src/sync-store.ts`
- Create: `packages/database/test/sync-store.test.ts`
- Modify: `package-lock.json`

- [ ] **Step 1: Write the failing sync store tests**

Create tests for these behaviors:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore } from "../src/index.js";

test("acceptSyncBatch stores seller account, customer, conversation, and messages", async () => {
  const store = new InMemorySyncStore();
  const result = await store.acceptSyncBatch({
    orgId: "org_internal",
    sellerAccount: { externalAccountId: "seller-1", displayName: "Seller One" },
    device: { deviceId: "device-1", deviceName: "MacBook" },
    cursor: { since: "2026-05-01T00:00:00.000Z" },
    sourceMeta: { collectedAt: "2026-05-25T10:00:00.000Z", collectorVersion: "0.1.0" },
    customers: [{ externalCustomerId: "customer-1", loginId: "buyer", displayName: "Buyer", country: "US" }],
    conversations: [{
      externalConversationId: "conv-1",
      externalCustomerId: "customer-1",
      lastMessageAt: "2026-05-25T09:00:00.000Z"
    }],
    messages: [{
      externalConversationId: "conv-1",
      externalMessageId: "msg-1",
      direction: "received",
      content: "hello",
      sentAt: "2026-05-25T09:00:00.000Z"
    }]
  });

  assert.equal(result.acceptedCount, 1);
  assert.equal(result.rejectedCount, 0);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.nextCursor, "2026-05-25T09:00:00.000Z");
  assert.equal(store.listMessages("org_internal").length, 1);
});

test("acceptSyncBatch is idempotent by external message id", async () => {
  const store = new InMemorySyncStore();
  const batch = {
    orgId: "org_internal",
    sellerAccount: { externalAccountId: "seller-1" },
    device: { deviceId: "device-1" },
    conversations: [{ externalConversationId: "conv-1" }],
    messages: [
      { externalConversationId: "conv-1", externalMessageId: "msg-1", direction: "sent", content: "same", sentAt: "2026-05-25T09:00:00.000Z" },
      { externalConversationId: "conv-1", externalMessageId: "msg-1", direction: "sent", content: "same", sentAt: "2026-05-25T09:00:00.000Z" }
    ]
  } as const;

  const first = await store.acceptSyncBatch(batch);
  const second = await store.acceptSyncBatch(batch);

  assert.equal(first.acceptedCount, 1);
  assert.equal(first.rejectedCount, 1);
  assert.equal(second.acceptedCount, 0);
  assert.equal(second.rejectedCount, 2);
  assert.equal(store.listMessages("org_internal").length, 1);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -w @wangwang/database`

Expected: npm reports the workspace does not exist.

- [ ] **Step 3: Implement the package and store**

Implement `SyncBatch`, `SyncBatchResult`, `StoredMessage`, and `InMemorySyncStore`. Use a unique key of `orgId + sellerAccount.externalAccountId + externalConversationId + externalMessageId` when the message has `externalMessageId`; otherwise use `orgId + seller + conversation + sentAt + direction + sha256(content)`.

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test -w @wangwang/database`

Expected: database sync store tests pass.

### Task 2: Internal Server Sync Batch Route

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/server.ts`
- Create: `apps/server/test/sync-batches.test.ts`
- Modify: `package-lock.json`

- [ ] **Step 1: Write the failing HTTP route tests**

Create tests with Fastify `inject`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore } from "@wangwang/database";
import { createServer } from "../src/server.js";

test("POST /collector/v1/sync-batches requires a registered device token", async () => {
  const app = await createServer({ store: new InMemorySyncStore(), deviceTokens: ["device-token"] });
  const response = await app.inject({ method: "POST", url: "/collector/v1/sync-batches", payload: {} });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false, error: "unauthorized" });
});

test("POST /collector/v1/sync-batches accepts a valid batch", async () => {
  const store = new InMemorySyncStore();
  const app = await createServer({ store, deviceTokens: ["device-token"] });
  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: "Bearer device-token" },
    payload: {
      orgId: "org_internal",
      sellerAccount: { externalAccountId: "seller-1" },
      device: { deviceId: "device-1" },
      conversations: [{ externalConversationId: "conv-1" }],
      messages: [{ externalConversationId: "conv-1", externalMessageId: "msg-1", direction: "received", content: "hello", sentAt: "2026-05-25T09:00:00.000Z" }]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().acceptedCount, 1);
  assert.equal(store.listMessages("org_internal").length, 1);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -w @wangwang/server`

Expected: npm reports the workspace does not exist.

- [ ] **Step 3: Implement `createServer` and route**

Create a Fastify app with `GET /health` and `POST /collector/v1/sync-batches`. The POST route checks `Authorization: Bearer <device_token>` against the provided `deviceTokens` set, calls `store.acceptSyncBatch`, and returns `{ ok: true, ...result }`.

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test -w @wangwang/server`

Expected: server route tests pass.

### Task 3: Workspace Integration

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Update root scripts**

Include `@wangwang/database` and `@wangwang/server` in `build` and `typecheck`. Add `dev:server` for the new internal server.

- [ ] **Step 2: Refresh npm metadata**

Run: `npm install`

Expected: npm links `@wangwang/database` and `@wangwang/server`.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -w @wangwang/database
npm test -w @wangwang/server
```

Expected: both workspaces pass.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm test -w @wangwang/onetalk-adapter
npm test -w @wangwang/api
npm run typecheck
npm run build
```

Expected: all commands exit 0.
