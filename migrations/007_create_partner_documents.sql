BEGIN;

CREATE TYPE partner_document_type AS ENUM (
    'AADHAAR',
    'PAN',
    'DRIVING_LICENCE',
    'PROFILE_PHOTO',
    'ADDRESS_PROOF',
    'VEHICLE_RC',
    'VEHICLE_INSURANCE',
    'VEHICLE_PERMIT',
    'VEHICLE_FITNESS',
    'OTHER'
);

CREATE TYPE partner_document_status AS ENUM (
    'PENDING',
    'SUBMITTED',
    'VERIFIED',
    'REJECTED',
    'EXPIRED'
);

CREATE TABLE partner_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    document_type partner_document_type NOT NULL,
    status partner_document_status NOT NULL DEFAULT 'PENDING',
    metadata JSONB,
    issued_at DATE,
    expires_at DATE,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT partner_documents_dates_ck
        CHECK (expires_at IS NULL OR issued_at IS NULL OR expires_at >= issued_at),
    CONSTRAINT partner_documents_verified_at_ck
        CHECK (
            (status IN ('VERIFIED', 'EXPIRED') AND verified_at IS NOT NULL)
            OR (status NOT IN ('VERIFIED', 'EXPIRED') AND verified_at IS NULL)
        ),
    CONSTRAINT partner_documents_expired_at_ck
        CHECK (status <> 'EXPIRED' OR expires_at IS NOT NULL),
    CONSTRAINT partner_documents_vehicle_type_ck
        CHECK (
            (vehicle_id IS NULL AND document_type NOT IN (
                'VEHICLE_RC', 'VEHICLE_INSURANCE', 'VEHICLE_PERMIT', 'VEHICLE_FITNESS'
            ))
            OR (vehicle_id IS NOT NULL AND document_type IN (
                'VEHICLE_RC', 'VEHICLE_INSURANCE', 'VEHICLE_PERMIT', 'VEHICLE_FITNESS'
            ))
        )
);

CREATE FUNCTION validate_partner_document_vehicle()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.vehicle_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM vehicles v
        JOIN driver_profiles d ON d.id = v.driver_profile_id
        JOIN partners p ON p.user_id = d.user_id
        WHERE v.id = NEW.vehicle_id
          AND p.id = NEW.partner_id
    ) THEN
        RAISE EXCEPTION 'Document vehicle does not belong to document partner';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER partner_documents_validate_vehicle
BEFORE INSERT OR UPDATE OF partner_id, vehicle_id ON partner_documents
FOR EACH ROW
EXECUTE FUNCTION validate_partner_document_vehicle();

CREATE FUNCTION validate_partner_document_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status <> NEW.status AND NOT (
        (OLD.status = 'PENDING' AND NEW.status = 'SUBMITTED')
        OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('VERIFIED', 'REJECTED'))
        OR (OLD.status = 'REJECTED' AND NEW.status = 'SUBMITTED')
        OR (OLD.status = 'VERIFIED' AND NEW.status = 'EXPIRED')
    ) THEN
        RAISE EXCEPTION 'Invalid partner document status transition';
    END IF;

    IF NEW.status = 'VERIFIED' AND NEW.expires_at IS NOT NULL
       AND NEW.expires_at <= CURRENT_DATE THEN
        RAISE EXCEPTION 'Verified document cannot already be expired';
    END IF;

    IF NEW.status = 'EXPIRED'
       AND (NEW.expires_at IS NULL OR NEW.expires_at > CURRENT_DATE) THEN
        RAISE EXCEPTION 'Expired document must have a past expiry date';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER partner_documents_validate_status
BEFORE UPDATE OF status, expires_at ON partner_documents
FOR EACH ROW
EXECUTE FUNCTION validate_partner_document_status_transition();

CREATE INDEX partner_documents_partner_id_idx ON partner_documents(partner_id);
CREATE INDEX partner_documents_vehicle_id_idx ON partner_documents(vehicle_id);
CREATE INDEX partner_documents_status_idx ON partner_documents(status);
CREATE INDEX partner_documents_expiry_idx ON partner_documents(expires_at)
    WHERE expires_at IS NOT NULL;

CREATE UNIQUE INDEX partner_documents_partner_type_uidx
    ON partner_documents(partner_id, document_type)
    WHERE vehicle_id IS NULL AND document_type <> 'OTHER';

CREATE UNIQUE INDEX partner_documents_vehicle_type_uidx
    ON partner_documents(vehicle_id, document_type)
    WHERE vehicle_id IS NOT NULL AND document_type <> 'OTHER';

CREATE TRIGGER partner_documents_set_updated_at
BEFORE UPDATE ON partner_documents
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

COMMIT;