import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { getFirebaseMessaging } from '../firebase/firebase.admin.js';
import { createFirebasePushSender } from '../firebase/push-sender.js';
import { env } from '../../config/env.js';
import { pool } from '../database/postgres.js';
import { PushDeliveryService } from '../../modules/notifications/services/push-delivery.service.js';
import type { NotificationJobData } from './notification.queue.js';
import { enqueueNotification, closeNotificationQueue } from './notification.queue.js';

if (
  !env.REDIS_URL ||
  !env.FIREBASE_PROJECT_ID ||
  !env.FIREBASE_CLIENT_EMAIL ||
  !env.FIREBASE_PRIVATE_KEY
) {
  throw new Error('Notification worker requires Redis and complete Firebase service configuration');
}
const messaging = getFirebaseMessaging();
if (!messaging) throw new Error('FIREBASE_NOT_CONFIGURED');
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', () => console.warn('Notification worker Redis unavailable'));
const delivery = new PushDeliveryService(createFirebasePushSender(messaging));
export const notificationWorker = new Worker<NotificationJobData>(
  env.NOTIFICATION_QUEUE_NAME,
  async (job) => delivery.deliver(job.data),
  { connection, concurrency: 4 },
);
notificationWorker.on('failed', () =>
  console.warn('Notification delivery attempt failed; inspect queue retry status'),
);
notificationWorker.on('error', () => console.warn('Notification worker unavailable'));
let stopping = false;
let recovering = false;
async function recoverPending() {
  if (recovering || stopping) return;
  recovering = true;
  try {
    const rows = await pool.query<{
      id: string;
      user_id: string;
      notification_type: string;
      title: string | null;
      body: string | null;
      payload: Record<string, string> | null;
    }>(
      `SELECT id,user_id,notification_type,title,body,payload FROM notifications
       WHERE channel='PUSH' AND delivery_status='PENDING' AND
       (processing_status='PENDING' OR (processing_status='PROCESSING' AND updated_at<NOW()-INTERVAL '5 minutes'))
       ORDER BY created_at LIMIT 100`,
    );
    for (const row of rows.rows) {
      await enqueueNotification({
        notificationId: row.id,
        userId: row.user_id,
        type: row.notification_type,
        title: row.title ?? 'INFURNUS',
        body: row.body ?? '',
        ...(row.payload ? { data: row.payload } : {}),
      });
    }
  } catch {
    console.warn('Pending notification recovery unavailable');
  } finally {
    recovering = false;
  }
}
const recovery = setInterval(() => {
  void recoverPending();
}, 30000);
recovery.unref();
void recoverPending();
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(recovery);
  await notificationWorker.close();
  await closeNotificationQueue();
  const { disconnectRedis } = await import('../redis/index.js');
  await disconnectRedis();
  await connection.quit();
  await pool.end();
}
process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
