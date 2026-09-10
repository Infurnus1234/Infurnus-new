CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE rentals
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rentals_user_idempotency_key
  ON rentals (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE rentals
  DROP CONSTRAINT IF EXISTS rentals_no_vehicle_overlap;

ALTER TABLE rentals
  ADD CONSTRAINT rentals_no_vehicle_overlap
  EXCLUDE USING gist (
    vehicle_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status IN ('PENDING', 'CONFIRMED', 'ACTIVE'));
