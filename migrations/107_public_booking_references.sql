-- Public references supplement, never replace, permanent ride UUIDs.
ALTER TABLE rides ADD COLUMN booking_id varchar(7);
ALTER TABLE rides ADD COLUMN booking_id_expires_at timestamptz;
CREATE TABLE booking_id_allocations (
  ride_id uuid PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  booking_id varchar(7) NOT NULL CHECK (booking_id ~ '^(11|22|33|44)[0-9]{5}$'),
  allocated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz,
  released_at timestamptz
);
CREATE UNIQUE INDEX booking_id_active_unique ON booking_id_allocations(booking_id) WHERE released_at IS NULL;
CREATE INDEX booking_id_release_due ON booking_id_allocations(expires_at) WHERE released_at IS NULL;

CREATE FUNCTION release_expired_booking_ids() RETURNS void LANGUAGE sql AS $$
  UPDATE booking_id_allocations SET released_at=clock_timestamp()
  WHERE released_at IS NULL AND expires_at<=clock_timestamp();
$$;

CREATE FUNCTION booking_id_random_suffix() RETURNS text LANGUAGE plpgsql AS $$
DECLARE bytes bytea; sample integer;
BEGIN
  LOOP
    bytes:=gen_random_bytes(3);
    sample:=get_byte(bytes,0)*65536+get_byte(bytes,1)*256+get_byte(bytes,2);
    IF sample<16700000 THEN RETURN lpad((sample%100000)::text,5,'0'); END IF;
  END LOOP;
END;
$$;
CREATE FUNCTION assign_public_booking_id() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prefix text; candidate text; allocated uuid; attempt integer;
BEGIN
  IF TG_OP='UPDATE' AND OLD.booking_id IS NOT NULL THEN
    NEW.booking_id := OLD.booking_id;
    NEW.booking_id_expires_at := OLD.booking_id_expires_at;
  ELSE
    prefix := CASE NEW.sector WHEN 'rental' THEN '11' WHEN 'service' THEN '22'
      WHEN 'premium' THEN '33' WHEN 'logistics' THEN '44' END;
    NEW.booking_id := NULL;
    NEW.booking_id_expires_at := NULL;
    IF prefix IS NOT NULL THEN
      PERFORM release_expired_booking_ids();
      FOR attempt IN 1..512 LOOP
        -- pgcrypto CSPRNG, rejection sampling avoids modulo bias.
        candidate := prefix || booking_id_random_suffix();
        allocated := NULL;
        INSERT INTO booking_id_allocations(ride_id,booking_id) VALUES(NEW.id,candidate)
          ON CONFLICT DO NOTHING RETURNING ride_id INTO allocated;
        IF allocated IS NOT NULL THEN NEW.booking_id:=candidate; EXIT; END IF;
      END LOOP;
      IF NEW.booking_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='P2001',MESSAGE='Booking ID allocation temporarily unavailable';
      END IF;
    END IF;
  END IF;
  IF NEW.booking_id IS NOT NULL AND NEW.booking_id_expires_at IS NULL
    AND NEW.status IN ('completed','cancelled') THEN
    NEW.booking_id_expires_at := COALESCE(NEW.completed_at,NEW.cancelled_at,clock_timestamp())+interval '7 days';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION sync_public_booking_expiry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE booking_id_allocations SET expires_at=NEW.booking_id_expires_at
    WHERE ride_id=NEW.id AND expires_at IS DISTINCT FROM NEW.booking_id_expires_at;
  RETURN NULL;
END;
$$;
CREATE TRIGGER ride_public_booking_id BEFORE INSERT OR UPDATE ON rides
  FOR EACH ROW EXECUTE FUNCTION assign_public_booking_id();
CREATE TRIGGER ride_public_booking_expiry AFTER INSERT OR UPDATE ON rides
  FOR EACH ROW EXECUTE FUNCTION sync_public_booking_expiry();
-- Existing active/scheduled bookings receive references; old terminal history is untouched.
UPDATE rides SET booking_id=booking_id WHERE status NOT IN ('completed','cancelled');
