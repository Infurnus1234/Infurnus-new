-- Durable first-vehicle intent. This is not an operational assignment: all existing
-- approval/compliance checks still apply when the intent is fulfilled.
CREATE TABLE owner_first_vehicle_assignments (
  owner_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id UUID UNIQUE REFERENCES vehicles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Preserve the earliest persisted vehicle for existing fleets, including ineligible ones.
INSERT INTO owner_first_vehicle_assignments(owner_id,vehicle_id)
SELECT DISTINCT ON (owner_id) owner_id,id FROM vehicles WHERE owner_id IS NOT NULL
ORDER BY owner_id,created_at,id;
