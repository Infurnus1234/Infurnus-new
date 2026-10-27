-- Additive compatibility migration: preserve IDs and existing historical audit data.
ALTER TABLE vehicle_types DROP CONSTRAINT vehicle_types_code_key;
ALTER TABLE vehicle_types ADD CONSTRAINT vehicle_types_sector_code_key UNIQUE(sector,code);
ALTER TABLE vehicle_types DROP CONSTRAINT vehicle_types_sector_check;
ALTER TABLE vehicle_types ADD CONSTRAINT vehicle_types_sector_check CHECK(sector IN ('passenger','logistics','service','premium','rental'));
ALTER TABLE vehicle_types DROP CONSTRAINT vehicle_types_code_check;
ALTER TABLE vehicle_types ADD CONSTRAINT vehicle_types_code_check CHECK(code ~ '^[a-z][a-z0-9_-]{0,49}$');
CREATE INDEX rides_demand_window_idx ON rides(sector,vehicle_category,created_at);
-- Before/after images support deliberate rollback without destroying audit history.
CREATE TABLE vehicle_pricing_rollout_audit (
  rollout TEXT NOT NULL,
  vehicle_type_id UUID NOT NULL,
  before_row JSONB NOT NULL,
  after_row JSONB NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(rollout,vehicle_type_id)
);

-- Defensive DB validation in addition to strict Admin API validation.
CREATE FUNCTION vehicle_pricing_reference_valid(p JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE b JSONB; r JSONB; d JSONB; amount NUMERIC; value JSONB;
BEGIN
 IF p IS NULL OR p='null'::jsonb THEN RETURN TRUE; END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(p->'displayName') IS DISTINCT FROM 'string' OR length(trim(p->>'displayName'))=0 THEN RETURN FALSE; END IF;
 b=p->'baseFare'; r=p->'perKmRate'; d=p->'demandPricing';
 IF jsonb_typeof(r)<>'object' OR r->'minimum' IS NULL OR r->'maximum' IS NULL THEN RETURN FALSE; END IF;
 IF b IS NULL OR b='null'::jsonb THEN
  IF p->>'routeBased' IS DISTINCT FROM 'true' THEN RETURN FALSE; END IF;
 ELSE
  IF jsonb_typeof(b)<>'object' OR b->'minimum' IS NULL OR b->'maximum' IS NULL THEN RETURN FALSE; END IF;
 END IF;
 FOR value IN SELECT x FROM (VALUES(r->'minimum'),(r->'maximum'),(b->'minimum'),(b->'maximum')) v(x) LOOP
  IF value IS NULL OR value='null'::jsonb THEN CONTINUE; END IF;
  IF jsonb_typeof(value)<>'number' THEN RETURN FALSE; END IF;
  amount=value::text::numeric;
  IF amount<>trunc(amount) OR amount<0 OR amount>9999999999 THEN RETURN FALSE; END IF;
 END LOOP;
 IF (r->>'minimum')::numeric>(r->>'maximum')::numeric OR (b->>'minimum')::numeric>(b->>'maximum')::numeric THEN RETURN FALSE; END IF;
 IF r->'minimum'='null'::jsonb OR r->'maximum'='null'::jsonb OR (b<>'null'::jsonb AND b->'minimum'='null'::jsonb) THEN RETURN FALSE; END IF;
 IF d IS NOT NULL THEN
  IF jsonb_typeof(d)<>'object' THEN RETURN FALSE; END IF;
  FOREACH value IN ARRAY ARRAY[d->'windowSeconds',d->'lowBookingCount',d->'highBookingCount',d->'staleAfterSeconds'] LOOP
   IF value IS NULL OR jsonb_typeof(value)<>'number' OR value::text::numeric<>trunc(value::text::numeric) THEN RETURN FALSE; END IF;
  END LOOP;
  IF (d->>'windowSeconds')::numeric NOT BETWEEN 1 AND 86400 OR (d->>'lowBookingCount')::numeric<0 OR (d->>'highBookingCount')::numeric>1000000 OR (d->>'highBookingCount')::numeric<=(d->>'lowBookingCount')::numeric OR (d->>'staleAfterSeconds')::numeric NOT BETWEEN 1 AND (d->>'windowSeconds')::numeric THEN RETURN FALSE; END IF;
 END IF;
 RETURN TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;
ALTER TABLE vehicle_types ADD CONSTRAINT vehicle_types_reference_valid CHECK(vehicle_pricing_reference_valid(pricing_reference));

ALTER TABLE vehicle_types ADD CONSTRAINT vehicle_types_single_pricing_model CHECK(NULLIF(pricing_reference,'null'::jsonb) IS NULL OR (base_fare_paise IS NULL AND per_km_rate_paise IS NULL));
