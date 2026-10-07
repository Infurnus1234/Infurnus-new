-- Registered vehicles are physical inventory (plate/owner/driver), not fare types.
-- No existing fare catalog exists. Keep that inventory and historical rides intact.
CREATE TABLE vehicle_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL CHECK (length(trim(name)) > 0),
  code VARCHAR(50) NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{0,49}$' AND code <> 'ftl'),
  sector VARCHAR(30) NOT NULL CHECK (sector IN ('passenger','logistics','service','premium')),
  base_fare_paise BIGINT NOT NULL CHECK (base_fare_paise BETWEEN 0 AND 9999999999),
  per_km_rate_paise BIGINT NOT NULL CHECK (per_km_rate_paise BETWEEN 0 AND 9999999999),
  currency VARCHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX vehicle_types_sector_active_idx ON vehicle_types(sector, active);
CREATE TRIGGER vehicle_types_set_updated_at BEFORE UPDATE ON vehicle_types
  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
-- No seed exact prices: an authorized administrator must configure them explicitly.
-- The existing forward-only runner does not support rollback migrations.
