-- Restore the existing Customer selection without changing its tariff or activation.
UPDATE vehicle_types
SET catalog_visible = TRUE, catalog_order = 3, version = version + 1
WHERE sector = 'service' AND code = 'towing' AND NOT catalog_visible;

-- Booking capacity belongs to the catalog type. Individual vehicle registration
-- capacity is a separate attribute and retains its existing value.
ALTER TABLE vehicle_types ADD COLUMN load_capacity_kg integer
  CHECK (load_capacity_kg IS NULL OR (load_capacity_kg > 0 AND sector = 'logistics'));

UPDATE vehicle_types t SET load_capacity_kg = capacity.kg
FROM (VALUES ('piaggio_ape',750), ('tata_magic',1000), ('cargo_207',2000), ('tata_407',3000))
  AS capacity(code,kg)
WHERE t.sector = 'logistics' AND t.code = capacity.code;
