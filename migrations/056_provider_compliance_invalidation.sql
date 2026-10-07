BEGIN;
CREATE FUNCTION invalidate_changed_provider_business() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.business_name,NEW.business_type,NEW.gst_number,NEW.owner_name,NEW.address,NEW.city,NEW.state,NEW.pin_code)
     IS DISTINCT FROM (OLD.business_name,OLD.business_type,OLD.gst_number,OLD.owner_name,OLD.address,OLD.city,OLD.state,OLD.pin_code)
     AND OLD.approval_status='approved' THEN
    NEW.approval_status:='pending';NEW.availability_status:='offline';NEW.reviewed_by:=NULL;NEW.reviewed_at:=NULL;NEW.approved_by:=NULL;NEW.approved_at:=NULL;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER fleet_business_reverification BEFORE UPDATE ON partners FOR EACH ROW EXECUTE FUNCTION invalidate_changed_provider_business();
DROP TRIGGER partner_approval_handoff ON partners;
CREATE TRIGGER partner_approval_handoff AFTER INSERT OR UPDATE ON partners FOR EACH ROW EXECUTE FUNCTION enqueue_provider_approval();

CREATE FUNCTION invalidate_uploaded_driver_licence() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.document_type='driver_license' AND NEW.verification_status='pending' AND
     (TG_OP='INSERT' OR NEW.storage_key IS DISTINCT FROM OLD.storage_key) THEN
    UPDATE driver_profiles SET verification_status='pending',verified_by=NULL,verified_at=NULL,
      availability_status=CASE WHEN availability_status='busy' THEN availability_status ELSE 'unavailable'::driver_availability_status END
    WHERE id=NEW.driver_profile_id;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER driver_licence_upload_reverification AFTER INSERT OR UPDATE OF storage_key ON driver_documents FOR EACH ROW EXECUTE FUNCTION invalidate_uploaded_driver_licence();

CREATE FUNCTION synchronize_vehicle_operational_status() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active THEN NEW.operational_status:='ACTIVE';
  ELSIF NEW.operational_status<>'MAINTENANCE' THEN NEW.operational_status:='INACTIVE'; END IF;
  IF TG_OP='UPDATE' AND (NEW.plate_number,NEW.make,NEW.model,NEW.category,NEW.sector,NEW.registration_expiry)
    IS DISTINCT FROM (OLD.plate_number,OLD.make,OLD.model,OLD.category,OLD.sector,OLD.registration_expiry) THEN
    NEW.verification_status:='pending';NEW.is_active:=FALSE;NEW.operational_status:='INACTIVE';NEW.verified_by:=NULL;NEW.verified_at:=NULL;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER vehicle_operational_status BEFORE INSERT OR UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION synchronize_vehicle_operational_status();
DROP TRIGGER vehicle_approval_handoff ON vehicles;
CREATE TRIGGER vehicle_approval_handoff AFTER INSERT OR UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION enqueue_provider_approval();
UPDATE vehicles SET operational_status=CASE WHEN is_active THEN 'ACTIVE' ELSE 'INACTIVE' END;
COMMIT;
