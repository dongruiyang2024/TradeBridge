import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { InMemorySyncStore } from "@wangwang/database";
import { createServer } from "../src/server.js";

const syncPayload = {
  orgId: "org_internal",
  sellerAccount: { externalAccountId: "seller-1", displayName: "Seller One" },
  device: { deviceId: "device-1", deviceName: "MacBook" },
  customers: [{ externalCustomerId: "customer-1", displayName: "Buyer One" }]
};

function passwordHash(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

async function createAuthApp() {
  const store = new InMemorySyncStore();
  await store.createInternalUser({
    orgId: "org_internal",
    email: "admin@example.com",
    displayName: "Admin User",
    passwordHash: passwordHash("secret"),
    roles: ["admin"]
  });

  const app = await createServer({
    store,
    deviceTokens: ["device-token"],
    internalTokens: ["bootstrap-token"]
  });

  return { app, store };
}

async function login(app: Awaited<ReturnType<typeof createServer>>, email = "admin@example.com") {
  return app.inject({
    method: "POST",
    url: "/internal/v1/auth/login",
    payload: {
      orgId: "org_internal",
      email,
      password: "secret"
    }
  });
}

test("POST /internal/v1/auth/login issues a session token and GET /internal/v1/me resolves it", async () => {
  const { app } = await createAuthApp();
  const loginResponse = await login(app);

  assert.equal(loginResponse.statusCode, 200);
  const loginBody = loginResponse.json();
  assert.equal(loginBody.ok, true);
  assert.equal(typeof loginBody.token, "string");
  assert.equal(loginBody.user.email, "admin@example.com");
  assert.deepEqual(loginBody.user.roles, ["admin"]);
  assert.equal("tokenHash" in loginBody, false);

  const meResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/me",
    headers: { authorization: `Bearer ${loginBody.token}` }
  });

  assert.equal(meResponse.statusCode, 200);
  assert.deepEqual(meResponse.json().user, loginBody.user);
});

test("POST /internal/v1/auth/login rejects invalid credentials", async () => {
  const { app } = await createAuthApp();
  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/auth/login",
    payload: {
      orgId: "org_internal",
      email: "admin@example.com",
      password: "wrong-password"
    }
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false, error: "invalid_credentials" });
});

test("bootstrap internal tokens remain available as admin auth during development", async () => {
  const { app } = await createAuthApp();
  const response = await app.inject({
    method: "GET",
    url: "/internal/v1/me",
    headers: { authorization: "Bearer bootstrap-token" }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().user.id, "bootstrap");
  assert.deepEqual(response.json().user.roles, ["admin"]);
});

test("session tokens can access internal APIs while collector tokens cannot", async () => {
  const { app } = await createAuthApp();
  await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: "Bearer device-token" },
    payload: syncPayload
  });

  const loginResponse = await login(app);
  const internalResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/customers?orgId=org_internal",
    headers: { authorization: `Bearer ${loginResponse.json().token}` }
  });
  const collectorResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/customers?orgId=org_internal",
    headers: { authorization: "Bearer device-token" }
  });

  assert.equal(internalResponse.statusCode, 200);
  assert.equal(internalResponse.json().customers.length, 1);
  assert.equal(collectorResponse.statusCode, 401);
  assert.deepEqual(collectorResponse.json(), { ok: false, error: "internal_unauthorized" });
});

test("authenticated users without a permitted role cannot access internal APIs", async () => {
  const { app, store } = await createAuthApp();
  await store.createInternalUser({
    orgId: "org_internal",
    email: "norole@example.com",
    displayName: "No Role",
    passwordHash: passwordHash("secret"),
    roles: []
  });

  const loginResponse = await login(app, "norole@example.com");
  const response = await app.inject({
    method: "GET",
    url: "/internal/v1/customers?orgId=org_internal",
    headers: { authorization: `Bearer ${loginResponse.json().token}` }
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { ok: false, error: "forbidden" });
});
