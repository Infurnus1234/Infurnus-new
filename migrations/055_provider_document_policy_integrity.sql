BEGIN;
DROP INDEX driver_documents_driver_type_uidx;
CREATE UNIQUE INDEX driver_documents_driver_type_uidx ON driver_documents(driver_profile_id,document_type,COALESCE(document_metadata->>'documentCode',''));

CREATE FUNCTION validate_provider_document_policy() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner_role TEXT; category_code TEXT; policy RECORD; page_count INTEGER; expiry_text TEXT;
BEGIN
  SELECT u.role::text,COALESCE(v.category,'*') INTO owner_role,category_code
  FROM driver_profiles dp JOIN users u ON u.id=dp.user_id LEFT JOIN vehicles v ON v.id=dp.active_vehicle_id WHERE dp.id=NEW.driver_profile_id;
  SELECT count(*) INTO page_count FROM driver_document_pages WHERE document_id=NEW.id AND version=NEW.version;
  page_count:=GREATEST(page_count,1);
  expiry_text:=NEW.document_metadata->>'expiresAt';
  IF expiry_text IS NOT NULL AND (expiry_text !~ '^\d{4}-\d{2}-\d{2}$' OR expiry_text::date<CURRENT_DATE) THEN
    RAISE EXCEPTION 'Document expiry is invalid' USING ERRCODE='23514';
  END IF;
  FOR policy IN SELECT * FROM provider_document_requirements WHERE active=TRUE AND provider_role=owner_role
    AND vehicle_category IN ('*',category_code) AND document_code=COALESCE(NEW.document_metadata->>'documentCode',NEW.document_type::text) LOOP
    IF policy.requires_expiry AND expiry_text IS NULL THEN RAISE EXCEPTION 'Document expiry is required by configured policy' USING ERRCODE='23514'; END IF;
    IF page_count<policy.minimum_pages THEN RAISE EXCEPTION 'Document has fewer pages than configured policy' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER driver_document_policy AFTER INSERT OR UPDATE ON driver_documents DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_provider_document_policy();

ALTER TABLE provider_bank_accounts ADD COLUMN verified_by UUID REFERENCES users(id) ON DELETE RESTRICT,ADD COLUMN verified_at TIMESTAMPTZ;
ALTER TABLE vehicles ADD COLUMN verified_by UUID REFERENCES users(id) ON DELETE RESTRICT,ADD COLUMN verified_at TIMESTAMPTZ;
COMMIT;
