DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'payment_status'
  ) THEN
    CREATE TYPE payment_status AS ENUM (
      'INITIATED',
      'AUTHORIZED',
      'CAPTURED',
      'REFUNDED',
      'FAILED'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  ride_id UUID,
  rental_id UUID REFERENCES rentals(id) ON DELETE RESTRICT,
  logistics_order_id UUID REFERENCES logistics_orders(id) ON DELETE RESTRICT,

  status payment_status NOT NULL DEFAULT 'INITIATED',

  amount NUMERIC(12, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',

  provider VARCHAR(50),
  provider_order_id VARCHAR(255),
  provider_payment_id VARCHAR(255),

  idempotency_key VARCHAR(255),

  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  authorized_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,

  failure_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT payments_valid_amount
    CHECK (amount >= 0),

  CONSTRAINT payments_valid_currency
    CHECK (currency ~ '^[A-Z]{3}$'),

  CONSTRAINT payments_single_business_reference
    CHECK (
      (ride_id IS NOT NULL)::INTEGER +
      (rental_id IS NOT NULL)::INTEGER +
      (logistics_order_id IS NOT NULL)::INTEGER = 1
    ),

  CONSTRAINT payments_authorized_consistency
    CHECK (
      (status IN ('AUTHORIZED', 'CAPTURED', 'REFUNDED') AND authorized_at IS NOT NULL)
      OR
      (status IN ('INITIATED', 'FAILED') AND authorized_at IS NULL)
    ),

  CONSTRAINT payments_captured_consistency
    CHECK (
      (status IN ('CAPTURED', 'REFUNDED') AND captured_at IS NOT NULL)
      OR
      (status IN ('INITIATED', 'AUTHORIZED', 'FAILED') AND captured_at IS NULL)
    ),

  CONSTRAINT payments_refunded_consistency
    CHECK (
      (status = 'REFUNDED' AND refunded_at IS NOT NULL)
      OR
      (status <> 'REFUNDED' AND refunded_at IS NULL)
    ),

  CONSTRAINT payments_failed_consistency
    CHECK (
      (status = 'FAILED' AND failed_at IS NOT NULL)
      OR
      (status <> 'FAILED' AND failed_at IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_idempotency_key
  ON payments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_order_id
  ON payments (provider_order_id)
  WHERE provider_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_payment_id
  ON payments (provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_user_created_at
  ON payments (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_status_created_at
  ON payments (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_ride
  ON payments (ride_id)
  WHERE ride_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_rental
  ON payments (rental_id)
  WHERE rental_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_logistics_order
  ON payments (logistics_order_id)
  WHERE logistics_order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION set_payments_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;

CREATE TRIGGER trg_payments_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW
EXECUTE FUNCTION set_payments_updated_at();
