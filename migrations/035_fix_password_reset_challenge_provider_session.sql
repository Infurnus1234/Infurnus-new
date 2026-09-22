BEGIN;

ALTER TABLE password_reset_challenges
    ADD COLUMN provider_session_id VARCHAR(255),
    ADD COLUMN provider_session_token_encrypted TEXT;

ALTER TABLE password_reset_challenges
    ALTER COLUMN otp_hash DROP NOT NULL;

ALTER TABLE password_reset_challenges
    ALTER COLUMN attempts SET DEFAULT 0;

ALTER TABLE password_reset_challenges
    DROP CONSTRAINT IF EXISTS password_reset_challenges_attempts_check;

ALTER TABLE password_reset_challenges
    DROP CONSTRAINT IF EXISTS password_reset_challenges_verified_before_consumed_check;

ALTER TABLE password_reset_challenges
    ADD CONSTRAINT password_reset_challenges_provider_session_check
    CHECK (
        provider_session_id IS NOT NULL
        AND provider_session_token_encrypted IS NOT NULL
    );

CREATE INDEX password_reset_challenges_provider_session_id_idx
    ON password_reset_challenges(provider_session_id);

COMMIT;