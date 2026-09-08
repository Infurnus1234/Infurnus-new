CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'rental_status'
  ) THEN
    CREATE TYPE rental_status AS ENUM (
      'PENDING',
      'CONFIRMED',
      'ACTIVE',
      'COMPLETED',
      'CANCELLED'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS rentals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,

  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,

  status rental_status NOT NULL DEFAULT 'PENDING',

  total_amount NUMERIC(12, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',

  cancellation_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,

  CONSTRAINT rentals_valid_period
    CHECK (end_at > start_at),

  CONSTRAINT rentals_valid_amount
    CHECK (total_amount >= 0),

  CONSTRAINT rentals_valid_currency
    CHECK (currency ~ '^[A-Z]{3}$'),

  CONSTRAINT rentals_cancelled_consistency
    CHECK (
      (status = 'CANCELLED' AND cancelled_at IS NOT NULL)
      OR
      (status <> 'CANCELLED' AND cancelled_at IS NULL)
    ),

  CONSTRAINT rentals_completed_consistency
    CHECK (
      (status = 'COMPLETED' AND completed_at IS NOT NULL)
      OR
      (status <> 'COMPLETED' AND completed_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_rentals_user_created_at
  ON rentals (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rentals_vehicle_period
  ON rentals (vehicle_id, start_at, end_at);

CREATE INDEX IF NOT EXISTS idx_rentals_status_start_at
  ON rentals (status, start_at);

CREATE OR REPLACE FUNCTION set_rentals_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rentals_updated_at ON rentals;

CREATE TRIGGER trg_rentals_updated_at
BEFORE UPDATE ON rentals
FOR EACH ROW
EXECUTE FUNCTION set_rentals_updated_at();
