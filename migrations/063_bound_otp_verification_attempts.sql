-- Compatibility: local and GitHub histories assigned different filenames to this same additive change.
-- Provider-independent limits; resend never resets a challenge's attempt budget.
ALTER TABLE login_challenges ADD COLUMN IF NOT EXISTS verification_attempts INTEGER NOT NULL DEFAULT 0
  CHECK (verification_attempts >= 0);
