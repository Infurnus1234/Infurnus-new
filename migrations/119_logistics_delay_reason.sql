ALTER TABLE logistics_pickup_fulfillment ADD COLUMN delay_reason text
  CHECK (delay_reason IN ('unassigned','eta_exceeds_deadline','pickup_not_verified'));
