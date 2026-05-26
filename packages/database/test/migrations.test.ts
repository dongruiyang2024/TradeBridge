import assert from "node:assert/strict";
import { test } from "node:test";
import { INTERNAL_SYNC_MIGRATIONS } from "../src/index.js";

test("internal sync migrations expose the initial schema in order", () => {
  assert.equal(INTERNAL_SYNC_MIGRATIONS.length, 1);
  assert.equal(INTERNAL_SYNC_MIGRATIONS[0].id, "001_internal_sync_schema");
  assert.equal(INTERNAL_SYNC_MIGRATIONS[0].filename, "001_internal_sync_schema.sql");
  assert.match(INTERNAL_SYNC_MIGRATIONS[0].sql, /CREATE TABLE IF NOT EXISTS org/i);
});

test("initial schema contains the core platform tables", () => {
  const sql = INTERNAL_SYNC_MIGRATIONS[0].sql;
  const tables = [
    "org",
    "app_user",
    "role",
    "user_role",
    "internal_session",
    "seller_account",
    "collector_device",
    "sync_job",
    "sync_batch",
    "customer",
    "conversation",
    "message",
    "customer_assignment",
    "customer_tag",
    "customer_note",
    "follow_up_task",
    "ai_summary",
    "reply_suggestion",
    "audit_log"
  ];

  for (const table of tables) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i"), `missing table ${table}`);
  }
});

test("initial schema defines idempotency constraints for sync writes", () => {
  const normalized = INTERNAL_SYNC_MIGRATIONS[0].sql.replace(/\s+/g, " ").toLowerCase();

  assert.match(normalized, /unique \(org_id, external_account_id\)/);
  assert.match(normalized, /unique \(org_id, device_token_hash\)/);
  assert.match(normalized, /unique \(org_id, seller_account_id, external_conversation_id\)/);
  assert.match(normalized, /unique \(org_id, seller_account_id, conversation_id, external_message_id\)/);
  assert.match(normalized, /unique \(org_id, conversation_id, sent_at, direction, content_hash\)/);
  assert.match(normalized, /unique \(org_id, seller_account_id, source_batch_key\)/);
});

test("initial schema uses text organization keys for API supplied org ids", () => {
  const normalized = INTERNAL_SYNC_MIGRATIONS[0].sql.replace(/\s+/g, " ").toLowerCase();
  const orgIdColumns = normalized.match(/\borg_id\s+text\s+not null references org\(id\)/g) || [];

  assert.match(normalized, /create table if not exists org \( id text primary key,/);
  assert.equal(orgIdColumns.length, 18);
  assert.equal(normalized.includes("org_id uuid"), false);
  assert.equal(normalized.includes("id uuid primary key default gen_random_uuid(), name text not null"), false);
});

test("initial schema contains internal auth credentials and sessions", () => {
  const normalized = INTERNAL_SYNC_MIGRATIONS[0].sql.replace(/\s+/g, " ").toLowerCase();

  assert.match(normalized, /password_hash text not null/);
  assert.match(normalized, /create table if not exists internal_session\b/);
  assert.match(normalized, /token_hash text not null/);
  assert.match(normalized, /expires_at timestamptz not null/);
  assert.match(normalized, /unique \(token_hash\)/);
});

test("initial schema does not define raw OneTalk credential columns", () => {
  const sql = INTERNAL_SYNC_MIGRATIONS[0].sql.toLowerCase();
  const forbidden = ["cookie2", "sgcookie", "ctoken", "_tb_token_", "chat_token", "cookie_value"];

  for (const marker of forbidden) {
    assert.equal(sql.includes(marker), false, `schema must not include ${marker}`);
  }
});
