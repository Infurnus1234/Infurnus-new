import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { pool } from '../src/infrastructure/database/postgres.js';
import { createApp } from '../src/app.js';
import { PostgresUserRepository } from '../src/modules/users/repositories/user.repository.js';
import { createConfiguredOtpProvider } from '../src/modules/auth/providers/otp-provider.factory.js';
import { hashPassword } from '../src/modules/auth/utils/password.js';
const evidence = process.argv[2];
if (!evidence || new URL(process.env.DATABASE_URL!).port !== '5434')
  throw new Error('Disposable database and evidence path required');
const email = 'niranjankumarnb45@gmail.com';
const id = randomUUID();
const originalError = console.error,
  originalInfo = console.info;
let providerDiagnostic: Record<string, unknown> | undefined;
try {
  await pool.query(
    "INSERT INTO users(id,first_name,last_name,email,phone,role,email_verified) VALUES($1,'Auth','Audit',$2,$3,'customer',TRUE)",
    [id, email, '+94' + id.replaceAll('-', '').slice(0, 10)],
  );
  await pool.query('INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)', [
    id,
    await hashPassword(randomUUID() + 'Aa1!'),
  ]);
  console.error = (_context, details) => {
    if (details && typeof details === 'object')
      providerDiagnostic = Object.fromEntries(
        ['errorType', 'name', 'code', 'type', 'status', 'statusCode']
          .filter((k) => details[k] !== undefined)
          .map((k) => [k, details[k]]),
      );
  };
  console.info = () => {};
  const provider = createConfiguredOtpProvider(pool);
  const app = createApp(new PostgresUserRepository(pool), provider, {
    enableAuthRateLimiting: false,
    enableAuthCsrfProtection: false,
  });
  const response = await request(app).post('/auth/forgot-password').send({ email });
  const count = await pool.query(
    'SELECT count(*)::int AS count FROM password_reset_challenges WHERE user_id=$1',
    [id],
  );
  const result = {
    email,
    httpStatus: response.status,
    errorCode: response.body.error?.code,
    providerDiagnostic,
    challengeCount: count.rows[0].count,
    inboxDelivery: 'NOT VERIFIED',
  };
  writeFileSync(evidence, JSON.stringify(result, null, 2));
  originalInfo(result);
} finally {
  console.error = originalError;
  console.info = originalInfo;
  await pool.query('DELETE FROM password_reset_challenges WHERE user_id=$1', [id]);
  await pool.query('DELETE FROM user_credentials WHERE user_id=$1', [id]);
  await pool.query('DELETE FROM users WHERE id=$1', [id]);
  await pool.end();
}
