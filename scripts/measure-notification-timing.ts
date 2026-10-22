import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';

// Never test against the application database. Always create an isolated local database.
const source = new URL(process.env.AUTH_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(source.hostname))
  throw new Error('Local audit PostgreSQL required');
source.port = '5434';
const name = `infurnus_notifications_test_${randomUUID().replaceAll('-', '')}`;
const queueName = `onboarding-timing-${randomUUID()}`;
process.env.NOTIFICATION_QUEUE_NAME = queueName;
const redisSource = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
if (!['localhost', '127.0.0.1', '[::1]'].includes(redisSource.hostname))
  throw new Error('Local Redis required');
process.env.REDIS_URL = redisSource.toString();
if (!/^infurnus_notifications_test_[a-f0-9]{32}$/.test(name))
  throw new Error('Invalid test database name');
const adminUrl = new URL(source);
adminUrl.pathname = '/postgres';
const testUrl = new URL(source);
testUrl.pathname = `/${name}`;
const admin = new Pool({ connectionString: adminUrl.toString() });
let created = false;
let closeTestPool: (() => Promise<void>) | undefined;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  await promisify(execFile)(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/infrastructure/database/run-migrations.ts'],
    { env: { ...process.env, DATABASE_URL: testUrl.toString() }, maxBuffer: 8 * 1024 * 1024 },
  );
  process.env.DATABASE_URL = testUrl.toString();
  const { pool } = await import('../src/infrastructure/database/postgres.js');
  closeTestPool = () => pool.end();
  const { PostgresNotificationRepository } =
    await import('../src/modules/notifications/repositories/notification.repository.js');
  const { PostgresDeviceTokenRepository } =
    await import('../src/modules/notifications/device-tokens/repositories/device-token.repository.js');
  const notifications = new PostgresNotificationRepository();
  const devices = new PostgresDeviceTokenRepository();
  const ids: string[] = [];
  for (let index = 0; index < 2; index++) {
    const row = await pool.query<{ id: string }>(
      "INSERT INTO users(first_name,last_name,email,role,status) VALUES('Notification','Fixture',$1,'driver','active') RETURNING id",
      [`notification-${randomUUID()}@example.invalid`],
    );
    ids.push(row.rows[0]!.id);
  }
  const owner = ids[0]!,
    other = ids[1]!;
  const notification = await notifications.create({
    id: randomUUID(),
    userId: owner,
    notificationType: 'ride.created',
    channel: 'PUSH',
    title: 'Fixture',
    body: 'Fixture',
  });
  assert.equal((await notifications.inbox(other, 25, 0)).items.length, 0);
  assert.equal(await notifications.readInbox(other, notification.id), 0);
  assert.equal((await notifications.inbox(owner, 25, 0)).unreadCount, 1);
  assert.equal(await notifications.readInbox(owner, notification.id), 1);
  assert.equal(await notifications.readInbox(owner, notification.id), 1);
  assert.equal((await notifications.inbox(owner, 25, 0)).unreadCount, 0);
  console.log('PASS: database inbox ownership, unread count and idempotent read state');
  const ownDevice = await devices.register({
    userId: owner,
    fcmToken: `fixture-${randomUUID()}`,
    platform: 'ANDROID',
    deviceId: randomUUID(),
  });
  const otherDevice = await devices.register({
    userId: other,
    fcmToken: `fixture-${randomUUID()}`,
    platform: 'ANDROID',
    deviceId: randomUUID(),
  });
  await notifications.recordDeviceAcceptance(
    notification.id,
    otherDevice.id,
    'fixture-provider-id',
  );
  assert.deepEqual(await notifications.acceptedDeviceIds(notification.id), []);
  await notifications.recordDeviceAcceptance(notification.id, ownDevice.id, 'fixture-provider-id');
  await notifications.recordDeviceAcceptance(notification.id, ownDevice.id, 'fixture-provider-id');
  assert.deepEqual(await notifications.acceptedDeviceIds(notification.id), [ownDevice.id]);
  console.log('PASS: per-device acceptance ownership and duplicate suppression');
  // Real isolated PostgreSQL + Redis/BullMQ, explicitly simulated provider.
  const { Worker, QueueEvents } = await import('bullmq');
  const { Redis } = await import('ioredis');
  const { enqueueNotification, notificationQueue, closeNotificationQueue } =
    await import('../src/infrastructure/queue/notification.queue.js');
  const { PushDeliveryService } =
    await import('../src/modules/notifications/services/push-delivery.service.js');
  const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  const events = new QueueEvents(queueName, { connection });
  let providerResponseAt: string | undefined;
  const delivery = new PushDeliveryService(
    {
      async send(tokens) {
        providerResponseAt = new Date().toISOString();
        return tokens.map(() => ({ success: true, messageId: 'SIMULATED-PROVIDER-ACCEPTANCE' }));
      },
    },
    notifications,
    devices,
  );
  const worker = new Worker(queueName, async (job) => delivery.deliver(job.data), { connection });
  try {
    await events.waitUntilReady();
    await worker.waitUntilReady();
    const clockSampleBefore = Date.now();
    const clockSample = await pool.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    const clockSampleAfter = Date.now();
    const estimatedDbClockOffsetMs =
      clockSample.rows[0]!.now.getTime() - (clockSampleBefore + clockSampleAfter) / 2;
    const eventAt = new Date().toISOString();
    const eventDb = await pool.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    const eventAtDb = eventDb.rows[0]!.now;
    const record = await notifications.create({
      id: randomUUID(),
      userId: owner,
      notificationType: 'ride.created',
      channel: 'PUSH',
      title: 'Local timing fixture',
      body: 'Local timing fixture',
    });
    await enqueueNotification({
      notificationId: record.id,
      userId: owner,
      type: 'ride.created',
      title: 'Fixture',
      body: 'Fixture',
      data: { expiresAt: new Date(Date.now() + 20000).toISOString() },
    });
    const job = await notificationQueue.getJob(record.id);
    assert.ok(job);
    await job.waitUntilFinished(events, 20000);
    const finished = await notificationQueue.getJob(record.id);
    assert.ok(finished?.processedOn);
    assert.ok(finished.finishedOn);
    const saved = await notifications.findById(record.id);
    assert.equal(saved?.deliveryStatus, 'SENT');
    assert.equal(saved?.deliveredAt, null);
    console.log(
      JSON.stringify({
        fixture: true,
        provider: 'SIMULATED � NO FCM REQUEST',
        eventAt,
        recordCreatedAt: record.createdAt.toISOString(),
        queueEnqueuedAt: new Date(job.timestamp).toISOString(),
        processingStartedAt: new Date(finished.processedOn).toISOString(),
        processingFinishedAt: new Date(finished.finishedOn).toISOString(),
        providerResponseAt,
        eventAtDb: eventAtDb.toISOString(),
        eventToRecordDbMs: record.createdAt.getTime() - eventAtDb.getTime(),
        estimatedDbClockOffsetMs,
        clockSampleRoundTripMs: clockSampleAfter - clockSampleBefore,
        crossClockEventToRecordMs: null,
        enqueueToStartMs: finished.processedOn - job.timestamp,
        workerDurationMs: finished.finishedOn - finished.processedOn,
        eventToSimulatedProviderMs: Date.parse(providerResponseAt!) - Date.parse(eventAt),
        clientReceiptAt: null,
        displayAt: null,
        openedAt: null,
      }),
    );
  } finally {
    await worker.close();
    await events.close();
    await notificationQueue.obliterate({ force: true }); // Only this run's random queue.
    await closeNotificationQueue();
    const { disconnectRedis } = await import('../src/infrastructure/redis/index.js');
    await disconnectRedis();
    await connection.quit();
  }
  assert.equal(await notifications.pushAllowed(owner), true);
  await pool.query(
    `INSERT INTO user_preferences(user_id,push_notifications_enabled) VALUES($1,FALSE)
    ON CONFLICT(user_id) DO UPDATE SET push_notifications_enabled=FALSE`,
    [owner],
  );
  assert.equal(await notifications.pushAllowed(owner), false);
  await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [other]);
  assert.equal(await notifications.pushAllowed(other), false);
  console.log('PASS: persisted notification preferences and inactive-account suppression');
} finally {
  await closeTestPool?.();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
