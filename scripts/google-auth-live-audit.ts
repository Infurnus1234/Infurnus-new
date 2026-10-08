import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

const tokenPath = process.argv[2];
if (
  !tokenPath ||
  process.env.NODE_ENV !== 'test' ||
  new URL(process.env.DATABASE_URL ?? '').port !== '5434'
)
  throw new Error('A token file and isolated test database on port 5434 are required');
const local = parse(readFileSync('.env'));
for (const key of ['GOOGLE_WEB_CLIENT_ID', 'GOOGLE_ANDROID_CLIENT_ID'])
  if (local[key]) process.env[key] = local[key];
const { GoogleIdentityProvider } =
  await import('../src/modules/auth/providers/google-identity.provider.js');
const { createAuthController } = await import('../src/modules/auth/controllers/auth.controller.js');
const { createAuthRouter } = await import('../src/modules/auth/routes/auth.routes.js');
const { errorMiddleware } = await import('../src/common/middleware/error.middleware.js');
const { pool } = await import('../src/infrastructure/database/postgres.js');
const { verifyAccessToken } = await import('../src/modules/auth/utils/jwt.js');
const token = readFileSync(tokenPath, 'utf8').trim();
let createdId: string | undefined;
try {
  const identity = await new GoogleIdentityProvider().verify(token);
  const before = await pool.query('SELECT id FROM users WHERE LOWER(email)=$1', [identity.email]);
  const linkedBefore = await pool.query(
    "SELECT user_id FROM auth_external_identities WHERE provider='GOOGLE' AND provider_subject=$1",
    [identity.subject],
  );
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', createAuthRouter(createAuthController()));
  app.use(errorMiddleware);
  const response = await request(app).post('/auth/google').send({ idToken: token });
  if (response.status === 200 && !before.rowCount && !linkedBefore.rowCount)
    createdId = response.body.data.userId;
  if (response.status !== 200) process.exitCode = 1;
  let jwtVerified = false,
    sessionStored = false;
  if (response.status === 200) {
    const jwt = await verifyAccessToken(response.body.data.accessToken);
    jwtVerified = jwt.sub === response.body.data.userId;
    sessionStored = Boolean(
      (
        await pool.query('SELECT id FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL', [
          jwt.sub,
        ])
      ).rowCount,
    );
  }
  console.log(
    JSON.stringify({
      googleIdentityVerified: true,
      httpStatus: response.status,
      errorCode: response.body.error?.code,
      jwtVerified,
      sessionStored,
      cookiesIssued: Boolean(response.headers['set-cookie']),
      inboxNotApplicable: true,
    }),
  );
} catch {
  console.log(
    JSON.stringify({
      googleIdentityVerified: false,
      result:
        'NOT VERIFIED; inspect configuration, token validity and provider reachability without logging the token',
    }),
  );
  process.exitCode = 1;
} finally {
  if (createdId) {
    await pool.query('DELETE FROM refresh_tokens WHERE user_id=$1', [createdId]);
    await pool.query('DELETE FROM users WHERE id=$1', [createdId]);
  }
  await pool.end();
}
