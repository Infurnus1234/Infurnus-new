BEGIN;

-- 1. Add explicit first-class domain columns to rides
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS sector VARCHAR(30) NOT NULL DEFAULT 'passenger',
  ADD COLUMN IF NOT EXISTS vehicle_category VARCHAR(50),
  ADD COLUMN IF NOT EXISTS fare_estimate NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS final_fare NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS actual_distance_meters INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_fuel_cost NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS pin VARCHAR(6),
  ADD COLUMN IF NOT EXISTS pin_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Backfill existing rides from route_metadata JSONB if available
UPDATE rides
SET
  sector = COALESCE(NULLIF(route_metadata->>'sector', ''), 'passenger'),
  vehicle_category = COALESCE(NULLIF(route_metadata->>'vehicleCategory', ''), NULLIF(route_metadata->>'vehicleType', '')),
  fare_estimate = CASE
    WHEN route_metadata->'pricing'->>'estimatedFare' IS NOT NULL THEN (route_metadata->'pricing'->>'estimatedFare')::NUMERIC(10, 2)
    WHEN route_metadata->>'fareEstimate' IS NOT NULL THEN (route_metadata->>'fareEstimate')::NUMERIC(10, 2)
    ELSE NULL
  END
WHERE route_metadata IS NOT NULL;

-- 3. Add sector and metric validation constraints
ALTER TABLE rides
  DROP CONSTRAINT IF EXISTS rides_sector_check;

ALTER TABLE rides
  ADD CONSTRAINT rides_sector_check
  CHECK (sector IN ('passenger', 'logistics', 'service', 'premium'));

ALTER TABLE rides
  DROP CONSTRAINT IF EXISTS rides_actual_distance_check;

ALTER TABLE rides
  ADD CONSTRAINT rides_actual_distance_check
  CHECK (actual_distance_meters >= 0);

-- 4. Add targeted performance indexes
CREATE INDEX IF NOT EXISTS idx_rides_sector_status
  ON rides (sector, status);

CREATE INDEX IF NOT EXISTS idx_rides_driver_status
  ON rides (assigned_driver_id, status)
  WHERE assigned_driver_id IS NOT NULL;

-- 5. Add foreign key constraint linking payments to rides
ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS fk_payments_rides;

ALTER TABLE payments
  ADD CONSTRAINT fk_payments_rides
  FOREIGN KEY (ride_id) REFERENCES rides (id) ON DELETE RESTRICT;

-- 6. Create GPS breadcrumbs table for in-trip location and distance tracking
CREATE TABLE IF NOT EXISTS ride_location_breadcrumbs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides (id) ON DELETE CASCADE,
  location geography(Point, 4326) NOT NULL,
  speed NUMERIC(6, 2),
  heading NUMERIC(5, 2),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_breadcrumbs_ride_id_recorded_at
  ON ride_location_breadcrumbs (ride_id, recorded_at ASC);

CREATE INDEX IF NOT EXISTS idx_breadcrumbs_location_gist
  ON ride_location_breadcrumbs USING GIST (location);

COMMIT;
