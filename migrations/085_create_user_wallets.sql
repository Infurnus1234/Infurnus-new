BEGIN;

CREATE TABLE IF NOT EXISTS user_wallets (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  balance_paise BIGINT NOT NULL DEFAULT 0 CHECK (balance_paise >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_wallet_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_wallets(user_id) ON DELETE RESTRICT,
  amount_paise BIGINT NOT NULL CHECK (amount_paise <> 0),
  balance_after_paise BIGINT NOT NULL CHECK (balance_after_paise >= 0),
  entry_type VARCHAR(30) NOT NULL CHECK (entry_type IN ('TOPUP', 'DEBIT_PAYMENT', 'REFUND', 'PROMO_CREDIT', 'CASHBACK', 'PEER_TRANSFER')),
  reference VARCHAR(150) NOT NULL CHECK (length(trim(reference)) > 0),
  description VARCHAR(255),
  payment_method VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'PENDING', 'FAILED', 'REFUNDED')),
  idempotency_key VARCHAR(100) NOT NULL CHECK (length(trim(idempotency_key)) > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_user_wallet_entries_user_created 
  ON user_wallet_entries(user_id, created_at DESC);

COMMIT;
