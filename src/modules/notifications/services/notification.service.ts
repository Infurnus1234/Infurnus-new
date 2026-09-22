import { createHash, randomUUID } from 'node:crypto';

import { enqueueNotification } from '../../../infrastructure/queue/notification.queue.js';

import { PostgresNotificationRepository } from '../repositories/notification.repository.js';

import { type NotificationPayload, type NotificationType } from '../types/notification.types.js';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;

  /**
   * Business entity associated with this notification.
   *
   * Examples:
   * - rideId
   * - bookingId
   * - rentalId
   * - campaignId
   */
  resourceId: string;

  /**
   * Version of the business event.
   *
   * Example:
   * RIDE_ACCEPTED + ride123 + eventVersion 1
   *
   * If the same event is accidentally emitted again with
   * the same version, it will be treated as a duplicate.
   */
  eventVersion: number;
}

export class NotificationService {
  constructor(private readonly notificationRepository = new PostgresNotificationRepository()) {}

  /**
   * Creates a deterministic idempotency key for a notification.
   *
   * The same:
   * - notification type
   * - recipient
   * - resource
   * - event version
   *
   * will always generate the same key.
   */
  private buildIdempotencyKey(input: CreateNotificationInput): string {
    const rawKey = [input.type, input.userId, input.resourceId, input.eventVersion].join(':');

    return createHash('sha256').update(rawKey).digest('hex');
  }

  async send(input: CreateNotificationInput): Promise<string> {
    const idempotencyKey = this.buildIdempotencyKey(input);

    /**
     * Fast path:
     * If this notification already exists, don't create another
     * database record or enqueue another BullMQ job.
     */
    const existingNotification =
      await this.notificationRepository.findByIdempotencyKey(idempotencyKey);

    if (existingNotification) {
      return existingNotification.id;
    }

    const notificationId = randomUUID();

    const notification: NotificationPayload = {
      notificationId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      ...(input.data !== undefined ? { data: input.data } : {}),
    };

    /**
     * Persist the notification first.
     *
     * PostgreSQL also has a UNIQUE index on idempotency_key,
     * so the database remains the final source of truth for
     * duplicate protection under concurrent requests.
     */
    await this.notificationRepository.create({
      id: notificationId,
      userId: input.userId,
      notificationType: input.type,
      channel: 'PUSH',
      title: input.title,
      body: input.body,
      ...(input.data !== undefined ? { payload: input.data } : {}),
      provider: 'FCM',
      idempotencyKey,
    });

    /**
     * Only enqueue after the notification has been persisted.
     */
    await enqueueNotification(notification);

    return notificationId;
  }
}
