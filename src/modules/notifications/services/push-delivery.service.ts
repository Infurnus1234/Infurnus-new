import type { NotificationJobData } from '../../../infrastructure/queue/notification.queue.js';
import { PostgresNotificationRepository } from '../repositories/notification.repository.js';
import { PostgresDeviceTokenRepository } from '../device-tokens/repositories/device-token.repository.js';

export interface PushSender {
  send(
    tokens: string[],
    job: NotificationJobData,
  ): Promise<Array<{ success: boolean; messageId?: string; code?: string }>>;
}

/** Provider acceptance is SENT; only an actual device receipt may be DELIVERED. */
export class PushDeliveryService {
  constructor(
    private readonly sender: PushSender,
    private readonly notifications = new PostgresNotificationRepository(),
    private readonly devices = new PostgresDeviceTokenRepository(),
  ) {}

  async deliver(job: NotificationJobData): Promise<void> {
    const record = await this.notifications.findById(job.notificationId);
    if (!record || record.userId !== job.userId) throw new Error('NOTIFICATION_RECORD_MISMATCH');
    if (['SENT', 'DELIVERED'].includes(record.deliveryStatus)) return;
    await this.notifications.markProcessing(job.notificationId);
    if (!(await this.notifications.pushAllowed(job.userId))) {
      await this.notifications.markFailed(job.notificationId, 'PUSH_DISABLED_OR_ACCOUNT_INACTIVE');
      return;
    }
    const expires = job.data?.expiresAt ? Date.parse(job.data.expiresAt) : undefined;
    if (expires !== undefined && (!Number.isFinite(expires) || expires <= Date.now())) {
      await this.notifications.markFailed(job.notificationId, 'OFFER_EXPIRED');
      return;
    }
    const acceptedDevices = new Set(await this.notifications.acceptedDeviceIds(job.notificationId));
    const devices = (await this.devices.findActiveByUserId(job.userId)).filter(
      (device) => !acceptedDevices.has(device.id),
    );
    if (!devices.length && !acceptedDevices.size) {
      await this.notifications.markFailed(job.notificationId, 'NO_ACTIVE_DEVICE');
      return;
    }
    try {
      let accepted = acceptedDevices.size;
      // FCM limits multicast batches to 500 device tokens.
      for (let offset = 0; offset < devices.length; offset += 500) {
        const batch = devices.slice(offset, offset + 500);
        const results = await this.sender.send(
          batch.map((device) => device.fcmToken),
          job,
        );
        let retry = results.length !== batch.length;
        for (let index = 0; index < results.length; index++) {
          const response = results[index]!;
          if (response.success) {
            if (batch[index])
              await this.notifications.recordDeviceAcceptance(
                job.notificationId,
                batch[index]!.id,
                response.messageId,
              );
            accepted++;
            continue;
          }
          if (
            [
              'messaging/registration-token-not-registered',
              'messaging/invalid-registration-token',
            ].includes(response.code ?? '')
          ) {
            // A token may rotate while FCM is responding. Invalidate only the token sent.
            if (batch[index]) await this.devices.deactivateByFcmToken(batch[index]!.fcmToken);
          } else retry = true;
        }
        if (retry) throw new Error('PUSH_PROVIDER_RETRY_REQUIRED');
      }
      if (!accepted) {
        await this.notifications.markFailed(job.notificationId, 'NO_VALID_DEVICE');
        return;
      }
      await this.notifications.markSent(job.notificationId);
      await this.notifications.markProcessed(job.notificationId);
    } catch {
      await this.notifications.markFailed(job.notificationId, 'PUSH_PROVIDER_UNAVAILABLE');
      throw new Error('PUSH_PROVIDER_UNAVAILABLE');
    }
  }
}
