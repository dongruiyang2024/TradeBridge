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
    orgId: "org_internal",
    sellerAccountExternalId: "seller-1",
    externalCustomerId: "customer-1"
  };

  await client.listCustomers("org_internal");
  await client.listConversations("org_internal");
  await client.listMessages("org_internal", "conv-1");
  await client.listCustomerNotes(scope);
  await client.createCustomerNote(scope, { body: "Customer asked for updated MOQ." });
  await client.addCustomerTag(scope, { tag: "hot-lead" });
  await client.createFollowUpTask(scope, { title: "Send revised quotation" });

  assert.deepEqual(
    calls.map((call) => call.url.pathname),
    [
      "/base/internal/v1/customers",
      "/base/internal/v1/conversations",
      "/base/internal/v1/conversations/conv-1/messages",
      "/base/internal/v1/customers/customer-1/notes",
      "/base/internal/v1/customers/customer-1/notes",
      "/base/internal/v1/customers/customer-1/tags",
      "/base/internal/v1/customers/customer-1/follow-up-tasks"
    ]
  );
  assert.deepEqual(calls.map((call) => call.url.searchParams.get("orgId")), [
    "org_internal",
    "org_internal",
    "org_internal",
    "org_internal",
    "org_internal",
    "org_internal",
    "org_internal"
  ]);
  assert.equal(calls[3].url.searchParams.get("sellerAccountExternalId"), "seller-1");
  assert.equal(calls[4].init.method, "POST");
  assert.equal(calls[5].init.method, "POST");
  assert.equal(calls[6].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[4].init.body)), { body: "Customer asked for updated MOQ." });
  assert.deepEqual(JSON.parse(String(calls[5].init.body)), { tag: "hot-lead" });
  assert.deepEqual(JSON.parse(String(calls[6].init.body)), { title: "Send revised quotation" });

  for (const call of calls) {
    assert.equal((call.init.headers as Record<string, string>).authorization, "Bearer internal-token");
  }
});

function responseFor(pathname: string, method: string): unknown {
  if (pathname.endsWith("/customers")) return { ok: true, customers: [] };
  if (pathname.endsWith("/conversations")) return { ok: true, conversations: [] };
  if (pathname.endsWith("/messages")) return { ok: true, messages: [] };
  if (method === "POST" && pathname.endsWith("/notes")) return { ok: true, note: { id: "note-1" } };
  if (method === "POST" && pathname.endsWith("/tags")) return { ok: true, tag: { id: "tag-1" } };
  if (method === "POST" && pathname.endsWith("/follow-up-tasks")) return { ok: true, task: { id: "task-1" } };
  if (pathname.endsWith("/notes")) return { ok: true, notes: [] };
  if (pathname.endsWith("/tags")) return { ok: true, tags: [] };
  if (pathname.endsWith("/follow-up-tasks")) return { ok: true, tasks: [] };
  return { ok: true };
}
