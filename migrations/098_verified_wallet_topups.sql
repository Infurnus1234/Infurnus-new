BEGIN;
CREATE TABLE wallet_topup_orders (
  order_id VARCHAR(100) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_paise BIGINT NOT NULL CHECK (amount_paise BETWEEN 1000 AND 10000000),
  idempotency_key VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, idempotency_key)
);
COMMIT;
