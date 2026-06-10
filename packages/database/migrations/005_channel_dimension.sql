CREATE TABLE IF NOT EXISTS channel_account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id UUID NOT NULL REFERENCES seller_account(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  display_name TEXT,
  surface TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_account_id, channel, external_account_id)
);

ALTER TABLE sync_batch ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE sync_batch ADD COLUMN IF NOT EXISTS channel_account_id UUID REFERENCES channel_account(id) ON DELETE SET NULL;

ALTER TABLE customer ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS channel_account_id UUID REFERENCES channel_account(id) ON DELETE SET NULL;

ALTER TABLE conversation ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE conversation ADD COLUMN IF NOT EXISTS channel_account_id UUID REFERENCES channel_account(id) ON DELETE SET NULL;

ALTER TABLE message ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE message ADD COLUMN IF NOT EXISTS channel_account_id UUID REFERENCES channel_account(id) ON DELETE SET NULL;

ALTER TABLE outbound_message ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE outbound_message ADD COLUMN IF NOT EXISTS channel_account_id UUID REFERENCES channel_account(id) ON DELETE SET NULL;

UPDATE sync_batch SET channel = 'alibaba-im' WHERE channel IS NULL;
UPDATE customer SET channel = 'alibaba-im' WHERE channel IS NULL;
UPDATE conversation SET channel = 'alibaba-im' WHERE channel IS NULL;
UPDATE message SET channel = 'alibaba-im' WHERE channel IS NULL;
UPDATE outbound_message SET channel = 'alibaba-im' WHERE channel IS NULL;

ALTER TABLE sync_batch ALTER COLUMN channel SET DEFAULT 'alibaba-im';
ALTER TABLE customer ALTER COLUMN channel SET DEFAULT 'alibaba-im';
ALTER TABLE conversation ALTER COLUMN channel SET DEFAULT 'alibaba-im';
ALTER TABLE message ALTER COLUMN channel SET DEFAULT 'alibaba-im';
ALTER TABLE outbound_message ALTER COLUMN channel SET DEFAULT 'alibaba-im';

ALTER TABLE sync_batch ALTER COLUMN channel SET NOT NULL;
ALTER TABLE customer ALTER COLUMN channel SET NOT NULL;
ALTER TABLE conversation ALTER COLUMN channel SET NOT NULL;
ALTER TABLE message ALTER COLUMN channel SET NOT NULL;
ALTER TABLE outbound_message ALTER COLUMN channel SET NOT NULL;

ALTER TABLE sync_batch DROP CONSTRAINT IF EXISTS sync_batch_seller_account_id_source_batch_key_key;
ALTER TABLE customer DROP CONSTRAINT IF EXISTS customer_seller_account_id_external_customer_id_key;
ALTER TABLE conversation DROP CONSTRAINT IF EXISTS conversation_seller_account_id_external_conversation_id_key;
ALTER TABLE message DROP CONSTRAINT IF EXISTS message_seller_account_id_conversation_id_external_message_id_key;
ALTER TABLE message DROP CONSTRAINT IF EXISTS message_conversation_id_sent_at_direction_content_hash_key;

ALTER TABLE sync_batch
  ADD CONSTRAINT sync_batch_seller_channel_account_source_batch_key
  UNIQUE (seller_account_id, channel, source_batch_key);

ALTER TABLE customer
  ADD CONSTRAINT customer_seller_channel_account_external_customer_key
  UNIQUE (seller_account_id, channel, external_customer_id);

ALTER TABLE conversation
  ADD CONSTRAINT conversation_seller_channel_account_external_conversation_key
  UNIQUE (seller_account_id, channel, external_conversation_id);

ALTER TABLE message
  ADD CONSTRAINT message_seller_channel_account_conversation_external_message_key
  UNIQUE (seller_account_id, channel, conversation_id, external_message_id);

ALTER TABLE message
  ADD CONSTRAINT message_channel_account_conversation_fallback_key
  UNIQUE (seller_account_id, channel, conversation_id, sent_at, direction, content_hash);

CREATE INDEX IF NOT EXISTS idx_channel_account_seller_channel ON channel_account (seller_account_id, channel);
CREATE INDEX IF NOT EXISTS idx_customer_channel_account ON customer (channel_account_id, external_customer_id);
CREATE INDEX IF NOT EXISTS idx_conversation_channel_account ON conversation (channel_account_id, external_conversation_id);
CREATE INDEX IF NOT EXISTS idx_message_channel_account ON message (channel_account_id, conversation_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_outbound_message_channel_account ON outbound_message (channel_account_id, status, created_at);
