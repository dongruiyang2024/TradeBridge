ALTER TABLE sync_batch DROP CONSTRAINT IF EXISTS sync_batch_seller_channel_account_source_batch_key;
ALTER TABLE customer DROP CONSTRAINT IF EXISTS customer_seller_channel_account_external_customer_key;
ALTER TABLE conversation DROP CONSTRAINT IF EXISTS conversation_seller_channel_account_external_conversation_key;

ALTER TABLE sync_batch
  ADD CONSTRAINT sync_batch_seller_channel_channel_account_source_batch_key
  UNIQUE (seller_account_id, channel, channel_account_id, source_batch_key);

ALTER TABLE customer
  ADD CONSTRAINT customer_seller_channel_channel_account_external_customer_key
  UNIQUE (seller_account_id, channel, channel_account_id, external_customer_id);

ALTER TABLE conversation
  ADD CONSTRAINT conversation_seller_channel_channel_account_external_conversation_key
  UNIQUE (seller_account_id, channel, channel_account_id, external_conversation_id);

CREATE INDEX IF NOT EXISTS idx_customer_seller_channel_account_external
  ON customer (seller_account_id, channel, channel_account_id, external_customer_id);

CREATE INDEX IF NOT EXISTS idx_conversation_seller_channel_account_external
  ON conversation (seller_account_id, channel, channel_account_id, external_conversation_id);

CREATE INDEX IF NOT EXISTS idx_outbound_message_seller_channel_account_claimable
  ON outbound_message (seller_account_id, channel, channel_account_id, status, created_at);
