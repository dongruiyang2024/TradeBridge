import fs from "node:fs";
import path from "node:path";

export interface DatabaseMigration {
  id: string;
  filename: string;
  sql: string;
}

export const INTERNAL_SYNC_MIGRATIONS: DatabaseMigration[] = [
  loadMigration("001_internal_sync_schema", "001_internal_sync_schema.sql"),
  loadMigration("002_outbound_message_queue", "002_outbound_message_queue.sql"),
  loadMigration("003_outbound_message_claim_lease", "003_outbound_message_claim_lease.sql"),
  loadMigration("004_collector_device_activation_account", "004_collector_device_activation_account.sql"),
  loadMigration("005_channel_dimension", "005_channel_dimension.sql"),
  loadMigration("006_customer_profile_enrichment", "006_customer_profile_enrichment.sql")
];

function loadMigration(id: string, filename: string): DatabaseMigration {
  const filePath = path.resolve(import.meta.dirname, "../migrations", filename);
  return {
    id,
    filename,
    sql: fs.readFileSync(filePath, "utf8")
  };
}
