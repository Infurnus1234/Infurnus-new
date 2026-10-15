import { requireDisposableAdministrativeDatabase } from './administrative-test-database.js';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { AdminManagementService } from '../services/admin-management.service.js';
import { createAdminManagementRouter } from '../routes/management.routes.js';
import { administrativePermissionGate } from '../middleware/permission.middleware.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { verifyPassword } from '../../auth/utils/password.js';
import { PostgresLoginRepository } from '../../auth/repositories/login.repository.js';
import { LoginService } from '../../auth/services/login.service.js';
import type { LoginChallengeRepository } from '../../auth/repositories/login-challenge.repository.js';
import type { OtpProvider } from '../../auth/providers/otp.provider.js';
describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'real database administrative grants',
  () => {
    const superId = randomUUID(),
      email = `admin-${randomUUID()}@example.invalid`;
    const password = 'Disposable-local-credential-2026!';
    const service = new AdminManagementService(pool);
    const app = express();
    app.use(express.json(), administrativePermissionGate(service));
    app.use('/admin/access', createAdminManagementRouter(service));
    app.get('/admin/users', (_req, res) =>
      res.json({
        success: true,
        data: { items: [{ id: 'TEST_SAMPLE', email: 'private@example.invalid' }] },
      }),
    );
    app.get('/admin/users/:id', (_req, res) =>
      res.json({ success: true, data: { id: 'TEST_SAMPLE' } }),
    );
    app.get('/partners', (_req, res) =>
      res.json({
        success: true,
        data: {
          items: [
            {
              id: 'TEST_SAMPLE',
              email: 'private@example.invalid',
              documents: [{ id: 'private-file' }],
            },
          ],
        },
      }),
    );
    app.use(errorMiddleware);
    let superToken: string, adminToken: string, adminId: string;
    beforeAll(async () => {
      requireDisposableAdministrativeDatabase();
      await pool.query(
        "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'TEST_SAMPLE','Super',$2,'super_admin')",
        [superId, `${superId}@example.invalid`],
      );
      superToken = await signAccessToken({ sub: superId, role: 'super_admin', type: 'access' });
    });
    afterAll(async () => {
      await pool.end();
    });
    it('requires authentication and creates a hashed default-deny account', async () => {
      expect((await request(app).post('/admin/access/admins').send({})).status).toBe(401);
      const response = await request(app)
        .post('/admin/access/admins')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ email, password, firstName: 'TEST_SAMPLE', lastName: 'Admin' });
      expect(response.status).toBe(201);
      adminId = response.body.data.id;
      expect(response.body.data.permissions).toEqual([]);
      expect(JSON.stringify(response.body)).not.toContain(password);
      const row = await pool.query('SELECT password_hash FROM user_credentials WHERE user_id=$1', [
        adminId,
      ]);
      expect(row.rows[0].password_hash).not.toBe(password);
      expect(await verifyPassword(row.rows[0].password_hash, password)).toBe(true);
      adminToken = await signAccessToken({ sub: adminId, role: 'admin', type: 'access' });
    });
    it('authenticates the new account through the existing password login service', async () => {
      const login = new LoginService(
        new PostgresLoginRepository(),
        {} as LoginChallengeRepository,
        {} as OtpProvider,
      );
      expect(await login.authenticate({ email, password }, true)).toEqual({
        userId: adminId,
        role: 'admin',
      });
      await expect(
        login.authenticate({ email, password: 'Wrong-local-password' }, true),
      ).rejects.toMatchObject({ statusCode: 401 });
    });
    it('rejects duplicate identity and direct self-escalation', async () => {
      const input = { email, password, firstName: 'TEST_SAMPLE', lastName: 'Admin' };
      expect(
        (
          await request(app)
            .post('/admin/access/admins')
            .set('Authorization', `Bearer ${superToken}`)
            .send(input)
        ).status,
      ).toBe(409);
      expect(
        (
          await request(app)
            .post('/admin/access/admins')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...input, email: 'another@example.invalid' })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .patch(`/admin/access/admins/${adminId}/permissions`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ permissions: ['users.read'], expectedUpdatedAt: 'invalid' })
        ).status,
      ).toBe(403);
    });
    it('persists grants, separates details and redacts ungranted sensitive fields', async () => {
      expect(
        (await request(app).get('/admin/users').set('Authorization', `Bearer ${adminToken}`))
          .status,
      ).toBe(403);
      const before = await service.identity(adminId);
      expect(
        (
          await request(app)
            .patch(`/admin/access/admins/${adminId}/permissions`)
            .set('Authorization', `Bearer ${superToken}`)
            .send({ permissions: ['users.read'], expectedUpdatedAt: before.updatedAt })
        ).status,
      ).toBe(200);
      expect((await new AdminManagementService(pool).identity(adminId)).permissions).toEqual([
        'users.read',
      ]);
      const read = await request(app)
        .get('/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(read.status).toBe(200);
      expect(read.body.data.items[0].email).toBeUndefined();
      expect(
        (
          await request(app)
            .get(`/admin/users/${adminId}`)
            .set('Authorization', `Bearer ${adminToken}`)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .patch(`/admin/access/admins/${adminId}/permissions`)
            .set('Authorization', `Bearer ${superToken}`)
            .send({ permissions: [], expectedUpdatedAt: before.updatedAt })
        ).status,
      ).toBe(409);
    });
    it('redacts native partner routes and requires approval detail grants', async () => {
      const current = await service.identity(adminId);
      await service.update(superId, adminId, {
        permissions: ['partners.read'],
        expectedUpdatedAt: current.updatedAt,
      });
      const response = await request(app)
        .get('/partners')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(response.status).toBe(200);
      expect(response.body.data.items[0].email).toBeUndefined();
      expect(response.body.data.items[0].documents).toEqual([]);
    });
    it('persists Super Admin-only disable/enable and revokes refresh sessions', async () => {
      const before = await service.identity(adminId);
      const endpoint = `/admin/access/admins/${adminId}/status`;
      const input = { status: 'suspended', expectedUpdatedAt: before.updatedAt };
      expect((await request(app).patch(endpoint).send(input)).status).toBe(401);
      expect(
        (
          await request(app)
            .patch(endpoint)
            .set('Authorization', `Bearer ${adminToken}`)
            .send(input)
        ).status,
      ).toBe(403);
      await pool.query(
        `INSERT INTO refresh_tokens(user_id,token_hash,family_id,expires_at) VALUES($1,$2,$3,NOW()+interval '1 day')`,
        [adminId, randomUUID(), randomUUID()],
      );
      expect(
        (
          await request(app)
            .patch(endpoint)
            .set('Authorization', `Bearer ${superToken}`)
            .send({ ...input, status: 'banned' })
        ).status,
      ).toBe(400);
      expect(
        (
          await request(app)
            .patch(endpoint)
            .set('Authorization', `Bearer ${superToken}`)
            .send(input)
        ).status,
      ).toBe(200);
      expect(
        (await new AdminManagementService(pool).list(superId, 1, adminId)).items[0].status,
      ).toBe('suspended');
      expect(
        (
          await pool.query(
            'SELECT id FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL',
            [adminId],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (await request(app).get('/partners').set('Authorization', `Bearer ${adminToken}`)).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .patch(endpoint)
            .set('Authorization', `Bearer ${superToken}`)
            .send({ ...input, status: 'active' })
        ).status,
      ).toBe(409);
      const suspended = (await service.list(superId, 1, adminId)).items[0];
      expect(
        (
          await request(app)
            .patch(endpoint)
            .set('Authorization', `Bearer ${superToken}`)
            .send({ status: 'active', expectedUpdatedAt: suspended.updatedAt })
        ).status,
      ).toBe(200);
      expect(
        (await request(app).get('/partners').set('Authorization', `Bearer ${adminToken}`)).status,
      ).toBe(200);
      expect(
        (
          await pool.query(
            'SELECT id FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL',
            [adminId],
          )
        ).rowCount,
      ).toBe(0);
      const owner = await service.identity(superId);
      await expect(
        service.setStatus(superId, superId, {
          status: 'suspended',
          expectedUpdatedAt: owner.updatedAt,
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(
        (
          await pool.query(
            "SELECT metadata FROM user_history WHERE user_id=$1 AND event_type='ADMIN_STATUS_UPDATED'",
            [adminId],
          )
        ).rowCount,
      ).toBe(2);
    });
    it('revokes existing and freshly signed sessions immediately and protects Super Admin', async () => {
      const current = await service.identity(adminId);
      await service.update(superId, adminId, {
        permissions: [],
        expectedUpdatedAt: current.updatedAt,
      });
      const fresh = await signAccessToken({ sub: adminId, role: 'admin', type: 'access' });
      for (const token of [adminToken, fresh])
        expect(
          (await request(app).get('/admin/users').set('Authorization', `Bearer ${token}`)).status,
        ).toBe(403);
      const owner = await service.identity(superId);
      await expect(
        service.update(superId, superId, { permissions: [], expectedUpdatedAt: owner.updatedAt }),
      ).rejects.toMatchObject({ statusCode: 403 });
      await pool.query("UPDATE users SET role='admin' WHERE id=$1", [superId]);
      expect(
        (
          await request(app)
            .get('/admin/access/admins')
            .set('Authorization', `Bearer ${superToken}`)
        ).status,
      ).toBe(403);
    });
  },
);
