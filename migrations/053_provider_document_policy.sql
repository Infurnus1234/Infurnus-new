BEGIN;
ALTER TABLE partner_documents DROP CONSTRAINT partner_documents_vehicle_type_ck;
ALTER TABLE partner_documents ADD CONSTRAINT partner_documents_vehicle_type_ck CHECK(
  (vehicle_id IS NULL AND document_type::text NOT IN ('VEHICLE_RC','VEHICLE_INSURANCE','VEHICLE_PERMIT','VEHICLE_FITNESS','VEHICLE_PUC'))
  OR (vehicle_id IS NOT NULL AND document_type::text IN ('VEHICLE_RC','VEHICLE_INSURANCE','VEHICLE_PERMIT','VEHICLE_FITNESS','VEHICLE_PUC'))
);

CREATE TABLE provider_document_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_role VARCHAR(30) NOT NULL CHECK(provider_role IN ('driver','fleet_owner','driver_fleet_owner')),
  vehicle_category VARCHAR(50) NOT NULL DEFAULT '*',
  document_code VARCHAR(50) NOT NULL CHECK(length(trim(document_code))>0),
  required BOOLEAN NOT NULL DEFAULT FALSE,
  requires_expiry BOOLEAN NOT NULL DEFAULT FALSE,
  minimum_pages INTEGER NOT NULL DEFAULT 1 CHECK(minimum_pages BETWEEN 1 AND 5),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_role,vehicle_category,document_code)
);
-- No new regulatory requirements or fee schedules are invented/seeding forced.
CREATE INDEX provider_document_requirements_category_idx ON provider_document_requirements(provider_role,vehicle_category) WHERE active=TRUE;

CREATE TABLE driver_document_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES driver_documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version>0),
  page_number INTEGER NOT NULL CHECK(page_number BETWEEN 1 AND 5),
  side VARCHAR(10) NOT NULL CHECK(side IN ('FRONT','BACK','PAGE')),
  storage_key VARCHAR(500) NOT NULL,
  resource_type VARCHAR(20) NOT NULL CHECK(resource_type IN ('image','raw','auto')),
  mime_type VARCHAR(100) NOT NULL,
  file_size INTEGER NOT NULL CHECK(file_size>0 AND file_size<=15728640),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_id,version,page_number)
);

ALTER TABLE partner_documents ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  ADD COLUMN upload_source VARCHAR(10) NOT NULL DEFAULT 'FILE' CHECK(upload_source IN ('CAMERA','GALLERY','FILE'));
CREATE TABLE partner_document_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES partner_documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version>0),
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_id,version)
);
CREATE FUNCTION retain_partner_document_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.metadata->'storage'->>'storageKey') IS DISTINCT FROM (OLD.metadata->'storage'->>'storageKey') THEN
    INSERT INTO partner_document_history(document_id,version,snapshot) VALUES(OLD.id,OLD.version,to_jsonb(OLD));
    NEW.version:=OLD.version+1; NEW.status:='PENDING'; NEW.verified_at:=NULL;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER partner_document_version BEFORE UPDATE ON partner_documents FOR EACH ROW EXECUTE FUNCTION retain_partner_document_version();
COMMIT;
