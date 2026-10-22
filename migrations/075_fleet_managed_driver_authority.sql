BEGIN;
CREATE TABLE fleet_managed_driver_accounts (
 driver_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
 partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
 created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
 onboarding_submitted_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX fleet_managed_driver_partner_idx ON fleet_managed_driver_accounts(partner_id,status);
COMMIT;
