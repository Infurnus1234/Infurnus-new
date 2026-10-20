import { pool } from '../../../infrastructure/database/postgres.js';

export type NotificationProcessingStatus = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED';

export type NotificationDeliveryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';

export interface CreateNotificationRecordInput {
  id: string;
  userId: string;
  notificationType: string;
  channel: string;
  title?: string;
  body?: string;
  payload?: Record<string, string>;
  provider?: string;
  idempotencyKey?: string;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  notificationType: string;
  channel: string;
  title: string | null;
  body: string | null;
  payload: Record<string, unknown> | null;
  processingStatus: NotificationProcessingStatus;
  deliveryStatus: NotificationDeliveryStatus;
  provider: string | null;
  providerMessageId: string | null;
  failureReason: string | null;
  attemptCount: number;
  idempotencyKey: string | null;
  createdAt: Date;
  processedAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  updatedAt: Date;
}

interface NotificationRow {
  id: string;
  user_id: string;
  notification_type: string;
  channel: string;
  title: string | null;
  body: string | null;
  payload: Record<string, unknown> | null;
  processing_status: NotificationProcessingStatus;
  delivery_status: NotificationDeliveryStatus;
  provider: string | null;
  provider_message_id: string | null;
  failure_reason: string | null;
  attempt_count: number;
  idempotency_key: string | null;
  created_at: Date;
  processed_at: Date | null;
  delivered_at: Date | null;
  failed_at: Date | null;
  updated_at: Date;
}

