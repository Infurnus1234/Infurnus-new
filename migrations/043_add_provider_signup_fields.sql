BEGIN;

-- ============================================================
-- Migration 043: Provider Signup Fields
-- ============================================================

ALTER TABLE pending_signups
    ADD COLUMN IF NOT EXISTS license_number VARCHAR(50),
    ADD COLUMN IF NOT EXISTS license_expiry DATE,
    ADD COLUMN IF NOT EXISTS business_name VARCHAR(150);


-- ============================================================
-- Driver / Driver + Fleet Owner registration requirements
-- ============================================================

ALTER TABLE pending_signups
    ADD CONSTRAINT pending_signups_driver_fields_ck
    CHECK (
        role NOT IN ('driver', 'driver_fleet_owner')
        OR (
            license_number IS NOT NULL
            AND length(trim(license_number)) > 0
            AND license_expiry IS NOT NULL
        )
    ) NOT VALID;


-- ============================================================
-- Fleet Owner / Driver + Fleet Owner registration requirements
-- ============================================================

ALTER TABLE pending_signups
    ADD CONSTRAINT pending_signups_fleet_owner_fields_ck
    CHECK (
        role NOT IN ('fleet_owner', 'driver_fleet_owner')
        OR (
            business_name IS NOT NULL
            AND length(trim(business_name)) > 0
        )
    ) NOT VALID;


COMMIT;