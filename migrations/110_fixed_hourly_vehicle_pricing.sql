-- Premium prices live on Premium categories. Chauffeured Rental uses the
-- passenger catalog, with separate columns from its ordinary ride tariffs.
ALTER TABLE vehicle_types
  ADD COLUMN fixed_hourly_rate_paise BIGINT,
  ADD COLUMN hourly_fuel_rate_paise BIGINT,
  ADD COLUMN hourly_fuel_unit TEXT,
  ADD COLUMN rental_pricing_version INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT vehicle_fixed_hourly_pricing_valid CHECK (
    (fixed_hourly_rate_paise IS NULL AND hourly_fuel_rate_paise IS NULL AND hourly_fuel_unit IS NULL)
    OR (
      sector IN ('premium', 'passenger')
      AND fixed_hourly_rate_paise IS NOT NULL AND fixed_hourly_rate_paise BETWEEN 0 AND 9999999999
      AND hourly_fuel_rate_paise IS NOT NULL AND hourly_fuel_rate_paise BETWEEN 0 AND 9999999999
      AND hourly_fuel_unit IS NOT NULL AND hourly_fuel_unit IN ('per_booking', 'per_hour', 'per_km')
    )
  );

-- Permit a Premium category to activate with fixed hourly pricing alone.
-- Keep the other sectors' pricing checks identical to migration 096.
ALTER TABLE vehicle_types DROP CONSTRAINT vehicle_type_pricing_model_check;
ALTER TABLE vehicle_types ADD CONSTRAINT vehicle_type_pricing_model_check CHECK (
 (sector='service' AND service_fixed_fare_paise IS NOT NULL AND base_fare_paise IS NULL AND per_km_rate_paise IS NULL AND pricing_reference IS NULL AND hourly_base_fares_paise IS NULL AND logistics_slabs IS NULL) OR
 (service_fixed_fare_paise IS NULL AND (
 (logistics_slabs IS NOT NULL AND sector='logistics' AND logistics_slabs_valid(logistics_slabs) AND base_fare_paise IS NULL AND per_km_rate_paise IS NULL AND pricing_reference IS NULL AND hourly_base_fares_paise IS NULL) OR
 (logistics_slabs IS NULL AND ((base_fare_paise IS NOT NULL AND per_km_rate_paise IS NOT NULL AND code<>'ftl') OR
 (base_fare_paise IS NULL AND per_km_rate_paise IS NULL AND ((pricing_reference IS NOT NULL AND jsonb_typeof(pricing_reference)='object') OR (pricing_reference IS NULL AND (active=FALSE OR (sector='premium' AND fixed_hourly_rate_paise IS NOT NULL)))))))))
);
