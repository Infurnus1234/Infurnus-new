BEGIN;
ALTER TABLE vehicles DROP CONSTRAINT vehicles_sector_ck;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_sector_ck CHECK(sector IN ('passenger','logistics','service','premium','rental'));
-- Inventory sector is retained; rentals never become passenger dispatch implicitly.
COMMIT;
