BEGIN;
ALTER TABLE provider_bank_accounts
 ADD COLUMN branch_name VARCHAR(150),
 ADD COLUMN account_type VARCHAR(20) CHECK(account_type IN ('SAVINGS','CURRENT','OTHER')),
 ADD COLUMN ownership_type VARCHAR(20) NOT NULL DEFAULT 'INDIVIDUAL' CHECK(ownership_type IN ('INDIVIDUAL','BUSINESS')),
 ADD COLUMN legal_entity_name VARCHAR(150),
 ADD COLUMN supporting_document_id UUID REFERENCES partner_documents(id) ON DELETE RESTRICT,
 ADD CONSTRAINT bank_business_entity_required CHECK(ownership_type<>'BUSINESS' OR (legal_entity_name IS NOT NULL AND length(btrim(legal_entity_name))>=2));
ALTER TABLE vehicles ADD COLUMN ownership_type VARCHAR(20) NOT NULL DEFAULT 'OWNED' CHECK(ownership_type IN ('OWNED','LEASED','FINANCED','OTHER')), ADD COLUMN owner_notes VARCHAR(1000);
-- Historical actor/target UUIDs intentionally remain after account deletion; no cascade erases audit history.
CREATE TABLE provider_bank_change_history (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 bank_account_id UUID NOT NULL,
 user_id UUID NOT NULL,
 actor_id UUID,
 action VARCHAR(30) NOT NULL,
 snapshot JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX provider_bank_change_history_owner_time ON provider_bank_change_history(user_id,created_at DESC,id DESC);
CREATE FUNCTION retain_bank_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO provider_bank_change_history(bank_account_id,user_id,actor_id,action,snapshot)
 VALUES(NEW.id,NEW.user_id,COALESCE(NULLIF(current_setting('infurnus.actor_id',true),'')::uuid,NEW.user_id),TG_OP,
 jsonb_build_object('accountNumberLast4',NEW.account_number_last4,'bankName',NEW.bank_name,'accountHolderName',NEW.account_holder_name,
 'accountType',NEW.account_type,'ownershipType',NEW.ownership_type,'supportingDocumentId',NEW.supporting_document_id,'isVerified',NEW.is_verified));
 RETURN NEW;
END; $$;
CREATE TRIGGER bank_change_history AFTER INSERT OR UPDATE ON provider_bank_accounts FOR EACH ROW EXECUTE FUNCTION retain_bank_change();
CREATE FUNCTION reject_bank_history_mutation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Bank change history is append-only'; END; $$;
CREATE TRIGGER immutable_bank_history BEFORE UPDATE OR DELETE ON provider_bank_change_history FOR EACH ROW EXECUTE FUNCTION reject_bank_history_mutation();
CREATE FUNCTION invalidate_bank_proof_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.metadata->'storage'->>'storageKey') IS DISTINCT FROM (OLD.metadata->'storage'->>'storageKey')
 OR NEW.status::text IN ('REJECTED','EXPIRED') THEN
  UPDATE provider_bank_accounts SET is_verified=FALSE,verified_by=NULL,verified_at=NULL,updated_at=NOW()
  WHERE supporting_document_id=NEW.id;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER bank_proof_reverification AFTER UPDATE OF metadata,status ON partner_documents FOR EACH ROW EXECUTE FUNCTION invalidate_bank_proof_change();
ALTER TABLE provider_document_requirements ADD COLUMN required_licence_classes TEXT[] NOT NULL DEFAULT '{}';
CREATE FUNCTION driver_licence_category_satisfied(profile_uuid UUID, category_code TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS (
  SELECT 1 FROM provider_document_requirements r JOIN driver_profiles p ON p.id=profile_uuid JOIN users u ON u.id=p.user_id
  WHERE r.provider_role=u.role::text AND r.active AND r.document_code='driver_license'
  AND r.vehicle_category IN ('*',category_code) AND cardinality(r.required_licence_classes)>0
  AND NOT EXISTS (
   SELECT 1 FROM driver_documents d WHERE d.driver_profile_id=p.id AND d.document_type='driver_license'
   AND d.verification_status='approved'
   AND (d.document_metadata->>'expiresAt' IS NULL OR (d.document_metadata->>'expiresAt')::date>=CURRENT_DATE)
   AND regexp_split_to_array(upper(COALESCE(d.document_metadata->>'licenceClasses','')),'[,;[:space:]]+') && r.required_licence_classes
  )
 );
$$;
CREATE OR REPLACE FUNCTION retain_partner_document_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.metadata->'storage',NEW.metadata->'pages',NEW.metadata->>'documentNumber',NEW.metadata->>'documentCode',NEW.metadata->>'issuingAuthority',NEW.metadata->>'holderName',NEW.metadata->>'licenceClasses',NEW.issued_at,NEW.expires_at)
 IS DISTINCT FROM (OLD.metadata->'storage',OLD.metadata->'pages',OLD.metadata->>'documentNumber',OLD.metadata->>'documentCode',OLD.metadata->>'issuingAuthority',OLD.metadata->>'holderName',OLD.metadata->>'licenceClasses',OLD.issued_at,OLD.expires_at) THEN
  INSERT INTO partner_document_history(document_id,version,snapshot) VALUES(OLD.id,OLD.version,to_jsonb(OLD));
  NEW.version:=OLD.version+1;NEW.status:='PENDING';NEW.verified_at:=NULL;NEW.reviewed_by:=NULL;NEW.reviewed_at:=NULL;
 END IF;RETURN NEW;
