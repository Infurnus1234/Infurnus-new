BEGIN;
ALTER TABLE provider_onboarding ADD COLUMN role_flow_active BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE provider_onboarding ADD COLUMN role_selection_pending BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE provider_onboarding ADD COLUMN flow_steps JSONB NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(flow_steps)='object');
ALTER TABLE provider_onboarding ADD COLUMN driver_code_verified_at TIMESTAMPTZ;
ALTER TABLE provider_onboarding ADD COLUMN flow_completed_at TIMESTAMPTZ;
ALTER TABLE provider_onboarding ADD COLUMN account_photo JSONB;
CREATE TABLE driver_onboarding_invitations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
 driver_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 code_hash TEXT UNIQUE,
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CONSUMED','REVOKED')),
 expires_at TIMESTAMPTZ NOT NULL,
 consumed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX driver_onboarding_one_active ON driver_onboarding_invitations(partner_id,driver_user_id) WHERE status='ACTIVE';
CREATE INDEX driver_onboarding_invited_user ON driver_onboarding_invitations(driver_user_id);
ALTER TABLE driver_assignment_codes ADD COLUMN intended_driver_profile_id UUID REFERENCES driver_profiles(id) ON DELETE RESTRICT;
-- Legacy code records remain readable; all newly issued codes are six digits.
COMMIT;
