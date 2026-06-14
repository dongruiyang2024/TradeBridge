import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  activateCollectorDevice,
  listOutboundMessages,
  markOutboundMessageDelivered,
  uploadSyncBatch,
  validateTradeBridgeAccount
} from "../src/background/tradebridge-client.js";

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

test("uploadSyncBatch posts collector batch with bearer token", async () => {
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({
      ok: true,
      acceptedCount: 1,
      rejectedCount: 0,
      nextCursor: "2026-05-26T08:10:00.000Z",
      warnings: []
    });
  };

  const result = await uploadSyncBatch({
    serverUrl: "http://127.0.0.1:5032",
    collectorToken: "collector-token",
    batch: {
      channel: "alibaba-im",
      channelAccount: { channel: "alibaba-im", externalAccountId: "seller-demo", surface: "onetalk-web" },
      sellerAccount: { externalAccountId: "seller-demo" },
      device: { deviceId: "chrome-extension-demo" }
    }
  });

  assert.equal(result.acceptedCount, 1);
  assert.equal(requests[0].url, "http://127.0.0.1:5032/collector/v1/sync-batches");
  assert.equal(requests[0].headers.get("authorization"), "Bearer collector-token");
  assert.equal(requests[0].headers.get("content-type"), "application/json");
  assert.equal(Object.hasOwn(await requests[0].json(), ["org", "Id"].join("")), false);
});

test("uploadSyncBatch maps 401 to tradebridge_unauthorized", async () => {
  globalThis.fetch = async () => Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  await assert.rejects(
    () =>
      uploadSyncBatch({
        serverUrl: "http://127.0.0.1:5032",
        collectorToken: "bad-token",
        batch: {
          channel: "alibaba-im",
          channelAccount: { channel: "alibaba-im", externalAccountId: "seller-demo", surface: "onetalk-web" },
          sellerAccount: { externalAccountId: "seller-demo" },
          device: { deviceId: "chrome-extension-demo" }
        }
      }),
    /tradebridge_unauthorized/
  );
});


test("activateCollectorDevice posts a Trade-Mind activation token without Bridge credentials", async () => {
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({
      ok: true,
      token: "collector-token",
      account: {
        id: "trade-mind:workspace-1:user-1:onetalk",
        email: "owner@example.com",
        displayName: "Owner One",
        roles: []
      },
      device: {
        id: "collector-device-1",
        externalDeviceId: "chrome-extension-demo",
        sellerAccountExternalId: "self-ali-1",
        deviceName: "Chrome Extension",
        status: "active"
      }
    });
  };

  const result = await activateCollectorDevice({
    serverUrl: "http://127.0.0.1:5032",
    activationToken: "tm-activation-token",
    sellerAccountExternalId: "self-ali-1",
    channelAccountExternalId: "self-login-1",
    deviceExternalId: "chrome-extension-demo",
    deviceName: "Chrome Extension"
  });
  const requestBody = await requests[0].json();

  assert.equal(result.token, "collector-token");
  assert.equal(result.account?.email, "owner@example.com");
  assert.equal(requests[0].url, "http://127.0.0.1:5032/collector/v1/auth/activate");
  assert.deepEqual(requestBody, {
    activationToken: "tm-activation-token",
    sellerAccountExternalId: "self-ali-1",
    channelAccountExternalId: "self-login-1",
    deviceExternalId: "chrome-extension-demo",
    deviceName: "Chrome Extension"
  });
});

test("activateCollectorDevice posts credentials and device metadata", async () => {
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({
      ok: true,
      token: "collector-token",
      device: {
        id: "collector-device-1",
        externalDeviceId: "chrome-extension-demo",
        sellerAccountExternalId: "seller-demo",
        deviceName: "Chrome Extension",
        status: "active"
      }
    });
  };

  const result = await activateCollectorDevice({
    serverUrl: "http://127.0.0.1:5032",
    email: "admin@example.com",
    password: "secret",
    sellerAccountExternalId: "seller-demo",
    deviceExternalId: "chrome-extension-demo",
    deviceName: "Chrome Extension"
  });
  const requestBody = await requests[0].json();

  assert.equal(result.token, "collector-token");
  assert.equal(result.device.externalDeviceId, "chrome-extension-demo");
  assert.equal(requests[0].url, "http://127.0.0.1:5032/collector/v1/auth/login");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].headers.get("content-type"), "application/json");
  assert.deepEqual(requestBody, {
    email: "admin@example.com",
    password: "secret",
    sellerAccountExternalId: "seller-demo",
    deviceExternalId: "chrome-extension-demo",
    deviceName: "Chrome Extension"
  });
});

test("activateCollectorDevice posts the Trade-Mind binding token when present", async () => {
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({
      ok: true,
      token: "collector-token",
      device: {
        id: "collector-device-1",
        externalDeviceId: "chrome-extension-demo",
        sellerAccountExternalId: "self-ali-1",
        deviceName: "Chrome Extension",
        status: "active"
      }
    });
  };

  await activateCollectorDevice({
    serverUrl: "http://127.0.0.1:5032",
    email: "admin@example.com",
    password: "secret",
    sellerAccountExternalId: "self-ali-1",
    tradeMindBindingToken: "tm-binding-token",
    channelAccountExternalId: "self-login-1",
    deviceExternalId: "chrome-extension-demo",
    deviceName: "Chrome Extension"
  });

  assert.deepEqual(await requests[0].json(), {
    email: "admin@example.com",
    password: "secret",
    sellerAccountExternalId: "self-ali-1",
    tradeMindBindingToken: "tm-binding-token",
    channelAccountExternalId: "self-login-1",
    deviceExternalId: "chrome-extension-demo",
    deviceName: "Chrome Extension"
  });
});

