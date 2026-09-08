CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'logistics_order_status'
  ) THEN
    CREATE TYPE logistics_order_status AS ENUM (
      'PENDING',
      'CONFIRMED',
      'ASSIGNED',
      'PICKUP_IN_PROGRESS',
      'PICKED_UP',
      'IN_TRANSIT',
      'DELIVERED',
      'CANCELLED',
      'FAILED'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS logistics_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  pickup_address JSONB NOT NULL,
  drop_address JSONB NOT NULL,
  goods JSONB NOT NULL,

  status logistics_order_status NOT NULL DEFAULT 'PENDING',

  scheduled_pickup_at TIMESTAMPTZ,

  cancellation_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,

  CONSTRAINT logistics_pickup_address_object
    CHECK (jsonb_typeof(pickup_address) = 'object'),

  CONSTRAINT logistics_drop_address_object
    CHECK (jsonb_typeof(drop_address) = 'object'),

  CONSTRAINT logistics_goods_object
    CHECK (jsonb_typeof(goods) = 'object'),

  CONSTRAINT logistics_cancelled_consistency
    CHECK (
      (status = 'CANCELLED' AND cancelled_at IS NOT NULL)
      OR
      (status <> 'CANCELLED' AND cancelled_at IS NULL)
    ),

  CONSTRAINT logistics_delivered_consistency
    CHECK (
      (status = 'DELIVERED' AND delivered_at IS NOT NULL)
      OR
      (status <> 'DELIVERED' AND delivered_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_logistics_orders_user_created_at
  ON logistics_orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_logistics_orders_status_created_at
  ON logistics_orders (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_logistics_orders_scheduled_pickup
  ON logistics_orders (scheduled_pickup_at)
  WHERE scheduled_pickup_at IS NOT NULL;

CREATE OR REPLACE FUNCTION set_logistics_orders_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_logistics_orders_updated_at
  ON logistics_orders;

CREATE TRIGGER trg_logistics_orders_updated_at
BEFORE UPDATE ON logistics_orders
FOR EACH ROW
EXECUTE FUNCTION set_logistics_orders_updated_at();
