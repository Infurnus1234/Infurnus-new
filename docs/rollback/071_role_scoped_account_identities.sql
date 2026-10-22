-- Maintenance-window rollback only. Refuse rollback if global uniqueness can no longer hold.
BEGIN;
LOCK TABLE users,pending_signups,auth_external_identities IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM users WHERE deleted_at IS NULL AND email IS NOT NULL GROUP BY lower(btrim(email)) HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM users WHERE deleted_at IS NULL AND phone IS NOT NULL GROUP BY ltrim(btrim(phone),'+') HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM pending_signups WHERE email IS NOT NULL GROUP BY lower(btrim(email)) HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM pending_signups GROUP BY contact_type,CASE WHEN contact_type='phone' THEN ltrim(btrim(contact_value),'+') ELSE lower(btrim(contact_value)) END HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM auth_external_identities GROUP BY provider,provider_subject HAVING count(*)>1)
 THEN RAISE EXCEPTION 'Rollback blocked: shared identities exist. Preserve accounts; no rows modified.'; END IF;
END $$;
CREATE UNIQUE INDEX users_email_active_uidx ON users(email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX users_phone_active_uidx ON users(phone) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_otp_phone_identity_uidx ON users(ltrim(phone,'+')) WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX pending_signups_email_unique_idx ON pending_signups(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX pending_signups_contact_uidx ON pending_signups(contact_type,contact_value);
CREATE UNIQUE INDEX pending_signups_otp_phone_identity_uidx ON pending_signups(ltrim(contact_value,'+')) WHERE contact_type='phone';
DROP TRIGGER external_identity_role_default ON auth_external_identities;
DROP FUNCTION set_external_identity_account_role();
ALTER TABLE auth_external_identities DROP CONSTRAINT external_identity_account_role_fk;
ALTER TABLE auth_external_identities DROP CONSTRAINT auth_external_identities_pkey;
ALTER TABLE auth_external_identities DROP COLUMN account_role;
ALTER TABLE auth_external_identities ADD PRIMARY KEY(provider,provider_subject);
ALTER TABLE users DROP CONSTRAINT users_id_role_key;
DROP INDEX users_role_email_uidx;
DROP INDEX users_role_phone_uidx;
DROP INDEX pending_signups_role_email_uidx;
DROP INDEX pending_signups_role_contact_uidx;
-- Operator must roll back application code and reconcile its migration ledger in the same maintenance procedure.
COMMIT;
