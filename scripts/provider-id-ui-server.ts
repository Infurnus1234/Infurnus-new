import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/infrastructure/database/postgres.js';
import { PostgresUserRepository } from '../src/modules/users/repositories/user.repository.js';
import { PostgresAdminRepository } from '../src/modules/admin/repositories/admin.repository.js';
import { AdminManagementService } from '../src/modules/admin/services/admin-management.service.js';
import { hashPassword } from '../src/modules/auth/utils/password.js';
import { requireDisposableAdministrativeDatabase } from '../src/modules/admin/tests/administrative-test-database.js';
requireDisposableAdministrativeDatabase();
const superId = (
  await pool.query(
    `INSERT INTO users(first_name,last_name,role) VALUES('Public ID','Test only','super_admin') RETURNING id`,
  )
).rows[0].id;
const password = 'Local-public-id-test-2026!';
const admin = await new AdminManagementService(pool).create(superId, {
  email: randomUUID() + '@example.invalid',
  password,
  firstName: 'Public ID',
  lastName: 'Reviewer',
  permissions: [
    'drivers.read',
    'drivers.detail',
    'partners.read',
    'partners.detail',
    'approvals.read',
    'payments.read',
    'users.read',
  ],
});
await pool.query('UPDATE users SET email_verified=TRUE WHERE id=$1', [admin.id]);
await pool.query('UPDATE user_credentials SET password_hash=$2 WHERE user_id=$1', [
  admin.id,
  await hashPassword(password),
]);
const owner = (
  await pool.query(
    `INSERT INTO users(first_name,last_name,email,role) VALUES('Numeric','Owner',$1,'driver_fleet_owner') RETURNING id`,
    [randomUUID() + '@example.invalid'],
  )
).rows[0].id;
const driver = (
  await pool.query(
    `INSERT INTO driver_profiles(user_id,license_number,license_expiry) VALUES($1,$2,'2099-12-31') RETURNING id`,
    [owner, randomUUID()],
  )
).rows[0].id;
const partner = (
  await pool.query(
    `INSERT INTO partners(user_id,business_name) VALUES($1,'Numeric public identity test fleet') RETURNING id`,
    [owner],
  )
).rows[0].id;
const publicId = (await pool.query('SELECT provider_public_id($1) AS id', [owner])).rows[0].id;
await writeFile(
  'tmp/provider-public-id/ui-fixture.json',
  JSON.stringify({ email: admin.email, password, driver, partner, publicId }),
);
const app = createApp(
  new PostgresUserRepository(pool),
  undefined,
  undefined,
  undefined,
  new PostgresAdminRepository(pool),
);
const server = app.listen(3186, '127.0.0.1', () => console.log('PUBLIC_ID_UI_READY'));
process.on('SIGTERM', () => server.close(() => void pool.end()));
