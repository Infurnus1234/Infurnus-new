CREATE TABLE logistics_pickup_fulfillment (
  ride_id uuid PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  pickup_arrived_at timestamptz,
  pickup_eta_at timestamptz,
  eta_recorded_at timestamptz,
  risk_notified_at timestamptz,
  delay_notified_at timestamptz
);

CREATE TABLE logistics_dispatch_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  admin_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX logistics_dispatch_escalations_ride_idx ON logistics_dispatch_escalations(ride_id);
