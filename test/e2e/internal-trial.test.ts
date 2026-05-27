import assert from "node:assert/strict";
import { test } from "node:test";
import type { FastifyInstance } from "fastify";
import { InMemorySyncStore, type SyncBatch } from "@wangwang/database";
import { collectOnce } from "../../apps/collector-desktop/src/collector.js";
import type {
  CollectorLastError,
  CollectorLocalState,
  CollectorStateStore,
  QueuedFailedBatch
} from "../../apps/collector-desktop/src/local-state.js";
import { hashPassword } from "../../apps/server/src/auth.js";
import { createServer } from "../../apps/server/src/server.js";
import { createInternalApiClient } from "../../apps/web/src/internal-api";
import {
  addTagToSelectedCustomer,
  createInitialDashboardState,
  createNoteForSelectedCustomer,
  createTaskForSelectedCustomer,
  loadCustomerList
} from "../../apps/web/src/dashboard-state";

const SELLER_ACCOUNT_ID = "seller-trial";
const SECRET_COOKIE = "one-talk-cookie-must-not-leave-collector";

test("internal trial flow uploads collector data and exercises the Web customer workflow", async () => {
  const store = new InMemorySyncStore();
  await store.createInternalUser({
    email: "trial-admin@example.com",
    displayName: "Trial Admin",
    passwordHash: await hashPassword("secret"),
    roles: ["admin"]
  });
  const app = await createServer({ store });

  await app.ready();
  const activationResponse = await app.inject({
    method: "POST",
    url: "/collector/v1/auth/login",
    payload: {
      email: "trial-admin@example.com",
      password: "secret",
      sellerAccountExternalId: SELLER_ACCOUNT_ID,
      deviceExternalId: "trial-device",
      deviceName: "Trial Mac"
    }
  });
  assert.equal(activationResponse.statusCode, 200);
  const collectorToken = activationResponse.json().token;

  const loginResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/auth/login",
    payload: { email: "trial-admin@example.com", password: "secret" }
  });
  assert.equal(loginResponse.statusCode, 200);
  const internalToken = loginResponse.json().token;
  const baseUrl = "http://tradebridge.internal";
  const fetchImpl = fastifyFetch(app);

  try {
    const state = new MemoryCollectorStateStore();
    const uploadResult = await collectOnce({
      sellerAccount: { externalAccountId: SELLER_ACCOUNT_ID, displayName: "Trial Seller" },
      device: { deviceId: "trial-device", deviceName: "Trial Mac" },
      state,
      adapter: fixtureCollectorAdapter(),
      uploadBatch: (batch) => uploadBatchThroughServer(app, batch, collectorToken),
      collectedAt: "2026-05-25T10:50:00.000Z"
    });

    assert.equal(uploadResult.acceptedCount, 2);
    assert.equal(uploadResult.rejectedCount, 0);
    assert.equal(await state.getCursor(SELLER_ACCOUNT_ID), "2026-05-25T10:50:00.000Z");

    const client = createInternalApiClient({ baseUrl, token: internalToken, fetchImpl });
    let dashboard = await loadCustomerList(createInitialDashboardState(), client);

    assert.equal(dashboard.customers.length, 1);
    assert.equal(dashboard.selectedCustomerId, "buyer-trial");
    assert.equal(dashboard.messages.length, 2);
    assert.deepEqual(
      dashboard.messages.map((message) => [message.externalMessageId, message.direction, message.content]),
      [
        ["trial-msg-1", "received", "Can you confirm delivery?"],
        ["trial-msg-2", "sent", "Delivery is booked for tomorrow."]
      ]
    );
    assert.doesNotMatch(JSON.stringify(dashboard.messages), new RegExp(SECRET_COOKIE));

    dashboard = await createNoteForSelectedCustomer(dashboard, client, "Buyer asked for delivery confirmation.");
    dashboard = await addTagToSelectedCustomer(dashboard, client, "priority");
    dashboard = await createTaskForSelectedCustomer(dashboard, client, "Send tracking number");

    assert.equal(dashboard.notes.at(-1)?.body, "Buyer asked for delivery confirmation.");
    assert.equal(dashboard.tags.at(-1)?.tag, "priority");
    assert.equal(dashboard.tasks.at(-1)?.title, "Send tracking number");

    const forbidden = await fetchImpl(new URL("/internal/v1/customers", baseUrl), {
      headers: { authorization: `Bearer ${collectorToken}` }
    });
    assert.equal(forbidden.status, 401);
  } finally {
    await app.close();
  }
});

