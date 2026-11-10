ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_sector_check;
ALTER TABLE rides ADD CONSTRAINT rides_sector_check
  CHECK (sector IN ('passenger', 'logistics', 'service', 'premium', 'rental'));
