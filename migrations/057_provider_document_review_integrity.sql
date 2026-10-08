BEGIN;

-- Extend the existing document entity; no mandatory document rules are seeded.
ALTER TABLE partner_documents ADD COLUMN reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN reviewed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION validate_partner_document_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.metadata->'storage'->>'storageKey') IS DISTINCT FROM (OLD.metadata->'storage'->>'storageKey') THEN
    NEW.status:='PENDING'; NEW.verified_at:=NULL; NEW.reviewed_by:=NULL; NEW.reviewed_at:=NULL;
    RETURN NEW;
  END IF;
  IF OLD.status<>NEW.status AND NOT (
    (OLD.status='PENDING' AND NEW.status='SUBMITTED') OR
    (OLD.status='SUBMITTED' AND NEW.status IN ('VERIFIED','REJECTED')) OR
    (OLD.status='REJECTED' AND NEW.status='SUBMITTED') OR
    (OLD.status='VERIFIED' AND NEW.status='EXPIRED')) THEN
    RAISE EXCEPTION 'Invalid partner document status transition' USING ERRCODE='23514';
  END IF;
  IF NEW.status='VERIFIED' AND NEW.expires_at IS NOT NULL AND NEW.expires_at<CURRENT_DATE THEN
    RAISE EXCEPTION 'Verified document cannot already be expired' USING ERRCODE='23514';
  END IF;
  IF NEW.status='EXPIRED' AND (NEW.expires_at IS NULL OR NEW.expires_at>=CURRENT_DATE) THEN
    RAISE EXCEPTION 'Expired document must have a past expiry date' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

-- Extend existing approval synchronization to non-financial domain targets.
CREATE OR REPLACE FUNCTION synchronize_provider_approval() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE domain_state TEXT; target_kind TEXT; reviewer_uuid UUID; reviewer_kind TEXT; reason_text TEXT;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'driver_profiles' THEN domain_state:=NEW.verification_status::text;target_kind:='driver_profile';reviewer_uuid:=NEW.verified_by;reason_text:=NEW.rejection_reason;
    WHEN 'driver_documents' THEN domain_state:=NEW.verification_status::text;target_kind:='driver_document';reviewer_uuid:=NEW.verified_by;reason_text:=NEW.rejection_reason;
    WHEN 'partners' THEN domain_state:=NEW.approval_status::text;target_kind:='partner';reviewer_uuid:=NEW.reviewed_by;reason_text:=NEW.rejection_reason;
    WHEN 'vehicles' THEN domain_state:=NEW.verification_status::text;target_kind:='vehicle';reviewer_uuid:=NEW.verified_by;
    WHEN 'partner_documents' THEN domain_state:=CASE NEW.status WHEN 'VERIFIED' THEN 'approved' WHEN 'REJECTED' THEN 'rejected' ELSE NULL END;target_kind:='partner_document';reviewer_uuid:=NEW.reviewed_by;reason_text:=NEW.metadata->>'rejectionReason';
    ELSE RETURN NEW;
  END CASE;
  IF domain_state NOT IN ('approved','rejected') OR domain_state IS NULL OR reviewer_uuid IS NULL THEN RETURN NEW; END IF;
  SELECT role::text INTO reviewer_kind FROM users WHERE id=reviewer_uuid AND status='active' AND deleted_at IS NULL;
  IF reviewer_kind IS NULL OR reviewer_kind NOT IN ('admin','super_admin') THEN RAISE EXCEPTION 'Reviewer is not authorized' USING ERRCODE='23514'; END IF;
  UPDATE provider_approval_requests SET status=upper(domain_state),reviewer_id=reviewer_uuid,reviewer_role=reviewer_kind,reviewed_at=NOW(),rejection_reason=reason_text,updated_at=NOW()
  WHERE target_type=target_kind AND target_id=NEW.id AND status='PENDING';
  RETURN NEW;
END; $$;
CREATE TRIGGER vehicle_approval_result AFTER UPDATE OF verification_status ON vehicles FOR EACH ROW EXECUTE FUNCTION synchronize_provider_approval();
CREATE TRIGGER partner_document_approval_result AFTER UPDATE OF status ON partner_documents FOR EACH ROW EXECUTE FUNCTION synchronize_provider_approval();

-- A deferred event may precede a later update in the same transaction: validate
-- the current row/version and allow rejection of a document that has expired.
CREATE OR REPLACE FUNCTION validate_provider_document_policy() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner_role TEXT; category_code TEXT; policy RECORD; page_count INTEGER; expiry_text TEXT; doc driver_documents%ROWTYPE;
BEGIN
  SELECT * INTO doc FROM driver_documents WHERE id=NEW.id;
  IF NOT FOUND OR doc.version<>NEW.version OR doc.verification_status='rejected' THEN RETURN NEW; END IF;
  SELECT u.role::text,COALESCE(v.category,'*') INTO owner_role,category_code
  FROM driver_profiles dp JOIN users u ON u.id=dp.user_id LEFT JOIN vehicles v ON v.id=dp.active_vehicle_id WHERE dp.id=doc.driver_profile_id;
  SELECT count(*) INTO page_count FROM driver_document_pages WHERE document_id=doc.id AND version=doc.version;
  page_count:=GREATEST(page_count,1); expiry_text:=doc.document_metadata->>'expiresAt';
  IF expiry_text IS NOT NULL AND (expiry_text !~ '^\d{4}-\d{2}-\d{2}$' OR expiry_text::date<CURRENT_DATE) THEN RAISE EXCEPTION 'Document expiry is invalid' USING ERRCODE='23514'; END IF;
  FOR policy IN SELECT * FROM provider_document_requirements WHERE active=TRUE AND provider_role=owner_role AND vehicle_category IN ('*',category_code)
    AND document_code=COALESCE(doc.document_metadata->>'documentCode',doc.document_type::text) LOOP
    IF policy.requires_expiry AND expiry_text IS NULL THEN RAISE EXCEPTION 'Document expiry is required by configured policy' USING ERRCODE='23514'; END IF;
    IF page_count<policy.minimum_pages THEN RAISE EXCEPTION 'Document has fewer pages than configured policy' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NEW;
END; $$;
COMMIT;
