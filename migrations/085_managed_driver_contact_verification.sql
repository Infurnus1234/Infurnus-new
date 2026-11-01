BEGIN;
-- Contact provenance is not verification; ownership still requires a consumed OTP.
ALTER TABLE fleet_managed_driver_accounts
 ADD COLUMN provisioned_email TEXT,
 ADD COLUMN provisioned_phone TEXT;
ALTER TABLE login_challenges ADD COLUMN provisioned_contact_value TEXT;
-- Recover only unambiguously fleet-created legacy accounts, not later-linked
-- self-registered accounts or their unverified secondary contacts.
UPDATE fleet_managed_driver_accounts m SET
 provisioned_email=lower(btrim(u.email)), provisioned_phone=u.phone
FROM users u, partners p
WHERE u.id=m.driver_user_id AND p.id=m.partner_id
 AND m.created_by=p.user_id AND u.role='driver'
 AND u.created_at=m.created_at
 AND NOT EXISTS(SELECT 1 FROM user_credentials c WHERE c.user_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM refresh_tokens t WHERE t.user_id=u.id);
COMMIT;
