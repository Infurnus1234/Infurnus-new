BEGIN;
ALTER TABLE rides ADD COLUMN pin_ciphertext TEXT, ADD COLUMN pin_verifier VARCHAR(64);
ALTER TABLE rides ADD CONSTRAINT ride_pin_verifier_format CHECK(pin_verifier IS NULL OR pin_verifier ~ '^[a-f0-9]{64}$');
-- Old releases could verify separately from start. Require a fresh atomic
-- verification for those pre-start rides while preserving their original code.
UPDATE rides SET pin_verified=FALSE,
 route_metadata=COALESCE(route_metadata,'{}'::jsonb)-'pinVerified'
 WHERE status IN ('requested','searching','driver_assigned','driver_arriving','driver_arrived') AND pin_verified;
CREATE FUNCTION enforce_ride_pin_start() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='in_progress' AND OLD.status<>'in_progress' AND NOT NEW.pin_verified THEN
    RAISE EXCEPTION 'PIN verification required before ride start';
  END IF;
  IF NEW.pin_verified AND NOT OLD.pin_verified AND (OLD.status<>'driver_arrived' OR NEW.status<>'in_progress') THEN
    RAISE EXCEPTION 'PIN verification must atomically start an arrived ride';
  END IF;
  IF NEW.status IN ('in_progress','completed','cancelled') THEN
    NEW.pin:=NULL; NEW.pin_ciphertext:=NULL; NEW.pin_verifier:=NULL;
    NEW.route_metadata:=COALESCE(NEW.route_metadata,'{}'::jsonb)-'pin';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rides_secure_pin_start BEFORE UPDATE ON rides FOR EACH ROW EXECUTE FUNCTION enforce_ride_pin_start();
UPDATE rides SET pin=NULL,route_metadata=COALESCE(route_metadata,'{}'::jsonb)-'pin' WHERE status IN ('in_progress','completed','cancelled');
COMMIT;
