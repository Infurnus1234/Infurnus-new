BEGIN;
CREATE FUNCTION authorize_driver_application_review() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE driver_owner UUID;fleet_owner UUID;
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('APPROVED','REJECTED','CHANGES_REQUESTED') THEN
  IF OLD.status NOT IN ('PENDING','UNDER_REVIEW','CHANGES_REQUESTED') THEN RAISE EXCEPTION 'Application is no longer reviewable' USING ERRCODE='23514'; END IF;
  SELECT user_id INTO driver_owner FROM driver_profiles WHERE id=NEW.driver_profile_id;
  SELECT user_id INTO fleet_owner FROM partners WHERE id=NEW.partner_id;
  IF NEW.reviewed_by IN (driver_owner,fleet_owner) THEN RAISE EXCEPTION 'Requester cannot review own application' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.reviewed_by AND role IN ('admin','super_admin') AND status='active' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Application reviewer is not authorized' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;
END; $$;
CREATE TRIGGER provider_application_review_authorization BEFORE UPDATE OF status ON driver_applications FOR EACH ROW EXECUTE FUNCTION authorize_driver_application_review();

CREATE FUNCTION synchronize_driver_application_review() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('APPROVED','REJECTED') THEN
  PERFORM set_config('infurnus.actor_id',NEW.reviewed_by::text,TRUE);
  IF NEW.status='APPROVED' THEN
   IF NOT EXISTS(SELECT 1 FROM driver_profiles d JOIN users u ON u.id=d.user_id WHERE d.id=NEW.driver_profile_id AND d.license_expiry>=CURRENT_DATE AND u.status='active' AND u.deleted_at IS NULL AND u.role IN ('driver','driver_fleet_owner')) THEN RAISE EXCEPTION 'Driver is not eligible' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT 1 FROM partners WHERE id=NEW.partner_id AND approval_status='approved') THEN RAISE EXCEPTION 'Fleet approval required' USING ERRCODE='23514'; END IF;
  END IF;
  UPDATE driver_profiles SET verification_status=CASE WHEN NEW.status='APPROVED' THEN 'approved'::driver_verification_status ELSE 'rejected'::driver_verification_status END,verified_by=NEW.reviewed_by,verified_at=NOW(),rejection_reason=NEW.review_reason,updated_at=NOW() WHERE id=NEW.driver_profile_id;
  IF NEW.status='APPROVED' THEN INSERT INTO partner_drivers(partner_id,driver_profile_id) VALUES(NEW.partner_id,NEW.driver_profile_id) ON CONFLICT(partner_id,driver_profile_id) DO UPDATE SET status='ACTIVE',updated_at=NOW(); END IF;
 END IF;RETURN NEW;
END; $$;
CREATE TRIGGER provider_application_review_sync AFTER UPDATE OF status ON driver_applications FOR EACH ROW EXECUTE FUNCTION synchronize_driver_application_review();
COMMIT;
