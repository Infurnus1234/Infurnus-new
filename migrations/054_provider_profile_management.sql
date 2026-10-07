BEGIN;
ALTER TABLE partners ADD COLUMN business_type VARCHAR(100),ADD COLUMN gst_number VARCHAR(30);
ALTER TABLE vehicles ADD COLUMN maintenance_notes VARCHAR(1000),ADD COLUMN last_service_date DATE,
  ADD COLUMN next_service_date DATE,ADD COLUMN operational_status VARCHAR(20) NOT NULL DEFAULT 'INACTIVE'
  CHECK(operational_status IN ('ACTIVE','INACTIVE','MAINTENANCE'));
CREATE UNIQUE INDEX vehicles_normalized_active_plate_uidx ON vehicles(upper(regexp_replace(plate_number,'[^A-Za-z0-9]','','g'))) WHERE is_active=TRUE;

CREATE FUNCTION audit_provider_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE actor_uuid UUID; resource_uuid UUID; event_kind TEXT; resource_kind TEXT; row_json JSONB;
BEGIN
  IF TG_OP='DELETE' THEN row_json:=to_jsonb(OLD); ELSE row_json:=to_jsonb(NEW); END IF;
  resource_uuid:=(row_json->>'id')::uuid;
  resource_kind:=TG_TABLE_NAME;
  CASE TG_TABLE_NAME
    WHEN 'driver_profiles' THEN actor_uuid:=COALESCE((row_json->>'verified_by')::uuid,(row_json->>'user_id')::uuid);
    WHEN 'driver_documents' THEN actor_uuid:=COALESCE((row_json->>'verified_by')::uuid,(row_json->>'uploaded_by')::uuid);
    WHEN 'partners' THEN actor_uuid:=COALESCE((row_json->>'reviewed_by')::uuid,(row_json->>'user_id')::uuid);
    WHEN 'vehicles' THEN actor_uuid:=(row_json->>'owner_id')::uuid;
    WHEN 'partner_documents' THEN SELECT user_id INTO actor_uuid FROM partners WHERE id=(row_json->>'partner_id')::uuid;
    WHEN 'provider_approval_requests' THEN actor_uuid:=COALESCE((row_json->>'reviewer_id')::uuid,(row_json->>'requester_id')::uuid);
  END CASE;
  -- Prefer authenticated transaction context when services supply it.
  IF NULLIF(current_setting('infurnus.actor_id',TRUE),'') IS NOT NULL THEN actor_uuid:=current_setting('infurnus.actor_id')::uuid; END IF;
  IF actor_uuid IS NOT NULL AND EXISTS(SELECT 1 FROM users WHERE id=actor_uuid) THEN
    event_kind:=CASE WHEN TG_OP='INSERT' THEN 'provider_resource_created' WHEN TG_OP='DELETE' THEN 'provider_resource_deleted' ELSE 'provider_resource_updated' END;
    INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata)
    VALUES(actor_uuid,event_kind,resource_kind,resource_uuid,jsonb_build_object('operation',TG_OP,'source','database','actorSource',CASE WHEN NULLIF(current_setting('infurnus.actor_id',TRUE),'') IS NOT NULL THEN 'authenticated_context' ELSE 'domain_record' END));
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER provider_profile_audit AFTER INSERT OR UPDATE OF license_number,license_expiry,verification_status OR DELETE ON driver_profiles FOR EACH ROW EXECUTE FUNCTION audit_provider_change();
CREATE TRIGGER provider_document_audit AFTER INSERT OR UPDATE OR DELETE ON driver_documents FOR EACH ROW EXECUTE FUNCTION audit_provider_change();
CREATE TRIGGER provider_fleet_audit AFTER INSERT OR UPDATE OR DELETE ON partners FOR EACH ROW EXECUTE FUNCTION audit_provider_change();
CREATE TRIGGER provider_vehicle_audit AFTER INSERT OR UPDATE OR DELETE ON vehicles FOR EACH ROW EXECUTE FUNCTION audit_provider_change();
CREATE TRIGGER provider_partner_document_audit AFTER INSERT OR UPDATE OR DELETE ON partner_documents FOR EACH ROW EXECUTE FUNCTION audit_provider_change();
CREATE TRIGGER provider_approval_audit AFTER INSERT OR UPDATE ON provider_approval_requests FOR EACH ROW EXECUTE FUNCTION audit_provider_change();

-- Automatic closure only where the existing domain records an actual reviewer.
CREATE FUNCTION synchronize_provider_approval() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE domain_state TEXT; target_kind TEXT; reviewer_uuid UUID; reviewer_kind TEXT; reason_text TEXT;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'driver_profiles' THEN domain_state:=NEW.verification_status::text;target_kind:='driver_profile';reviewer_uuid:=NEW.verified_by;reason_text:=NEW.rejection_reason;
    WHEN 'driver_documents' THEN domain_state:=NEW.verification_status::text;target_kind:='driver_document';reviewer_uuid:=NEW.verified_by;reason_text:=NEW.rejection_reason;
    WHEN 'partners' THEN domain_state:=NEW.approval_status::text;target_kind:='partner';reviewer_uuid:=NEW.reviewed_by;reason_text:=NEW.rejection_reason;
    ELSE RETURN NEW;
  END CASE;
  IF domain_state NOT IN ('approved','rejected') OR reviewer_uuid IS NULL THEN RETURN NEW; END IF;
  SELECT role::text INTO reviewer_kind FROM users WHERE id=reviewer_uuid AND status='active' AND deleted_at IS NULL;
  IF reviewer_kind NOT IN ('admin','super_admin') THEN RAISE EXCEPTION 'Reviewer is not authorized' USING ERRCODE='23514'; END IF;
  UPDATE provider_approval_requests SET status=upper(domain_state),reviewer_id=reviewer_uuid,reviewer_role=reviewer_kind,reviewed_at=NOW(),rejection_reason=reason_text,updated_at=NOW()
  WHERE target_type=target_kind AND target_id=NEW.id AND status='PENDING';
  RETURN NEW;
END; $$;
CREATE TRIGGER driver_profile_approval_result AFTER UPDATE OF verification_status ON driver_profiles FOR EACH ROW EXECUTE FUNCTION synchronize_provider_approval();
CREATE TRIGGER driver_document_approval_result AFTER UPDATE OF verification_status ON driver_documents FOR EACH ROW EXECUTE FUNCTION synchronize_provider_approval();
CREATE TRIGGER fleet_approval_result AFTER UPDATE OF approval_status ON partners FOR EACH ROW EXECUTE FUNCTION synchronize_provider_approval();
COMMIT;