function fixtureCollectorAdapter() {
  return {
    detectSession: () => ({
      cookies: { cookie2: SECRET_COOKIE },
      cookieNames: ["cookie2"],
      hasCtoken: false,
      hasTbToken: false,
      hasCookie2: true,
      hasSgcookie: false,
      logPaths: [],
      cookieDbPaths: [],
      tokenCachePaths: []
    }),
    fetchConversations: async () => ({
      html: "<html></html>",
      bootstrap: { aliId: "seller-ali" },
      conversations: [
        {
          cid: "conv-trial",
          contactAccountId: "buyer-trial",
          contactNick: "Trial Buyer",
          contactLoginId: "trial_buyer",
          country: "US",
          lastMessageTime: 1779706200000,
          selfAliId: "seller-ali"
        }
      ]
    }),
    fetchMessages: async () => ({
      status: 200,
      contentType: "application/json",
      code: 200,
      raw: {},
      messages: [
        {
          messageId: "trial-msg-1",
          senderAliId: "buyer-ali",
          messageType: "text",
          content: "Can you confirm delivery?",
          sendTime: 1779706140000
        },
        {
          messageId: "trial-msg-2",
          senderAliId: "seller-ali",
          messageType: "text",
          content: "Delivery is booked for tomorrow.",
          sendTime: 1779706200000
        }
      ]
    })
  };
}

async function uploadBatchThroughServer(app: FastifyInstance, batch: SyncBatch, collectorToken: string) {
  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: `Bearer ${collectorToken}` },
    payload: batch
  });
  const body = response.json();
  if (response.statusCode !== 200 || body.ok !== true) {
    throw new Error(body.error || `upload_failed_${response.statusCode}`);
  }
  return {
    acceptedCount: body.acceptedCount,
    rejectedCount: body.rejectedCount,
    nextCursor: body.nextCursor,
    warnings: body.warnings
  };
}

function fastifyFetch(app: FastifyInstance): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const response = await app.inject({
      method: request.method,
      url: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(request.headers.entries()),
      payload: init?.body ? String(init.body) : undefined
    });

    return new Response(response.body, {
      status: response.statusCode,
      headers: response.headers as HeadersInit
    });
  };
}

class MemoryCollectorStateStore implements CollectorStateStore {
  private state: CollectorLocalState = {
    cursors: {},
    failedBatches: []
  };

  async read(): Promise<CollectorLocalState> {
    return this.state;
  }

  async getCursor(sellerAccountExternalId: string): Promise<string | null> {
    return this.state.cursors[sellerAccountExternalId] || null;
  }

  async saveCursor(sellerAccountExternalId: string, cursor: string): Promise<void> {
    this.state.cursors[sellerAccountExternalId] = cursor;
  }

  async recordFailedBatch(batch: SyncBatch, reason: string): Promise<QueuedFailedBatch> {
    const failed = {
      id: `failed-${this.state.failedBatches.length + 1}`,
      batch,
      reason,
      createdAt: new Date().toISOString()
    };
    this.state.failedBatches.push(failed);
    return failed;
  }

  async listFailedBatches(): Promise<QueuedFailedBatch[]> {
    return this.state.failedBatches;
  }

  async clearFailedBatch(id: string): Promise<void> {
    this.state.failedBatches = this.state.failedBatches.filter((batch) => batch.id !== id);
  }

  async setLastError(error: CollectorLastError): Promise<void> {
    this.state.lastError = error;
  }

  async clearLastError(): Promise<void> {
    delete this.state.lastError;
  }
}