END; $$;

-- Allow replacement/information renewal from reviewed states, always pending.
CREATE OR REPLACE FUNCTION invalidate_partner_document_content() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.metadata->'storage',NEW.metadata->'pages',NEW.metadata->>'documentNumber',NEW.metadata->>'documentCode',NEW.metadata->>'issuingAuthority',NEW.metadata->>'holderName',NEW.metadata->>'licenceClasses',NEW.issued_at,NEW.expires_at)
 IS DISTINCT FROM (OLD.metadata->'storage',OLD.metadata->'pages',OLD.metadata->>'documentNumber',OLD.metadata->>'documentCode',OLD.metadata->>'issuingAuthority',OLD.metadata->>'holderName',OLD.metadata->>'licenceClasses',OLD.issued_at,OLD.expires_at) THEN
  NEW.status:='PENDING';NEW.verified_at:=NULL;NEW.reviewed_by:=NULL;NEW.reviewed_at:=NULL;
 END IF;RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION validate_partner_document_status_transition() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.metadata->'storage',NEW.metadata->'pages',NEW.metadata->>'documentNumber',NEW.metadata->>'documentCode',NEW.metadata->>'issuingAuthority',NEW.metadata->>'holderName',NEW.metadata->>'licenceClasses',NEW.issued_at,NEW.expires_at)
 IS DISTINCT FROM (OLD.metadata->'storage',OLD.metadata->'pages',OLD.metadata->>'documentNumber',OLD.metadata->>'documentCode',OLD.metadata->>'issuingAuthority',OLD.metadata->>'holderName',OLD.metadata->>'licenceClasses',OLD.issued_at,OLD.expires_at) AND NEW.status='PENDING' THEN RETURN NEW; END IF;
 IF OLD.status<>NEW.status AND NOT ((OLD.status='PENDING' AND NEW.status='SUBMITTED') OR (OLD.status='SUBMITTED' AND NEW.status IN ('VERIFIED','REJECTED')) OR (OLD.status='REJECTED' AND NEW.status='SUBMITTED') OR (OLD.status='VERIFIED' AND NEW.status='EXPIRED')) THEN RAISE EXCEPTION 'Invalid partner document status transition' USING ERRCODE='23514'; END IF;
 IF NEW.status='VERIFIED' AND NEW.expires_at IS NOT NULL AND NEW.expires_at<CURRENT_DATE THEN RAISE EXCEPTION 'Verified document cannot already be expired' USING ERRCODE='23514'; END IF;
 IF NEW.status='EXPIRED' AND (NEW.expires_at IS NULL OR NEW.expires_at>=CURRENT_DATE) THEN RAISE EXCEPTION 'Expired document must have a past expiry date' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION retain_driver_document_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.storage_key,NEW.document_metadata->>'documentNumber',NEW.document_metadata->>'holderName',NEW.document_metadata->>'licenceClasses',NEW.document_metadata->>'expiresAt')
 IS DISTINCT FROM (OLD.storage_key,OLD.document_metadata->>'documentNumber',OLD.document_metadata->>'holderName',OLD.document_metadata->>'licenceClasses',OLD.document_metadata->>'expiresAt') THEN
  INSERT INTO driver_document_history(document_id,driver_profile_id,version,snapshot) VALUES(OLD.id,OLD.driver_profile_id,OLD.version,to_jsonb(OLD));
  NEW.version:=OLD.version+1;NEW.verification_status:='pending';NEW.verified_at:=NULL;NEW.verified_by:=NULL;NEW.rejection_reason:=NULL;
 END IF;RETURN NEW;
END; $$;
COMMIT;
