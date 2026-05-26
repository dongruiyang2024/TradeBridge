CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS role (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS user_role (
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS internal_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token_hash)
);

CREATE TABLE IF NOT EXISTS user_invitation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  roles TEXT[] NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, token_hash)
);

CREATE TABLE IF NOT EXISTS seller_account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_account_id TEXT NOT NULL,
  display_name TEXT,
  last_seen_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (external_account_id)
);

CREATE TABLE IF NOT EXISTS collector_device (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id UUID REFERENCES seller_account(id) ON DELETE SET NULL,
  device_name TEXT,
  device_token_hash TEXT NOT NULL,
  last_heartbeat_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_token_hash)
);

CREATE TABLE IF NOT EXISTS sync_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id UUID NOT NULL REFERENCES seller_account(id) ON DELETE CASCADE,
  collector_device_id UUID REFERENCES collector_device(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_batch (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id UUID NOT NULL REFERENCES seller_account(id) ON DELETE CASCADE,
  collector_device_id UUID REFERENCES collector_device(id) ON DELETE SET NULL,
  source_batch_key TEXT NOT NULL,
  cursor JSONB,
  source_meta JSONB,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_account_id, source_batch_key)
);

CREATE TABLE IF NOT EXISTS customer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id UUID NOT NULL REFERENCES seller_account(id) ON DELETE CASCADE,
  external_customer_id TEXT NOT NULL,
  login_id TEXT,
  display_name TEXT,
  country TEXT,
  owner_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  stage TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_account_id, external_customer_id)
);

CREATE TABLE IF NOT EXISTS conversation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id UUID NOT NULL REFERENCES seller_account(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customer(id) ON DELETE SET NULL,
  external_conversation_id TEXT NOT NULL,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_account_id, external_conversation_id)
);

CREATE TABLE IF NOT EXISTS message (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id UUID NOT NULL REFERENCES seller_account(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  external_message_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('received', 'sent', 'unknown')),
  message_type TEXT,
  content TEXT,
  sent_at TIMESTAMPTZ,
  content_hash TEXT NOT NULL,
  raw_sanitized JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_account_id, conversation_id, external_message_id),
  UNIQUE (conversation_id, sent_at, direction, content_hash)
);

CREATE TABLE IF NOT EXISTS customer_assignment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, user_id)
);

CREATE TABLE IF NOT EXISTS customer_tag (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, tag)
);

CREATE TABLE IF NOT EXISTS customer_note (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS follow_up_task (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES app_user(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversation(id) ON DELETE CASCADE,
  prompt_version TEXT NOT NULL,
  source_message_start_at TIMESTAMPTZ,
  source_message_end_at TIMESTAMPTZ,
  summary TEXT NOT NULL,
  intent_level TEXT,
  next_action TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reply_suggestion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversation(id) ON DELETE CASCADE,
  prompt_version TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_conversation_sent_at ON message (conversation_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_customer_owner ON customer (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_task_due ON follow_up_task (status, due_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_user_invitation_email ON user_invitation (email);
CREATE INDEX IF NOT EXISTS idx_user_invitation_token_hash ON user_invitation (token_hash);
CREATE INDEX IF NOT EXISTS idx_app_user_email ON app_user (email);
CREATE INDEX IF NOT EXISTS idx_internal_session_user_id ON internal_session (user_id);
