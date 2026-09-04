BEGIN;

CREATE TABLE user_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    event_type VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT user_history_event_type_ck
        CHECK (length(trim(event_type)) > 0),

    CONSTRAINT user_history_entity_type_ck
        CHECK (length(trim(entity_type)) > 0)
);

CREATE INDEX user_history_user_created_idx
    ON user_history(user_id, created_at DESC);

COMMIT;