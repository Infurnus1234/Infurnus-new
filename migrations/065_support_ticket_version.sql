ALTER TABLE support_tickets ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
