ALTER TABLE driver_profiles ADD COLUMN online_preference boolean;

UPDATE driver_profiles
SET online_preference = availability_status IN ('available', 'busy', 'stale');

ALTER TABLE driver_profiles
  ALTER COLUMN online_preference SET DEFAULT false,
  ALTER COLUMN online_preference SET NOT NULL;
