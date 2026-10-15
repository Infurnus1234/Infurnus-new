BEGIN;
-- Existing offer creation already refuses any prior ride/driver pair. Abort rather
-- than deleting historical attempts if a deployment has conflicting legacy data.
CREATE UNIQUE INDEX ride_dispatch_attempts_ride_driver_uidx
  ON ride_dispatch_attempts(ride_id,driver_profile_id);
CREATE INDEX ride_dispatch_pending_deadline_idx
  ON rides(dispatch_expires_at,id) WHERE status='searching' AND assigned_driver_id IS NULL;
ALTER TABLE ride_dispatch_attempts ADD COLUMN city_id TEXT, ADD COLUMN boundary_geojson JSONB;
ALTER TABLE ride_dispatch_attempts DROP CONSTRAINT ride_dispatch_attempts_status_check;
ALTER TABLE ride_dispatch_attempts ADD CONSTRAINT ride_dispatch_attempts_status_check CHECK(status IN ('offered','rejected','timed_out','accepted','cancelled'));
CREATE FUNCTION cancel_terminal_dispatch_attempts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status<>'searching' THEN
  UPDATE ride_dispatch_attempts SET status='cancelled',responded_at=NOW()
  WHERE ride_id=NEW.id AND status='offered'
    AND NOT(NEW.status='driver_assigned' AND driver_profile_id=NEW.assigned_driver_id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rides_cancel_terminal_dispatch_attempts AFTER UPDATE OF status ON rides
 FOR EACH ROW EXECUTE FUNCTION cancel_terminal_dispatch_attempts();
COMMIT;
