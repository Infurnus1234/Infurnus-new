-- Authorized Thar tariff: INR 500 base + INR 45 per billable kilometre.
-- The existing calculator converts one-way route metres to round-trip billing.
-- Update the existing premium identity used by the Concierge booking flow.
-- No physical vehicle, approval, other category, or historical fare is changed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vehicle_types WHERE sector='premium' AND code='thar') THEN
    RAISE EXCEPTION 'Existing premium/thar category is required';
  END IF;
  UPDATE vehicle_types SET base_fare_paise=50000,per_km_rate_paise=4500,
    pricing_reference=NULL,active=TRUE,version=version+1
  WHERE sector='premium' AND code='thar'
    AND (base_fare_paise IS DISTINCT FROM 50000 OR per_km_rate_paise IS DISTINCT FROM 4500
      OR pricing_reference IS NOT NULL OR NOT active);
END $$;
