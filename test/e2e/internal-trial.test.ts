import assert from "node:assert/strict";
import { test } from "node:test";
import type { FastifyInstance } from "fastify";
import { InMemorySyncStore, type SyncBatch } from "@wangwang/database";
import { runSyncOnce } from "../../apps/chrome-extension/src/background/sync-orchestrator.js";
import type { ExtensionConfig, ExtensionStatus } from "../../apps/chrome-extension/src/shared/sync-types.js";
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
const DEVICE_ID = "chrome-extension-trial";
const SECRET_COOKIE = "one-talk-cookie-must-not-leave-extension";

test("internal trial flow uploads Chrome extension data and exercises the Web customer workflow", async () => {
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
      deviceExternalId: DEVICE_ID,
      deviceName: "Chrome Extension"
    }
  });
  assert.equal(activationResponse.statusCode, 200);
  const activation = activationResponse.json();
  assert.equal(activation.device.sellerAccountExternalId, SELLER_ACCOUNT_ID);
  assert.equal(activation.device.externalDeviceId, DEVICE_ID);
  assert.equal(activation.device.deviceName, "Chrome Extension");
  const collectorToken = activation.token;

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
    const extensionState = new MemoryExtensionStateStore({
      serverUrl: baseUrl,
      collectorToken,
      sellerAccountExternalId: SELLER_ACCOUNT_ID,
      sellerAccountDisplayName: "Trial Seller",
      deviceId: DEVICE_ID,
      deviceName: "Chrome Extension"
    });
    const syncResult = await runSyncOnce({
      stateStore: extensionState,
      onetalkClient: fixtureOnetalkWebClient(),
      uploadSyncBatch: (options) => uploadBatchThroughServer(app, options.batch, collectorToken),
      now: () => new Date("2026-05-25T10:50:00.000Z")
    });

    assert.equal(syncResult.ok, true);
    assert.equal(syncResult.acceptedCount, 2);
    assert.equal(syncResult.rejectedCount, 0);
    assert.equal(extensionState.status.nextCursor, "2026-05-25T10:50:00.000Z");

    const client = createInternalApiClient({ baseUrl, token: internalToken, fetchImpl });
    let dashboard = await loadCustomerList(createInitialDashboardState(), client);

    assert.equal(dashboard.customers.length, 1);
    assert.equal(dashboard.selectedCustomerId, "buyer-trial");
    assert.equal(dashboard.customers[0].channel, "alibaba-im");
    assert.equal(dashboard.customers[0].channelAccountExternalId, SELLER_ACCOUNT_ID);
    assert.equal(dashboard.customers[0].channelSurface, "onetalk-web");
    assert.equal(dashboard.conversations[0].channel, "alibaba-im");
    assert.equal(dashboard.conversations[0].channelSurface, "onetalk-web");
    assert.equal(dashboard.messages.length, 2);
    assert.deepEqual([...new Set(dashboard.messages.map((message) => message.channel))], ["alibaba-im"]);
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

function fixtureOnetalkWebClient() {
  return {
    fetchWeblite: async () => ({
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
    getChatMessages: async () => ({
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
          sendTime: 1779706140000,
          cookie2: SECRET_COOKIE
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

class MemoryExtensionStateStore {
  status: ExtensionStatus = {};

  constructor(private readonly config: ExtensionConfig) {}

  async getConfig(): Promise<ExtensionConfig> {
    return this.config;
  }

  async getStatus(): Promise<ExtensionStatus> {
    return this.status;
  }

  async saveStatus(status: ExtensionStatus): Promise<void> {
    this.status = status;
  }
}
