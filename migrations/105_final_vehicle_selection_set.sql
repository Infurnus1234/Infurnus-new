BEGIN;
-- Preserve records, prices and Premium configurations. Only revise the requested selection metadata.
WITH selected(sector,code,name,position) AS (VALUES
 ('passenger','hatchback','Hatchback',0),('passenger','mini','Mini Cab',1),
 ('passenger','sedan','Sedan',2),('passenger','innova','Innova Crysta',3),
 ('logistics','tata_407','Tata 407',0),('logistics','cargo_207','Tata 207',1),
 ('logistics','tata_magic','Tata Magic',2),('logistics','piaggio_ape','Piaggio Ape',3),
 ('service','ambulance','Ambulance',0),('service','crane','Crane',1),('service','jcb','JCB',2)
)
UPDATE vehicle_types t SET catalog_visible=s.code IS NOT NULL,catalog_order=COALESCE(s.position,1000),name=COALESCE(s.name,t.name),version=version+1
FROM (SELECT old.id,selected.code,selected.name,selected.position FROM vehicle_types old LEFT JOIN selected ON old.sector=selected.sector AND old.code=selected.code WHERE old.sector IN ('passenger','logistics','service')) s
WHERE t.id=s.id;
COMMIT;
