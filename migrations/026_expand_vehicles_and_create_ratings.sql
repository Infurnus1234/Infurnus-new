-- Migration 026: Expand vehicles with sector, category, fuel rate, load capacity and create ratings table

DO $$
BEGIN
  -- Add sector column to vehicles if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'sector'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN sector VARCHAR(30) NOT NULL DEFAULT 'passenger';
    ALTER TABLE vehicles ADD CONSTRAINT vehicles_sector_ck
      CHECK (sector IN ('passenger', 'logistics', 'service', 'premium'));
  END IF;

  -- Add category column to vehicles if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'category'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN category VARCHAR(50) NOT NULL DEFAULT 'sedan';
  END IF;

  -- Add fuel_rate_per_km column to vehicles if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'fuel_rate_per_km'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN fuel_rate_per_km NUMERIC(8, 2) NOT NULL DEFAULT 0.00;
  END IF;

  -- Add load_capacity_kg column to vehicles if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'load_capacity_kg'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN load_capacity_kg NUMERIC(8, 2) NOT NULL DEFAULT 0.00;
  END IF;
END $$;

-- Create ratings table
CREATE TABLE IF NOT EXISTS ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  driver_profile_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
  rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ratings_ride_unique UNIQUE (ride_id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_driver_profile_id
  ON ratings (driver_profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ratings_customer_id
  ON ratings (customer_id, created_at DESC);
