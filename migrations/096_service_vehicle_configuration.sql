-- Additive, with no invented tariffs or automatic activation of existing types.
ALTER TABLE vehicle_types
 ADD COLUMN service_fixed_fare_paise BIGINT CHECK(service_fixed_fare_paise BETWEEN 0 AND 9999999999),
 ADD COLUMN service_radius_meters INTEGER NOT NULL DEFAULT 25000 CHECK(service_radius_meters BETWEEN 1 AND 200000);
ALTER TABLE vehicle_types DROP CONSTRAINT vehicle_type_pricing_model_check;
ALTER TABLE vehicle_types ADD CONSTRAINT vehicle_type_pricing_model_check CHECK (
 (sector='service' AND service_fixed_fare_paise IS NOT NULL AND base_fare_paise IS NULL AND per_km_rate_paise IS NULL AND pricing_reference IS NULL AND hourly_base_fares_paise IS NULL AND logistics_slabs IS NULL) OR
 (service_fixed_fare_paise IS NULL AND (
 (logistics_slabs IS NOT NULL AND sector='logistics' AND logistics_slabs_valid(logistics_slabs) AND base_fare_paise IS NULL AND per_km_rate_paise IS NULL AND pricing_reference IS NULL AND hourly_base_fares_paise IS NULL) OR
 (logistics_slabs IS NULL AND ((base_fare_paise IS NOT NULL AND per_km_rate_paise IS NOT NULL AND code<>'ftl') OR
 (base_fare_paise IS NULL AND per_km_rate_paise IS NULL AND ((pricing_reference IS NOT NULL AND jsonb_typeof(pricing_reference)='object') OR (pricing_reference IS NULL AND active=FALSE)))))))
);
-- Existing service distance tariffs remain stored for rollback, but new application
-- eligibility fails closed until an administrator explicitly saves a fixed fare.
ALTER TABLE rides ADD COLUMN client_request_id UUID;
CREATE UNIQUE INDEX rides_customer_request_unique ON rides(customer_id,client_request_id) WHERE client_request_id IS NOT NULL;
-- driver_profiles.last_location already has the GiST geography index used by ST_DWithin.
