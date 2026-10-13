-- Owner-approved initial minimum rates. Preserve previously configured exact prices
-- and activation; this migration does not activate any vehicle type.
UPDATE vehicle_types AS v SET
 base_fare_paise=p.base,
 per_km_rate_paise=p.rate,
 pricing_reference=NULL,
 version=v.version+1
FROM (VALUES
 ('bike',1500,500),('auto',2000,800),('mini',4000,900),
 ('sedan',6500,1200),('suv',9000,1600),('three_wheeler',20000,1500),
 ('mini_truck',23500,1800),('pickup_8ft',32500,2000),('tata_407',77500,2500)
) AS p(code,base,rate)
WHERE v.code=p.code AND v.base_fare_paise IS NULL AND v.per_km_rate_paise IS NULL;

-- A starting reference is not a complete truck/route quote.
UPDATE vehicle_types SET
 pricing_reference='{"displayName":"FTL (Intercity, per truck size)","baseFare":null,"perKmRate":{"minimum":2600,"maximum":2600},"routeBased":true}'::jsonb,
 version=version+1
WHERE code='ftl' AND base_fare_paise IS NULL AND per_km_rate_paise IS NULL;
