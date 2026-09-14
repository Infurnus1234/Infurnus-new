BEGIN;

ALTER TABLE pending_signups
    ALTER COLUMN otp_expires_at DROP NOT NULL;

COMMIT;
