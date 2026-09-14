BEGIN;

-- ============================================================
-- Migration 017
-- Add Optional Signup Email
--
-- Phone is the mandatory signup verification channel.
-- Email is optional account data and is no longer an
-- alternative verification contact.
-- ============================================================

ALTER TABLE pending_signups
    ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Only one pending signup may reserve a given email.
-- NULL values are intentionally excluded.
CREATE UNIQUE INDEX IF NOT EXISTS
    pending_signups_email_unique_idx
    ON pending_signups(email)
    WHERE email IS NOT NULL;

COMMIT;
