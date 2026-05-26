import assert from "node:assert/strict";
import { test } from "node:test";
import { INTERNAL_SYNC_MIGRATIONS, runMigrations, type SqlClient } from "../src/index.js";

class FakeSqlClient implements SqlClient {
  readonly queries: Array<{ sql: string; params: readonly unknown[] }> = [];

  constructor(private readonly appliedIds: string[] = []) {}

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    this.queries.push({ sql, params });
    if (/select id from schema_migration/i.test(sql)) {
      return {
        rows: this.appliedIds.map((id) => ({ id })) as T[],
        rowCount: this.appliedIds.length
      };
    }
    return { rows: [], rowCount: 0 };
  }
}

test("runMigrations creates migration table and applies pending migrations", async () => {
  const client = new FakeSqlClient();
  const result = await runMigrations(client);

  assert.deepEqual(result.appliedIds, ["001_internal_sync_schema"]);
  assert.equal(result.skippedIds.length, 0);
  assert.match(client.queries[0].sql, /CREATE TABLE IF NOT EXISTS schema_migration/i);
  assert.match(client.queries[1].sql, /SELECT id FROM schema_migration/i);
  assert.equal(client.queries.some((query) => query.sql === INTERNAL_SYNC_MIGRATIONS[0].sql), true);
  assert.deepEqual(client.queries.at(-1)?.params, ["001_internal_sync_schema"]);
});

test("runMigrations skips already applied migrations", async () => {
  const client = new FakeSqlClient(["001_internal_sync_schema"]);
  const result = await runMigrations(client);

  assert.deepEqual(result.appliedIds, []);
  assert.deepEqual(result.skippedIds, ["001_internal_sync_schema"]);
  assert.equal(client.queries.some((query) => query.sql === INTERNAL_SYNC_MIGRATIONS[0].sql), false);
});
