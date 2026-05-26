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

  assert.deepEqual(
    result.appliedIds,
    INTERNAL_SYNC_MIGRATIONS.map((migration) => migration.id)
  );
  assert.equal(result.skippedIds.length, 0);
  assert.match(client.queries[0].sql, /CREATE TABLE IF NOT EXISTS schema_migration/i);
  assert.match(client.queries[1].sql, /SELECT id FROM schema_migration/i);
  for (const migration of INTERNAL_SYNC_MIGRATIONS) {
    assert.equal(client.queries.some((query) => query.sql === migration.sql), true);
  }
  assert.deepEqual(client.queries.at(-1)?.params, ["001_internal_sync_schema"]);
});

test("runMigrations skips already applied migrations", async () => {
  const client = new FakeSqlClient(INTERNAL_SYNC_MIGRATIONS.map((migration) => migration.id));
  const result = await runMigrations(client);

  assert.deepEqual(result.appliedIds, []);
  assert.deepEqual(
    result.skippedIds,
    INTERNAL_SYNC_MIGRATIONS.map((migration) => migration.id)
  );
  for (const migration of INTERNAL_SYNC_MIGRATIONS) {
    assert.equal(client.queries.some((query) => query.sql === migration.sql), false);
  }
});
