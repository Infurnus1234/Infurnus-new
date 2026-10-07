BEGIN;

CREATE TABLE auth_external_identities (
    provider VARCHAR(20) NOT NULL CHECK (provider = 'GOOGLE'),
    provider_subject VARCHAR(255) NOT NULL CHECK (length(provider_subject) > 0),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider, provider_subject),
    UNIQUE (user_id, provider)
);

COMMIT;
