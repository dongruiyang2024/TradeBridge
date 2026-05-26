import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore } from "@wangwang/database";
import { hashPassword } from "../src/auth.js";
import { createServer } from "../src/server.js";

const syncPayload = {
  sellerAccount: { externalAccountId: "seller-1", displayName: "Seller One" },
  device: { deviceId: "device-1", deviceName: "MacBook" },
  customers: [{ externalCustomerId: "customer-1", displayName: "Buyer One" }]
};

async function createDeviceAdminApp() {
  const store = new InMemorySyncStore();
  const admin = await store.createInternalUser({
    email: "admin@example.com",
    displayName: "Admin User",
    passwordHash: await hashPassword("secret"),
    roles: ["admin"]
  });
  await store.createInternalUser({
    email: "sales@example.com",
    displayName: "Sales User",
    passwordHash: await hashPassword("secret"),
    roles: ["sales"]
  });

  const app = await createServer({
    store,
    deviceTokens: ["static-device-token"]
  });

  return { app, store, admin };
}

async function registerDevice(app: Awaited<ReturnType<typeof createServer>>) {
  return app.inject({
    method: "POST",
    url: "/internal/v1/collector-devices",
    headers: await createInternalAuthHeaders(app),
    payload: {
      deviceName: "MacBook"
    }
  });
}

async function createInternalAuthHeaders(app: Awaited<ReturnType<typeof createServer>>) {
  const loginResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/auth/login",
    payload: {
      email: "admin@example.com",
      password: "secret"
    }
  });
  assert.equal(loginResponse.statusCode, 200);
  return { authorization: `Bearer ${loginResponse.json().token}` };
}

test("admin users can register, list, and revoke collector devices without exposing token hashes", async () => {
  const { app, store, admin } = await createDeviceAdminApp();
  const createResponse = await registerDevice(app);
  const authHeaders = await createInternalAuthHeaders(app);

  assert.equal(createResponse.statusCode, 200);
  const created = createResponse.json();
  assert.equal(created.ok, true);
  assert.equal(typeof created.token, "string");
  assert.equal(Object.hasOwn(created.device, "orgId"), false);
  assert.equal(created.device.deviceName, "MacBook");
  assert.equal(created.device.status, "active");
  assert.equal("token" in created.device, false);
  assert.equal("tokenHash" in created.device, false);

  const listResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/collector-devices",
    headers: authHeaders
  });
  assert.equal(listResponse.statusCode, 200);
  assert.deepEqual(listResponse.json().devices, [created.device]);

  const revokeResponse = await app.inject({
    method: "POST",
    url: `/internal/v1/collector-devices/${created.device.id}/revoke`,
    headers: authHeaders
  });
  assert.equal(revokeResponse.statusCode, 200);
  assert.equal(revokeResponse.json().device.status, "revoked");

  const auditLogs = await store.listAuditLogs();
  const collectorDeviceAuditLogs = auditLogs.filter((log) => log.targetType === "collector_device");
  assert.equal(collectorDeviceAuditLogs.length, 2);
  assert.equal(collectorDeviceAuditLogs[0].action, "collector_device.registered");
  assert.equal(collectorDeviceAuditLogs[0].actorUserId, admin.id);
  assert.equal(collectorDeviceAuditLogs[0].targetType, "collector_device");
  assert.equal(collectorDeviceAuditLogs[1].action, "collector_device.revoked");
  assert.equal(collectorDeviceAuditLogs[1].targetId, created.device.id);
});

test("registered collector device tokens can upload sync batches until revoked", async () => {
  const { app } = await createDeviceAdminApp();
  const createResponse = await registerDevice(app);
  const token = createResponse.json().token;
  const deviceId = createResponse.json().device.id;

  const syncResponse = await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: `Bearer ${token}` },
    payload: syncPayload
  });
  assert.equal(syncResponse.statusCode, 200);
  assert.equal(syncResponse.json().ok, true);

  await app.inject({
    method: "POST",
    url: `/internal/v1/collector-devices/${deviceId}/revoke`,
    headers: await createInternalAuthHeaders(app)
  });
  const rejectedResponse = await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: `Bearer ${token}` },
    payload: syncPayload
  });

  assert.equal(rejectedResponse.statusCode, 401);
  assert.deepEqual(rejectedResponse.json(), { ok: false, error: "unauthorized" });
});

test("static collector device tokens remain available as a development fallback", async () => {
  const { app } = await createDeviceAdminApp();
  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: "Bearer static-device-token" },
    payload: syncPayload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
});

test("sales users cannot manage collector devices", async () => {
  const { app } = await createDeviceAdminApp();
  const loginResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/auth/login",
    payload: {
      email: "sales@example.com",
      password: "secret"
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/collector-devices",
    headers: { authorization: `Bearer ${loginResponse.json().token}` },
    payload: {
      deviceName: "MacBook"
    }
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { ok: false, error: "forbidden" });
});
