BEGIN;

ALTER TABLE driver_profiles ADD COLUMN emergency_contact_relationship VARCHAR(100),
  ADD COLUMN alternate_contact_phone VARCHAR(20),
  ADD COLUMN location_speed DOUBLE PRECISION CHECK(location_speed >= 0 AND location_speed < 'Infinity'::float8),
  ADD COLUMN location_heading DOUBLE PRECISION CHECK(location_heading >= 0 AND location_heading <= 360),
  ADD COLUMN location_accuracy DOUBLE PRECISION CHECK(location_accuracy >= 0 AND location_accuracy < 'Infinity'::float8);
ALTER TABLE driver_documents ADD COLUMN upload_source VARCHAR(10) NOT NULL DEFAULT 'FILE' CHECK(upload_source IN ('CAMERA','GALLERY','FILE')),
  ADD COLUMN document_metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(document_metadata)='object'),
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>0);

CREATE FUNCTION invalidate_changed_driver_licence() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.license_number,NEW.license_expiry) IS DISTINCT FROM (OLD.license_number,OLD.license_expiry) THEN
    NEW.verification_status := 'pending'; NEW.verified_by := NULL; NEW.verified_at := NULL;
    NEW.availability_status := 'unavailable';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER driver_licence_reverification BEFORE UPDATE ON driver_profiles FOR EACH ROW EXECUTE FUNCTION invalidate_changed_driver_licence();

CREATE TABLE driver_document_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES driver_documents(id) ON DELETE CASCADE,
  driver_profile_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version>0),
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_id,version)
);
CREATE INDEX driver_document_history_driver_time_idx ON driver_document_history(driver_profile_id,created_at DESC);
CREATE FUNCTION retain_driver_document_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.storage_key IS DISTINCT FROM OLD.storage_key THEN
    INSERT INTO driver_document_history(document_id,driver_profile_id,version,snapshot)
    VALUES(OLD.id,OLD.driver_profile_id,OLD.version,to_jsonb(OLD));
    NEW.version := OLD.version+1;
    NEW.verification_status := 'pending'; NEW.verified_at := NULL; NEW.verified_by := NULL; NEW.rejection_reason := NULL;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER driver_document_version BEFORE UPDATE ON driver_documents FOR EACH ROW EXECUTE FUNCTION retain_driver_document_version();

CREATE TABLE provider_location_history (
  id BIGSERIAL PRIMARY KEY,
  driver_profile_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  fleet_id UUID REFERENCES partners(id) ON DELETE SET NULL,
  location geography(Point,4326) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  UNIQUE(driver_profile_id,recorded_at)
);
CREATE INDEX provider_location_history_driver_time_idx ON provider_location_history(driver_profile_id,recorded_at DESC);
CREATE INDEX provider_location_history_fleet_time_idx ON provider_location_history(fleet_id,recorded_at DESC);
CREATE INDEX provider_location_history_location_gist ON provider_location_history USING GIST(location);
CREATE FUNCTION retain_provider_location() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE vehicle_uuid UUID; fleet_uuid UUID;
BEGIN
  IF NEW.last_location IS NOT NULL AND NEW.last_location_at IS NOT NULL AND NEW.last_location_at IS DISTINCT FROM OLD.last_location_at THEN
    SELECT v.id,p.id INTO vehicle_uuid,fleet_uuid FROM vehicles v LEFT JOIN partners p ON p.user_id=v.owner_id
    WHERE v.driver_profile_id=NEW.id AND v.is_active=TRUE LIMIT 1;
    INSERT INTO provider_location_history(driver_profile_id,vehicle_id,fleet_id,location,recorded_at,speed,heading,accuracy)
    VALUES(NEW.id,vehicle_uuid,fleet_uuid,NEW.last_location,NEW.last_location_at,NEW.location_speed,NEW.location_heading,NEW.location_accuracy)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER provider_location_history AFTER UPDATE OF last_location_at ON driver_profiles FOR EACH ROW EXECUTE FUNCTION retain_provider_location();

CREATE TABLE provider_vehicle_association_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  previous_driver_profile_id UUID REFERENCES driver_profiles(id) ON DELETE SET NULL,
  driver_profile_id UUID REFERENCES driver_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX provider_vehicle_association_history_vehicle_time_idx ON provider_vehicle_association_history(vehicle_id,created_at DESC);
CREATE FUNCTION retain_provider_vehicle_association() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.driver_profile_id IS DISTINCT FROM OLD.driver_profile_id THEN
    INSERT INTO provider_vehicle_association_history(vehicle_id,owner_id,previous_driver_profile_id,driver_profile_id)
    VALUES(NEW.id,NEW.owner_id,OLD.driver_profile_id,NEW.driver_profile_id);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER provider_vehicle_association_history AFTER UPDATE OF driver_profile_id ON vehicles FOR EACH ROW EXECUTE FUNCTION retain_provider_vehicle_association();

COMMIT;
