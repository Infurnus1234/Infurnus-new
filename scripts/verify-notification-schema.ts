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
