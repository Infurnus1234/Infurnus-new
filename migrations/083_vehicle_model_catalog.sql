-- Manufacturer/model identity is independent of service types and fare codes.
CREATE TABLE vehicle_model_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make text NOT NULL CHECK(length(make) BETWEEN 1 AND 50),
  model text NOT NULL CHECK(length(model) BETWEEN 1 AND 50),
  normalized_make text GENERATED ALWAYS AS (lower(make)) STORED,
  normalized_model text GENERATED ALWAYS AS (lower(model)) STORED,
  UNIQUE(normalized_make,normalized_model)
);
INSERT INTO vehicle_model_catalog(make,model) VALUES('Tata','407'),('Mahindra','Scorpio');
