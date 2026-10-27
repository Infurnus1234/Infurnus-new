-- Model identity is independent of service category and pricing/dispatch eligibility.
-- Owner-scoped additions never publish unreviewed names into another fleet's catalog.
CREATE TABLE fleet_vehicle_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  make text NOT NULL CHECK (length(make) BETWEEN 1 AND 50),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 50),
  normalized_make text GENERATED ALWAYS AS (lower(make)) STORED,
  normalized_model text GENERATED ALWAYS AS (lower(model)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, normalized_make, normalized_model)
);
