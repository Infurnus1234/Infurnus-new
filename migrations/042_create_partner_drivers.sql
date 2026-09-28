-- Migration 042: Partner -> Driver Relationship
-- Stores the permanent operational relationship between a Partner
-- and an approved Driver.
--
-- Driver applications remain the onboarding/review history.
-- This table represents the actual Partner -> Driver relationship.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'partner_driver_status'
  ) THEN
    CREATE TYPE partner_driver_status AS ENUM (
      'ACTIVE',
      'INACTIVE'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS partner_drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  partner_id UUID NOT NULL
    REFERENCES partners(id)
    ON DELETE RESTRICT,

  driver_profile_id UUID NOT NULL
    REFERENCES driver_profiles(id)
    ON DELETE RESTRICT,

  status partner_driver_status
    NOT NULL DEFAULT 'ACTIVE',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT partner_drivers_unique_pair
    UNIQUE (partner_id, driver_profile_id)
);

CREATE INDEX IF NOT EXISTS partner_drivers_partner_id_idx
  ON partner_drivers(partner_id);

CREATE INDEX IF NOT EXISTS partner_drivers_driver_profile_id_idx
  ON partner_drivers(driver_profile_id);

CREATE INDEX IF NOT EXISTS partner_drivers_status_idx
  ON partner_drivers(status);

CREATE TRIGGER partner_drivers_set_updated_at
BEFORE UPDATE ON partner_drivers
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

COMMIT;
