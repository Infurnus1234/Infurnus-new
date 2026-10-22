BEGIN;
ALTER TABLE provider_onboarding ADD COLUMN dashboard_deferred_at TIMESTAMPTZ;
-- Existing onboarding decisions and invitation verification remain intact.
-- This field permits dashboard viewing only, never Driver approval or assignment.
COMMIT;
