BEGIN;

-- ============================================================
-- Migration 014
-- OTP Provider Session State
--
-- Purpose:
--   Prepare pending signup records for provider-managed OTP
--   sessions such as Sendmator.
--
-- Important:
--   The provider is the source of truth for OTP generation
--   and verification.
--
--   This migration does NOT remove the legacy otp_hash column.
--   Legacy OTP fields remain temporarily so the application
--   can be migrated safely without breaking existing records.
-- ============================================================


-- ============================================================
-- 1. OTP provider
-- ============================================================

ALTER TABLE pending_signups
    ADD COLUMN IF NOT EXISTS otp_provider VARCHAR(50);


-- ============================================================
-- 2. Provider session identifier
--
-- This is an identifier/reference and is not itself the
-- credential required to verify the OTP.
-- ============================================================

ALTER TABLE pending_signups
    ADD COLUMN IF NOT EXISTS otp_provider_session_id VARCHAR(255);


-- ============================================================
-- 3. Provider session expiry
--
-- This mirrors the provider's session expiry so the backend
-- can reject obviously expired challenges before making an
-- unnecessary provider request.
--
-- The provider remains authoritative for actual verification.
-- ============================================================

ALTER TABLE pending_signups
    ADD COLUMN IF NOT EXISTS otp_provider_expires_at TIMESTAMPTZ;


-- ============================================================
-- 4. Provider metadata consistency
--
-- If a provider is recorded, a provider session identifier
-- must also exist.
--
-- If no provider is recorded, provider session state must
-- remain NULL.
-- ============================================================

ALTER TABLE pending_signups
    ADD CONSTRAINT pending_signups_otp_provider_state_ck
    CHECK (
        (
            otp_provider IS NULL
            AND otp_provider_session_id IS NULL
            AND otp_provider_expires_at IS NULL
        )
        OR
        (
            otp_provider IS NOT NULL
            AND length(trim(otp_provider)) > 0
            AND otp_provider_session_id IS NOT NULL
            AND length(trim(otp_provider_session_id)) > 0
            AND otp_provider_expires_at IS NOT NULL
        )
    );


-- ============================================================
-- 5. Provider/session lookup index
--
-- Useful when resolving an OTP challenge through the provider
-- session identifier.
-- ============================================================

CREATE INDEX IF NOT EXISTS pending_signups_otp_provider_session_idx
    ON pending_signups(otp_provider, otp_provider_session_id)
    WHERE otp_provider_session_id IS NOT NULL;


-- ============================================================
-- 6. Provider expiry index
--
-- Useful for cleanup of abandoned/expired provider sessions.
-- ============================================================

CREATE INDEX IF NOT EXISTS pending_signups_otp_provider_expires_at_idx
    ON pending_signups(otp_provider_expires_at)
    WHERE otp_provider_expires_at IS NOT NULL;


COMMIT;