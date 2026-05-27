CREATE TABLE IF NOT EXISTS outbound_message (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id UUID NOT NULL REFERENCES seller_account(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  external_message_id TEXT,
  created_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  delivered_by_device_id TEXT,
  error_code TEXT,
  error_message TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbound_message_pending ON outbound_message (seller_account_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_outbound_message_conversation ON outbound_message (conversation_id, created_at);
