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

async function createAuthApp() {
  const store = new InMemorySyncStore();
  await store.createInternalUser({
    email: "admin@example.com",
    displayName: "Admin User",
    passwordHash: await hashPassword("secret"),
    roles: ["admin"]
  });

  const app = await createServer({ store });

  return { app, store };
}

async function login(app: Awaited<ReturnType<typeof createServer>>, email = "admin@example.com") {
  return app.inject({
    method: "POST",
    url: "/internal/v1/auth/login",
    payload: {
      email,
      password: "secret"
    }
  });
}

async function createInternalAuthHeaders(app: Awaited<ReturnType<typeof createServer>>, email = "admin@example.com") {
  const loginResponse = await login(app, email);
  assert.equal(loginResponse.statusCode, 200);
  return { authorization: `Bearer ${loginResponse.json().token}` };
}

async function createCollectorToken(store: InMemorySyncStore, externalDeviceId = "device-1"): Promise<string> {
  const registered = await store.registerCollectorDevice({
    sellerAccountExternalId: "seller-1",
    externalDeviceId,
    deviceName: "Test Device",
    token: "device-token"
  });
  return registered.token;
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

test("POST /internal/v1/auth/login ignores organization concepts", async () => {
  const { app } = await createAuthApp();
  const loginResponse = await login(app);

  assert.equal(loginResponse.statusCode, 200);
  const loginBody = loginResponse.json();
  assert.equal(loginBody.ok, true);
  assert.equal(typeof loginBody.token, "string");
  assert.equal(Object.hasOwn(loginBody.user, ["org", "Id"].join("")), false);
  assert.equal(loginBody.user.email, "admin@example.com");

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
      email: "admin@example.com",
      password: "wrong-password"
    }
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false, error: "invalid_credentials" });
});

test("POST /internal/v1/auth/login rejects disabled users with valid passwords", async () => {
  const { app, store } = await createAuthApp();
  await store.createInternalUser({
    email: "disabled@example.com",
    displayName: "Disabled User",
    passwordHash: await hashPassword("secret"),
    roles: ["admin"],
    status: "disabled"
  });

  const response = await login(app, "disabled@example.com");

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false, error: "invalid_credentials" });
});

test("POST /internal/v1/auth/login returns 401 when failed-login audit cannot be written", async () => {
  const { app, store } = await createAuthApp();
  const originalAppendAuditLog = store.appendAuditLog.bind(store);
  store.appendAuditLog = async (input) => {
    if (input.action === "auth.login.failed") throw new Error("audit_org_missing");
    return originalAppendAuditLog(input);
  };

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/auth/login",
    payload: { email: "nobody@example.com", password: "wrong" }
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false, error: "invalid_credentials" });
});

test("unknown bearer tokens cannot access internal APIs", async () => {
  const { app } = await createAuthApp();
  const response = await app.inject({
    method: "GET",
    url: "/internal/v1/me",
    headers: { authorization: "Bearer bootstrap-token" }
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false, error: "internal_unauthorized" });
});

test("POST /collector/v1/auth/login activates a collector device for admin users", async () => {
  const { app, store } = await createAuthApp();
  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/auth/login",
    payload: {
      email: "admin@example.com",
      password: "secret",
      sellerAccountExternalId: "seller-1",
      deviceExternalId: "chrome-extension-1",
      deviceName: "Chrome Extension"
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.token, "string");
  assert.equal(body.device.externalDeviceId, "chrome-extension-1");
  assert.equal(body.device.sellerAccountExternalId, "seller-1");
  assert.equal(body.device.deviceName, "Chrome Extension");
  assert.equal(body.device.status, "active");
  assert.equal("token" in body.device, false);
  assert.equal("tokenHash" in body.device, false);

  const syncResponse = await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: `Bearer ${body.token}` },
    payload: { ...syncPayload, device: { deviceId: "chrome-extension-1", deviceName: "Chrome Extension" } }
  });
  assert.equal(syncResponse.statusCode, 200);

  const auditLogs = await store.listAuditLogs();
  assert.equal(auditLogs.some((log) => log.action === "collector_device.activated"), true);
});

test("POST /collector/v1/auth/login stores Trade-Mind binding tokens without exposing them publicly", async () => {
  const { app, store } = await createAuthApp();
  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/auth/login",
    payload: {
      email: "admin@example.com",
      password: "secret",
      sellerAccountExternalId: "self-ali-1",
      tradeMindBindingToken: "tm-binding-token",
      deviceExternalId: "chrome-extension-1",
      deviceName: "Chrome Extension"
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.device.sellerAccountExternalId, "self-ali-1");
  assert.equal("tradeMindBindingToken" in body.device, false);

  const devices = await store.listCollectorDevices();
  assert.equal(devices[0].tradeMindBindingToken, "tm-binding-token");
});

