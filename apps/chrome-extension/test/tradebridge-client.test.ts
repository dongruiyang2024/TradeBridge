import assert from "node:assert/strict";
import { after, test } from "node:test";
import { uploadSyncBatch } from "../src/background/tradebridge-client.js";

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
  assert.equal(Object.hasOwn(await requests[0].json(), "orgId"), false);
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
