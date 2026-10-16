import { Worker, type Job } from 'bullmq';
import { env } from '../../config/env.js';
import { getFirebaseMessaging } from '../firebase/firebase.admin.js';
import { PostgresDeviceTokenRepository } from '../../modules/notifications/device-tokens/repositories/device-token.repository.js';
import { PostgresNotificationRepository } from '../../modules/notifications/repositories/notification.repository.js';
import type { NotificationJobData } from './notification.queue.js';
import type { SendResponse } from 'firebase-admin/messaging';

const deviceTokenRepository = new PostgresDeviceTokenRepository();
const notificationRepository = new PostgresNotificationRepository();

export const notificationWorker = new Worker<NotificationJobData>(
  env.NOTIFICATION_QUEUE_NAME,
  async (job: Job<NotificationJobData>) => {
    const { notificationId, userId, title, body, data } = job.data;
    const messaging = getFirebaseMessaging();

    if (!messaging) {
      console.info(JSON.stringify({ event: 'fcm_skipped_not_configured', notificationId }));
      return;
    }

    const activeDevices = await deviceTokenRepository.findActiveByUserId(userId);
    if (!activeDevices.length) {
      console.info(JSON.stringify({ event: 'no_active_devices_for_user', userId, notificationId }));
      await notificationRepository.markFailed(notificationId, 'No active device tokens');
      return;
    }

    const tokens = activeDevices.map((d) => d.fcmToken);

    try {
      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: data ?? {},
      });

      let delivered = false;
      await Promise.all(
        response.responses.map(async (resp: SendResponse, idx: number) => {
          if (resp.success) {
            delivered = true;
          } else {
            const errorCode = resp.error?.code;
            if (
              errorCode === 'messaging/registration-token-not-registered' ||
              errorCode === 'messaging/invalid-registration-token'
            ) {
              await deviceTokenRepository.deactivateByFcmToken(tokens[idx]!);
            }
          }
        }),
      );

      if (delivered) {
        await notificationRepository.markDelivered(notificationId);
      } else {
        await notificationRepository.markFailed(notificationId, 'All FCM tokens failed');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await notificationRepository.markFailed(notificationId, message);
      throw error;
    }
  },
  {
    // Blocking workers need their own unlimited-retry connection; API calls stay bounded.
    connection: {
      url: env.REDIS_URL!,
      maxRetriesPerRequest: null,
      connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
    },
    concurrency: 5,
  },
);

notificationWorker.on('completed', (job) => {
  console.info(JSON.stringify({ event: 'notification_job_completed', jobId: job.id }));
});

notificationWorker.on('failed', (job, err) => {
  console.error(
    JSON.stringify({ event: 'notification_job_failed', jobId: job?.id, error: err.message }),
  );
});
