import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore } from "@wangwang/database";
import { createServer } from "../src/server.js";

test("local Web workbench origins can preflight internal APIs", async () => {
  const app = await createServer({ store: new InMemorySyncStore() });
  const response = await app.inject({
    method: "OPTIONS",
    url: "/internal/v1/customers",
    headers: {
      origin: "http://127.0.0.1:5173",
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization,content-type"
    }
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["access-control-allow-origin"], "http://127.0.0.1:5173");
  assert.match(String(response.headers["access-control-allow-methods"]), /GET/);
  assert.match(String(response.headers["access-control-allow-headers"]), /authorization/);
});

test("Chrome extension origins can preflight collector APIs", async () => {
  const app = await createServer({ store: new InMemorySyncStore() });
  const response = await app.inject({
    method: "OPTIONS",
    url: "/collector/v1/auth/login",
    headers: {
      origin: "chrome-extension://aaiambckmiggfpmjnigniblljihldjen",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type"
    }
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["access-control-allow-origin"], "chrome-extension://aaiambckmiggfpmjnigniblljihldjen");
});
