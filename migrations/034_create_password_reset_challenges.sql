BEGIN;

-- ============================================================
-- Migration 034: Password Reset Challenges
-- ============================================================
--
-- Dedicated password-reset OTP/session state.
-- OTP and session tokens are stored only as hashes.
-- A reset challenge must be explicitly verified before
-- the password can be changed.
-- ============================================================

CREATE TABLE password_reset_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    email VARCHAR(320) NOT NULL,

    session_token_hash CHAR(64) NOT NULL UNIQUE,

    otp_hash CHAR(64) NOT NULL,

    attempts SMALLINT NOT NULL DEFAULT 0,

    max_attempts SMALLINT NOT NULL DEFAULT 10,

    expires_at TIMESTAMPTZ NOT NULL,

    last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    verified_at TIMESTAMPTZ,

    consumed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT password_reset_challenges_email_check
        CHECK (btrim(email) <> ''),

    CONSTRAINT password_reset_challenges_attempts_check
        CHECK (attempts >= 0 AND attempts <= max_attempts),

    CONSTRAINT password_reset_challenges_max_attempts_check
        CHECK (max_attempts > 0),

    CONSTRAINT password_reset_challenges_expiry_check
        CHECK (expires_at > created_at),

    CONSTRAINT password_reset_challenges_verified_check
        CHECK (
            verified_at IS NULL
            OR verified_at >= created_at
        ),

    CONSTRAINT password_reset_challenges_consumed_check
        CHECK (
            consumed_at IS NULL
            OR consumed_at >= created_at
        ),

    CONSTRAINT password_reset_challenges_verified_before_consumed_check
        CHECK (
            consumed_at IS NULL
            OR verified_at IS NOT NULL
        )
);

-- Active challenge lookup by user.
CREATE INDEX password_reset_challenges_user_id_idx
    ON password_reset_challenges(user_id);

-- Active challenge lookup by email.
CREATE INDEX password_reset_challenges_email_idx
    ON password_reset_challenges(email);

-- Expired challenge cleanup.
CREATE INDEX password_reset_challenges_expires_at_idx
    ON password_reset_challenges(expires_at);

-- Only one active reset challenge per user.
CREATE UNIQUE INDEX password_reset_challenges_active_user_uidx
    ON password_reset_challenges(user_id)
    WHERE consumed_at IS NULL;

-- Automatically maintain updated_at.
CREATE TRIGGER password_reset_challenges_set_updated_at
BEFORE UPDATE ON password_reset_challenges
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

COMMIT;