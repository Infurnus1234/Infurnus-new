BEGIN;
-- OTHER is an existing configurable type, not a new mandatory document.
ALTER TABLE partner_documents DROP CONSTRAINT partner_documents_vehicle_type_ck;
ALTER TABLE partner_documents ADD CONSTRAINT partner_documents_vehicle_type_ck CHECK(
 (vehicle_id IS NULL AND document_type::text NOT IN ('VEHICLE_RC','VEHICLE_INSURANCE','VEHICLE_PERMIT','VEHICLE_FITNESS','VEHICLE_PUC'))
 OR (vehicle_id IS NOT NULL AND document_type::text IN ('VEHICLE_RC','VEHICLE_INSURANCE','VEHICLE_PERMIT','VEHICLE_FITNESS','VEHICLE_PUC','OTHER'))
);
CREATE UNIQUE INDEX partner_custom_document_code_uidx ON partner_documents(partner_id,COALESCE(vehicle_id,'00000000-0000-0000-0000-000000000000'::uuid), (metadata->>'documentCode'))
WHERE document_type='OTHER' AND metadata->>'documentCode' IS NOT NULL;
COMMIT;
