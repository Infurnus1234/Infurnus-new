-- Deployment selects one Cloud Run revision before ownership can transfer.
CREATE TABLE backend_worker_revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision text NOT NULL CHECK (revision ~ '^[a-z][a-z0-9-]{0,62}$')
);