test("GET /collector/v1/me resolves the TradeBridge account bound to a collector token", async () => {
  const { app } = await createAuthApp();
  const loginResponse = await app.inject({
    method: "POST",
    url: "/collector/v1/auth/login",
    payload: {
      email: "admin@example.com",
      password: "secret",
      sellerAccountExternalId: "seller-1",
      deviceExternalId: "chrome-extension-1",
      deviceName: "Chrome Extension"
    }
  });
  const token = loginResponse.json().token;

  const meResponse = await app.inject({
    method: "GET",
    url: "/collector/v1/me",
    headers: { authorization: `Bearer ${token}` }
  });

  assert.equal(meResponse.statusCode, 200);
  assert.deepEqual(meResponse.json().account, {
    id: "user_1",
    email: "admin@example.com",
    displayName: "Admin User",
    roles: ["admin"]
  });
  assert.equal(meResponse.json().device.externalDeviceId, "chrome-extension-1");
  assert.equal("token" in meResponse.json().device, false);
  assert.equal("tokenHash" in meResponse.json().device, false);
});

test("GET /collector/v1/me rejects missing or invalid collector tokens", async () => {
  const { app } = await createAuthApp();
  const response = await app.inject({
    method: "GET",
    url: "/collector/v1/me",
    headers: { authorization: "Bearer missing-token" }
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false, error: "unauthorized" });
});

test("POST /collector/v1/auth/login can activate with generated seller and device defaults", async () => {
  const { app } = await createAuthApp();
  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/auth/login",
    payload: {
      email: "admin@example.com",
      password: "secret"
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.token, "string");
  assert.equal(body.device.sellerAccountExternalId, "default-seller");
  assert.match(body.device.externalDeviceId, /^collector-/);
  assert.equal(body.device.deviceName, "TradeBridge Collector");
});

test("POST /collector/v1/auth/login rejects invalid credentials", async () => {
  const { app } = await createAuthApp();
  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/auth/login",
    payload: {
      email: "admin@example.com",
      password: "wrong-password",
      sellerAccountExternalId: "seller-1",
      deviceExternalId: "chrome-extension-1"
    }
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false, error: "invalid_credentials" });
});

test("POST /collector/v1/auth/login rejects non-admin users", async () => {
  const { app, store } = await createAuthApp();
  await store.createInternalUser({
    email: "sales@example.com",
    displayName: "Sales User",
    passwordHash: await hashPassword("secret"),
    roles: ["sales"]
  });

  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/auth/login",
    payload: {
      email: "sales@example.com",
      password: "secret",
      sellerAccountExternalId: "seller-1",
      deviceExternalId: "chrome-extension-1"
    }
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { ok: false, error: "forbidden" });
});

test("POST /collector/v1/auth/login rejects disabled admins", async () => {
  const { app, store } = await createAuthApp();
  await store.createInternalUser({
    email: "disabled-admin@example.com",
    displayName: "Disabled Admin",
    passwordHash: await hashPassword("secret"),
    roles: ["admin"],
    status: "disabled"
  });

  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/auth/login",
    payload: {
      email: "disabled-admin@example.com",
      password: "secret",
      sellerAccountExternalId: "seller-1",
      deviceExternalId: "chrome-extension-1"
    }
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false, error: "invalid_credentials" });
});

test("POST /collector/v1/auth/login rejects missing credentials", async () => {
  const { app } = await createAuthApp();
  const response = await app.inject({
    method: "POST",
    url: "/collector/v1/auth/login",
    payload: {
      email: "admin@example.com"
    }
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { ok: false, error: "invalid_collector_login_request" });
});

test("POST /internal/v1/auth/logout revokes the current session", async () => {
  const { app } = await createAuthApp();
  const loginResponse = await login(app);
  const token = loginResponse.json().token;

  const logoutResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/auth/logout",
    headers: { authorization: `Bearer ${token}` }
  });
  const meResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/me",
    headers: { authorization: `Bearer ${token}` }
  });

  assert.equal(logoutResponse.statusCode, 200);
  assert.deepEqual(logoutResponse.json(), { ok: true });
  assert.equal(meResponse.statusCode, 401);
});

test("session tokens can access internal APIs while collector tokens cannot", async () => {
  const { app, store } = await createAuthApp();
  const collectorToken = await createCollectorToken(store);
  await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: `Bearer ${collectorToken}` },
    payload: syncPayload
  });

  const loginResponse = await login(app);
  const internalResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/customers",
    headers: { authorization: `Bearer ${loginResponse.json().token}` }
  });
  const collectorResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/customers",
    headers: { authorization: `Bearer ${collectorToken}` }
  });

  assert.equal(internalResponse.statusCode, 200);
  assert.equal(internalResponse.json().customers.length, 1);
  assert.equal(collectorResponse.statusCode, 401);
  assert.deepEqual(collectorResponse.json(), { ok: false, error: "internal_unauthorized" });
});

