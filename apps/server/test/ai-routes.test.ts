import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore } from "@wangwang/database";
import { hashPassword } from "../src/auth.js";
import { createServer } from "../src/server.js";

const customerSummaryPath =
  "/internal/v1/customers/customer-1/ai-summary?orgId=org_internal&sellerAccountExternalId=seller-1";
const replySuggestionPath =
  "/internal/v1/conversations/conv-1/reply-suggestions?orgId=org_internal&sellerAccountExternalId=seller-1";

async function createSeededApp(aiProvider = createFakeAiProvider(), aiJobQueue?: unknown) {
  const store = new InMemorySyncStore();
  await store.createInternalUser({
    orgId: "org_internal",
    email: "admin@example.com",
    displayName: "Admin User",
    passwordHash: await hashPassword("secret"),
    roles: ["admin"]
  });
  const app = await createServer({
    store,
    deviceTokens: ["device-token"],
    aiProvider,
    aiJobQueue
  });

  await app.inject({
    method: "POST",
    url: "/collector/v1/sync-batches",
    headers: { authorization: "Bearer device-token" },
    payload: {
      orgId: "org_internal",
      sellerAccount: { externalAccountId: "seller-1", displayName: "Seller One" },
      device: { deviceId: "device-1" },
      customers: [{ externalCustomerId: "customer-1", loginId: "buyer_login", displayName: "Buyer One" }],
      conversations: [{ externalConversationId: "conv-1", externalCustomerId: "customer-1" }],
      messages: [
        {
          externalConversationId: "conv-1",
          externalMessageId: "msg-1",
          direction: "received",
          messageType: "text",
          content: "Can you quote 500 units?",
          sentAt: "2026-05-25T09:00:00.000Z"
        },
        {
          externalConversationId: "conv-1",
          externalMessageId: "msg-2",
          direction: "sent",
          messageType: "text",
          content: "Sure, I will send it today.",
          sentAt: "2026-05-25T09:05:00.000Z"
        }
      ]
    }
  });

  return app;
}

async function createInternalAuthHeaders(app: Awaited<ReturnType<typeof createServer>>) {
  const loginResponse = await app.inject({
    method: "POST",
    url: "/internal/v1/auth/login",
    payload: {
      orgId: "org_internal",
      email: "admin@example.com",
      password: "secret"
    }
  });
  assert.equal(loginResponse.statusCode, 200);
  return { authorization: `Bearer ${loginResponse.json().token}` };
}

test("POST and GET customer AI summary use provider output and persist latest result", async () => {
  const providerInputs: Record<string, unknown> = {};
  const queuedJobs: string[] = [];
  const app = await createSeededApp(createFakeAiProvider(providerInputs), createRecordingQueue(queuedJobs));
  const authHeaders = await createInternalAuthHeaders(app);

  const createResponse = await app.inject({
    method: "POST",
    url: customerSummaryPath,
    headers: authHeaders
  });
  const getResponse = await app.inject({
    method: "GET",
    url: customerSummaryPath,
    headers: authHeaders
  });

  assert.equal(createResponse.statusCode, 200);
  assert.equal(createResponse.json().ok, true);
  assert.equal(createResponse.json().job.status, "completed");
  assert.equal(createResponse.json().job.id, "test-job-1");
  assert.equal(createResponse.json().summary.promptVersion, "fake-ai-v1");
  assert.equal(createResponse.json().summary.summary, "Buyer wants a quote for 500 units.");
  assert.equal(createResponse.json().summary.intentLevel, "high");
  assert.equal(createResponse.json().summary.nextAction, "Send revised quotation");
  assert.equal((providerInputs.customerSummary as { messages: unknown[] }).messages.length, 2);
  assert.deepEqual(queuedJobs, ["customer-summary"]);
  assert.equal(getResponse.statusCode, 200);
  assert.deepEqual(getResponse.json().summary, createResponse.json().summary);
});

test("POST and GET conversation reply suggestions use provider output and persist drafts", async () => {
  const providerInputs: Record<string, unknown> = {};
  const queuedJobs: string[] = [];
  const app = await createSeededApp(createFakeAiProvider(providerInputs), createRecordingQueue(queuedJobs));
  const authHeaders = await createInternalAuthHeaders(app);

  const createResponse = await app.inject({
    method: "POST",
    url: replySuggestionPath,
    headers: authHeaders,
    payload: { tone: "concise" }
  });
  const getResponse = await app.inject({
    method: "GET",
    url: replySuggestionPath,
    headers: authHeaders
  });

  assert.equal(createResponse.statusCode, 200);
  assert.equal(createResponse.json().ok, true);
  assert.equal(createResponse.json().job.status, "completed");
  assert.equal(createResponse.json().job.id, "test-job-1");
  assert.deepEqual(
    createResponse.json().suggestions.map((item: { suggestion: string }) => item.suggestion),
    ["Thanks, I will send the 500-unit quote today.", "I can include MOQ, lead time, and shipping terms."]
  );
  assert.equal(createResponse.json().suggestions[0].promptVersion, "fake-ai-v1");
  assert.equal((providerInputs.replySuggestion as { tone: string; messages: unknown[] }).tone, "concise");
  assert.equal((providerInputs.replySuggestion as { tone: string; messages: unknown[] }).messages.length, 2);
  assert.deepEqual(queuedJobs, ["reply-suggestions"]);
  assert.equal(getResponse.statusCode, 200);
  assert.deepEqual(getResponse.json().suggestions, createResponse.json().suggestions);
});

test("AI routes reject orgId outside the authenticated user's org", async () => {
  const app = await createSeededApp();
  const authHeaders = await createInternalAuthHeaders(app);
  const customerSummaryPath =
    "/internal/v1/customers/customer-1/ai-summary?orgId=org_other&sellerAccountExternalId=seller-1";
  const replySuggestionsPath =
    "/internal/v1/conversations/conv-1/reply-suggestions?orgId=org_other&sellerAccountExternalId=seller-1";
  const requests = [
    { method: "POST", url: customerSummaryPath, headers: authHeaders },
    { method: "GET", url: customerSummaryPath, headers: authHeaders },
    { method: "POST", url: replySuggestionsPath, headers: authHeaders, payload: { tone: "concise" } },
    { method: "GET", url: replySuggestionsPath, headers: authHeaders }
  ] as const;

  for (const request of requests) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { ok: false, error: "forbidden" });
  }
});

test("AI routes reject collector tokens", async () => {
  const app = await createSeededApp();
  const response = await app.inject({
    method: "POST",
    url: customerSummaryPath,
    headers: { authorization: "Bearer device-token" }
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false, error: "internal_unauthorized" });
});

function createFakeAiProvider(calls: Record<string, unknown> = {}) {
  return {
    async generateCustomerSummary(input: unknown) {
      calls.customerSummary = input;
      return {
        promptVersion: "fake-ai-v1",
        summary: "Buyer wants a quote for 500 units.",
        intentLevel: "high",
        nextAction: "Send revised quotation"
      };
    },
    async generateReplySuggestion(input: unknown) {
      calls.replySuggestion = input;
      return {
        promptVersion: "fake-ai-v1",
        suggestions: [
          "Thanks, I will send the 500-unit quote today.",
          "I can include MOQ, lead time, and shipping terms."
        ]
      };
    }
  };
}

function createRecordingQueue(calls: string[]) {
  let sequence = 0;
  return {
    async run(name: string, _payload: unknown, handler: () => Promise<unknown>) {
      calls.push(name);
      sequence += 1;
      return {
        jobId: `test-job-${sequence}`,
        status: "completed",
        result: await handler()
      };
    }
  };
}
