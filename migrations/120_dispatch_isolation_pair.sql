-- Keep the paired accounts isolated at the write boundary, regardless of worker revision.
CREATE TABLE dispatch_isolation_pair (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  customer_id uuid NOT NULL REFERENCES users(id),
  driver_profile_id uuid NOT NULL REFERENCES driver_profiles(id),
  expires_at timestamptz NOT NULL
);

CREATE FUNCTION enforce_dispatch_isolation_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pair dispatch_isolation_pair%ROWTYPE;
  customer uuid;
  candidates uuid[];
  ride_sector text;
  ride_category text;
BEGIN
  SELECT * INTO pair FROM dispatch_isolation_pair;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'rides' THEN
    customer := NEW.customer_id;
    ride_sector := NEW.sector;
    ride_category := NEW.vehicle_category;
    IF TG_OP = 'INSERT' THEN
      candidates := ARRAY[NEW.dispatch_driver_id, NEW.assigned_driver_id];
    ELSIF NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.sector IS DISTINCT FROM OLD.sector
       OR NEW.vehicle_category IS DISTINCT FROM OLD.vehicle_category THEN
      candidates := ARRAY[NEW.dispatch_driver_id, NEW.assigned_driver_id];
    ELSE
      candidates := ARRAY[
        CASE WHEN NEW.dispatch_driver_id IS DISTINCT FROM OLD.dispatch_driver_id THEN NEW.dispatch_driver_id END,
        CASE WHEN NEW.assigned_driver_id IS DISTINCT FROM OLD.assigned_driver_id THEN NEW.assigned_driver_id END
      ];
    END IF;
  ELSE
    SELECT customer_id, sector, vehicle_category INTO customer, ride_sector, ride_category
      FROM rides WHERE id = NEW.ride_id;
    candidates := ARRAY[NEW.driver_profile_id];
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(candidates) AS candidate(id)
    WHERE candidate.id IS NOT NULL
      AND (customer = pair.customer_id OR candidate.id = pair.driver_profile_id)
      AND NOT (
        customer = pair.customer_id AND candidate.id = pair.driver_profile_id
        AND ride_sector = 'logistics' AND ride_category = 'tata_407'
        AND clock_timestamp() < pair.expires_at
      )
  ) THEN
    RAISE EXCEPTION 'Dispatch violates the active test pairing' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rides_dispatch_isolation_pair
BEFORE INSERT OR UPDATE OF customer_id, sector, vehicle_category, dispatch_driver_id, assigned_driver_id ON rides
FOR EACH ROW EXECUTE FUNCTION enforce_dispatch_isolation_pair();

CREATE TRIGGER automatic_dispatch_isolation_pair
BEFORE INSERT OR UPDATE OF ride_id, driver_profile_id ON ride_dispatch_attempts
FOR EACH ROW EXECUTE FUNCTION enforce_dispatch_isolation_pair();

CREATE TRIGGER targeted_dispatch_isolation_pair
BEFORE INSERT OR UPDATE OF ride_id, driver_profile_id ON logistics_dispatch_offers
FOR EACH ROW EXECUTE FUNCTION enforce_dispatch_isolation_pair();