test("authenticated users without a permitted role cannot access internal APIs", async () => {
  const { app, store } = await createAuthApp();
  await store.createInternalUser({
    email: "norole@example.com",
    displayName: "No Role",
    passwordHash: await hashPassword("secret"),
    roles: []
  });

  const loginResponse = await login(app, "norole@example.com");
  const response = await app.inject({
    method: "GET",
    url: "/internal/v1/customers",
    headers: { authorization: `Bearer ${loginResponse.json().token}` }
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { ok: false, error: "forbidden" });
});

test("POST /internal/v1/setup/admin creates the first admin without a setup token", async () => {
  const store = new InMemorySyncStore();
  const app = await createServer({ store });

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/setup/admin",
    payload: {
      email: "owner@example.com",
      displayName: "Owner",
      password: "secret-password"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().user.email, "owner@example.com");
  assert.deepEqual(response.json().user.roles, ["admin"]);
});

test("POST /internal/v1/setup/admin rejects setup when an admin already exists", async () => {
  const store = new InMemorySyncStore();
  await store.createInternalUser({
    email: "admin@example.com",
    displayName: "Admin User",
    passwordHash: await hashPassword("secret"),
    roles: ["admin"]
  });
  const app = await createServer({ store });

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/setup/admin",
    payload: {
      email: "owner@example.com",
      displayName: "Owner",
      password: "secret-password"
    }
  });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), { ok: false, error: "admin_already_exists" });
});

test("POST /internal/v1/setup/admin rejects existing emails without promoting users", async () => {
  const store = new InMemorySyncStore();
  await store.createInternalUser({
    email: "sales@example.com",
    displayName: "Sales User",
    passwordHash: await hashPassword("secret"),
    roles: ["sales"]
  });
  const app = await createServer({ store });

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/setup/admin",
    payload: {
      email: "sales@example.com",
      displayName: "Promoted Sales",
      password: "secret-password"
    }
  });
  const users = await store.listInternalUsers();
  const salesUser = users.find((user) => user.email === "sales@example.com");

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), { ok: false, error: "user_already_exists" });
  assert.deepEqual(salesUser?.roles, ["sales"]);
  assert.equal(salesUser?.displayName, "Sales User");
});

test("admin users can create, list, disable, and reset users", async () => {
  const { app } = await createAuthApp();
  const headers = await createInternalAuthHeaders(app);

  const createResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/users",
    headers,
    payload: {
      email: "sales@example.com",
      displayName: "Sales User",
      password: "sales-secret",
      roles: ["sales"]
    }
  });
  const userId = createResponse.json().user.id;

  const listResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/users",
    headers
  });
  const disableResponse = await app.inject({
    method: "POST",
    url: `/internal/v1/users/${userId}/disable`,
    headers
  });
  const resetResponse = await app.inject({
    method: "POST",
    url: `/internal/v1/users/${userId}/reset-password`,
    headers,
    payload: { password: "new-sales-secret" }
  });

  assert.equal(createResponse.statusCode, 200);
  assert.equal(listResponse.json().users.some((user: { email: string }) => user.email === "sales@example.com"), true);
  assert.equal(disableResponse.json().user.status, "disabled");
  assert.equal(resetResponse.json().user.status, "active");
});

test("non-admin users cannot manage users or invitations", async () => {
  const { app, store } = await createAuthApp();
  await store.createInternalUser({
    email: "sales@example.com",
    displayName: "Sales User",
    passwordHash: await hashPassword("secret"),
    roles: ["sales"]
  });
  const headers = await createInternalAuthHeaders(app, "sales@example.com");

  const usersResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/users",
    headers
  });
  const invitationResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/invitations",
    headers,
    payload: {
      email: "invitee@example.com",
      displayName: "Invitee",
      roles: ["sales"]
    }
  });

  assert.equal(usersResponse.statusCode, 403);
  assert.deepEqual(usersResponse.json(), { ok: false, error: "forbidden" });
  assert.equal(invitationResponse.statusCode, 403);
  assert.deepEqual(invitationResponse.json(), { ok: false, error: "forbidden" });
});

test("disable and reset password return 404 for missing users", async () => {
  const { app } = await createAuthApp();
  const headers = await createInternalAuthHeaders(app);

  const disableResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/users/user_missing/disable",
    headers
  });
  const resetResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/users/user_missing/reset-password",
    headers,
    payload: { password: "new-secret" }
  });

  assert.equal(disableResponse.statusCode, 404);
  assert.deepEqual(disableResponse.json(), { ok: false, error: "user_not_found" });
  assert.equal(resetResponse.statusCode, 404);
  assert.deepEqual(resetResponse.json(), { ok: false, error: "user_not_found" });
});

