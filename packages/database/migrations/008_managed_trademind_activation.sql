CREATE TABLE IF NOT EXISTS managed_trademind_activation (
  identity_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  user_display_name TEXT,
  channel TEXT NOT NULL,
  binding_token TEXT NOT NULL,
  activation_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, workspace_id, user_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_managed_trademind_activation_token
  ON managed_trademind_activation (activation_token_hash)
  WHERE consumed_at IS NULL;

ALTER TABLE collector_device
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;
