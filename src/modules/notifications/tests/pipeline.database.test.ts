import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { describe, it, expect, vi } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { env } from '../../../config/env.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { createDeviceTokenRouter } from '../device-tokens/routes/device-token.routes.js';
import { PostgresNotificationRepository } from '../repositories/notification.repository.js';
import { PushDeliveryService } from '../services/push-delivery.service.js';
import { createFirebasePushSender } from '../../../infrastructure/firebase/push-sender.js';

describe.runIf(process.env.FCM_AUDIT_DB_TESTS === 'true')(
  'PostgreSQL + BullMQ pipeline, mock FCM boundary',
  () => {
    it('persists token rotation, retries, deduplicates and records SENT separately from device receipt', async () => {
      const user = (
        await pool.query(
          "INSERT INTO users(first_name,last_name,phone,role) VALUES('Push','Fixture',$1,'driver') RETURNING id",
          ['+97' + randomUUID().replaceAll('-', '').slice(0, 10)],
        )
      ).rows[0].id;
      const app = express();
      app.use(express.json());
      app.use('/devices', createDeviceTokenRouter());
      app.use(errorMiddleware);
      const token = await signAccessToken({ sub: user, role: 'driver', type: 'access' });
      const { notificationQueue, closeNotificationQueue } =
        await import('../../../infrastructure/queue/notification.queue.js');
      const { NotificationService } = await import('../services/notification.service.js');
      const connection = new Redis(env.REDIS_URL!, { maxRetriesPerRequest: null });
      const sdk = {
        sendEachForMulticast: vi
          .fn()
          .mockRejectedValueOnce(new Error('fixture outage'))
          .mockResolvedValue({ responses: [{ success: true, messageId: 'fixture-acceptance' }] }),
      };
      const delivery = new PushDeliveryService(createFirebasePushSender(sdk));
      const worker = new Worker(notificationQueue.name, (job) => delivery.deliver(job.data), {
        connection,
      });
      worker.on('error', () => {});
      let id: string | undefined;
      try {
        await request(app)
          .post('/devices')
          .send({ fcmToken: 'fixture', platform: 'ANDROID', deviceId: 'fixture' })
          .expect(401);
        const first = await request(app)
          .post('/devices')
          .set('Authorization', 'Bearer ' + token)
          .send({ fcmToken: 'fixture-old', platform: 'ANDROID', deviceId: 'fixture-install' })
          .expect(200);
        const second = await request(app)
          .post('/devices')
          .set('Authorization', 'Bearer ' + token)
          .send({ fcmToken: 'fixture-rotated', platform: 'ANDROID', deviceId: 'fixture-install' })
          .expect(200);
        expect(second.body.data.id).toBe(first.body.data.id);
        expect(
          (await pool.query('SELECT fcm_token FROM user_devices WHERE user_id=$1', [user])).rows,
        ).toEqual([{ fcm_token: 'fixture-rotated' }]);
        const service = new NotificationService();
        const input = {
          userId: user,
          type: 'ride.created' as const,
          title: 'Fixture offer',
          body: 'Open current ride',
          resourceId: randomUUID(),
          eventVersion: 1,
          data: { rideId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() },
        };
        id = await service.send(input);
        expect(await service.send(input)).toBe(id);
        const repository = new PostgresNotificationRepository();
        let record = await repository.findById(id);
        const until = Date.now() + 10000;
        while (record?.deliveryStatus !== 'SENT' && Date.now() < until) {
          await new Promise((r) => setTimeout(r, 30));
          record = await repository.findById(id);
        }
        expect(record?.deliveryStatus).toBe('SENT');
        expect(record?.deliveredAt).toBeNull();
        expect(sdk.sendEachForMulticast).toHaveBeenCalledTimes(2);
        expect(sdk.sendEachForMulticast.mock.calls[1]![0].tokens).toEqual(['fixture-rotated']);
        expect(await repository.acceptedDeviceIds(id)).toEqual([first.body.data.id]);
        expect(
          (
            await pool.query('SELECT count(*)::int AS n FROM notifications WHERE user_id=$1', [
              user,
            ])
          ).rows[0].n,
        ).toBe(1);
        await delivery.deliver({ notificationId: id, ...input });
        expect(sdk.sendEachForMulticast).toHaveBeenCalledTimes(2);
        await request(app)
          .delete('/devices/' + first.body.data.id)
          .set('Authorization', 'Bearer ' + token)
          .expect(200);
        expect(
          (await pool.query('SELECT is_active FROM user_devices WHERE user_id=$1', [user])).rows[0]
            .is_active,
        ).toBe(false);
      } finally {
        await worker.close();
        await connection.quit();
        if (id) {
          const job = await notificationQueue.getJob(id);
          await job?.remove();
        }
        await closeNotificationQueue();
        const { disconnectRedis } = await import('../../../infrastructure/redis/index.js');
        await disconnectRedis();
        await pool.query('DELETE FROM notifications WHERE user_id=$1', [user]);
        await pool.query('DELETE FROM user_devices WHERE user_id=$1', [user]);
        await pool.query('DELETE FROM users WHERE id=$1', [user]);
      }
    }, 15000);
  },
);
