ALTER TABLE rides
  ADD COLUMN driver_accepted_at timestamptz,
  ADD COLUMN cancelled_by_customer boolean NOT NULL DEFAULT false;

-- Recover acceptance for active legacy rides only from the winning dispatch record.
-- Backfilling history must not move the timestamp used for the driver's arrival.
ALTER TABLE rides DISABLE TRIGGER rides_set_updated_at;
WITH accepted AS (
  SELECT r.id, max(attempt.responded_at) AS accepted_at
  FROM rides r
  JOIN ride_dispatch_attempts attempt
    ON attempt.ride_id = r.id AND attempt.driver_profile_id = r.assigned_driver_id
  WHERE r.status IN ('driver_assigned', 'driver_arriving', 'driver_arrived')
    AND r.sector IN ('logistics', 'rental', 'premium', 'service')
    AND attempt.status = 'accepted'
    AND attempt.responded_at BETWEEN r.created_at AND statement_timestamp()
  GROUP BY r.id
)
UPDATE rides r SET driver_accepted_at = accepted.accepted_at
FROM accepted WHERE r.id = accepted.id;
ALTER TABLE rides ENABLE TRIGGER rides_set_updated_at;

CREATE FUNCTION ride_customer_cancellation_deadline(sector text, accepted_at timestamptz)
RETURNS timestamptz
LANGUAGE sql STABLE
AS $$
  SELECT CASE WHEN sector IN ('logistics', 'rental', 'premium', 'service')
    THEN accepted_at + interval '300 seconds'
  END
$$;

CREATE FUNCTION ride_customer_cancellation_allowed(
  sector text, status ride_status, accepted_at timestamptz, checked_at timestamptz
)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN status IN ('requested', 'searching') THEN true
    WHEN status IN ('driver_assigned', 'driver_arriving', 'driver_arrived') THEN
      CASE WHEN sector IN ('logistics', 'rental', 'premium', 'service')
        THEN COALESCE(checked_at >= accepted_at
          AND checked_at < ride_customer_cancellation_deadline(sector, accepted_at), false)
        ELSE true
      END
    ELSE false
  END
$$;
