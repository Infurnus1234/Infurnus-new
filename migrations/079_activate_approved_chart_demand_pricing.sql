-- Explicit user-approved chart only. No aliases, registration rows or physical vehicles changed.
-- Existing forward-only migration runner applies this atomically; abort if identities drifted.
CREATE TEMP TABLE approved_chart_prices(sector TEXT,code TEXT,pricing JSONB) ON COMMIT DROP;
INSERT INTO approved_chart_prices VALUES
('passenger','bike','{"displayName": "Bike", "baseFare": {"minimum": 1500, "maximum": 2000}, "perKmRate": {"minimum": 500, "maximum": 800}, "demandPricing": {"windowSeconds": 300, "lowBookingCount": 5, "highBookingCount": 20, "staleAfterSeconds": 30}}'::jsonb),
('passenger','auto','{"displayName": "Auto", "baseFare": {"minimum": 2000, "maximum": 2500}, "perKmRate": {"minimum": 800, "maximum": 1100}, "demandPricing": {"windowSeconds": 300, "lowBookingCount": 5, "highBookingCount": 20, "staleAfterSeconds": 30}}'::jsonb),
('passenger','mini','{"displayName": "Mini Cab", "baseFare": {"minimum": 4000, "maximum": 8000}, "perKmRate": {"minimum": 900, "maximum": 1100}, "demandPricing": {"windowSeconds": 300, "lowBookingCount": 5, "highBookingCount": 20, "staleAfterSeconds": 30}}'::jsonb),
('passenger','sedan','{"displayName": "Sedan", "baseFare": {"minimum": 6500, "maximum": 10000}, "perKmRate": {"minimum": 1200, "maximum": 1500}, "demandPricing": {"windowSeconds": 300, "lowBookingCount": 5, "highBookingCount": 20, "staleAfterSeconds": 30}}'::jsonb),
('passenger','suv','{"displayName": "SUV", "baseFare": {"minimum": 9000, "maximum": 12000}, "perKmRate": {"minimum": 1600, "maximum": 2200}, "demandPricing": {"windowSeconds": 300, "lowBookingCount": 5, "highBookingCount": 20, "staleAfterSeconds": 30}}'::jsonb),
('logistics','three_wheeler','{"displayName": "3-Wheeler (Goods)", "baseFare": {"minimum": 20000, "maximum": 20000}, "perKmRate": {"minimum": 1500, "maximum": 2000}, "demandPricing": {"windowSeconds": 300, "lowBookingCount": 5, "highBookingCount": 20, "staleAfterSeconds": 30}}'::jsonb),
('logistics','mini_truck','{"displayName": "Mini Truck (Tata Ace)", "baseFare": {"minimum": 23500, "maximum": 32500}, "perKmRate": {"minimum": 1800, "maximum": 2200}, "demandPricing": {"windowSeconds": 300, "lowBookingCount": 5, "highBookingCount": 20, "staleAfterSeconds": 30}}'::jsonb),
('logistics','pickup_8ft','{"displayName": "Pickup 8ft", "baseFare": {"minimum": 32500, "maximum": 37500}, "perKmRate": {"minimum": 2000, "maximum": 2500}, "demandPricing": {"windowSeconds": 300, "lowBookingCount": 5, "highBookingCount": 20, "staleAfterSeconds": 30}}'::jsonb),
('logistics','tata_407','{"displayName": "Tata 407", "baseFare": {"minimum": 77500, "maximum": null}, "perKmRate": {"minimum": 2500, "maximum": 3000}, "demandPricing": {"windowSeconds": 300, "lowBookingCount": 5, "highBookingCount": 20, "staleAfterSeconds": 30}}'::jsonb),
('logistics','ftl','{"displayName": "FTL (Intercity, per truck size)", "baseFare": null, "perKmRate": {"minimum": 2600, "maximum": 9100}, "routeBased": true, "demandPricing": {"windowSeconds": 300, "lowBookingCount": 5, "highBookingCount": 20, "staleAfterSeconds": 30}}'::jsonb);
DO $$ BEGIN
  IF (SELECT count(*) FROM vehicle_types t JOIN approved_chart_prices p USING(sector,code)) <> 10 THEN
    RAISE EXCEPTION 'Approved chart category identities require review; expected exactly ten existing records';
  END IF;
END $$;
-- Shared advisory key matches Admin updates and booking configuration locks.
SELECT pg_advisory_xact_lock(hashtextextended(code,648032)) FROM approved_chart_prices ORDER BY code;
INSERT INTO vehicle_pricing_rollout_audit(rollout,vehicle_type_id,before_row,after_row)
SELECT 'approved-chart-demand-v1',t.id,to_jsonb(t),'{}'::jsonb FROM vehicle_types t JOIN approved_chart_prices p USING(sector,code);
UPDATE vehicle_types t SET name=p.pricing->>'displayName',base_fare_paise=NULL,per_km_rate_paise=NULL,pricing_reference=p.pricing,currency='INR',active=TRUE,version=version+1
FROM approved_chart_prices p WHERE t.sector=p.sector AND t.code=p.code;
UPDATE vehicle_pricing_rollout_audit a SET after_row=to_jsonb(t) FROM vehicle_types t WHERE a.vehicle_type_id=t.id AND a.rollout='approved-chart-demand-v1';
