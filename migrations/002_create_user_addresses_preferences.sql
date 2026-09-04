BEGIN;

-- ============================================================
-- User Addresses
-- One user can have multiple saved addresses.
-- ============================================================

CREATE TABLE user_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    label VARCHAR(30) NOT NULL,

    address_line_1 VARCHAR(255) NOT NULL,
    address_line_2 VARCHAR(255),

    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    country VARCHAR(100) NOT NULL DEFAULT 'India',

    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,

    is_default BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT user_addresses_label_ck
        CHECK (length(trim(label)) > 0),

    CONSTRAINT user_addresses_address_line_1_ck
        CHECK (length(trim(address_line_1)) > 0),

    CONSTRAINT user_addresses_city_ck
        CHECK (length(trim(city)) > 0),

    CONSTRAINT user_addresses_state_ck
        CHECK (length(trim(state)) > 0),

    CONSTRAINT user_addresses_postal_code_ck
        CHECK (length(trim(postal_code)) > 0),

    CONSTRAINT user_addresses_country_ck
        CHECK (length(trim(country)) > 0),

    CONSTRAINT user_addresses_latitude_ck
        CHECK (
            latitude IS NULL
            OR latitude BETWEEN -90 AND 90
        ),

    CONSTRAINT user_addresses_longitude_ck
        CHECK (
            longitude IS NULL
            OR longitude BETWEEN -180 AND 180
        ),

    CONSTRAINT user_addresses_coordinates_ck
        CHECK (
            (latitude IS NULL AND longitude IS NULL)
            OR
            (latitude IS NOT NULL AND longitude IS NOT NULL)
        )
);


-- ============================================================
-- User Addresses indexes
-- ============================================================

CREATE INDEX user_addresses_user_id_idx
    ON user_addresses(user_id);

-- A user can have only one default address.
CREATE UNIQUE INDEX user_addresses_one_default_uidx
    ON user_addresses(user_id)
    WHERE is_default = TRUE;


-- ============================================================
-- User Addresses updated_at trigger
-- ============================================================

CREATE TRIGGER user_addresses_set_updated_at
BEFORE UPDATE ON user_addresses
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();


-- ============================================================
-- User Preferences
-- One-to-one relationship with users.
-- user_id is therefore the primary key.
-- ============================================================

CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY
        REFERENCES users(id)
        ON DELETE CASCADE,

    push_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    email_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sms_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- User Preferences updated_at trigger
-- ============================================================

CREATE TRIGGER user_preferences_set_updated_at
BEFORE UPDATE ON user_preferences
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();


COMMIT;