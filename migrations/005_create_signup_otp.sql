BEGIN;

-- ============================================================
-- Migration 005
-- Signup Credentials + OTP Verification
--
-- Rules:
-- 1. New accounts must provide either email OR phone.
-- 2. Password + confirm password are validated at API level.
-- 3. Password is stored only as an Argon2 hash.
-- 4. OTP is stored only as a SHA-256 hash.
-- 5. Account is not created in users until OTP verification.
-- 6. Normal users use user_credentials.
-- 7. Admin credentials remain in admin_credentials.
-- ============================================================


-- ============================================================
-- 1. Email OR phone support
--
-- The signup flow allows either:
--   email signup -> phone NULL
--   phone signup -> email NULL
--
-- Existing active-phone uniqueness index already handles NULLs.
-- ============================================================

ALTER TABLE users
    ALTER COLUMN phone DROP NOT NULL;


-- ============================================================
-- 2. Signup contact type
-- ============================================================

CREATE TYPE signup_contact_type AS ENUM (
    'email',
    'phone'
);


-- ============================================================
-- 3. Pending signups
--
-- These records represent accounts that have started signup
-- but have NOT successfully completed OTP verification.
--
-- No users row is created until OTP verification succeeds.
-- ============================================================

CREATE TABLE pending_signups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,

    contact_type signup_contact_type NOT NULL,

    contact_value VARCHAR(320) NOT NULL,

    password_hash VARCHAR(255) NOT NULL,

    role user_role NOT NULL DEFAULT 'customer',

    -- Never store the raw OTP.
    otp_hash VARCHAR(255) NOT NULL,

    otp_expires_at TIMESTAMPTZ NOT NULL,

    otp_attempts SMALLINT NOT NULL DEFAULT 0,

    otp_verified_at TIMESTAMPTZ,

    -- Used for resend-rate limiting.
    last_otp_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- ========================================================
    -- Constraints
    -- ========================================================

    CONSTRAINT pending_signups_otp_attempts_ck
        CHECK (otp_attempts >= 0),

    CONSTRAINT pending_signups_otp_expiry_ck
        CHECK (otp_expires_at > created_at),

    CONSTRAINT pending_signups_contact_value_ck
        CHECK (length(trim(contact_value)) > 0),

    CONSTRAINT pending_signups_password_hash_ck
        CHECK (length(trim(password_hash)) > 0),

    CONSTRAINT pending_signups_otp_hash_ck
        CHECK (length(trim(otp_hash)) > 0)
);


-- ============================================================
-- 4. Pending signup indexes
-- ============================================================

-- Prevent two active pending signups for the same contact.
CREATE UNIQUE INDEX pending_signups_contact_uidx
    ON pending_signups(contact_type, contact_value);

-- Useful for OTP expiry cleanup.
CREATE INDEX pending_signups_otp_expires_at_idx
    ON pending_signups(otp_expires_at);

-- Useful for cleanup of abandoned signup records.
CREATE INDEX pending_signups_created_at_idx
    ON pending_signups(created_at);


-- ============================================================
-- 5. Pending signup updated_at trigger
-- ============================================================

CREATE TRIGGER pending_signups_set_updated_at
BEFORE UPDATE ON pending_signups
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();


-- ============================================================
-- 6. User credentials
--
-- Normal application users store password credentials here.
--
-- Admin credentials intentionally remain in:
--     admin_credentials
--
-- This separation allows different security policies for admins.
-- ============================================================

CREATE TABLE user_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL UNIQUE
        REFERENCES users(id)
        ON DELETE CASCADE,

    password_hash VARCHAR(255) NOT NULL,

    last_login_at TIMESTAMPTZ,

    last_login_ip INET,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT user_credentials_password_hash_ck
        CHECK (length(trim(password_hash)) > 0)
);


-- ============================================================
-- 7. User credentials updated_at trigger
-- ============================================================

CREATE TRIGGER user_credentials_set_updated_at
BEFORE UPDATE ON user_credentials
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();


-- ============================================================
-- 8. Commit
-- ============================================================

COMMIT;