test("listOutboundMessages reads queued replies with collector token", async () => {
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({
      ok: true,
      messages: [
        {
          id: "outbound-1",
          sellerAccountExternalId: "seller-1",
          externalCustomerId: "customer-1",
          externalConversationId: "conv-1",
          content: "Hello",
          status: "queued",
          createdAt: "2026-05-27T07:00:00.000Z",
          updatedAt: "2026-05-27T07:00:00.000Z"
        }
      ]
    });
  };

  const messages = await listOutboundMessages({
    serverUrl: "http://127.0.0.1:5032",
    collectorToken: "device-token"
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, "outbound-1");
  assert.equal(requests[0].url, "http://127.0.0.1:5032/collector/v1/outbound-messages");
  assert.equal(requests[0].headers.get("authorization"), "Bearer device-token");
});

test("markOutboundMessageDelivered posts send result", async () => {
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({
      ok: true,
      message: {
        id: "outbound-1",
        sellerAccountExternalId: "seller-1",
        externalCustomerId: "customer-1",
        externalConversationId: "conv-1",
        content: "Hello",
        status: "sent",
        externalMessageId: "onetalk-msg-1",
        createdAt: "2026-05-27T07:00:00.000Z",
        updatedAt: "2026-05-27T07:00:01.000Z"
      }
    });
  };

  const result = await markOutboundMessageDelivered({
    serverUrl: "http://127.0.0.1:5032",
    collectorToken: "device-token",
    outboundMessageId: "outbound-1",
    status: "sent",
    externalMessageId: "onetalk-msg-1"
  });

  assert.equal(result.status, "sent");
  assert.equal(result.externalMessageId, "onetalk-msg-1");
  assert.equal(requests[0].url, "http://127.0.0.1:5032/collector/v1/outbound-messages/outbound-1/delivery");
  assert.equal(requests[0].method, "POST");
  assert.equal(await requests[0].text(), JSON.stringify({ status: "sent", externalMessageId: "onetalk-msg-1" }));
});

test("activateCollectorDevice can post only credentials and let the server assign collector scope", async () => {
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({
      ok: true,
      token: "collector-token",
      device: {
        id: "collector-device-1",
        externalDeviceId: "collector-generated",
        sellerAccountExternalId: "default-seller",
        deviceName: "TradeBridge Collector",
        status: "active"
      }
    });
  };

  const result = await activateCollectorDevice({
    serverUrl: "http://127.0.0.1:5032",
    email: "admin@example.com",
    password: "secret"
  });
  const requestBody = await requests[0].json();

  assert.equal(result.token, "collector-token");
  assert.equal(result.device.sellerAccountExternalId, "default-seller");
  assert.equal(result.device.externalDeviceId, "collector-generated");
  assert.deepEqual(requestBody, {
    email: "admin@example.com",
    password: "secret"
  });
});

test("activateCollectorDevice maps auth failures", async () => {
  globalThis.fetch = async () => Response.json({ ok: false, error: "invalid_credentials" }, { status: 401 });
  await assert.rejects(
    () =>
      activateCollectorDevice({
        serverUrl: "http://127.0.0.1:5032",
        email: "admin@example.com",
        password: "wrong",
        sellerAccountExternalId: "seller-demo",
        deviceExternalId: "chrome-extension-demo"
      }),
    /invalid_credentials/
  );

  globalThis.fetch = async () => Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  await assert.rejects(
    () =>
      activateCollectorDevice({
        serverUrl: "http://127.0.0.1:5032",
        email: "sales@example.com",
        password: "secret",
        sellerAccountExternalId: "seller-demo",
        deviceExternalId: "chrome-extension-demo"
      }),
    /forbidden/
  );
});

test("validateTradeBridgeAccount reads the account behind a collector token", async () => {
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({
      ok: true,
      account: {
        id: "user_1",
        email: "admin@example.com",
        displayName: "Admin User",
        roles: ["admin"]
      },
      device: {
        id: "collector-device-1",
        externalDeviceId: "chrome-extension-demo",
        sellerAccountExternalId: "seller-demo",
        deviceName: "Chrome Extension",
        status: "active"
      }
    });
  };

  const result = await validateTradeBridgeAccount({
    serverUrl: "http://127.0.0.1:5032",
    collectorToken: "collector-token"
  });

  assert.equal(result.account.email, "admin@example.com");
  assert.deepEqual(result.account.roles, ["admin"]);
  assert.equal(requests[0].url, "http://127.0.0.1:5032/collector/v1/me");
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].headers.get("authorization"), "Bearer collector-token");
});

test("validateTradeBridgeAccount maps 401 to tradebridge_unauthorized", async () => {
  globalThis.fetch = async () => Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  await assert.rejects(
    () =>
      validateTradeBridgeAccount({
        serverUrl: "http://127.0.0.1:5032",
        collectorToken: "bad-token"
      }),
    /tradebridge_unauthorized/
  );
});

test("activateCollectorDevice surfaces server activation errors", async () => {
  globalThis.fetch = async () =>
    Response.json({ ok: false, error: "invalid_collector_login_request" }, { status: 400 });

  await assert.rejects(
    () =>
      activateCollectorDevice({
        serverUrl: "http://127.0.0.1:5032",
        email: "admin@example.com",
        password: "secret"
      }),
    /invalid_collector_login_request/
  );
});

test("activateCollectorDevice includes HTTP status for non-json activation failures", async () => {
  globalThis.fetch = async () => new Response("not found", { status: 404 });

  await assert.rejects(
    () =>
      activateCollectorDevice({
        serverUrl: "http://127.0.0.1:5173",
        email: "admin@example.com",
        password: "secret"
      }),
    /collector_activation_failed_404/
  );
});
