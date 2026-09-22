DROP INDEX IF EXISTS uq_user_devices_fcm_token;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_devices_fcm_token
    ON user_devices (fcm_token)
    WHERE is_active = TRUE;