-- Migration 040: Harden Vehicle Governance
-- Enforces vehicle verification and activation integrity
-- while preserving existing valid vehicle records.

BEGIN;

-- ============================================================
-- 1. Harden vehicle sector values
-- ============================================================
-- Migration 026 originally allowed:
-- passenger, logistics, service, premium.
-- Rental is part of the current INFURNUS service model.

ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS vehicles_sector_ck;

ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_sector_ck
  CHECK (
    sector IN (
      'passenger',
      'logistics',
      'service',
      'premium',
      'rental'
    )
  );


-- ============================================================
-- 2. Harden vehicle verification status
-- ============================================================
-- Keep verification_status as VARCHAR(30) rather than introducing
-- another enum, because migration 029 already established it as
-- VARCHAR(30).

ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS vehicles_verification_status_ck;

ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_verification_status_ck
  CHECK (
    verification_status IN (
      'pending',
      'under_review',
      'approved',
      'rejected',
      'changes_requested'
    )
  );


-- ============================================================
-- 3. New vehicles must start unverified
-- ============================================================
-- Existing rows are preserved.
-- Only future INSERT operations receive these defaults.

ALTER TABLE vehicles
  ALTER COLUMN verification_status SET DEFAULT 'pending';


-- ============================================================
-- 4. New vehicles must start inactive
-- ============================================================
-- A vehicle must not become operational merely because it was
-- created in the database.

ALTER TABLE vehicles
  ALTER COLUMN is_active SET DEFAULT FALSE;


-- ============================================================
-- 5. Verification / activation integrity
-- ============================================================
-- An active vehicle must have an approved verification status.

ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS vehicles_active_verification_ck;

ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_active_verification_ck
  CHECK (
    is_active = FALSE
    OR verification_status = 'approved'
  );


-- ============================================================
-- 6. Registration date integrity
-- ============================================================
-- If both dates exist, registration expiry cannot precede
-- registration date.

ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS vehicles_registration_period_ck;

ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_registration_period_ck
  CHECK (
    registration_date IS NULL
    OR registration_expiry IS NULL
    OR registration_expiry >= registration_date
  );


-- ============================================================
-- 7. Manufacturing year integrity
-- ============================================================
-- If both manufacturing year and registration date exist,
-- manufacturing cannot happen after registration.

ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS vehicles_manufacturing_registration_ck;

ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_manufacturing_registration_ck
  CHECK (
    manufacturing_year IS NULL
    OR registration_date IS NULL
    OR manufacturing_year <= EXTRACT(YEAR FROM registration_date)::INT
  );


-- ============================================================
-- 8. Seating capacity integrity
-- ============================================================
-- NULL means the information has not been provided yet.

ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS vehicles_seating_capacity_ck;

ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_seating_capacity_ck
  CHECK (
    seating_capacity IS NULL
    OR seating_capacity > 0
  );


-- ============================================================
-- 9. Manufacturing year range integrity
-- ============================================================
-- Prevent obviously invalid future/ancient manufacturing years.
-- NULL remains allowed for incomplete legacy records.

ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS vehicles_manufacturing_year_ck;

ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_manufacturing_year_ck
  CHECK (
    manufacturing_year IS NULL
    OR manufacturing_year BETWEEN 1900 AND 2100
  );


-- ============================================================
-- 10. Registration expiry consistency
-- ============================================================
-- Commercial/operational vehicles must not have an expiry date
-- earlier than their registration date when both are available.
--
-- This is intentionally represented by the registration-period
-- constraint above; no duplicate constraint is required.


-- ============================================================
-- 11. Documentation
-- ============================================================

COMMENT ON COLUMN vehicles.verification_status IS
  'Vehicle verification lifecycle: pending, under_review, approved, rejected, or changes_requested.';

COMMENT ON COLUMN vehicles.is_active IS
  'Operational activation state. Active vehicles must have approved verification status.';

COMMENT ON CONSTRAINT vehicles_active_verification_ck ON vehicles IS
  'Prevents an unverified vehicle from becoming operational.';

COMMENT ON CONSTRAINT vehicles_registration_period_ck ON vehicles IS
  'Ensures vehicle registration expiry is not before registration date.';

COMMENT ON CONSTRAINT vehicles_manufacturing_registration_ck ON vehicles IS
  'Ensures manufacturing year is not later than the vehicle registration year.';


COMMIT;