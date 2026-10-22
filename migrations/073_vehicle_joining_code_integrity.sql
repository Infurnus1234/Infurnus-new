BEGIN;
-- Abort on conflicting legacy active codes rather than choosing a code silently.
CREATE UNIQUE INDEX driver_assignment_one_active_vehicle_uidx ON driver_assignment_codes(vehicle_id) WHERE status='ACTIVE';
CREATE INDEX fleet_vehicle_reporting_idx ON rides(assigned_vehicle_id,completed_at) WHERE status='completed';
COMMIT;
