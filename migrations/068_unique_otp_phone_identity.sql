-- SendOTP treats a country-coded number with or without '+' as the same phone.
-- Fail on legacy collisions rather than merging identities or choosing an owner.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users WHERE phone IS NOT NULL AND deleted_at IS NULL
    GROUP BY ltrim(phone, '+') HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM pending_signups WHERE contact_type = 'phone'
    GROUP BY ltrim(contact_value, '+') HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Phone identity aliases collide; reconcile ownership explicitly before migration';
  END IF;
END $$;

CREATE UNIQUE INDEX users_otp_phone_identity_uidx
  ON users (ltrim(phone, '+')) WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX pending_signups_otp_phone_identity_uidx
  ON pending_signups (ltrim(contact_value, '+')) WHERE contact_type = 'phone';
