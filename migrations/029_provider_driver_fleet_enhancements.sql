-- Migration 029: Provider, Driver, and Fleet Owner enhancements
-- Adds fleet owner and driver_fleet_owner support, vehicle ownership decoupling,
-- driver assignment codes, provider bank accounts, and support tickets.

-- 1. Expand user_role enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'fleet_owner';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'driver_fleet_owner';

-- 2. Expand partners with provider type and fleet details
ALTER TABLE partners ADD COLUMN IF NOT EXISTS provider_type VARCHAR(30) NOT NULL DEFAULT 'DRIVER';
ALTER TABLE partners ADD COLUMN IF NOT EXISTS owner_name VARCHAR(100);
ALTER TABLE partners ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE partners ADD COLUMN IF NOT EXISTS state VARCHAR(100);
ALTER TABLE partners ADD COLUMN IF NOT EXISTS pin_code VARCHAR(20);
ALTER TABLE partners ADD COLUMN IF NOT EXISTS number_of_vehicles INT NOT NULL DEFAULT 1;

-- 3. Expand driver_profiles with personal details, emergency contact, and active vehicle pointer
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS dob DATE;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS gender VARCHAR(20);
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS state VARCHAR(100);
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS pin_code VARCHAR(20);
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(100);
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(20);

-- 4. Refactor vehicles: decouple mandatory driver_profile_id and add owner_id
ALTER TABLE vehicles ALTER COLUMN driver_profile_id DROP NOT NULL;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS manufacturing_year INT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fuel_type VARCHAR(30);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS seating_capacity INT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS registration_date DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS registration_expiry DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_commercial BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS permit_details TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS verification_status VARCHAR(30) NOT NULL DEFAULT 'approved';

-- Backfill owner_id from driver_profiles for existing rows
UPDATE vehicles v
SET owner_id = dp.user_id
FROM driver_profiles dp
WHERE v.driver_profile_id = dp.id AND v.owner_id IS NULL;

-- Update unique index so multiple unassigned vehicles can exist
DROP INDEX IF EXISTS vehicles_one_active_per_driver_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_one_active_per_driver_uidx
  ON vehicles(driver_profile_id)
  WHERE is_active = TRUE AND driver_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vehicles_owner_id_idx
  ON vehicles(owner_id);

-- 5. Active vehicle pointer on driver_profiles (references vehicles)
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS active_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL;

-- 6. Driver Assignment Codes for Fleet Owner -> Driver Mapping
CREATE TABLE IF NOT EXISTS driver_assignment_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  fleet_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  driver_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLAIMED', 'REVOKED', 'EXPIRED')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignment_codes_code
  ON driver_assignment_codes(code) WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_assignment_codes_owner
  ON driver_assignment_codes(fleet_owner_id);

CREATE INDEX IF NOT EXISTS idx_assignment_codes_vehicle
  ON driver_assignment_codes(vehicle_id);

-- 7. Provider Bank / Payment Payout Details
CREATE TABLE IF NOT EXISTS provider_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_holder_name VARCHAR(150) NOT NULL,
  account_number_encrypted VARCHAR(255) NOT NULL,
  account_number_last4 VARCHAR(4) NOT NULL,
  ifsc_code VARCHAR(20) NOT NULL,
  bank_name VARCHAR(100) NOT NULL,
  upi_id VARCHAR(100),
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT provider_bank_accounts_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_bank_user
  ON provider_bank_accounts(user_id);

-- 8. Support Tickets
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number VARCHAR(30) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL,
  category VARCHAR(50) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user
  ON support_tickets(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status
  ON support_tickets(status);
