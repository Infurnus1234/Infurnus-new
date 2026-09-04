BEGIN;

-- ============================================================
-- Extensions
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- Shared updated_at trigger function
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- Enums
-- ============================================================

CREATE TYPE user_role AS ENUM (
    'customer',
    'driver',
    'admin',
    'super_admin'
);

CREATE TYPE user_status AS ENUM (
    'active',
    'suspended',
    'banned'
);

CREATE TYPE driver_verification_status AS ENUM (
    'pending',
    'under_review',
    'approved',
    'rejected'
);


-- ============================================================
-- Users
-- Shared identity/profile table for all user roles
-- ============================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,

    email VARCHAR(320),
    phone VARCHAR(20) NOT NULL,

    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    phone_verified BOOLEAN NOT NULL DEFAULT FALSE,

    role user_role NOT NULL DEFAULT 'customer',
    status user_status NOT NULL DEFAULT 'active',

    deleted_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- Users indexes
-- ============================================================

-- Active users must have unique phone numbers.
CREATE UNIQUE INDEX users_phone_active_uidx
    ON users(phone)
    WHERE deleted_at IS NULL;

-- Active users must have unique email addresses when email exists.
CREATE UNIQUE INDEX users_email_active_uidx
    ON users(email)
    WHERE deleted_at IS NULL
      AND email IS NOT NULL;

-- Useful for role-based queries over active users.
CREATE INDEX users_role_idx
    ON users(role)
    WHERE deleted_at IS NULL;

-- Useful for active/suspended/banned user lookups.
CREATE INDEX users_status_idx
    ON users(status)
    WHERE deleted_at IS NULL;


-- ============================================================
-- Users updated_at trigger
-- ============================================================

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();


-- ============================================================
-- Driver profiles
-- Driver-specific information belongs outside users.
-- ============================================================

CREATE TABLE driver_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL UNIQUE
        REFERENCES users(id)
        ON DELETE RESTRICT,

    license_number VARCHAR(50) NOT NULL,
    license_expiry DATE NOT NULL,

    license_document_key VARCHAR(500),
    vehicle_rc_document_key VARCHAR(500),
    profile_photo_key VARCHAR(500),

    verification_status driver_verification_status
        NOT NULL DEFAULT 'pending',

    verified_by UUID
        REFERENCES users(id),

    verified_at TIMESTAMPTZ,

    rejection_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- Driver profile indexes
-- ============================================================

CREATE UNIQUE INDEX driver_license_number_uidx
    ON driver_profiles(license_number);

CREATE INDEX driver_verification_status_idx
    ON driver_profiles(verification_status);


-- ============================================================
-- Driver profiles updated_at trigger
-- ============================================================

CREATE TRIGGER driver_profiles_set_updated_at
BEFORE UPDATE ON driver_profiles
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();


-- ============================================================
-- Vehicles
-- Vehicle-specific information belongs outside driver_profiles.
-- ============================================================

CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    driver_profile_id UUID NOT NULL
        REFERENCES driver_profiles(id)
        ON DELETE RESTRICT,

    make VARCHAR(50) NOT NULL,
    model VARCHAR(50) NOT NULL,
    color VARCHAR(30),

    plate_number VARCHAR(20) NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT vehicles_active_retirement_ck
        CHECK (
            retired_at IS NULL
            OR is_active = FALSE
        )
);


-- ============================================================
-- Vehicle indexes
-- ============================================================

-- A plate number cannot belong to multiple active vehicles.
CREATE UNIQUE INDEX vehicles_plate_number_active_uidx
    ON vehicles(plate_number)
    WHERE is_active = TRUE;

-- A driver can have at most one active vehicle.
CREATE UNIQUE INDEX vehicles_one_active_per_driver_uidx
    ON vehicles(driver_profile_id)
    WHERE is_active = TRUE;

CREATE INDEX vehicles_driver_profile_id_idx
    ON vehicles(driver_profile_id);


-- ============================================================
-- Vehicles updated_at trigger
-- ============================================================

CREATE TRIGGER vehicles_set_updated_at
BEFORE UPDATE ON vehicles
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();


-- ============================================================
-- Admin credentials
-- Password + MFA state is intentionally separate from users.
-- ============================================================

CREATE TABLE admin_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL UNIQUE
        REFERENCES users(id)
        ON DELETE CASCADE,

    password_hash VARCHAR(255) NOT NULL,

    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret TEXT,
    mfa_recovery_codes_hash TEXT[],

    last_login_at TIMESTAMPTZ,
    last_login_ip INET,

    failed_login_attempts SMALLINT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT admin_failed_login_attempts_ck
        CHECK (failed_login_attempts >= 0)
);


-- ============================================================
-- Admin credentials updated_at trigger
-- ============================================================

CREATE TRIGGER admin_credentials_set_updated_at
BEFORE UPDATE ON admin_credentials
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();


-- ============================================================
-- Refresh tokens
-- Token values are never stored in plaintext.
-- Only the hash is persisted.
-- ============================================================

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE RESTRICT,

    token_hash VARCHAR(255) NOT NULL,

    family_id UUID NOT NULL,

    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,

    revoked_at TIMESTAMPTZ,

    replaced_by UUID
        REFERENCES refresh_tokens(id),

    user_agent TEXT,
    ip_address INET,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT refresh_tokens_expiry_ck
        CHECK (expires_at > issued_at)
);


-- ============================================================
-- Refresh token indexes
-- ============================================================

CREATE UNIQUE INDEX refresh_tokens_token_hash_uidx
    ON refresh_tokens(token_hash);

-- Active-token lookup by user.
CREATE INDEX refresh_tokens_user_id_idx
    ON refresh_tokens(user_id)
    WHERE revoked_at IS NULL;

-- Token-family lookup for rotation/reuse detection.
CREATE INDEX refresh_tokens_family_id_idx
    ON refresh_tokens(family_id);

-- Useful for cleanup/expiry processing.
CREATE INDEX refresh_tokens_expires_at_idx
    ON refresh_tokens(expires_at);


COMMIT;