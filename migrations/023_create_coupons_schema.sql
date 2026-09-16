BEGIN;

-- ============================================================
-- Coupon discount type
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'coupon_discount_type'
  ) THEN
    CREATE TYPE coupon_discount_type AS ENUM (
      'PERCENTAGE',
      'FIXED'
    );
  END IF;
END
$$;


-- ============================================================
-- Coupons
-- ============================================================

CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  code VARCHAR(50) NOT NULL,

  discount_type coupon_discount_type NOT NULL,

  -- Percentage is stored as a numeric percentage value.
  -- Example: 20.00 = 20%.
  discount_value NUMERIC(10, 2) NOT NULL,

  -- Maximum discount in paise.
  -- Required for percentage coupons.
  max_discount_amount BIGINT,

  -- Minimum fare required before the coupon can be applied.
  -- Stored in paise.
  min_fare_amount BIGINT NOT NULL DEFAULT 0,

  -- NULL means unlimited total redemptions.
  usage_limit INTEGER,

  -- NULL means unlimited redemptions per user.
  per_user_limit INTEGER,

  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  expires_at TIMESTAMPTZ,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  -- Counter maintained transactionally during redemption.
  usage_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT coupons_code_not_empty_ck
    CHECK (length(btrim(code)) > 0),

  CONSTRAINT coupons_discount_value_ck
    CHECK (discount_value > 0),

  CONSTRAINT coupons_percentage_value_ck
    CHECK (
      discount_type <> 'PERCENTAGE'
      OR discount_value <= 100
    ),

  CONSTRAINT coupons_max_discount_ck
    CHECK (
      max_discount_amount IS NULL
      OR max_discount_amount > 0
    ),

  CONSTRAINT coupons_percentage_max_discount_ck
    CHECK (
      discount_type <> 'PERCENTAGE'
      OR max_discount_amount IS NOT NULL
    ),

  CONSTRAINT coupons_fixed_max_discount_ck
    CHECK (
      discount_type <> 'FIXED'
      OR max_discount_amount IS NULL
    ),

  CONSTRAINT coupons_min_fare_ck
    CHECK (min_fare_amount >= 0),

  CONSTRAINT coupons_usage_limit_ck
    CHECK (
      usage_limit IS NULL
      OR usage_limit > 0
    ),

  CONSTRAINT coupons_per_user_limit_ck
    CHECK (
      per_user_limit IS NULL
      OR per_user_limit > 0
    ),

  CONSTRAINT coupons_usage_count_ck
    CHECK (usage_count >= 0),

  CONSTRAINT coupons_usage_count_limit_ck
    CHECK (
      usage_limit IS NULL
      OR usage_count <= usage_limit
    ),

  CONSTRAINT coupons_expiry_ck
    CHECK (
      expires_at IS NULL
      OR expires_at > starts_at
    )
);


-- ============================================================
-- Coupon code normalization
--
-- Codes are stored normalized by the application/service layer.
-- This unique index also protects against accidental duplicates.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_uidx
  ON coupons (UPPER(code));


-- ============================================================
-- Coupon lookup indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS coupons_active_window_idx
  ON coupons (is_active, starts_at, expires_at);

CREATE INDEX IF NOT EXISTS coupons_expires_at_idx
  ON coupons (expires_at)
  WHERE expires_at IS NOT NULL;


-- ============================================================
-- Coupon redemptions
--
-- This table is the immutable audit record of every successful
-- coupon application.
--
-- Monetary values are stored in paise.
-- ============================================================

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  coupon_id UUID NOT NULL
    REFERENCES coupons(id)
    ON DELETE RESTRICT,

  user_id UUID NOT NULL
    REFERENCES users(id)
    ON DELETE RESTRICT,

  ride_id UUID NOT NULL
    REFERENCES rides(id)
    ON DELETE RESTRICT,

  coupon_code VARCHAR(50) NOT NULL,

  discount_type coupon_discount_type NOT NULL,

  discount_value NUMERIC(10, 2) NOT NULL,

  fare_before_discount BIGINT NOT NULL,

  discount_amount BIGINT NOT NULL,

  fare_after_discount BIGINT NOT NULL,

  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT coupon_redemptions_code_not_empty_ck
    CHECK (length(btrim(coupon_code)) > 0),

  CONSTRAINT coupon_redemptions_discount_value_ck
    CHECK (discount_value > 0),

  CONSTRAINT coupon_redemptions_fare_before_ck
    CHECK (fare_before_discount >= 0),

  CONSTRAINT coupon_redemptions_discount_amount_ck
    CHECK (discount_amount >= 0),

  CONSTRAINT coupon_redemptions_fare_after_ck
    CHECK (fare_after_discount >= 0),

  CONSTRAINT coupon_redemptions_discount_not_exceed_fare_ck
    CHECK (
      discount_amount <= fare_before_discount
    ),

  CONSTRAINT coupon_redemptions_fare_math_ck
    CHECK (
      fare_after_discount =
        fare_before_discount - discount_amount
    )
);


-- ============================================================
-- Redemption indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_idx
  ON coupon_redemptions (coupon_id, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS coupon_redemptions_user_idx
  ON coupon_redemptions (user_id, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS coupon_redemptions_ride_idx
  ON coupon_redemptions (ride_id);


-- ============================================================
-- Updated-at trigger
-- ============================================================

CREATE OR REPLACE FUNCTION set_coupons_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_coupons_updated_at ON coupons;

CREATE TRIGGER trg_coupons_updated_at
BEFORE UPDATE ON coupons
FOR EACH ROW
EXECUTE FUNCTION set_coupons_updated_at();


COMMIT;