import { Queue, type JobsOptions } from 'bullmq';
import { env } from '../../config/env.js';
import { redis } from '../redis/redis.js';

export interface NotificationJobData {
  notificationId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

const defaultJobOptions: JobsOptions = {
  attempts: env.NOTIFICATION_MAX_ATTEMPTS,

  backoff: {
    type: 'exponential',
    delay: env.NOTIFICATION_BACKOFF_DELAY_MS,
  },

  removeOnComplete: {
    age: 24 * 60 * 60,
    count: 1000,
  },

  removeOnFail: {
    age: 7 * 24 * 60 * 60,
    count: 5000,
  },
};

export const notificationQueue = new Queue<NotificationJobData>(env.NOTIFICATION_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions,
});

export async function enqueueNotification(data: NotificationJobData): Promise<void> {
  await notificationQueue.add(data.type, data, {
    jobId: data.notificationId,
  });
}

export async function closeNotificationQueue(): Promise<void> {
  await notificationQueue.close();
}
