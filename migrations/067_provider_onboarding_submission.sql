BEGIN;
-- Deferral affects enrolment only; required operational compliance is unchanged.
ALTER TABLE provider_document_requirements ADD COLUMN onboarding_deferrable BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE provider_document_requirements SET onboarding_deferrable=FALSE WHERE document_code='driver_license';
ALTER TABLE provider_document_requirements ADD CONSTRAINT licence_not_deferrable CHECK(document_code<>'driver_license' OR NOT onboarding_deferrable);
CREATE TABLE provider_onboarding (
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
 deferred_codes JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(deferred_codes)='array'),
 receipt_id UUID UNIQUE,
 snapshot JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(snapshot)='array'),
 submitted_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK ((receipt_id IS NULL)=(submitted_at IS NULL))
);
COMMIT;
