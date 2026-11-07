BEGIN;
ALTER TABLE vehicles ADD COLUMN operating_location JSONB;
ALTER TABLE vehicles ADD CONSTRAINT vehicle_operating_location_shape CHECK (
 operating_location IS NULL OR (
 jsonb_typeof(operating_location)='object' AND operating_location ?& ARRAY['address','latitude','longitude'] AND
 jsonb_typeof(operating_location->'address')='string' AND length(trim(operating_location->>'address')) BETWEEN 1 AND 500 AND
 jsonb_typeof(operating_location->'latitude')='number' AND jsonb_typeof(operating_location->'longitude')='number' AND
 (operating_location->>'latitude')::double precision BETWEEN -90 AND 90 AND
 (operating_location->>'longitude')::double precision BETWEEN -180 AND 180
 ));
ALTER TABLE vehicles ADD COLUMN operating_point geography(Point,4326) GENERATED ALWAYS AS (
 CASE WHEN operating_location IS NOT NULL THEN ST_SetSRID(ST_MakePoint((operating_location->>'longitude')::double precision,(operating_location->>'latitude')::double precision),4326)::geography END
) STORED;
CREATE INDEX vehicles_operating_point_gist ON vehicles USING GIST(operating_point) WHERE operating_point IS NOT NULL;
-- Preserve approved existing city coordinates without inventing missing locations.
UPDATE vehicles v SET operating_location=jsonb_build_object('address',c.name,'latitude',c.latitude,'longitude',c.longitude)
FROM premium_service_cities c WHERE v.sector='premium' AND v.operating_city_id=c.id AND v.operating_location IS NULL;
COMMIT;
