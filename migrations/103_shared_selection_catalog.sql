BEGIN;
ALTER TABLE vehicle_types ADD COLUMN catalog_visible BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE vehicle_types ADD COLUMN catalog_order INTEGER NOT NULL DEFAULT 1000;
-- Initialize the requested shared catalog using existing inventory records.
-- Availability and all approved prices remain under the existing Admin controls.
WITH approved(sector,code,name,sort_order) AS (VALUES
  ('logistics','piaggio_ape','Piaggio Ape',0),
  ('logistics','tata_magic','Tata Magic',1),
  ('logistics','tata_407','Tata 407',2),
  ('logistics','cargo_207','Tata 207',3),
  ('passenger','hatchback','Hatchback',0),
  ('passenger','sedan','Sedan',1),
  ('passenger','innova','Innova Crysta',2),
  ('passenger','mini','Mini',3),
  ('service','ambulance','Ambulance',0),
  ('service','towing','Towing Van',1),
  ('service','jcb','JCB',2),
  ('premium','scorpio','Scorpio N',0),
  ('premium','thar','Mahindra Thar',1),
  ('premium','innova','Innova Crysta',2),
  ('premium','mercedes','Mercedes V-Class',3),
  ('premium','helicopter','Helicopter',4),
  ('premium','traveller','Force Traveller',5)
)
UPDATE vehicle_types t
SET catalog_visible = a.code IS NOT NULL,
    catalog_order = COALESCE(a.sort_order,1000),
    name = COALESCE(a.name,t.name),
    version = t.version + 1
FROM (SELECT existing.id, approved.code, approved.name, approved.sort_order
      FROM vehicle_types existing LEFT JOIN approved
      ON approved.sector=existing.sector AND approved.code=existing.code) a
WHERE t.id=a.id;
COMMIT;
