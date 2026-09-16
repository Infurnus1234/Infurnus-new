BEGIN;

ALTER TABLE login_challenges
  ADD COLUMN IF NOT EXISTS otp_channel TEXT;

UPDATE login_challenges
SET otp_channel = 'sms'
WHERE otp_channel IS NULL;

ALTER TABLE login_challenges
  ALTER COLUMN otp_channel SET DEFAULT 'sms';

ALTER TABLE login_challenges
  ALTER COLUMN otp_channel SET NOT NULL;

ALTER TABLE login_challenges
  DROP CONSTRAINT IF EXISTS login_challenges_otp_channel_check;

ALTER TABLE login_challenges
  ADD CONSTRAINT login_challenges_otp_channel_check
  CHECK (otp_channel IN ('sms', 'email'));

COMMIT;