test("POST /internal/v1/users rejects invalid roles", async () => {
  const { app } = await createAuthApp();
  const headers = await createInternalAuthHeaders(app);

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/users",
    headers,
    payload: {
      email: "owner@example.com",
      displayName: "Owner User",
      password: "owner-secret",
      roles: ["sales", "owner"]
    }
  });
  const listResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/users",
    headers
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { ok: false, error: "invalid_user_request" });
  assert.equal(listResponse.json().users.some((user: { email: string }) => user.email === "owner@example.com"), false);
});

test("POST /internal/v1/users rejects duplicate roles", async () => {
  const { app } = await createAuthApp();
  const headers = await createInternalAuthHeaders(app);

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/users",
    headers,
    payload: {
      email: "duplicate@example.com",
      displayName: "Duplicate Role User",
      password: "duplicate-secret",
      roles: ["sales", "sales"]
    }
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { ok: false, error: "invalid_user_request" });
});

test("admin users can invite users and invitees can accept", async () => {
  const { app } = await createAuthApp();
  const headers = await createInternalAuthHeaders(app);

  const inviteResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/invitations",
    headers,
    payload: {
      email: "invitee@example.com",
      displayName: "Invitee",
      roles: ["sales"]
    }
  });
  const token = inviteResponse.json().invitation.token;

  const inspectResponse = await app.inject({
    method: "GET",
    url: `/internal/v1/invitations/${token}`
  });
  const acceptResponse = await app.inject({
    method: "POST",
    url: `/internal/v1/invitations/${token}/accept`,
    payload: { password: "invitee-secret" }
  });

  assert.equal(inviteResponse.statusCode, 200);
  assert.equal(inspectResponse.json().invitation.email, "invitee@example.com");
  assert.equal(acceptResponse.json().user.email, "invitee@example.com");
  assert.equal(typeof acceptResponse.json().token, "string");
});

test("POST /internal/v1/invitations rejects invalid roles without creating an invitation", async () => {
  const { app, store } = await createAuthApp();
  const headers = await createInternalAuthHeaders(app);
  let createdInvitation = false;
  const originalCreateUserInvitation = store.createUserInvitation.bind(store);
  store.createUserInvitation = async (input) => {
    createdInvitation = true;
    return originalCreateUserInvitation(input);
  };

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/invitations",
    headers,
    payload: {
      email: "owner@example.com",
      displayName: "Owner Invitee",
      roles: ["sales", "owner"]
    }
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { ok: false, error: "invalid_invitation_request" });
  assert.equal("invitation" in response.json(), false);
  assert.equal(createdInvitation, false);
});

test("POST /internal/v1/invitations rejects duplicate roles", async () => {
  const { app } = await createAuthApp();
  const headers = await createInternalAuthHeaders(app);

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/invitations",
    headers,
    payload: {
      email: "duplicate-invitee@example.com",
      displayName: "Duplicate Invitee",
      roles: ["sales", "sales"]
    }
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { ok: false, error: "invalid_invitation_request" });
});

test("invitation routes return expected errors for missing and already accepted tokens", async () => {
  const { app } = await createAuthApp();
  const headers = await createInternalAuthHeaders(app);

  const missingInspectResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/invitations/missing-token"
  });
  const missingAcceptResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/invitations/missing-token/accept",
    payload: { password: "invitee-secret" }
  });
  const inviteResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/invitations",
    headers,
    payload: {
      email: "invitee@example.com",
      displayName: "Invitee",
      roles: ["sales"]
    }
  });
  const token = inviteResponse.json().invitation.token;
  await app.inject({
    method: "POST",
    url: `/internal/v1/invitations/${token}/accept`,
    payload: { password: "invitee-secret" }
  });
  const acceptedAgainResponse = await app.inject({
    method: "POST",
    url: `/internal/v1/invitations/${token}/accept`,
    payload: { password: "invitee-secret" }
  });

  assert.equal(missingInspectResponse.statusCode, 404);
  assert.deepEqual(missingInspectResponse.json(), { ok: false, error: "invitation_not_found" });
  assert.equal(missingAcceptResponse.statusCode, 404);
  assert.deepEqual(missingAcceptResponse.json(), { ok: false, error: "invitation_not_found" });
  assert.equal(acceptedAgainResponse.statusCode, 409);
  assert.deepEqual(acceptedAgainResponse.json(), { ok: false, error: "invitation_already_accepted" });
});
