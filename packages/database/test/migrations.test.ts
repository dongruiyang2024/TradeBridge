import assert from "node:assert/strict";
import { test } from "node:test";
import { INTERNAL_SYNC_MIGRATIONS } from "../src/index.js";

test("internal sync migrations expose the initial schema in order", () => {
  assert.deepEqual(
    INTERNAL_SYNC_MIGRATIONS.map((migration) => [migration.id, migration.filename]),
    [
      ["001_internal_sync_schema", "001_internal_sync_schema.sql"],
      ["002_outbound_message_queue", "002_outbound_message_queue.sql"]
    ]
  );
  assert.doesNotMatch(INTERNAL_SYNC_MIGRATIONS[0].sql, /CREATE TABLE IF NOT EXISTS org/i);
});

test("outbound queue migration upgrades existing databases", () => {
  const normalized = INTERNAL_SYNC_MIGRATIONS[1].sql.replace(/\s+/g, " ").toLowerCase();

  assert.match(normalized, /create table if not exists outbound_message\b/);
  assert.match(normalized, /status text not null default 'queued' check \(status in \('queued', 'sent', 'failed'\)\)/);
  assert.match(normalized, /create index if not exists idx_outbound_message_pending/);
  assert.match(normalized, /create index if not exists idx_outbound_message_conversation/);
});

test("initial schema contains the core platform tables", () => {
  const sql = INTERNAL_SYNC_MIGRATIONS[0].sql;
  const tables = [
    "app_user",
    "role",
    "user_role",
    "internal_session",
    "user_invitation",
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
    "outbound_message",
    "audit_log"
  ];

  for (const table of tables) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i"), `missing table ${table}`);
  }
});

test("initial schema defines idempotency constraints for sync writes", () => {
  const normalized = INTERNAL_SYNC_MIGRATIONS[0].sql.replace(/\s+/g, " ").toLowerCase();

  assert.match(normalized, /unique \(external_account_id\)/);
  assert.match(normalized, /unique \(external_device_id\)/);
  assert.match(normalized, /unique \(device_token_hash\)/);
  assert.match(normalized, /unique \(seller_account_id, external_conversation_id\)/);
  assert.match(normalized, /unique \(seller_account_id, conversation_id, external_message_id\)/);
  assert.match(normalized, /unique \(conversation_id, sent_at, direction, content_hash\)/);
  assert.match(normalized, /unique \(seller_account_id, source_batch_key\)/);
});

test("initial schema does not contain organization tables or columns", () => {
  const normalized = INTERNAL_SYNC_MIGRATIONS[0].sql.replace(/\s+/g, " ").toLowerCase();

  assert.doesNotMatch(normalized, /create table if not exists org/);
  assert.doesNotMatch(normalized, new RegExp(`\\b${["org", "id"].join("_")}\\b`));
  assert.doesNotMatch(normalized, /references org\(id\)/);
});

test("initial schema defines single-tenant user and role constraints", () => {
  const normalized = INTERNAL_SYNC_MIGRATIONS[0].sql.replace(/\s+/g, " ").toLowerCase();

  assert.match(normalized, /unique \(email\)/);
  assert.match(normalized, /unique \(name\)/);
  assert.match(normalized, /primary key \(user_id, role_id\)/);
});

test("initial schema contains internal auth credentials and sessions", () => {
  const normalized = INTERNAL_SYNC_MIGRATIONS[0].sql.replace(/\s+/g, " ").toLowerCase();

  assert.match(normalized, /password_hash text not null/);
  assert.match(normalized, /create table if not exists internal_session\b/);
  assert.match(normalized, /token_hash text not null/);
  assert.match(normalized, /expires_at timestamptz not null/);
  assert.match(normalized, /unique \(token_hash\)/);
});

test("initial schema contains internal user invitations", () => {
  const normalized = INTERNAL_SYNC_MIGRATIONS[0].sql.replace(/\s+/g, " ").toLowerCase();

  assert.match(normalized, /create table if not exists user_invitation\b/);
  assert.match(normalized, /roles text\[\] not null/);
  assert.match(normalized, /created_by uuid references app_user\(id\) on delete set null/);
  assert.match(normalized, /accepted_at timestamptz/);
  assert.match(normalized, /unique \(email, token_hash\)/);
  assert.match(normalized, /create index if not exists idx_user_invitation_email on user_invitation \(email\)/);
  assert.match(normalized, /create index if not exists idx_user_invitation_token_hash on user_invitation \(token_hash\)/);
});

test("initial schema does not define raw OneTalk credential columns", () => {
  const sql = INTERNAL_SYNC_MIGRATIONS[0].sql.toLowerCase();
  const forbidden = ["cookie2", "sgcookie", "ctoken", "_tb_token_", "chat_token", "cookie_value"];

  for (const marker of forbidden) {
    assert.equal(sql.includes(marker), false, `schema must not include ${marker}`);
  }
});

test("single-tenant schema includes auth lookup indexes", () => {
  const normalized = INTERNAL_SYNC_MIGRATIONS[0].sql.replace(/\s+/g, " ").toLowerCase();

  assert.match(normalized, /create index if not exists idx_app_user_email on app_user \(email\)/);
  assert.match(normalized, /create index if not exists idx_internal_session_user_id on internal_session \(user_id\)/);
});
