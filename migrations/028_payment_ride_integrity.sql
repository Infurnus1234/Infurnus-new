-- 028_payment_ride_integrity.sql
-- Ensure payments-ride integrity and prevent duplicate active payments for the same ride

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_active_ride
  ON payments (ride_id)
  WHERE ride_id IS NOT NULL AND status IN ('INITIATED', 'AUTHORIZED', 'CAPTURED');
