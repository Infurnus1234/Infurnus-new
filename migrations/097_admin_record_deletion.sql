-- Administrative removal preserves support and delivery history and references.
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS admin_deleted_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS admin_deleted_at TIMESTAMPTZ;
ALTER TABLE provider_approval_requests ADD COLUMN IF NOT EXISTS admin_deleted_at TIMESTAMPTZ;
ALTER TABLE driver_applications ADD COLUMN IF NOT EXISTS admin_deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_support_admin_active ON support_tickets(created_at DESC, id DESC)
  WHERE admin_deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_admin_active ON notifications(created_at DESC, id DESC)
  WHERE admin_deleted_at IS NULL;
