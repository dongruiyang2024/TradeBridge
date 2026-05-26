import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createInternalApiClient } from "../src/internal-api.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("internal API client sends bearer-scoped customer workflow requests", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const body = responseFor(url.pathname, init.method || "GET");
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const client = createInternalApiClient({
    baseUrl: "http://server.test/base/",
    token: "internal-token"
  });
  const scope = {
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1"
  };

  await client.listCustomers();
  await client.listConversations();
  await client.listMessages("conv-1");
  await client.login({ email: "admin@example.com", password: "secret" });
  await client.logout();
  await client.listCustomerNotes(scope);
  await client.getCustomerAssignment(scope);
  await client.createCustomerNote(scope, { body: "Customer asked for updated MOQ." });
  await client.addCustomerTag(scope, { tag: "hot-lead" });
  await client.createFollowUpTask(scope, { title: "Send revised quotation" });

  assert.deepEqual(
    calls.map((call) => call.url.pathname),
    [
      "/base/internal/v1/customers",
      "/base/internal/v1/conversations",
      "/base/internal/v1/conversations/conv-1/messages",
      "/base/internal/v1/auth/login",
      "/base/internal/v1/auth/logout",
      "/base/internal/v1/customers/customer-1/notes",
      "/base/internal/v1/customers/customer-1/assignment",
      "/base/internal/v1/customers/customer-1/notes",
      "/base/internal/v1/customers/customer-1/tags",
      "/base/internal/v1/customers/customer-1/follow-up-tasks"
    ]
  );
  assert.deepEqual(calls.map((call) => call.url.searchParams.get("orgId")), Array(10).fill(null));
  assert.equal(calls[5].url.searchParams.get("sellerAccountExternalId"), "seller-1");
  assert.equal(calls[3].init.method, "POST");
  assert.equal(calls[4].init.method, "POST");
  assert.equal(calls[7].init.method, "POST");
  assert.equal(calls[8].init.method, "POST");
  assert.equal(calls[9].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[3].init.body)), {
    email: "admin@example.com",
    password: "secret"
  });
  assert.deepEqual(JSON.parse(String(calls[7].init.body)), { body: "Customer asked for updated MOQ." });
  assert.deepEqual(JSON.parse(String(calls[8].init.body)), { tag: "hot-lead" });
  assert.deepEqual(JSON.parse(String(calls[9].init.body)), { title: "Send revised quotation" });

  for (const [index, call] of calls.entries()) {
    const headers = call.init.headers as Record<string, string>;
    if (index === 3) {
      assert.equal(headers.authorization, undefined);
    } else {
      assert.equal(headers.authorization, "Bearer internal-token");
    }
  }
});

test("internal API client sends setup, user management, and invitation requests", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const body = responseFor(url.pathname, init.method || "GET");
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const client = createInternalApiClient({
    baseUrl: "http://server.test",
    token: "session-token"
  });

  await client.setupAdmin({
    email: "owner@example.com",
    displayName: "Owner",
    password: "setup-secret"
  });
  await client.listInternalUsers();
  await client.createInternalUser({
    email: "sales@example.com",
    displayName: "Sales",
    password: "sales-secret",
    roles: ["sales"]
  });
  await client.disableInternalUser({ userId: "user/id 1" });
  await client.resetInternalUserPassword({ userId: "user/id 1", password: "reset-secret" });
  await client.createInvitation({
    email: "invitee@example.com",
    displayName: "Invitee",
    roles: ["supervisor"]
  });
  await client.getInvitation("invite/token 1");
  await client.acceptInvitation({ token: "invite/token 1", password: "accepted-secret" });

  assert.deepEqual(
    calls.map((call) => call.url.pathname),
    [
      "/internal/v1/setup/admin",
      "/internal/v1/users",
      "/internal/v1/users",
      "/internal/v1/users/user%2Fid%201/disable",
      "/internal/v1/users/user%2Fid%201/reset-password",
      "/internal/v1/invitations",
      "/internal/v1/invitations/invite%2Ftoken%201",
      "/internal/v1/invitations/invite%2Ftoken%201/accept"
    ]
  );
  assert.equal(calls[1].url.searchParams.get("orgId"), null);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[1].init.method, undefined);
  assert.equal(calls[2].init.method, "POST");
  assert.equal(calls[3].init.method, "POST");
  assert.equal(calls[4].init.method, "POST");
  assert.equal(calls[5].init.method, "POST");
  assert.equal(calls[6].init.method, undefined);
  assert.equal(calls[7].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    email: "owner@example.com",
    displayName: "Owner",
    password: "setup-secret"
  });
  assert.deepEqual(JSON.parse(String(calls[2].init.body)), {
    email: "sales@example.com",
    displayName: "Sales",
    password: "sales-secret",
    roles: ["sales"]
  });
  assert.equal(calls[3].init.body, undefined);
  assert.deepEqual(JSON.parse(String(calls[4].init.body)), { password: "reset-secret" });
  assert.deepEqual(JSON.parse(String(calls[5].init.body)), {
    email: "invitee@example.com",
    displayName: "Invitee",
    roles: ["supervisor"]
  });
  assert.deepEqual(JSON.parse(String(calls[7].init.body)), { password: "accepted-secret" });

  assert.equal((calls[0].init.headers as Record<string, string>).authorization, undefined);
  for (const index of [1, 2, 3, 4, 5]) {
    assert.equal((calls[index].init.headers as Record<string, string>).authorization, "Bearer session-token");
  }
  assert.equal((calls[6].init.headers as Record<string, string>).authorization, undefined);
  assert.equal((calls[7].init.headers as Record<string, string>).authorization, undefined);
});