function mapNotificationRow(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    notificationType: row.notification_type,
    channel: row.channel,
    title: row.title,
    body: row.body,
    payload: row.payload,
    processingStatus: row.processing_status,
    deliveryStatus: row.delivery_status,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    failureReason: row.failure_reason,
    attemptCount: row.attempt_count,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    processedAt: row.processed_at,
    deliveredAt: row.delivered_at,
    failedAt: row.failed_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Safely maps the first returned row.
 *
 * INSERT/UPDATE ... RETURNING should normally return one row,
 * but PostgreSQL can return zero rows when the WHERE condition
 * of an UPDATE matches nothing.
 */
function mapFirstNotificationRow(row: NotificationRow | undefined): NotificationRecord {
  if (!row) {
    throw new Error('Notification record was not returned by the database');
  }

  return mapNotificationRow(row);
}

export interface NotificationRepository {
  create(input: CreateNotificationRecordInput): Promise<NotificationRecord>;

  findById(id: string): Promise<NotificationRecord | null>;

  findByIdempotencyKey(idempotencyKey: string): Promise<NotificationRecord | null>;

  markProcessing(id: string): Promise<NotificationRecord>;

  markSent(id: string, providerMessageId?: string): Promise<NotificationRecord>;

  markDelivered(id: string): Promise<NotificationRecord>;

  markProcessed(id: string): Promise<NotificationRecord>;

  markFailed(id: string, failureReason: string): Promise<NotificationRecord>;
}

export class PostgresNotificationRepository implements NotificationRepository {
  async pushAllowed(userId: string): Promise<boolean> {
    const result = await pool.query<{ allowed: boolean }>(
      `SELECT COALESCE(p.push_notifications_enabled,TRUE) AS allowed
      FROM users u LEFT JOIN user_preferences p ON p.user_id=u.id
      WHERE u.id=$1 AND u.status='active' AND u.deleted_at IS NULL`,
      [userId],
    );
    return result.rows[0]?.allowed === true;
  }
  async acceptedDeviceIds(notificationId: string): Promise<string[]> {
    const result = await pool.query<{ device_id: string }>(
      'SELECT device_id FROM notification_device_acceptances WHERE notification_id=$1',
      [notificationId],
    );
    return result.rows.map((row) => row.device_id);
  }

  async recordDeviceAcceptance(
    notificationId: string,
    deviceId: string,
    messageId?: string,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO notification_device_acceptances(notification_id,device_id,provider_message_id)
      SELECT n.id,d.id,$3 FROM notifications n JOIN user_devices d ON d.user_id=n.user_id
      WHERE n.id=$1 AND d.id=$2 ON CONFLICT(notification_id,device_id) DO NOTHING`,
      [notificationId, deviceId, messageId ?? null],
    );
  }

  async inbox(userId: string, limit: number, offset: number) {
    const result = await pool.query(
      `SELECT id,notification_type AS type,title,body,payload,created_at AS "createdAt",
       read_at AS "readAt" FROM notifications WHERE user_id=$1
       ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    const count = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM notifications WHERE user_id=$1 AND read_at IS NULL',
      [userId],
    );
    return { items: result.rows, unreadCount: Number(count.rows[0]?.count ?? 0) };
  }

  async readInbox(userId: string, id?: string) {
    const result = await pool.query(
      `UPDATE notifications SET read_at=COALESCE(read_at,NOW())
       WHERE user_id=$1 ${id ? 'AND id=$2' : 'AND read_at IS NULL'} RETURNING id`,
      id ? [userId, id] : [userId],
    );
    return result.rowCount ?? 0;
  }

  async create(input: CreateNotificationRecordInput): Promise<NotificationRecord> {
    const result = await pool.query<NotificationRow>(
      `
        INSERT INTO notifications (
          id,
          user_id,
          notification_type,
          channel,
          title,
          body,
          payload,
          provider,
          idempotency_key
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7::jsonb,
          $8,
          $9
        )
        RETURNING
          id,
          user_id,
          notification_type,
          channel,
          title,
          body,
          payload,
          processing_status,
          delivery_status,
          provider,
          provider_message_id,
          failure_reason,
          attempt_count,
          idempotency_key,
          created_at,
          processed_at,
          delivered_at,
          failed_at,
          updated_at
      `,
      [
        input.id,
        input.userId,
        input.notificationType,
        input.channel,
        input.title ?? null,
        input.body ?? null,
        input.payload !== undefined ? JSON.stringify(input.payload) : null,
        input.provider ?? null,
        input.idempotencyKey ?? null,
      ],
    );

    return mapFirstNotificationRow(result.rows[0]);
  }

  async findById(id: string): Promise<NotificationRecord | null> {
    const result = await pool.query<NotificationRow>(
      `
        SELECT
          id,
          user_id,
          notification_type,
          channel,
          title,
          body,
          payload,
          processing_status,
          delivery_status,
          provider,
          provider_message_id,
          failure_reason,
          attempt_count,
          idempotency_key,
          created_at,
          processed_at,
          delivered_at,
          failed_at,
          updated_at
        FROM notifications
        WHERE id = $1
      `,
      [id],
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return mapNotificationRow(row);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<NotificationRecord | null> {
    const result = await pool.query<NotificationRow>(
      `
        SELECT
          id,
          user_id,
          notification_type,
          channel,
          title,
          body,
          payload,
          processing_status,
          delivery_status,
          provider,
          provider_message_id,
          failure_reason,
          attempt_count,
          idempotency_key,
          created_at,
          processed_at,
          delivered_at,
          failed_at,
          updated_at
        FROM notifications
        WHERE idempotency_key = $1
      `,
      [idempotencyKey],
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return mapNotificationRow(row);
  }

  async markProcessing(id: string): Promise<NotificationRecord> {
    const result = await pool.query<NotificationRow>(
      `
        UPDATE notifications
        SET
          processing_status = 'PROCESSING',
          attempt_count = attempt_count + 1
        WHERE id = $1
        RETURNING
          id,
          user_id,
          notification_type,
          channel,
          title,
          body,
          payload,
          processing_status,
          delivery_status,
          provider,
          provider_message_id,
          failure_reason,
          attempt_count,
          idempotency_key,
          created_at,
          processed_at,
          delivered_at,
          failed_at,
          updated_at
      `,
      [id],
    );

    return mapFirstNotificationRow(result.rows[0]);
  }

  async markSent(id: string, providerMessageId?: string): Promise<NotificationRecord> {
    const result = await pool.query<NotificationRow>(
      `
        UPDATE notifications
        SET
          delivery_status = 'SENT',
          provider_message_id = COALESCE(
            $2,
            provider_message_id
          )
        WHERE id = $1
        RETURNING
          id,
          user_id,
          notification_type,
          channel,
          title,
          body,
          payload,
          processing_status,
          delivery_status,
          provider,
          provider_message_id,
          failure_reason,
          attempt_count,
          idempotency_key,
          created_at,
          processed_at,
          delivered_at,
          failed_at,
          updated_at
      `,
      [id, providerMessageId ?? null],
    );

    return mapFirstNotificationRow(result.rows[0]);
  }

  async markDelivered(id: string): Promise<NotificationRecord> {
    const result = await pool.query<NotificationRow>(
      `
        UPDATE notifications
        SET
          delivery_status = 'DELIVERED',
          delivered_at = COALESCE(
            delivered_at,
            NOW()
          )
        WHERE id = $1
        RETURNING
          id,
          user_id,
          notification_type,
          channel,
          title,
          body,
          payload,
          processing_status,
          delivery_status,
          provider,
          provider_message_id,
          failure_reason,
          attempt_count,
          idempotency_key,
          created_at,
          processed_at,
          delivered_at,
          failed_at,
          updated_at
      `,
      [id],
    );

    return mapFirstNotificationRow(result.rows[0]);
  }

  async markProcessed(id: string): Promise<NotificationRecord> {
    const result = await pool.query<NotificationRow>(
      `
        UPDATE notifications
        SET
          processing_status = 'PROCESSED',
          processed_at = COALESCE(
            processed_at,
            NOW()
          )
        WHERE id = $1
        RETURNING
          id,
          user_id,
          notification_type,
          channel,
          title,
          body,
          payload,
          processing_status,
          delivery_status,
          provider,
          provider_message_id,
          failure_reason,
          attempt_count,
          idempotency_key,
          created_at,
          processed_at,
          delivered_at,
          failed_at,
          updated_at
      `,
      [id],
    );

    return mapFirstNotificationRow(result.rows[0]);
  }

  async markFailed(id: string, failureReason: string): Promise<NotificationRecord> {
    const result = await pool.query<NotificationRow>(
      `
        UPDATE notifications
        SET
          processing_status = 'FAILED',
          delivery_status = 'FAILED',
          failure_reason = $2,
          failed_at = COALESCE(
            failed_at,
            NOW()
          )
        WHERE id = $1
        RETURNING
          id,
          user_id,
          notification_type,
          channel,
          title,
          body,
          payload,
          processing_status,
          delivery_status,
          provider,
          provider_message_id,
          failure_reason,
          attempt_count,
          idempotency_key,
          created_at,
          processed_at,
          delivered_at,
          failed_at,
          updated_at
      `,
      [id, failureReason],
    );

    return mapFirstNotificationRow(result.rows[0]);
  }
}
