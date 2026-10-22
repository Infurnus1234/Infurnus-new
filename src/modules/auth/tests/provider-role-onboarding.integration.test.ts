import { requireDriverEnrolment } from '../../providers/services/driver-enrolment-gate.js';
import express from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireDriver } from '../middleware/authorization.middleware.js';
import { DriverController } from '../../rides/controllers/driver.controller.js';
import { DriverService } from '../../rides/services/driver.service.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, it, expect } from 'vitest';
import { createApp } from '../../../app.js';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresUserRepository } from '../../users/repositories/user.repository.js';
import { verifyAccessToken } from '../utils/jwt.js';
import type { OtpProvider } from '../providers/otp.provider.js';
const ids: string[] = [],
  pending: string[] = [];
const send = async () => ({
  sessionId: randomUUID(),
  sessionToken: randomUUID(),
  expiresAt: new Date(Date.now() + 300000).toISOString(),
});
const verify = async (_token: string, otp: string) => ({
  verified: otp === '123456',
  attemptsRemaining: null,
});
const provider = {
  sendSmsOtp: send,
  sendEmailOtp: send,
  verifySmsOtp: verify,
  verifyEmailOtp: verify,
  resendSmsOtp: send,
  resendEmailOtp: send,
} as OtpProvider;
const app = createApp(new PostgresUserRepository(pool), provider, {
  enableAuthRateLimiting: false,
});
const driverApp = express();
driverApp.use(express.json());
const controller = new DriverController(
  new DriverService(new PostgresDriverRepository(pool)),
  {} as never,
  {} as never,
);
driverApp.get('/rides/driver/profile', requireAuth, requireDriver(), controller.getProfile);
driverApp.post('/rides/driver/profile', requireAuth, requireDriver(), controller.upsertProfile);
driverApp.patch(
  '/rides/driver/availability',
  requireAuth,
  requireDriver(),
  controller.availability,
);
driverApp.get(
  '/protected-dashboard-data',
  requireAuth,
  requireDriver(),
  requireDriverEnrolment,
  (_req, res) => res.json({ ok: true }),
);
driverApp.use(errorMiddleware);
afterAll(async () => {
  for (const id of ids) {
    await pool.query('DELETE FROM provider_approval_requests WHERE requester_id=$1', [id]);
    await pool.query('DELETE FROM login_challenges WHERE user_id=$1', [id]);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id=$1', [id]);
    await pool.query('DELETE FROM user_credentials WHERE user_id=$1', [id]);
    await pool.query('DELETE FROM driver_profiles WHERE user_id=$1', [id]);
    await pool.query('DELETE FROM partners WHERE user_id=$1', [id]);
    await pool.query('DELETE FROM provider_onboarding WHERE user_id=$1', [id]);
    await pool.query('DELETE FROM users WHERE id=$1', [id]);
  }
  for (const id of pending) await pool.query('DELETE FROM pending_signups WHERE id=$1', [id]);
});
describe('Provider role sign-in and single-page licence enrolment', () => {
  it.each(['driver', 'driver_fleet_owner', 'fleet_owner'])(
    '%s preserves role and credentials without collecting licence twice',
    async (role) => {
      const email = `role-${randomUUID()}@example.com`;
      const payload = {
        firstName: 'Role',
        lastName: 'Fixture',
        email,
        role,
        ...(role !== 'driver'
          ? {
              businessName: 'Fixture Fleet',
              password: 'FixturePassword123!',
              confirmPassword: 'FixturePassword123!',
            }
          : {}),
        ...(role !== 'fleet_owner' ? { onboardingLicencePending: true } : {}),
      };
      const signup = await request(app).post('/auth/signup').send(payload).expect(201);
      pending.push(signup.body.data.signupId);
      const accepted = await request(app)
        .post('/auth/signup/verify')
        .send({ signupId: signup.body.data.signupId, otp: '123456' })
        .expect(200);
      const id = accepted.body.data.userId;
      ids.push(id);
      expect((await verifyAccessToken(accepted.body.data.accessToken)).role).toBe(role);
      expect(
        (
          await pool.query('SELECT role_flow_active FROM provider_onboarding WHERE user_id=$1', [
            id,
          ])
        ).rows[0].role_flow_active,
      ).toBe(true);
      expect(
        (await pool.query('SELECT 1 FROM driver_profiles WHERE user_id=$1', [id])).rowCount,
      ).toBe(0);
      if (role !== 'driver')
        await request(app)
          .post('/auth/login')
          .send({ email, password: 'InfurnusOTPLogin@123' })
          .expect(401);
      const login = await request(app)
        .post('/auth/login')
        .send({ email, ...(role !== 'driver' ? { password: 'FixturePassword123!' } : {}) })
        .expect(200);
      const session = await request(app)
        .post('/auth/login/verify')
        .send({ challengeId: login.body.data.challengeId, otp: '123456' })
        .expect(200);
      const token = session.body.data.accessToken;
      expect((await verifyAccessToken(token)).role).toBe(role);
      if (role !== 'fleet_owner') {
        await request(driverApp)
          .get('/rides/driver/profile')
          .set('Authorization', `Bearer ${token}`)
          .expect(404);
        const profile = await request(driverApp)
          .post('/rides/driver/profile')
          .set('Authorization', `Bearer ${token}`)
          .send({ licenseNumber: 'SINGLE-' + randomUUID(), licenseExpiry: '2099-12-31' })
          .expect(200);
        expect(profile.body.data.verificationStatus).toBe('pending');
        await request(driverApp)
          .patch('/rides/driver/availability')
          .set('Authorization', `Bearer ${token}`)
          .send({ status: 'available' })
          .expect(403);
      } else {
        await request(driverApp)
          .get('/rides/driver/profile')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
        expect((await pool.query('SELECT 1 FROM partners WHERE user_id=$1', [id])).rowCount).toBe(
          1,
        );
      }
    },
  );
  it('legacy signup still requires licence and rejects enrolment privilege injection', async () => {
    const body = {
      firstName: 'Legacy',
      lastName: 'Fixture',
      email: `legacy-${randomUUID()}@example.com`,
      role: 'driver',
    };
    await request(app).post('/auth/signup').send(body).expect(400);
    await request(app)
      .post('/auth/signup')
      .send({ ...body, onboardingLicencePending: true, verificationStatus: 'approved' })
      .expect(400);
  });
  it('legacy signup cannot opt out of mandatory Driver code verification', async () => {
    const signup = await request(app)
      .post('/auth/signup')
      .send({
        firstName: 'Legacy',
        lastName: 'Code Fixture',
        email: `legacy-code-${randomUUID()}@example.com`,
        role: 'driver',
        licenseNumber: 'LEGACY-' + randomUUID(),
        licenseExpiry: '2099-12-31',
      })
      .expect(201);
    pending.push(signup.body.data.signupId);
    const accepted = await request(app)
      .post('/auth/signup/verify')
      .send({ signupId: signup.body.data.signupId, otp: '123456' })
      .expect(200);
    const id = accepted.body.data.userId;
    ids.push(id);
    const state = (
      await pool.query(
        'SELECT role_flow_active,driver_code_verified_at FROM provider_onboarding WHERE user_id=$1',
        [id],
      )
    ).rows[0];
    expect(state.role_flow_active).toBe(true);
    expect(state.driver_code_verified_at).toBe(null);
    await request(driverApp)
      .get('/protected-dashboard-data')
      .set('Authorization', 'Bearer ' + accepted.body.data.accessToken)
      .expect(403);
  });
});
