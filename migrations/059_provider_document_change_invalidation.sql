BEGIN;
CREATE OR REPLACE FUNCTION retain_partner_document_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.metadata->'storage',NEW.metadata->'pages',NEW.metadata->>'documentNumber',NEW.metadata->>'documentCode',NEW.metadata->>'issuingAuthority',NEW.issued_at,NEW.expires_at)
 IS DISTINCT FROM (OLD.metadata->'storage',OLD.metadata->'pages',OLD.metadata->>'documentNumber',OLD.metadata->>'documentCode',OLD.metadata->>'issuingAuthority',OLD.issued_at,OLD.expires_at) THEN
  INSERT INTO partner_document_history(document_id,version,snapshot) VALUES(OLD.id,OLD.version,to_jsonb(OLD));
  NEW.version:=OLD.version+1;NEW.status:='PENDING';NEW.verified_at:=NULL;NEW.reviewed_by:=NULL;NEW.reviewed_at:=NULL;
 END IF;RETURN NEW;
END; $$;

-- Allow replacement/information renewal from reviewed states, always pending.
CREATE FUNCTION invalidate_partner_document_content() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.metadata->'storage',NEW.metadata->'pages',NEW.metadata->>'documentNumber',NEW.metadata->>'documentCode',NEW.metadata->>'issuingAuthority',NEW.issued_at,NEW.expires_at)
 IS DISTINCT FROM (OLD.metadata->'storage',OLD.metadata->'pages',OLD.metadata->>'documentNumber',OLD.metadata->>'documentCode',OLD.metadata->>'issuingAuthority',OLD.issued_at,OLD.expires_at) THEN
  NEW.status:='PENDING';NEW.verified_at:=NULL;NEW.reviewed_by:=NULL;NEW.reviewed_at:=NULL;
 END IF;RETURN NEW;
END; $$;
CREATE TRIGGER partner_document_content_invalidation BEFORE UPDATE ON partner_documents FOR EACH ROW EXECUTE FUNCTION invalidate_partner_document_content();

CREATE OR REPLACE FUNCTION validate_partner_document_status_transition() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.metadata->'storage',NEW.metadata->'pages',NEW.metadata->>'documentNumber',NEW.metadata->>'documentCode',NEW.metadata->>'issuingAuthority',NEW.issued_at,NEW.expires_at)
 IS DISTINCT FROM (OLD.metadata->'storage',OLD.metadata->'pages',OLD.metadata->>'documentNumber',OLD.metadata->>'documentCode',OLD.metadata->>'issuingAuthority',OLD.issued_at,OLD.expires_at) AND NEW.status='PENDING' THEN RETURN NEW; END IF;
 IF OLD.status<>NEW.status AND NOT ((OLD.status='PENDING' AND NEW.status='SUBMITTED') OR (OLD.status='SUBMITTED' AND NEW.status IN ('VERIFIED','REJECTED')) OR (OLD.status='REJECTED' AND NEW.status='SUBMITTED') OR (OLD.status='VERIFIED' AND NEW.status='EXPIRED')) THEN RAISE EXCEPTION 'Invalid partner document status transition' USING ERRCODE='23514'; END IF;
 IF NEW.status='VERIFIED' AND NEW.expires_at IS NOT NULL AND NEW.expires_at<CURRENT_DATE THEN RAISE EXCEPTION 'Verified document cannot already be expired' USING ERRCODE='23514'; END IF;
 IF NEW.status='EXPIRED' AND (NEW.expires_at IS NULL OR NEW.expires_at>=CURRENT_DATE) THEN RAISE EXCEPTION 'Expired document must have a past expiry date' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION enforce_provider_configured_compliance() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner_uuid UUID;profile_uuid UUID;fleet_uuid UUID;vehicle_uuid UUID;category_code TEXT;is_approved BOOLEAN;
BEGIN
 CASE TG_TABLE_NAME
 WHEN 'driver_profiles' THEN owner_uuid:=NEW.user_id;profile_uuid:=NEW.id;vehicle_uuid:=NEW.active_vehicle_id;is_approved:=NEW.verification_status='approved';SELECT category INTO category_code FROM vehicles WHERE id=vehicle_uuid;
 WHEN 'partners' THEN owner_uuid:=NEW.user_id;fleet_uuid:=NEW.id;is_approved:=NEW.approval_status='approved';
 WHEN 'vehicles' THEN owner_uuid:=NEW.owner_id;vehicle_uuid:=NEW.id;category_code:=NEW.category;is_approved:=NEW.verification_status='approved';SELECT id INTO fleet_uuid FROM partners WHERE user_id=owner_uuid;
 END CASE;
 IF is_approved AND NOT provider_compliance_satisfied(owner_uuid,profile_uuid,fleet_uuid,vehicle_uuid,category_code) THEN RAISE EXCEPTION 'Configured required documents must be approved and valid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER provider_profile_compliance BEFORE INSERT OR UPDATE OF verification_status ON driver_profiles FOR EACH ROW EXECUTE FUNCTION enforce_provider_configured_compliance();
CREATE TRIGGER provider_fleet_compliance BEFORE INSERT OR UPDATE OF approval_status ON partners FOR EACH ROW EXECUTE FUNCTION enforce_provider_configured_compliance();
CREATE TRIGGER provider_vehicle_compliance BEFORE INSERT OR UPDATE OF verification_status ON vehicles FOR EACH ROW EXECUTE FUNCTION enforce_provider_configured_compliance();
COMMIT;
