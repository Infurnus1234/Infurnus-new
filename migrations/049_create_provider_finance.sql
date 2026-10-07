BEGIN;

-- These entities do not exist in the audited schema. Keep existing users,
-- provider bank accounts and user_history as the identity/audit authorities.
CREATE TABLE provider_wallets (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  balance_paise BIGINT NOT NULL DEFAULT 0 CHECK (balance_paise >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE provider_wallet_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES provider_wallets(user_id) ON DELETE RESTRICT,
  amount_paise BIGINT NOT NULL CHECK (amount_paise <> 0),
  balance_after_paise BIGINT NOT NULL CHECK (balance_after_paise >= 0),
  entry_type VARCHAR(30) NOT NULL CHECK (entry_type IN ('EARNING','COMMISSION','ADJUSTMENT','PAYOUT_RESERVE','PAYOUT_REFUND')),
  reference VARCHAR(150) NOT NULL CHECK (length(trim(reference)) > 0),
  idempotency_key VARCHAR(100) NOT NULL CHECK (length(trim(idempotency_key)) > 0),
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX provider_wallet_entries_owner_time_idx ON provider_wallet_entries(user_id, created_at DESC);

CREATE TABLE provider_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES provider_wallets(user_id) ON DELETE RESTRICT,
  bank_account_id UUID NOT NULL REFERENCES provider_bank_accounts(id) ON DELETE RESTRICT,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','SUCCESS','FAILED')),
  idempotency_key VARCHAR(100) NOT NULL CHECK (length(trim(idempotency_key)) > 0),
  provider_reference VARCHAR(150),
  failure_reason VARCHAR(1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idempotency_key),
  CHECK (status <> 'SUCCESS' OR provider_reference IS NOT NULL),
  CHECK (status <> 'FAILED' OR failure_reason IS NOT NULL)
);
CREATE UNIQUE INDEX provider_payouts_reference_uidx ON provider_payouts(provider_reference) WHERE provider_reference IS NOT NULL;
CREATE INDEX provider_payouts_owner_time_idx ON provider_payouts(user_id, created_at DESC);
CREATE INDEX provider_payouts_pending_idx ON provider_payouts(created_at) WHERE status IN ('PENDING','PROCESSING');

-- Freeze payout destinations while money is reserved; clients cannot replace
-- the details behind a payout already handed to the payment operator.
CREATE FUNCTION protect_pending_payout_bank() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.account_number_encrypted, NEW.ifsc_code, NEW.account_holder_name)
     IS DISTINCT FROM (OLD.account_number_encrypted, OLD.ifsc_code, OLD.account_holder_name)
     AND EXISTS (SELECT 1 FROM provider_payouts WHERE bank_account_id = OLD.id AND status IN ('PENDING','PROCESSING')) THEN
    RAISE EXCEPTION 'Bank account has a pending payout' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER provider_bank_pending_payout_guard BEFORE UPDATE ON provider_bank_accounts
FOR EACH ROW EXECUTE FUNCTION protect_pending_payout_bank();

COMMIT;
