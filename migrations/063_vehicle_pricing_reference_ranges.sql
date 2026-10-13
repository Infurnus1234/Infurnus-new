-- Owner-supplied approximate reference. No exact prices or production activation.
ALTER TABLE vehicle_types ALTER COLUMN base_fare_paise DROP NOT NULL;
ALTER TABLE vehicle_types ALTER COLUMN per_km_rate_paise DROP NOT NULL;
ALTER TABLE vehicle_types DROP CONSTRAINT vehicle_types_code_check;
ALTER TABLE vehicle_types ADD CONSTRAINT vehicle_types_code_check CHECK (code ~ '^[a-z][a-z0-9_]{0,49}$');
ALTER TABLE vehicle_types ADD COLUMN pricing_reference JSONB;
ALTER TABLE vehicle_types ADD CONSTRAINT vehicle_type_pricing_model_check CHECK (
 (base_fare_paise IS NOT NULL AND per_km_rate_paise IS NOT NULL AND code <> 'ftl') OR
 (base_fare_paise IS NULL AND per_km_rate_paise IS NULL AND pricing_reference IS NOT NULL AND jsonb_typeof(pricing_reference)='object')
);
INSERT INTO vehicle_types(name,code,sector,base_fare_paise,per_km_rate_paise,pricing_reference,active) VALUES
('Bike','bike','passenger',NULL,NULL,'{"displayName":"Bike","baseFare":{"minimum":1500,"maximum":2000},"perKmRate":{"minimum":500,"maximum":800}}'::jsonb,FALSE),
('Auto','auto','passenger',NULL,NULL,'{"displayName":"Auto","baseFare":{"minimum":2000,"maximum":2500},"perKmRate":{"minimum":800,"maximum":1100}}'::jsonb,FALSE),
('Mini Cab','mini','passenger',NULL,NULL,'{"displayName":"Mini Cab","baseFare":{"minimum":4000,"maximum":8000},"perKmRate":{"minimum":900,"maximum":1100}}'::jsonb,FALSE),
('Sedan','sedan','passenger',NULL,NULL,'{"displayName":"Sedan","baseFare":{"minimum":6500,"maximum":10000},"perKmRate":{"minimum":1200,"maximum":1500}}'::jsonb,FALSE),
('SUV','suv','passenger',NULL,NULL,'{"displayName":"SUV","baseFare":{"minimum":9000,"maximum":12000},"perKmRate":{"minimum":1600,"maximum":2200}}'::jsonb,FALSE),
('Piaggio Ape','three_wheeler','logistics',NULL,NULL,'{"displayName":"Piaggio Ape","baseFare":{"minimum":20000,"maximum":20000},"perKmRate":{"minimum":1500,"maximum":2000}}'::jsonb,FALSE),
('Magic','mini_truck','logistics',NULL,NULL,'{"displayName":"Magic","baseFare":{"minimum":23500,"maximum":32500},"perKmRate":{"minimum":1800,"maximum":2200}}'::jsonb,FALSE),
('Pickup','pickup_8ft','logistics',NULL,NULL,'{"displayName":"Pickup","baseFare":{"minimum":32500,"maximum":37500},"perKmRate":{"minimum":2000,"maximum":2500}}'::jsonb,FALSE),
('Tata 407','tata_407','logistics',NULL,NULL,'{"displayName":"Tata 407","baseFare":{"minimum":77500,"maximum":null},"perKmRate":{"minimum":2500,"maximum":3000}}'::jsonb,FALSE),
('FTL (Intercity, per truck size)','ftl','logistics',NULL,NULL,'{"displayName":"FTL (Intercity, per truck size)","baseFare":null,"perKmRate":{"minimum":2600,"maximum":9100},"routeBased":true}'::jsonb,FALSE)
ON CONFLICT(code) DO UPDATE SET name=CASE
 WHEN vehicle_types.code='three_wheeler' AND vehicle_types.name='3-Wheeler (Goods)' THEN 'Piaggio Ape'
 WHEN vehicle_types.code='mini_truck' AND vehicle_types.name='Mini Truck (Tata Ace)' THEN 'Magic'
 WHEN vehicle_types.code='pickup_8ft' AND vehicle_types.name='Pickup 8ft' THEN 'Pickup'
 ELSE vehicle_types.name END,
 pricing_reference=COALESCE(NULLIF(vehicle_types.pricing_reference,'null'::jsonb),EXCLUDED.pricing_reference),
 version=vehicle_types.version+1
WHERE vehicle_types.pricing_reference IS NULL OR vehicle_types.pricing_reference='null'::jsonb
 OR (vehicle_types.code='three_wheeler' AND vehicle_types.name='3-Wheeler (Goods)')
 OR (vehicle_types.code='mini_truck' AND vehicle_types.name='Mini Truck (Tata Ace)')
 OR (vehicle_types.code='pickup_8ft' AND vehicle_types.name='Pickup 8ft');
