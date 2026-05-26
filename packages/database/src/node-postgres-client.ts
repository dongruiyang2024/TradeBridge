import { Pool } from "pg";
import type { SqlClient, SqlQueryResult } from "./sql-client.js";

export interface PgPoolLike {
  query(sql: string, params?: readonly unknown[]): Promise<PgQueryResult | PgQueryResult[]>;
  end(): Promise<void>;
}

interface PgQueryResult {
    rows: unknown[];
    rowCount: number | null;
}

export class NodePostgresClient implements SqlClient {
  constructor(private readonly pool: PgPoolLike) {}

  async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<SqlQueryResult<T>> {
    const result = normalizePgResult(await this.pool.query(sql, params));
    return {
      rows: result.rows as T[],
      rowCount: result.rowCount ?? result.rows.length
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createNodePostgresClient(databaseUrl: string): NodePostgresClient {
  return new NodePostgresClient(new Pool({ connectionString: databaseUrl }));
}

function normalizePgResult(result: PgQueryResult | PgQueryResult[]): PgQueryResult {
  if (!Array.isArray(result)) return result;

  const lastResult = result.at(-1);
  return {
    rows: lastResult?.rows || [],
    rowCount: result.reduce((sum, item) => sum + (item.rowCount || 0), 0)
  };
}
