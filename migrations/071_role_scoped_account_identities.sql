BEGIN;
-- Build stricter normalized role indexes before removing global restrictions.
CREATE UNIQUE INDEX users_role_email_uidx ON users(role,lower(btrim(email))) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX users_role_phone_uidx ON users(role,ltrim(btrim(phone),'+')) WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX pending_signups_role_email_uidx ON pending_signups(role,lower(btrim(email))) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX pending_signups_role_contact_uidx ON pending_signups(role,contact_type,(CASE WHEN contact_type='phone' THEN ltrim(btrim(contact_value),'+') ELSE lower(btrim(contact_value)) END));
DROP INDEX users_email_active_uidx;
DROP INDEX users_phone_active_uidx;
DROP INDEX users_otp_phone_identity_uidx;
DROP INDEX pending_signups_email_unique_idx;
DROP INDEX pending_signups_contact_uidx;
DROP INDEX pending_signups_otp_phone_identity_uidx;

ALTER TABLE users ADD CONSTRAINT users_id_role_key UNIQUE(id,role);
ALTER TABLE auth_external_identities ADD COLUMN account_role user_role;
UPDATE auth_external_identities i SET account_role=u.role FROM users u WHERE u.id=i.user_id;
ALTER TABLE auth_external_identities ALTER COLUMN account_role SET NOT NULL;
ALTER TABLE auth_external_identities DROP CONSTRAINT auth_external_identities_pkey;
ALTER TABLE auth_external_identities ADD PRIMARY KEY(provider,provider_subject,account_role);
ALTER TABLE auth_external_identities ADD CONSTRAINT external_identity_account_role_fk FOREIGN KEY(user_id,account_role) REFERENCES users(id,role) ON UPDATE CASCADE ON DELETE CASCADE;
-- Older internal provisioning inserts may omit role; derive it from the actual account.
CREATE FUNCTION set_external_identity_account_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.account_role IS NULL THEN SELECT role INTO NEW.account_role FROM users WHERE id=NEW.user_id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER external_identity_role_default BEFORE INSERT ON auth_external_identities FOR EACH ROW EXECUTE FUNCTION set_external_identity_account_role();
COMMIT;
