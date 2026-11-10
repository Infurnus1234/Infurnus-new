BEGIN;
ALTER TABLE vehicle_types ADD COLUMN registration_active BOOLEAN NOT NULL DEFAULT FALSE;
-- Preserve the complete existing Premium registration list.
UPDATE vehicle_types SET registration_active=catalog_visible WHERE sector='premium';
-- One-time initial registration selections. Keep IDs, prices, registrations and Premium unchanged.
-- Future additions remain controlled by Admin catalog_visible + active; no runtime whitelist.
WITH selected(sector,code,name,position) AS (VALUES
 ('passenger','hatchback','Hatchback',0),('passenger','mini','Mini Cab',1),
 ('passenger','sedan','Sedan',2),('passenger','innova','Innova Crysta',3),
 ('logistics','tata_407','Tata 407',0),('logistics','cargo_207','Tata 207',1),
 ('logistics','tata_magic','Tata Magic',2),('logistics','piaggio_ape','Piaggio Ape',3),
 ('service','ambulance','Ambulance',0),('service','crane','Crane',1),('service','jcb','JCB',2)
)
UPDATE vehicle_types t
SET catalog_visible = s.code IS NOT NULL,
    catalog_order = COALESCE(s.position,1000),
    name = COALESCE(s.name,t.name),
    registration_active = s.code IS NOT NULL,
    version = t.version + 1
FROM (SELECT existing.id, selected.code, selected.name, selected.position
      FROM vehicle_types existing LEFT JOIN selected
        ON existing.sector=selected.sector AND existing.code=selected.code
      WHERE existing.sector IN ('passenger','logistics','service')) s
WHERE t.id=s.id;
DO $$ BEGIN
 IF (SELECT count(*) FROM vehicle_types WHERE sector IN ('passenger','logistics','service') AND catalog_visible AND registration_active) <> 11 THEN
   RAISE EXCEPTION 'The initial Fleet registration catalog requires all 11 existing vehicle types';
 END IF;
END $$;
COMMIT;
