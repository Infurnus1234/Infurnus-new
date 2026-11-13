ALTER TABLE rides
  ADD COLUMN logistics_escalated_at timestamptz,
  ADD COLUMN logistics_escalation_reason text,
  ADD COLUMN logistics_retry_at timestamptz;

CREATE INDEX rides_logistics_unescalated_idx ON rides (created_at)
  WHERE sector = 'logistics' AND status = 'searching'
    AND assigned_driver_id IS NULL AND logistics_escalated_at IS NULL;
