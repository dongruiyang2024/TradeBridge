ALTER TABLE collector_device
  ADD COLUMN IF NOT EXISTS trade_mind_binding_token TEXT;

CREATE INDEX IF NOT EXISTS idx_collector_device_trade_mind_binding_token
  ON collector_device (trade_mind_binding_token)
  WHERE trade_mind_binding_token IS NOT NULL;
