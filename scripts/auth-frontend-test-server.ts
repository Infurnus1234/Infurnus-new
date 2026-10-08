import { createApp } from '../src/app.js';
import { pool } from '../src/infrastructure/database/postgres.js';
import { PostgresUserRepository } from '../src/modules/users/repositories/user.repository.js';
import { DevOtpProvider } from '../src/modules/auth/providers/dev-otp.provider.js';

// Test harness only. Never imported by production server composition.
if (process.env.NODE_ENV !== 'test' || new URL(process.env.DATABASE_URL!).port !== '5434') {
  throw new Error('This harness requires the disposable test database');
}
const prefix = process.argv[2];
if (!prefix || !/^frontend-auth-[a-f0-9]+$/.test(prefix))
  throw new Error('Unique fixture prefix required');
const app = createApp(new PostgresUserRepository(pool), new DevOtpProvider());
app.post('/__auth_test_shutdown', async (_req, res) => {
  const users = await pool.query<{ id: string }>('SELECT id FROM users WHERE email=$1', [
    prefix + '@example.com',
  ]);
  const ids = users.rows.map((row) => row.id);
  for (const table of [
    'password_reset_challenges',
    'login_challenges',
    'refresh_tokens',
    'user_credentials',
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::uuid[])`, [ids]);
  }
  await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
  await pool.query('DELETE FROM pending_signups WHERE email=$1', [prefix + '@example.com']);
  res.json({ success: true });
  server.close(() => void pool.end());
});
const server = app.listen(3109, '127.0.0.1', () =>
  console.log('Disposable frontend auth backend ready on 3109'),
);
