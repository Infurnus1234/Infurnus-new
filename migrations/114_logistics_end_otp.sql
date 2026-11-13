-- Add end-OTP columns for logistics delivery confirmation.
-- Only logistics rides use these; all other sectors leave them NULL.
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS end_pin_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS end_pin_verifier VARCHAR(64);

ALTER TABLE rides
  DROP CONSTRAINT IF EXISTS ride_end_pin_verifier_format;
ALTER TABLE rides
  ADD CONSTRAINT ride_end_pin_verifier_format
    CHECK (end_pin_verifier IS NULL OR end_pin_verifier ~ '^[a-f0-9]{64}$');

-- Clear end OTP when ride is completed or cancelled (same as start PIN).
CREATE OR REPLACE FUNCTION enforce_ride_end_pin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('completed', 'cancelled') THEN
    NEW.end_pin_ciphertext := NULL;
    NEW.end_pin_verifier   := NULL;
    NEW.route_metadata     := COALESCE(NEW.route_metadata, '{}'::jsonb) - 'endPin';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS rides_clear_end_pin ON rides;
CREATE TRIGGER rides_clear_end_pin
  BEFORE UPDATE ON rides
  FOR EACH ROW EXECUTE FUNCTION enforce_ride_end_pin();
