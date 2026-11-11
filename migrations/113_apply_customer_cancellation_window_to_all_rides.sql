-- Recover timestamps for active legacy rides from the accepted offer, without
-- changing updated_at, which the customer app uses for the arrival timer.
ALTER TABLE rides DISABLE TRIGGER rides_set_updated_at;
WITH accepted AS (
  SELECT r.id, max(attempt.responded_at) AS accepted_at
  FROM rides r
  JOIN ride_dispatch_attempts attempt
    ON attempt.ride_id = r.id AND attempt.driver_profile_id = r.assigned_driver_id
  WHERE r.driver_accepted_at IS NULL
    AND r.status IN ('driver_assigned', 'driver_arriving', 'driver_arrived')
    AND attempt.status = 'accepted'
    AND attempt.responded_at BETWEEN r.created_at AND statement_timestamp()
  GROUP BY r.id
)
UPDATE rides r SET driver_accepted_at = accepted.accepted_at
FROM accepted WHERE r.id = accepted.id;
ALTER TABLE rides ENABLE TRIGGER rides_set_updated_at;

CREATE OR REPLACE FUNCTION ride_customer_cancellation_deadline(sector text, accepted_at timestamptz)
RETURNS timestamptz
LANGUAGE sql STABLE
AS $$
  SELECT accepted_at + interval '300 seconds'
$$;

CREATE OR REPLACE FUNCTION ride_customer_cancellation_allowed(
  sector text, status ride_status, accepted_at timestamptz, checked_at timestamptz
)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN status IN ('requested', 'searching') THEN true
    WHEN status IN ('driver_assigned', 'driver_arriving', 'driver_arrived') THEN
      COALESCE(checked_at >= accepted_at
        AND checked_at < ride_customer_cancellation_deadline(sector, accepted_at), false)
    ELSE false
  END
$$;
