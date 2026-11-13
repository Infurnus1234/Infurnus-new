CREATE TABLE logistics_dispatch_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  admin_id uuid REFERENCES users(id) ON DELETE SET NULL,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driver_profile_id uuid NOT NULL REFERENCES driver_profiles(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'driver' CHECK (kind IN ('driver','fleet')),
  parent_offer_id uuid REFERENCES logistics_dispatch_offers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','coordinating','forwarded','accepted','rejected','expired','revoked')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  last_ring_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX logistics_dispatch_one_pending_recipient_idx
  ON logistics_dispatch_offers (ride_id, recipient_id, kind)
  WHERE status IN ('pending','coordinating','forwarded');
CREATE INDEX logistics_dispatch_pending_driver_idx
  ON logistics_dispatch_offers (driver_profile_id, expires_at) WHERE status = 'pending';
CREATE INDEX logistics_dispatch_ride_history_idx
  ON logistics_dispatch_offers (ride_id, created_at DESC);

CREATE TABLE logistics_dispatch_rings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES logistics_dispatch_offers(id) ON DELETE CASCADE,
  admin_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX logistics_dispatch_rings_offer_idx ON logistics_dispatch_rings(offer_id, created_at DESC);

ALTER TABLE rides ADD COLUMN logistics_dispatch_source text
  CHECK (logistics_dispatch_source IN ('automatic','admin','fleet'));

CREATE FUNCTION revoke_cancelled_logistics_offers() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE logistics_dispatch_offers
  SET status=CASE WHEN expires_at<=clock_timestamp() THEN 'expired' ELSE 'revoked' END,
      responded_at=clock_timestamp()
  WHERE ride_id=NEW.id AND status IN ('pending','coordinating','forwarded');
  RETURN NEW;
END;
$$;

CREATE TRIGGER rides_revoke_cancelled_logistics_offers AFTER UPDATE OF status ON rides
  FOR EACH ROW WHEN (NEW.sector='logistics' AND NEW.status='cancelled' AND OLD.status<>NEW.status)
  EXECUTE FUNCTION revoke_cancelled_logistics_offers();
