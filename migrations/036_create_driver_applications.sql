-- Migration 036: Driver/Partner Application Workflow
-- Creates the Super Admin approval foundation for driver onboarding.

BEGIN;

-- ============================================================
-- 1. Driver application status
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'driver_application_status'
  ) THEN
    CREATE TYPE driver_application_status AS ENUM (
      'PENDING',
      'UNDER_REVIEW',
      'APPROVED',
      'REJECTED',
      'CHANGES_REQUESTED',
      'CANCELLED',
      'EXPIRED'
    );
  END IF;
END $$;


-- ============================================================
-- 2. Vehicle ownership type
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'vehicle_ownership_type'
  ) THEN
    CREATE TYPE vehicle_ownership_type AS ENUM (
      'PARTNER_OWNED',
      'DRIVER_ONLY'
    );
  END IF;
END $$;


-- ============================================================
-- 3. Driver Applications
-- ============================================================

CREATE TABLE driver_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Existing Partner/Driver identity
  partner_id UUID NOT NULL
    REFERENCES partners(id)
    ON DELETE RESTRICT,

  driver_profile_id UUID NOT NULL
    REFERENCES driver_profiles(id)
    ON DELETE RESTRICT,

  -- Requested service
  requested_sector VARCHAR(30) NOT NULL,

  -- Requested vehicle category
  requested_vehicle_category VARCHAR(50) NOT NULL,

  -- Vehicle ownership model
  vehicle_ownership_type vehicle_ownership_type NOT NULL,

  -- Application lifecycle
  status driver_application_status NOT NULL DEFAULT 'PENDING',

  -- Submission
  submitted_at TIMESTAMPTZ,

  -- Review
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID
    REFERENCES users(id)
    ON DELETE RESTRICT,

  -- Reason for rejection / requested changes
  review_reason TEXT,

  -- Final approval metadata
  approved_at TIMESTAMPTZ,
  approved_by UUID
    REFERENCES users(id)
    ON DELETE RESTRICT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ==========================================================
  -- Constraints
  -- ==========================================================

  CONSTRAINT driver_applications_sector_ck
    CHECK (
      requested_sector IN (
        'passenger',
        'logistics',
        'service',
        'premium',
        'rental'
      )
    ),

  CONSTRAINT driver_applications_review_reason_ck
    CHECK (
      status NOT IN ('REJECTED', 'CHANGES_REQUESTED')
      OR (
        review_reason IS NOT NULL
        AND length(trim(review_reason)) > 0
      )
    ),

  CONSTRAINT driver_applications_review_metadata_ck
    CHECK (
      status NOT IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED')
      OR reviewed_at IS NOT NULL
    ),

  CONSTRAINT driver_applications_approval_metadata_ck
    CHECK (
      status <> 'APPROVED'
      OR (
        approved_at IS NOT NULL
        AND approved_by IS NOT NULL
      )
    ),

  CONSTRAINT driver_applications_submission_ck
    CHECK (
      status = 'PENDING'
      OR submitted_at IS NOT NULL
    )
);


-- ============================================================
-- 4. Prevent multiple active applications
-- ============================================================

CREATE UNIQUE INDEX driver_applications_active_partner_uidx
  ON driver_applications(partner_id)
  WHERE status IN (
    'PENDING',
    'UNDER_REVIEW',
    'CHANGES_REQUESTED'
  );


-- ============================================================
-- 5. Application lookup indexes
-- ============================================================

CREATE INDEX driver_applications_driver_profile_idx
  ON driver_applications(driver_profile_id);

CREATE INDEX driver_applications_status_idx
  ON driver_applications(status);

CREATE INDEX driver_applications_sector_idx
  ON driver_applications(requested_sector);

CREATE INDEX driver_applications_category_idx
  ON driver_applications(requested_vehicle_category);

CREATE INDEX driver_applications_ownership_type_idx
  ON driver_applications(vehicle_ownership_type);

CREATE INDEX driver_applications_reviewed_by_idx
  ON driver_applications(reviewed_by);

CREATE INDEX driver_applications_approved_by_idx
  ON driver_applications(approved_by);

CREATE INDEX driver_applications_created_at_idx
  ON driver_applications(created_at DESC);


-- ============================================================
-- 6. Updated-at trigger
-- ============================================================

CREATE TRIGGER driver_applications_set_updated_at
BEFORE UPDATE ON driver_applications
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();


COMMIT;