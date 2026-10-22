BEGIN;
-- Account enrollment can defer licence capture to its single authenticated page.
-- This does not create a driver profile or change operational eligibility.
ALTER TABLE pending_signups ADD COLUMN licence_onboarding_pending BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pending_signups DROP CONSTRAINT pending_signups_driver_fields_ck;
ALTER TABLE pending_signups ADD CONSTRAINT pending_signups_driver_fields_ck CHECK (
 (licence_onboarding_pending AND role IN ('driver','driver_fleet_owner') AND license_number IS NULL AND license_expiry IS NULL)
 OR (NOT licence_onboarding_pending AND (
  role NOT IN ('driver','driver_fleet_owner') OR
  (license_number IS NOT NULL AND length(trim(license_number)) > 0 AND license_expiry IS NOT NULL)
 ))
) NOT VALID;
COMMIT;
