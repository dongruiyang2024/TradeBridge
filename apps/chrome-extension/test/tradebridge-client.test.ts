import assert from "node:assert/strict";
import { after, test } from "node:test";
import { activateCollectorDevice, uploadSyncBatch } from "../src/background/tradebridge-client.js";

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
          sellerAccount: { externalAccountId: "seller-demo" },
          device: { deviceId: "chrome-extension-demo" }
        }
      }),
    /tradebridge_unauthorized/
  );
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
