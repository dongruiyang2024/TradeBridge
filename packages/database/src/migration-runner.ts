import { INTERNAL_SYNC_MIGRATIONS } from "./migrations.js";
import type { SqlClient } from "./sql-client.js";

export interface MigrationRunResult {
  appliedIds: string[];
  skippedIds: string[];
}

export async function runMigrations(client: SqlClient): Promise<MigrationRunResult> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const existing = await client.query<{ id: string }>("SELECT id FROM schema_migration ORDER BY id");
  const applied = new Set(existing.rows.map((row) => row.id));
  const appliedIds: string[] = [];
  const skippedIds: string[] = [];

  for (const migration of INTERNAL_SYNC_MIGRATIONS) {
    if (applied.has(migration.id)) {
      skippedIds.push(migration.id);
      continue;
    }
    await client.query(migration.sql);
    await client.query("INSERT INTO schema_migration (id) VALUES ($1)", [migration.id]);
    appliedIds.push(migration.id);
  }

  return { appliedIds, skippedIds };
}
