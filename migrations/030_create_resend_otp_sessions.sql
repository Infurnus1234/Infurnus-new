-- Migration 030: Resend Email OTP Sessions

CREATE TABLE IF NOT EXISTS resend_otp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  email VARCHAR(320) NOT NULL,

  session_token_hash CHAR(64) NOT NULL UNIQUE,

  otp_hash CHAR(64) NOT NULL,

  attempts SMALLINT NOT NULL DEFAULT 0,

  max_attempts SMALLINT NOT NULL DEFAULT 10,

  expires_at TIMESTAMPTZ NOT NULL,

  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  consumed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT resend_otp_sessions_email_check
    CHECK (btrim(email) <> ''),

  CONSTRAINT resend_otp_sessions_attempts_check
    CHECK (attempts >= 0 AND attempts <= max_attempts),

  CONSTRAINT resend_otp_sessions_max_attempts_check
    CHECK (max_attempts > 0),

  CONSTRAINT resend_otp_sessions_expiry_check
    CHECK (expires_at > created_at),

  CONSTRAINT resend_otp_sessions_consumed_check
    CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX IF NOT EXISTS idx_resend_otp_sessions_email
  ON resend_otp_sessions(email);

CREATE INDEX IF NOT EXISTS idx_resend_otp_sessions_expires_at
  ON resend_otp_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_resend_otp_sessions_active_email
  ON resend_otp_sessions(email)
  WHERE consumed_at IS NULL;