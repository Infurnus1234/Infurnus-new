-- Persist provider acceptance per device so retries skip accepted recipients.
CREATE TABLE IF NOT EXISTS notification_device_acceptances (
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES user_devices(id) ON DELETE CASCADE,
  provider_message_id TEXT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, device_id)
);
