BEGIN;
CREATE TABLE premium_service_cities (
  id VARCHAR(100) PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_-]*$'),
  name VARCHAR(100) NOT NULL CHECK (length(trim(name))>0),
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  source VARCHAR(500) NOT NULL CHECK (length(trim(source))>0),
  approval_reference VARCHAR(500) NOT NULL CHECK (length(trim(approval_reference))>0),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
