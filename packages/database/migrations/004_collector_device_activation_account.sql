ALTER TABLE collector_device
  ADD COLUMN IF NOT EXISTS activated_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS activated_by_user_email TEXT,
  ADD COLUMN IF NOT EXISTS activated_by_user_display_name TEXT,
  ADD COLUMN IF NOT EXISTS activated_by_user_roles TEXT[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_collector_device_activated_by_user_email
  ON collector_device (activated_by_user_email);
