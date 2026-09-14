BEGIN;

-- ============================================================
-- Migration 016
-- Persist OTP Provider Session Token
--
-- Sendmator exposes both:
--   session_id    -> identifier
--   session_token -> credential required for verify/resend
--
-- Migration 014 intentionally stored only the identifier.
-- This migration adds the credential separately so the two
-- values retain their correct semantics.
-- ============================================================

ALTER TABLE pending_signups
    ADD COLUMN IF NOT EXISTS otp_provider_session_token VARCHAR(255);

-- Provider state is valid only when all provider session
-- components are present.
ALTER TABLE pending_signups
    DROP CONSTRAINT IF EXISTS pending_signups_otp_provider_state_ck;

ALTER TABLE pending_signups
    ADD CONSTRAINT pending_signups_otp_provider_state_ck
    CHECK (
        (
            otp_provider IS NULL
            AND otp_provider_session_id IS NULL
            AND otp_provider_session_token IS NULL
            AND otp_provider_expires_at IS NULL
        )
        OR
        (
            otp_provider IS NOT NULL
            AND length(trim(otp_provider)) > 0
            AND otp_provider_session_id IS NOT NULL
            AND length(trim(otp_provider_session_id)) > 0
            AND otp_provider_session_token IS NOT NULL
            AND length(trim(otp_provider_session_token)) > 0
            AND otp_provider_expires_at IS NOT NULL
        )
    );

COMMIT;
