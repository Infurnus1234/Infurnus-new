import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { randomInt, randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { env } from '../../../config/env.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { createAuthController } from '../controllers/auth.controller.js';
import { createAuthRouter } from '../routes/auth.routes.js';
import { DevOtpProvider } from '../providers/dev-otp.provider.js';
import { resetAuthTestRateLimits } from './reset-auth-rate-limits.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireAdminOrSuperAdmin } from '../middleware/authorization.middleware.js';
import { signAccessToken, verifyAccessToken } from '../utils/jwt.js';
import { hashPassword } from '../utils/password.js';
import { createManagedDriverRouter } from '../../providers/routes/managed-driver.routes.js';
import { ManagedDriverRepository } from '../../providers/repositories/managed-driver.repository.js';
import { fixture, actor } from '../../providers/tests/fleet-workflow-fixture.js';
import { RoleEnrolmentRepository } from '../../providers/repositories/role-enrolment.repository.js';
import { createRoleEnrolmentRouter } from '../../providers/routes/role-enrolment.routes.js';

// Actual HTTP, SQL, JWT and challenge guards; only delivery is a local fixture.
describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Fleet-provisioned contact ownership and OTP-only roles',
  () => {
    const repo = new ManagedDriverRepository(pool);
    const app = express();
    app.use(express.json(), cookieParser());
    app.use('/auth', createAuthRouter(createAuthController(new DevOtpProvider())));
    app.use('/provider', requireAuth, createManagedDriverRouter(repo));
    app.use('/provider', requireAuth, createRoleEnrolmentRouter(new RoleEnrolmentRepository(pool)));
    app.get('/admin-check', requireAuth, requireAdminOrSuperAdmin(), (_req, res) =>
      res.sendStatus(204),
    );
    app.use(errorMiddleware);
    beforeAll(() => {
      if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
        throw Error('Disposable local database required');
    });
    beforeEach(resetAuthTestRateLimits);
    const email = () => randomUUID() + '@example.invalid';
    const phone = () => '+91' + randomInt(6000000000, 9999999999);
    const profile = () => ({
      firstName: 'TEST_SAMPLE',
      lastName: 'Provisioned',
      licenseNumber: 'TEST-' + randomUUID(),
      licenseExpiry: '2090-01-01',
    });
    const bearer = async (id: string, role = 'fleet_owner') =>
      'Bearer ' + (await signAccessToken({ sub: id, role, type: 'access' }));
    async function provision(contacts: Record<string, string>) {
      const f = await fixture();
      const payload: Record<string, string> = { ...profile(), ...contacts };
      const response = await request(app)
        .post('/provider/managed-drivers')
        .set('Authorization', await bearer(f.owner))
        .send(payload);
      expect(response.status).toBe(201);
      expect(response.body.data.accountOrigin).toBe('fleet_provisioned');
      return {
        ...f,
        payload,
        created: response.body.data as { userId: string; profileId: string },
      };
    }
    async function login(userId: string, contact: Record<string, string>) {
      const response = await request(app)
        .post('/auth/login')
        .send({ ...contact, role: 'driver' });
      expect(response.status).toBe(200);
      expect(response.body.data.accessToken).toBeUndefined();
      expect(
        (
          await pool.query('SELECT id FROM login_challenges WHERE id=$1 AND user_id=$2', [
            response.body.data.challengeId,
            userId,
          ])
        ).rowCount,
      ).toBe(1);
      return response.body.data.challengeId as string;
    }
    it.each(['phone', 'email'])(
      'verifies a Fleet-created %s account while the saved business is pending, without approving or duplicating anything',
      async (channel) => {
        const contact = channel === 'phone' ? phone() : email();
        const f = await provision({ [channel]: contact });
        await pool.query("UPDATE partners SET approval_status='under_review' WHERE id=$1", [
          f.partner,
        ]);
        const challengeId = await login(f.created.userId, { [channel]: contact });
        const verified = await request(app)
          .post('/auth/login/verify')
          .send({ challengeId, otp: '123456' });
        expect(verified.status).toBe(200);
        expect(verified.body.data.userId).toBe(f.created.userId);
        const state = (
          await pool.query(
            `SELECT u.phone_verified,u.email_verified,dp.id,dp.verification_status,
          dp.active_vehicle_id,p.approval_status,(SELECT count(*)::int FROM driver_profiles WHERE user_id=u.id) profiles
          FROM users u JOIN driver_profiles dp ON dp.user_id=u.id
          JOIN fleet_managed_driver_accounts m ON m.driver_user_id=u.id JOIN partners p ON p.id=m.partner_id WHERE u.id=$1`,
            [f.created.userId],
          )
        ).rows[0];
        expect(state.id).toBe(f.created.profileId);
        expect(state.profiles).toBe(1);
        expect(state.verification_status).toBe('pending');
        expect(state.approval_status).toBe('under_review');
        expect(state.active_vehicle_id).toBeNull();
        expect(state[channel === 'phone' ? 'phone_verified' : 'email_verified']).toBe(true);
      },
    );
    it('does not register a second Driver when a Fleet-created contact uses Sign Up, then logs into the original account', async () => {
      const contact = phone(),
        f = await provision({ phone: contact });
      const signup = await request(app)
        .post('/auth/signup')
        .send({ ...profile(), phone: contact, role: 'driver' });
      expect(signup.status).toBe(201); // Preserve the existing anti-enumeration envelope.
      expect(
        (await pool.query('SELECT 1 FROM pending_signups WHERE id=$1', [signup.body.data.signupId]))
          .rowCount,
      ).toBe(0);
      expect(
        (
          await request(app)
            .post('/auth/signup/verify')
            .send({ signupId: signup.body.data.signupId, otp: '123456' })
        ).status,
      ).toBe(400);
      const challengeId = await login(f.created.userId, { phone: contact });
      const authenticated = await request(app)
        .post('/auth/login/verify')
        .send({ challengeId, otp: '123456' });
      expect(authenticated.status).toBe(200);
      expect(authenticated.body.data.userId).toBe(f.created.userId);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM users WHERE ltrim(phone,'+')=ltrim($1,'+') AND role='driver'",
            [contact],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it('logs into the same Fleet-created account after Driver approval without changing its approval or creating another profile', async () => {
      const contact = phone(),
        f = await provision({ phone: contact });
      await pool.query(
        "UPDATE driver_profiles SET verification_status='approved',verified_by=$2,verified_at=NOW() WHERE id=$1",
        [f.created.profileId, f.admin],
      );
      const challengeId = await login(f.created.userId, { phone: contact });
      const response = await request(app)
        .post('/auth/login/verify')
        .send({ challengeId, otp: '123456' });
      expect(response.status).toBe(200);
      expect(response.body.data.userId).toBe(f.created.userId);
      const profiles = (
        await pool.query('SELECT id,verification_status FROM driver_profiles WHERE user_id=$1', [
          f.created.userId,
        ])
      ).rows;
      expect(profiles).toEqual([{ id: f.created.profileId, verification_status: 'approved' }]);
    });
    it('invites a phone-only existing Driver over HTTP and requires their consent before reusing the account/profile', async () => {
      const f = await fixture(),
        existing = await actor('driver'),
        contact = phone();
      await pool.query('UPDATE users SET email=NULL,phone=$2,phone_verified=TRUE WHERE id=$1', [
        existing,
        contact,
      ]);
      const input = { ...profile(), phone: contact };
      const saved = (
        await pool.query(
          'INSERT INTO driver_profiles(user_id,license_number,license_expiry) VALUES($1,$2,$3) RETURNING id',
          [existing, input.licenseNumber, input.licenseExpiry],
        )
      ).rows[0];
      await expect(repo.create(f.owner, 'fleet_owner', input)).rejects.toMatchObject({
        code: 'DRIVER_CONSENT_REQUIRED',
      });
      const invited = await request(app)
        .post('/provider/fleet-drivers')
        .set('Authorization', await bearer(f.owner))
        .send({ phone: contact });
      expect(invited.status, invited.text).toBe(201);
      expect(invited.body.data.driverUserId).toBe(existing);
      expect(
        (
          await request(app)
            .post('/provider/fleet-drivers')
            .set('Authorization', await bearer(f.owner))
            .send({ phone: contact, email: email() })
        ).status,
      ).toBe(400);
      const path = '/provider/fleet-invitations/' + invited.body.data.id + '/accept';
      expect(
        (
          await request(app)
            .post(path)
            .set('Authorization', await bearer(f.driver, 'driver'))
            .send({})
        ).status,
      ).toBe(409);
      const accepted = await request(app)
        .post(path)
        .set('Authorization', await bearer(existing, 'driver'))
        .send({});
      expect(accepted.status, accepted.text).toBe(200);
      expect(accepted.body.data.vehicleAssigned).toBe(false);
      const managed = await repo.create(f.owner, 'fleet_owner', input);
      expect(managed.userId).toBe(existing);
      expect(managed.profileId).toBe(saved.id);
      expect(
        (
          await pool.query('SELECT count(*)::int n FROM driver_profiles WHERE user_id=$1', [
            existing,
          ])
        ).rows[0].n,
      ).toBe(1);
      expect(
        (await pool.query('SELECT 1 FROM partner_drivers WHERE driver_profile_id=$1', [saved.id]))
          .rowCount,
      ).toBe(0);
      const pending = (
        await pool.query(
          'SELECT verification_status,active_vehicle_id FROM driver_profiles WHERE id=$1',
          [saved.id],
        )
      ).rows[0];
      expect(pending).toEqual({ verification_status: 'pending', active_vehicle_id: null });
      const challengeId = await login(existing, { phone: contact });
      const authenticated = await request(app)
        .post('/auth/login/verify')
        .send({ challengeId, otp: '123456' });
      expect(authenticated.status).toBe(200);
      expect(authenticated.body.data.userId).toBe(existing);
    });
    it.each(['phone', 'email', 'both'])(
      'provisions %s, requires OTP, logs into the same profile and preserves pending approvals',
      async (kind) => {
        const contacts = {
          ...(kind !== 'phone' ? { email: email() } : {}),
          ...(kind !== 'email' ? { phone: phone() } : {}),
        };
        const f = await provision(contacts);
        const retry = await request(app)
          .post('/provider/managed-drivers')
          .set('Authorization', await bearer(f.owner))
          .send(f.payload);
        expect(retry.status).toBe(201);
        expect(retry.body.data.userId).toBe(f.created.userId);
        for (const [channel, value] of Object.entries(contacts)) {
          const challengeId = await login(f.created.userId, { [channel]: value });
          const wrong = await request(app)
            .post('/auth/login/verify')
            .send({ challengeId, otp: '000000' });
          expect(wrong.status).toBe(400);
          const verified = await request(app)
            .post('/auth/login/verify')
            .send({ challengeId, otp: '123456' });
          expect(verified.status).toBe(200);
          expect(verified.body.data.userId).toBe(f.created.userId);
          const token = verified.body.data.accessToken;
          expect((await verifyAccessToken(token)).sub).toBe(f.created.userId);
          expect(
            (
              await request(app)
                .post('/auth/change-password')
                .set('Authorization', 'Bearer ' + token)
                .send({
                  currentPassword: 'unused',
                  newPassword: 'SomeOtherPassword123!',
                  confirmPassword: 'SomeOtherPassword123!',
                })
            ).status,
          ).toBe(403);
          expect(
            (
              await request(app)
                .get('/admin-check')
                .set('Authorization', 'Bearer ' + token)
            ).status,
          ).toBe(403);
          expect(
            (
              await request(app)
                .post('/provider/managed-drivers')
                .set('Authorization', 'Bearer ' + token)
                .send({ ...profile(), email: email() })
            ).status,
          ).toBe(403);
          expect(
            (await request(app).post('/auth/login/verify').send({ challengeId, otp: '123456' }))
              .status,
          ).toBe(400);
        }
        const saved = (
          await pool.query(
            'SELECT u.email_verified,u.phone_verified,dp.verification_status,dp.active_vehicle_id,(SELECT count(*)::int FROM driver_profiles x WHERE x.user_id=u.id) AS profiles FROM users u JOIN driver_profiles dp ON dp.user_id=u.id WHERE u.id=$1',
            [f.created.userId],
          )
        ).rows[0];
        expect(saved.email_verified).toBe(Boolean(contacts.email));
        expect(saved.phone_verified).toBe(Boolean(contacts.phone));
        expect(saved.verification_status).toBe('pending');
        expect(saved.active_vehicle_id).toBeNull();
        expect(saved.profiles).toBe(1);
        expect(
          (
            await pool.query(
              'SELECT partner_id FROM fleet_managed_driver_accounts WHERE driver_user_id=$1',
              [f.created.userId],
            )
          ).rows[0].partner_id,
        ).toBe(f.partner);
        expect(
          (await pool.query('SELECT id FROM user_credentials WHERE user_id=$1', [f.created.userId]))
            .rowCount,
        ).toBe(0);
      },
    );
    it.each([
      {},
      { email: ' ' },
      { phone: 'not-a-phone' },
      { email: 'bad' },
      { phone: '+123' },
      { phone: '+91abc9876543210' },
    ])('rejects missing/invalid contacts %j', async (contacts) => {
      const f = await fixture();
      expect(
        (
          await request(app)
            .post('/provider/managed-drivers')
            .set('Authorization', await bearer(f.owner))
            .send({ ...profile(), ...contacts })
        ).status,
      ).toBe(400);
    });
    it('normalizes both contacts and serializes duplicate concurrent provisioning', async () => {
      const e = email(),
        p = phone();
      const f = await fixture();
      const input = {
        ...profile(),
        email: ' ' + e.toUpperCase() + ' ',
        phone: p.slice(0, 3) + ' ' + p.slice(3),
      };
      const responses = await Promise.all(
        Array.from({ length: 4 }, async () =>
          request(app)
            .post('/provider/managed-drivers')
            .set('Authorization', await bearer(f.owner))
            .send(input),
        ),
      );
      expect(responses.every((r) => r.status === 201)).toBe(true);
      expect(new Set(responses.map((r) => r.body.data.userId)).size).toBe(1);
      const saved = (
        await pool.query('SELECT email,phone FROM users WHERE id=$1', [
          responses[0]!.body.data.userId,
        ])
      ).rows[0];
      expect(saved).toEqual({ email: e, phone: p });
    });
    it('rejects contacts belonging to different accounts and cannot link another fleet', async () => {
      const a = await provision({ email: email() }),
        b = await provision({ phone: phone() });
      const result = await request(app)
        .post('/provider/managed-drivers')
        .set('Authorization', await bearer(a.owner))
        .send({ ...profile(), email: a.payload.email, phone: b.payload.phone });
      expect(result.status).toBe(409);
      expect(
        (
          await request(app)
            .get('/provider/managed-drivers/' + a.created.userId)
            .set('Authorization', await bearer(b.owner))
        ).status,
      ).toBe(404);
    });
    it.each(['suspended', 'banned'])(
      'denies %s managed accounts before sending or creating a session',
      async (status) => {
        const e = email(),
          f = await provision({ email: e });
        await pool.query('UPDATE users SET status=$2 WHERE id=$1', [f.created.userId, status]);
        expect(
          (await request(app).post('/auth/login').send({ email: e, role: 'driver' })).status,
        ).toBe(401);
        expect(
          (await pool.query('SELECT id FROM refresh_tokens WHERE user_id=$1', [f.created.userId]))
            .rowCount,
        ).toBe(0);
      },
    );
    it.each(['contact', 'fleet', 'account', 'owner'])(
      'rejects a %s change after OTP issuance without verifying contact or consuming the challenge',
      async (change) => {
        const e = email(),
          f = await provision({ email: e });
        const challengeId = await login(f.created.userId, { email: e });
        if (change === 'contact')
          await pool.query('UPDATE users SET email=$2 WHERE id=$1', [f.created.userId, email()]);
        if (change === 'fleet')
          await pool.query(
            "UPDATE fleet_managed_driver_accounts SET status='INACTIVE' WHERE driver_user_id=$1",
            [f.created.userId],
          );
        if (change === 'account')
          await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [f.created.userId]);
        if (change === 'owner')
          await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [f.owner]);
        expect(
          (await request(app).post('/auth/login/verify').send({ challengeId, otp: '123456' }))
            .status,
        ).toBeGreaterThanOrEqual(400);
        expect(
          (await pool.query('SELECT email_verified FROM users WHERE id=$1', [f.created.userId]))
            .rows[0].email_verified,
        ).toBe(false);
        expect(
          (await pool.query('SELECT id FROM refresh_tokens WHERE user_id=$1', [f.created.userId]))
            .rowCount,
        ).toBe(0);
      },
    );
    it('enforces expiry, resend cooldown and attempt limits on a provisioned first login', async () => {
      const e = email(),
        f = await provision({ email: e });
      const challengeId = await login(f.created.userId, { email: e });
      expect((await request(app).post('/auth/login/resend').send({ challengeId })).status).toBe(
        429,
      );
      for (let i = 0; i < env.AUTH_OTP_MAX_ATTEMPTS; i++)
        await request(app).post('/auth/login/verify').send({ challengeId, otp: '000000' });
      expect(
        (await request(app).post('/auth/login/verify').send({ challengeId, otp: '123456' })).status,
      ).toBe(429);
      await pool.query(
        "UPDATE login_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
        [challengeId],
      );
      expect(
        (await request(app).post('/auth/login/verify').send({ challengeId, otp: '123456' })).status,
      ).toBe(400);
    });
    it('requires explicit account selection for shared provider contacts and retains existing consent', async () => {
      const f = await fixture();
      const e = (await pool.query('SELECT email FROM users WHERE id=$1', [f.driver])).rows[0].email;
      const combined = await actor('driver_fleet_owner');
      await pool.query('UPDATE users SET email=$2 WHERE id=$1', [combined, e]);
      const input = { ...profile(), email: e };
      await expect(repo.create(f.owner, 'fleet_owner', input)).rejects.toMatchObject({
        code: 'DRIVER_ACCOUNT_REQUIRED',
      });
      const selected = await repo.create(f.owner, 'fleet_owner', {
        ...input,
        driverUserId: f.driver,
      });
      expect(selected.userId).toBe(f.driver);
      expect(selected.accountOrigin).toBe('self_registered');
      expect(
        (await pool.query('SELECT role FROM users WHERE id=$1', [combined])).rows[0].role,
      ).toBe('driver_fleet_owner');
    });
    it('does not promote a legacy unverified secondary contact into a provisioned contact', async () => {
      const id = await actor('driver');
      const e = (await pool.query('SELECT email FROM users WHERE id=$1', [id])).rows[0].email;
      const response = await request(app).post('/auth/login').send({ email: e, role: 'driver' });
      expect(response.status).toBe(200);
      expect(
        (await pool.query('SELECT id FROM login_challenges WHERE user_id=$1', [id])).rowCount,
      ).toBe(0);
    });
    it.each(['customer', 'driver', 'fleet_owner', 'driver_fleet_owner'])(
      '%s rejects password payloads but can request OTP with a verified contact',
      async (role) => {
        const id = await actor(role),
          e = email();
        await pool.query('UPDATE users SET email=$2,email_verified=TRUE WHERE id=$1', [id, e]);
        const rejected = await request(app)
          .post('/auth/login')
          .send({ email: e, role, password: 'unused-historical-password' });
        expect(rejected.status).toBe(400);
        expect(rejected.body.error.code).toBe('PASSWORD_LOGIN_NOT_ALLOWED');
        expect((await request(app).post('/auth/login').send({ email: e, role })).status).toBe(200);
        expect(
          (
            await request(app)
              .post('/auth/admin/login')
              .send({ email: e, role, password: 'unused-historical-password' })
          ).status,
        ).toBeGreaterThanOrEqual(400);
      },
    );
    it.each(['admin', 'super_admin'])(
      '%s retains password authentication and role separation',
      async (role) => {
        const id = await actor(role),
          e = email();
        await pool.query('UPDATE users SET email=$2,email_verified=TRUE WHERE id=$1', [id, e]);
        const password = 'Disposable-admin-pass-2026!';
        await pool.query('INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)', [
          id,
          await hashPassword(password),
        ]);
        expect(
          (await request(app).post('/auth/admin/login').send({ email: e, password: 'incorrect' }))
            .status,
        ).toBe(401);
        const result = await request(app).post('/auth/admin/login').send({ email: e, password });
        expect(result.status).toBe(200);
        expect(
          (
            await request(app)
              .get('/admin-check')
              .set('Authorization', 'Bearer ' + result.body.data.accessToken)
          ).status,
        ).toBe(204);
        expect((await request(app).post('/auth/login').send({ email: e, role })).status).toBe(401);
      },
    );
  },
);
