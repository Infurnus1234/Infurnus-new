-- Explicit fleet configuration: never infer a vehicle's home city from a destination or GPS.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS operating_city_id TEXT;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_operating_city_format CHECK
 (operating_city_id IS NULL OR operating_city_id ~ '^[A-Za-z][A-Za-z0-9_-]{0,99}$');
CREATE INDEX IF NOT EXISTS vehicles_premium_operating_city_idx
 ON vehicles(operating_city_id,category) WHERE sector='premium';
