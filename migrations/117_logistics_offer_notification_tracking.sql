ALTER TABLE logistics_dispatch_offers ADD COLUMN notification_id uuid;
ALTER TABLE logistics_dispatch_rings ADD COLUMN notification_id uuid;

CREATE INDEX logistics_dispatch_pending_notification_idx
  ON logistics_dispatch_offers (expires_at)
  WHERE status='pending' AND notification_id IS NULL;
CREATE INDEX logistics_dispatch_pending_ring_notification_idx
  ON logistics_dispatch_rings (created_at) WHERE notification_id IS NULL;
