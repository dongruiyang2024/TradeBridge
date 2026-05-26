import fs from "node:fs";
import path from "node:path";

export interface DatabaseMigration {
  id: string;
  filename: string;
  sql: string;
}

export const INTERNAL_SYNC_MIGRATIONS: DatabaseMigration[] = [
  loadMigration("001_internal_sync_schema", "001_internal_sync_schema.sql")
];

function loadMigration(id: string, filename: string): DatabaseMigration {
  const filePath = path.resolve(import.meta.dirname, "../migrations", filename);
  return {
    id,
    filename,
    sql: fs.readFileSync(filePath, "utf8")
  };
}
