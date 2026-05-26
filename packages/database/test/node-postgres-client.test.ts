import assert from "node:assert/strict";
import { test } from "node:test";
import { NodePostgresClient } from "../src/index.js";

class FakePool {
  readonly queries: Array<{ sql: string; params: readonly unknown[] }> = [];
  closed = false;

  async query(sql: string, params: readonly unknown[] = []) {
    this.queries.push({ sql, params });
    return {
      rows: [{ ok: true }, { ok: true }],
      rowCount: null
    };
  }

  async end(): Promise<void> {
    this.closed = true;
  }
}

class MultiStatementPool {
  async query() {
    return [
      {
        rows: [],
        rowCount: null
      },
      {
        rows: [{ applied: true }],
        rowCount: 1
      }
    ];
  }

  async end(): Promise<void> {}
}

test("NodePostgresClient forwards query text and params", async () => {
  const pool = new FakePool();
  const client = new NodePostgresClient(pool);

  const result = await client.query("select * from message where id = $1", ["msg-1"]);

  assert.deepEqual(pool.queries, [{ sql: "select * from message where id = $1", params: ["msg-1"] }]);
  assert.deepEqual(result.rows, [{ ok: true }, { ok: true }]);
  assert.equal(result.rowCount, 2);
});

test("NodePostgresClient normalizes pg multi-statement query results", async () => {
  const client = new NodePostgresClient(new MultiStatementPool());

  const result = await client.query("create table example(id text); select true as applied");

  assert.deepEqual(result.rows, [{ applied: true }]);
  assert.equal(result.rowCount, 1);
});

test("NodePostgresClient closes the underlying pool", async () => {
  const pool = new FakePool();
  const client = new NodePostgresClient(pool);

  await client.close();

  assert.equal(pool.closed, true);
});
