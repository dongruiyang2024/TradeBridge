import assert from "node:assert/strict";
import { test } from "node:test";
import { createSyncAiJobQueue, redisConnectionFromUrl } from "../src/ai-queue.js";

test("sync AI job queue executes inline and returns a completed job result", async () => {
  const queue = createSyncAiJobQueue();
  const job = await queue.run("customer-summary", { externalCustomerId: "customer-1" }, async () => ({
    summary: "Buyer wants a quote."
  }));

  assert.equal(job.status, "completed");
  assert.equal(job.jobId, "sync-ai-1");
  assert.deepEqual(job.result, { summary: "Buyer wants a quote." });
});

test("redisConnectionFromUrl parses Redis URLs for BullMQ connection options", () => {
  assert.deepEqual(redisConnectionFromUrl("redis://user:pass@localhost:6380/2"), {
    host: "localhost",
    port: 6380,
    username: "user",
    password: "pass",
    db: 2
  });
});
