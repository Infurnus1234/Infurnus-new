BEGIN;

CREATE TABLE login_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE RESTRICT,

    otp_provider VARCHAR(50) NOT NULL,

    provider_session_id VARCHAR(255) NOT NULL,

    encrypted_provider_session_token TEXT NOT NULL,

    provider_expires_at TIMESTAMPTZ NOT NULL,

    expires_at TIMESTAMPTZ NOT NULL,

    last_otp_sent_at TIMESTAMPTZ NOT NULL,

    verified_at TIMESTAMPTZ,

    consumed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT login_challenges_provider_not_empty_check
        CHECK (btrim(otp_provider) <> ''),

    CONSTRAINT login_challenges_session_id_not_empty_check
        CHECK (btrim(provider_session_id) <> ''),

    CONSTRAINT login_challenges_encrypted_token_not_empty_check
        CHECK (btrim(encrypted_provider_session_token) <> ''),

    CONSTRAINT login_challenges_expiry_check
        CHECK (expires_at > created_at),

    CONSTRAINT login_challenges_provider_expiry_check
        CHECK (provider_expires_at > created_at),

    CONSTRAINT login_challenges_verified_consumed_check
        CHECK (
            consumed_at IS NULL
            OR verified_at IS NOT NULL
        ),

    CONSTRAINT login_challenges_verified_before_consumed_check
        CHECK (
            verified_at IS NULL
            OR consumed_at IS NULL
            OR verified_at <= consumed_at
        )
);

CREATE INDEX login_challenges_user_id_idx
    ON login_challenges (user_id);

CREATE INDEX login_challenges_provider_session_id_idx
    ON login_challenges (provider_session_id);

CREATE INDEX login_challenges_expires_at_idx
    ON login_challenges (expires_at);

CREATE UNIQUE INDEX login_challenges_one_active_per_user_uidx
    ON login_challenges (user_id)
    WHERE consumed_at IS NULL
      AND verified_at IS NULL;

COMMIT;