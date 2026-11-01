-- Stable identities for all existing registration/customer categories. No fare
-- values are copied, invented, activated, or changed on existing records.
ALTER TABLE vehicle_types DROP CONSTRAINT vehicle_type_pricing_model_check;
ALTER TABLE vehicle_types ADD CONSTRAINT vehicle_type_pricing_model_check CHECK (
 (base_fare_paise IS NOT NULL AND per_km_rate_paise IS NOT NULL AND code <> 'ftl') OR
 (base_fare_paise IS NULL AND per_km_rate_paise IS NULL AND
  ((pricing_reference IS NOT NULL AND jsonb_typeof(pricing_reference)='object') OR
   (pricing_reference IS NULL AND active=FALSE)))
);
INSERT INTO vehicle_types(name,code,sector,base_fare_paise,per_km_rate_paise,active)
SELECT name,code,sector,NULL,NULL,FALSE FROM fleet_registration_vehicle_types
ON CONFLICT(sector,code) DO NOTHING;