test("login sends email credentials without org scope", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const client = createInternalApiClient({
    baseUrl: "",
    token: "",
    fetchImpl: async (input, init = {}) => {
      calls.push({ url: new URL(String(input), "http://local.test"), init });
      return new Response(
        JSON.stringify({
          ok: true,
          token: "session-token",
          user: { id: "user-1", email: "admin@example.com", displayName: "Admin", status: "active", roles: ["admin"] }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  const result = await client.login({ email: "admin@example.com", password: "secret" });

  assert.equal(result.token, "session-token");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    email: "admin@example.com",
    password: "secret"
  });
});

function responseFor(pathname: string, method: string): unknown {
  if (pathname.endsWith("/customers")) return { ok: true, customers: [] };
  if (pathname.endsWith("/conversations")) return { ok: true, conversations: [] };
  if (pathname.endsWith("/messages")) return { ok: true, messages: [] };
  if (pathname.endsWith("/auth/login")) return { ok: true, token: "session-token", user: { email: "admin@example.com" } };
  if (pathname.endsWith("/setup/admin")) return { ok: true, user: { id: "admin-1", email: "owner@example.com" } };
  if (pathname.endsWith("/auth/logout")) return { ok: true };
  if (method === "GET" && pathname.endsWith("/users")) return { ok: true, users: [] };
  if (method === "POST" && pathname.endsWith("/users")) return { ok: true, user: { id: "user-1" } };
  if (pathname.endsWith("/disable")) return { ok: true, user: { id: "user-1", status: "disabled" } };
  if (pathname.endsWith("/reset-password")) return { ok: true, user: { id: "user-1", status: "active" } };
  if (method === "POST" && pathname.endsWith("/invitations")) return { ok: true, invitation: { id: "invite-1" } };
  if (pathname.endsWith("/accept")) {
    return {
      ok: true,
      invitation: { id: "invite-1", acceptedAt: "2026-05-26T00:00:00.000Z" },
      token: "accepted-session-token",
      user: { id: "user-1" }
    };
  }
  if (pathname.includes("/invitations/")) return { ok: true, invitation: { id: "invite-1" } };
  if (pathname.endsWith("/assignment")) return { ok: true, assignment: { id: "assignment-1" } };
  if (method === "POST" && pathname.endsWith("/notes")) return { ok: true, note: { id: "note-1" } };
  if (method === "POST" && pathname.endsWith("/tags")) return { ok: true, tag: { id: "tag-1" } };
  if (method === "POST" && pathname.endsWith("/follow-up-tasks")) return { ok: true, task: { id: "task-1" } };
  if (pathname.endsWith("/notes")) return { ok: true, notes: [] };
  if (pathname.endsWith("/tags")) return { ok: true, tags: [] };
  if (pathname.endsWith("/follow-up-tasks")) return { ok: true, tasks: [] };
  return { ok: true };
}
