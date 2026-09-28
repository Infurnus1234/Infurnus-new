BEGIN;

-- ============================================================
-- Driver Documents
-- Stores uploaded driver documents separately from driver_profiles.
-- ============================================================

CREATE TYPE driver_document_type AS ENUM (
    'profile_photo',
    'driver_license',
    'vehicle_rc'
);

CREATE TYPE driver_document_verification_status AS ENUM (
    'pending',
    'approved',
    'rejected'
);

CREATE TABLE driver_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    driver_profile_id UUID NOT NULL
        REFERENCES driver_profiles(id)
        ON DELETE CASCADE,

    document_type driver_document_type NOT NULL,

    storage_provider VARCHAR(50) NOT NULL,
    storage_key VARCHAR(500) NOT NULL,

    resource_type VARCHAR(20) NOT NULL,
    access_mode VARCHAR(20) NOT NULL,

    mime_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL,

    verification_status driver_document_verification_status
        NOT NULL DEFAULT 'pending',

    rejection_reason TEXT,

    uploaded_by UUID NOT NULL
        REFERENCES users(id)
        ON DELETE RESTRICT,

    verified_by UUID
        REFERENCES users(id)
        ON DELETE RESTRICT,

    verified_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT driver_documents_storage_provider_ck
        CHECK (storage_provider = 'cloudinary'),

    CONSTRAINT driver_documents_resource_type_ck
        CHECK (resource_type IN ('image', 'raw', 'auto')),

    CONSTRAINT driver_documents_access_mode_ck
        CHECK (access_mode IN ('public', 'authenticated')),

    CONSTRAINT driver_documents_file_size_ck
        CHECK (file_size > 0),

    CONSTRAINT driver_documents_rejection_reason_ck
        CHECK (
            verification_status <> 'rejected'
            OR rejection_reason IS NOT NULL
        ),

    CONSTRAINT driver_documents_verified_by_ck
        CHECK (
            verification_status <> 'approved'
            OR verified_by IS NOT NULL
        ),

    CONSTRAINT driver_documents_verified_at_ck
        CHECK (
            verification_status <> 'approved'
            OR verified_at IS NOT NULL
        )
);

-- One current document per type per driver.
CREATE UNIQUE INDEX driver_documents_driver_type_uidx
    ON driver_documents(driver_profile_id, document_type);

CREATE INDEX driver_documents_driver_profile_idx
    ON driver_documents(driver_profile_id);

CREATE INDEX driver_documents_verification_status_idx
    ON driver_documents(verification_status);

CREATE INDEX driver_documents_uploaded_by_idx
    ON driver_documents(uploaded_by);

COMMIT;