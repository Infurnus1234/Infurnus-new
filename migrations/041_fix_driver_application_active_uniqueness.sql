-- Migration 041: Fix active driver application uniqueness
-- Allows one Partner to onboard multiple Drivers.
-- Prevents duplicate active applications for the same Partner + Driver pair.

BEGIN;

DROP INDEX IF EXISTS driver_applications_active_partner_uidx;

CREATE UNIQUE INDEX driver_applications_active_partner_driver_uidx
  ON driver_applications(partner_id, driver_profile_id)
  WHERE status IN (
    'PENDING',
    'UNDER_REVIEW',
    'CHANGES_REQUESTED'
  );

COMMIT;
