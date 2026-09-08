DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'notification_processing_status'
  ) THEN
    CREATE TYPE notification_processing_status AS ENUM (
      'PENDING',
      'PROCESSING',
      'PROCESSED',
      'FAILED'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'notification_delivery_status'
  ) THEN
    CREATE TYPE notification_delivery_status AS ENUM (
      'PENDING',
      'SENT',
      'DELIVERED',
      'FAILED'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  notification_type VARCHAR(100) NOT NULL,
  channel VARCHAR(30) NOT NULL,

  title TEXT,
  body TEXT,

  payload JSONB,

  processing_status notification_processing_status NOT NULL DEFAULT 'PENDING',
  delivery_status notification_delivery_status NOT NULL DEFAULT 'PENDING',

  provider VARCHAR(50),
  provider_message_id VARCHAR(255),

  failure_reason TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT notifications_type_not_blank
    CHECK (length(trim(notification_type)) > 0),

  CONSTRAINT notifications_channel_not_blank
    CHECK (length(trim(channel)) > 0),

  CONSTRAINT notifications_attempt_count_valid
    CHECK (attempt_count >= 0),

  CONSTRAINT notifications_payload_object
    CHECK (
      payload IS NULL OR jsonb_typeof(payload) = 'object'
    ),

  CONSTRAINT notifications_processed_consistency
    CHECK (
      (processing_status = 'PROCESSED' AND processed_at IS NOT NULL)
      OR
      (processing_status <> 'PROCESSED')
    ),

  CONSTRAINT notifications_failed_consistency
    CHECK (
      (processing_status = 'FAILED' AND failed_at IS NOT NULL)
      OR
      (processing_status <> 'FAILED')
    ),

  CONSTRAINT notifications_delivered_consistency
    CHECK (
      (delivery_status = 'DELIVERED' AND delivered_at IS NOT NULL)
      OR
      (delivery_status <> 'DELIVERED')
    )
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at
  ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_processing_status
  ON notifications (processing_status, created_at);

CREATE INDEX IF NOT EXISTS idx_notifications_delivery_status
  ON notifications (delivery_status, created_at);

CREATE INDEX IF NOT EXISTS idx_notifications_provider_message_id
  ON notifications (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION set_notifications_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_updated_at ON notifications;

CREATE TRIGGER trg_notifications_updated_at
BEFORE UPDATE ON notifications
FOR EACH ROW
EXECUTE FUNCTION set_notifications_updated_at();
