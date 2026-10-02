BEGIN;

ALTER TABLE rides
  ADD COLUMN dispatch_driver_id UUID REFERENCES driver_profiles(id) ON DELETE SET NULL,
  ADD COLUMN dispatch_expires_at TIMESTAMPTZ,
  ADD COLUMN dispatch_attempt INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT rides_dispatch_lease_pair_ck CHECK (
    (dispatch_driver_id IS NULL AND dispatch_expires_at IS NULL)
    OR (dispatch_driver_id IS NOT NULL AND dispatch_expires_at IS NOT NULL)
  ),
  ADD CONSTRAINT rides_dispatch_attempt_nonnegative_ck CHECK (dispatch_attempt >= 0);

CREATE TABLE ride_dispatch_attempts (
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  driver_profile_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
  status VARCHAR(16) NOT NULL CHECK (status IN ('offered', 'rejected', 'timed_out', 'accepted')),
  offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  PRIMARY KEY (ride_id, attempt),
  UNIQUE (ride_id, driver_profile_id, attempt)
);

CREATE INDEX ride_dispatch_attempts_driver_status_idx
  ON ride_dispatch_attempts (driver_profile_id, status, offered_at DESC);

COMMIT;
