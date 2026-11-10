-- Approved hourly booking policy; preserve prices and historical ride snapshots.
ALTER TABLE vehicle_types ALTER COLUMN hourly_missing_duration_policy SET DEFAULT 'require_duration';
UPDATE vehicle_types
SET hourly_missing_duration_policy='require_duration', extended_duration_policy='booked_duration', version=version+1
WHERE hourly_base_fares_paise IS NOT NULL
  AND (hourly_missing_duration_policy IS DISTINCT FROM 'require_duration'
       OR extended_duration_policy IS DISTINCT FROM 'booked_duration');
ALTER TABLE vehicle_types ADD CONSTRAINT vehicle_hourly_booking_policy CHECK (
 hourly_base_fares_paise IS NULL OR
 (hourly_missing_duration_policy='require_duration' AND extended_duration_policy IS NOT DISTINCT FROM 'booked_duration')
);
