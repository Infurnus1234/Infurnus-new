CREATE TABLE IF NOT EXISTS user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    fcm_token TEXT NOT NULL,

    platform VARCHAR(20) NOT NULL,

    device_id VARCHAR(255) NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT user_devices_platform_check
        CHECK (
            platform IN (
                'ANDROID',
                'IOS',
                'WEB'
            )
        ),

    CONSTRAINT user_devices_unique_device
        UNIQUE (user_id, device_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_devices_fcm_token
    ON user_devices (fcm_token);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id
    ON user_devices (user_id);

CREATE INDEX IF NOT EXISTS idx_user_devices_active
    ON user_devices (user_id, is_active)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_user_devices_last_seen
    ON user_devices (last_seen_at);


CREATE OR REPLACE FUNCTION set_user_devices_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_user_devices_updated_at
    ON user_devices;


CREATE TRIGGER trg_user_devices_updated_at
BEFORE UPDATE ON user_devices
FOR EACH ROW
EXECUTE FUNCTION set_user_devices_updated_at();