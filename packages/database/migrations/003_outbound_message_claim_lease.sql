ALTER TABLE outbound_message ADD COLUMN IF NOT EXISTS claimed_by_device_id TEXT;
ALTER TABLE outbound_message ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_outbound_message_claimable
  ON outbound_message (seller_account_id, status, claim_expires_at, created_at);
