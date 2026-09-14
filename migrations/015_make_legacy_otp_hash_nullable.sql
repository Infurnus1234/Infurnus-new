BEGIN;

-- ============================================================
-- Migration 015
-- Make legacy OTP hash nullable
--
-- OTP generation and verification are now provider-managed.
-- The legacy otp_hash column is retained temporarily for
-- backwards compatibility with historical pending-signup rows,
-- but it is no longer required for new provider-managed OTPs.
-- ============================================================

ALTER TABLE pending_signups
    DROP CONSTRAINT IF EXISTS pending_signups_otp_hash_ck;

ALTER TABLE pending_signups
    ALTER COLUMN otp_hash DROP NOT NULL;

COMMIT;
