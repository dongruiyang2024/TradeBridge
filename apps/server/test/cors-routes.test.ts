import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemorySyncStore, type SqlClient } from "@wangwang/database";
import { createServer, createServerFromEnv } from "../src/server.js";

class CorsSqlClient implements SqlClient {
  async query<T>(sql: string): Promise<{ rows: T[]; rowCount: number }> {
    if (/select id from schema_migration/i.test(sql)) return { rows: [] as T[], rowCount: 0 };
    return { rows: [] as T[], rowCount: 0 };
  }
}

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

test("configured production Web origins can preflight internal APIs", async () => {
  const app = await createServer({
    store: new InMemorySyncStore(),
    allowedWebOrigins: ["https://workbench.example.com/"]
  });
  const response = await app.inject({
    method: "OPTIONS",
    url: "/internal/v1/customers",
    headers: {
      origin: "https://workbench.example.com",
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization,content-type"
    }
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["access-control-allow-origin"], "https://workbench.example.com");
});

test("comma separated Web origins from env can preflight internal APIs", async () => {
  const app = await createServerFromEnv({
    env: {
      DATABASE_URL: "postgres://local/test",
      WANGWANG_WEB_ORIGINS: "https://workbench.example.com, https://ops.example.com"
    },
    sqlClientFactory: async () => new CorsSqlClient()
  });
  const response = await app.inject({
    method: "OPTIONS",
    url: "/internal/v1/customers",
    headers: {
      origin: "https://ops.example.com",
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization,content-type"
    }
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["access-control-allow-origin"], "https://ops.example.com");
});

test("unconfigured production origins are rejected", async () => {
  const app = await createServer({ store: new InMemorySyncStore() });
  const response = await app.inject({
    method: "OPTIONS",
    url: "/internal/v1/customers",
    headers: {
      origin: "https://evil.example.com",
      "access-control-request-method": "GET"
    }
  });

  assert.equal(response.headers["access-control-allow-origin"], undefined);
});
