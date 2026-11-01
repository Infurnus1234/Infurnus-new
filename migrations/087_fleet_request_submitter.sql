BEGIN;
-- Repair only Fleet-managed Drivers with a recorded successful submission.
-- Profile-insert triggers created these pending rows before the Fleet submitted.
UPDATE provider_approval_requests r
SET requester_id=p.user_id,requester_role=u.role::text,fleet_id=p.id,updated_at=NOW()
FROM driver_profiles dp,fleet_managed_driver_accounts m,partners p,users u
WHERE r.target_type='driver_profile' AND r.target_id=dp.id
 AND r.request_type='driver_verification' AND r.status='PENDING'
 AND r.fleet_id IS NULL AND r.requester_id=dp.user_id
 AND m.driver_user_id=dp.user_id AND m.onboarding_submitted_at IS NOT NULL
 AND p.id=m.partner_id AND u.id=p.user_id
 AND u.role IN ('fleet_owner','driver_fleet_owner');
COMMIT;
