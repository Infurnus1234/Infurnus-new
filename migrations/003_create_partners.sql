BEGIN;

-- ============================================================
-- Partner status enums
-- ============================================================

CREATE TYPE partner_approval_status AS ENUM (
    'pending',
    'under_review',
    'approved',
    'rejected'
);

CREATE TYPE partner_availability_status AS ENUM (
    'offline',
    'available',
    'unavailable'
);


-- ============================================================
-- Partners
-- Partner-specific business profile linked 1:1 to users.
-- ============================================================

CREATE TABLE partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL UNIQUE
        REFERENCES users(id)
        ON DELETE RESTRICT,

    business_name VARCHAR(150) NOT NULL,
    business_description TEXT,

    approval_status partner_approval_status
        NOT NULL DEFAULT 'pending',

    availability_status partner_availability_status
        NOT NULL DEFAULT 'offline',

    rejection_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT partners_business_name_ck
        CHECK (length(trim(business_name)) > 0),

    CONSTRAINT partners_rejection_reason_ck
        CHECK (
            approval_status <> 'rejected'
            OR rejection_reason IS NOT NULL
        )
);


-- ============================================================
-- Partner indexes
-- ============================================================

CREATE INDEX partners_approval_status_idx
    ON partners(approval_status);

CREATE INDEX partners_availability_status_idx
    ON partners(availability_status);


-- ============================================================
-- Partners updated_at trigger
-- ============================================================

CREATE TRIGGER partners_set_updated_at
BEFORE UPDATE ON partners
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();


COMMIT;