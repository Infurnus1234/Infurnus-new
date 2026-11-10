-- Add optional duration pricing to the existing catalog. Never seed example fares.
ALTER TABLE vehicle_types
  ADD COLUMN hourly_base_fares_paise JSONB,
  ADD COLUMN hourly_missing_duration_policy TEXT NOT NULL DEFAULT 'legacy_base',
  ADD COLUMN extended_duration_policy TEXT;

CREATE FUNCTION vehicle_hourly_fares_valid(fares JSONB) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE AS $$
 SELECT CASE WHEN jsonb_typeof(fares)='object' THEN
   COALESCE((SELECT bool_and(
     key=ANY(ARRAY['1','2','3','4','5','6','7','8','9','10','11','12','12_plus'])
     AND CASE WHEN jsonb_typeof(value)='number' THEN
       (value::text)::numeric BETWEEN 0 AND 9999999999
       AND trunc((value::text)::numeric)=(value::text)::numeric
       ELSE FALSE END) FROM jsonb_each(fares)), TRUE)
 ELSE FALSE END
$$;
ALTER TABLE vehicle_types
 ADD CONSTRAINT vehicle_hourly_duration_policy CHECK
   (hourly_missing_duration_policy IN ('legacy_base','require_duration')),
 ADD CONSTRAINT vehicle_extended_duration_policy CHECK
   (extended_duration_policy IS NULL OR extended_duration_policy='booked_duration'),
 ADD CONSTRAINT vehicle_hourly_pricing_valid CHECK
   (hourly_base_fares_paise IS NULL OR (
     sector IN ('passenger','premium') AND vehicle_hourly_fares_valid(hourly_base_fares_paise)
     AND base_fare_paise IS NOT NULL AND per_km_rate_paise IS NOT NULL AND pricing_reference IS NULL
     AND (NOT active OR hourly_base_fares_paise ?& ARRAY['1','2','3','4','5','6','7','8','9','10','11','12','12_plus'])
   ));
