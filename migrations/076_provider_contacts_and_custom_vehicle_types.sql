-- Profile contacts are not authentication identities. The migration runner is forward-only.
CREATE TABLE provider_profile_contacts (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  email VARCHAR(254),
  phone VARCHAR(16),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Owner inventory only: these entries never configure fare or dispatch capabilities.
CREATE TABLE fleet_custom_vehicle_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  normalized_name TEXT NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE DEFAULT ('custom_' || replace(gen_random_uuid()::text,'-','')),
  sector VARCHAR(30) NOT NULL CHECK (sector IN ('passenger','logistics','service','premium','rental')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(owner_id,sector,normalized_name)
);
