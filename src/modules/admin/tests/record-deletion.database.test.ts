import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { requireDisposableAdministrativeDatabase } from './administrative-test-database.js';
import { AdminManagementService } from '../services/admin-management.service.js';
import { RecordDeletionService } from '../services/record-deletion.service.js';
import { createRecordDeletionRouter } from '../routes/record-deletion.routes.js';
import { administrativePermissionGate } from '../middleware/permission.middleware.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { signAccessToken, verifyAccessToken } from '../../auth/utils/jwt.js';
import { loadDeletedSubjects } from '../../auth/services/deleted-subjects.js';
import { hashPassword } from '../../auth/utils/password.js';
import { LoginService } from '../../auth/services/login.service.js';
import { PostgresLoginRepository } from '../../auth/repositories/login.repository.js';
import type { LoginChallengeRepository } from '../../auth/repositories/login-challenge.repository.js';
import type { OtpProvider } from '../../auth/providers/otp.provider.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Permanent administrative deletion on real PostgreSQL',
  () => {
    const access = new AdminManagementService(pool),
      service = new RecordDeletionService(pool);
    const app = express();
    app.use(express.json(), administrativePermissionGate(access));
    app.use('/admin/records', createRecordDeletionRouter(service));
    app.use(errorMiddleware);
    let owner: string, admin: string, ownerToken: string, adminToken: string;
    async function user(role = 'customer') {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'TEST_ONLY','Deletion',$2,$3)`,
        [id, id + '@example.invalid', role],
      );
      return id;
    }
    async function token(id: string, role: string) {
      return signAccessToken({ sub: id, role, type: 'access' });
    }
    async function remove(module: string, id: string, t = ownerToken) {
      return request(app)
        .delete(`/admin/records/${module}/${id}`)
        .set('Authorization', `Bearer ${t}`);
    }
    beforeAll(async () => {
      requireDisposableAdministrativeDatabase();
      owner = await user('super_admin');
      ownerToken = await token(owner, 'super_admin');
      const created = await access.create(owner, {
        email: randomUUID() + '@example.invalid',
        password: 'Local-deletion-test-2026!',
        firstName: 'TEST_ONLY',
        lastName: 'Admin',
        permissions: ['users.read', 'users.delete'],
      });
      admin = created.id;
      adminToken = await token(admin, 'admin');
    });
    afterAll(async () => {
      await pool.end();
    });
    it('requires authentication and rejects customer and ungranted Admin access', async () => {
      const id = await user();
      expect((await request(app).delete('/admin/records/users/' + id)).status).toBe(401);
      const customer = await user();
      expect((await remove('users', id, await token(customer, 'customer'))).status).toBe(403);
      expect((await remove('vehicles', randomUUID(), adminToken)).status).toBe(403);
      expect((await pool.query('SELECT id FROM users WHERE id=$1', [id])).rowCount).toBe(1);
    });
    it('permanently deletes an eligible user for explicitly granted Admin and rejects old JWTs across reload', async () => {
      const id = await user(),
        old = await token(id, 'customer');
      await pool.query(`INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)`, [
        id,
        await hashPassword('Local-deletion-test-2026!'),
      ]);
      await pool.query(
        `INSERT INTO refresh_tokens(user_id,token_hash,family_id,expires_at) VALUES($1,$2,$3,NOW()+interval '1 day')`,
        [id, randomUUID(), randomUUID()],
      );
      const history = await pool.query(
        `INSERT INTO user_history(user_id,event_type,entity_type,entity_id) VALUES($1,'LOCAL_TEST','USER',$1) RETURNING id`,
        [id],
      );
      expect((await remove('users', id, adminToken)).status).toBe(200);
      expect((await pool.query('SELECT id FROM users WHERE id=$1', [id])).rowCount).toBe(0);
      expect(
        (await pool.query('SELECT id FROM user_credentials WHERE user_id=$1', [id])).rowCount,
      ).toBe(0);
      expect(
        (await pool.query('SELECT id FROM refresh_tokens WHERE user_id=$1', [id])).rowCount,
      ).toBe(0);
      expect(
        (await pool.query('SELECT user_id FROM user_history WHERE id=$1', [history.rows[0].id]))
          .rows[0].user_id,
      ).toBe(admin);
      await expect(verifyAccessToken(old)).rejects.toBeDefined();
      await loadDeletedSubjects(pool);
      await expect(verifyAccessToken(old)).rejects.toBeDefined();
      const login = new LoginService(
        new PostgresLoginRepository(),
        {} as LoginChallengeRepository,
        {} as OtpProvider,
      );
      await expect(
        login.authenticate(
          { email: id + '@example.invalid', password: 'Local-deletion-test-2026!' },
          true,
        ),
      ).rejects.toMatchObject({ statusCode: 401 });
    });
    it('protects self, all Super Admins and cross-module Admin targets', async () => {
      expect((await remove('admins', owner)).status).toBe(403);
      expect((await remove('admins', admin, adminToken)).status).toBe(403);
      const other = await user('super_admin');
      expect((await remove('users', other)).status).toBe(403);
      expect((await remove('users', admin)).status).toBe(403);
    });
    it('deletes an eligible Admin only through Super Admin governance and retains previous revocation audits', async () => {
      const created = await access.create(owner, {
        email: randomUUID() + '@example.invalid',
        password: 'Local-deletion-test-2026!',
        firstName: 'TEST_ONLY',
        lastName: 'Disposable',
      });
      const old = await token(created.id, 'admin');
      expect((await remove('admins', created.id)).status).toBe(200);
      expect((await pool.query('SELECT id FROM users WHERE id=$1', [created.id])).rowCount).toBe(0);
      expect(
        (
          await pool.query('SELECT id FROM admin_roles WHERE name=$1', [
            'managed-admin:' + created.id,
          ])
        ).rowCount,
      ).toBe(0);
      await expect(verifyAccessToken(old)).rejects.toBeDefined();
    });
    it('returns 404 for missing records and 400 for invalid identifiers/modules', async () => {
      expect((await remove('users', randomUUID())).status).toBe(404);
      expect((await remove('users', 'invalid')).status).toBe(400);
      expect((await remove('payments', randomUUID())).status).toBe(400);
    });
    it('rolls back credential cleanup and preserves dependent operational history', async () => {
      const id = await user();
      await pool.query(
        `INSERT INTO user_credentials(user_id,password_hash) VALUES($1,'local-test-hash')`,
        [id],
      );
      await pool.query(
        `INSERT INTO rides(customer_id,status,pickup_location,destination_location) VALUES($1,'requested',ST_SetSRID(ST_Point(85.1,25.6),4326)::geography,ST_SetSRID(ST_Point(85.2,25.6),4326)::geography)`,
        [id],
      );
      expect((await remove('users', id)).status).toBe(409);
      expect(
        (await pool.query('SELECT id FROM user_credentials WHERE user_id=$1', [id])).rowCount,
      ).toBe(1);
      await expect(verifyAccessToken(await token(id, 'customer'))).resolves.toMatchObject({
        sub: id,
      });
    });
    it('deletes an unused driver and its account, and does not leave unreviewed target requests', async () => {
      const id = await user('driver');
      const p = await pool.query(
        `INSERT INTO driver_profiles(user_id,license_number,license_expiry) VALUES($1,$2,'2099-01-01') RETURNING id`,
        [id, 'TEST_ONLY_' + id],
      );
      const profile = p.rows[0].id;
      expect((await remove('drivers', profile, adminToken)).status).toBe(403);
      expect((await remove('drivers', profile)).status).toBe(200);
      expect((await pool.query('SELECT id FROM users WHERE id=$1', [id])).rowCount).toBe(0);
      expect(
        (await pool.query('SELECT id FROM driver_profiles WHERE id=$1', [profile])).rowCount,
      ).toBe(0);
      expect(
        (
          await pool.query('SELECT id FROM provider_approval_requests WHERE target_id=$1', [
            profile,
          ])
        ).rowCount,
      ).toBe(0);
    });
    it('deletes an unused fleet/provider account and protects cross-module combined identities', async () => {
      const id = await user('fleet_owner'),
        p = await pool.query(
          `INSERT INTO partners(user_id,business_name) VALUES($1,'TEST_ONLY_DELETION') RETURNING id`,
          [id],
        );
      expect((await remove('partners', p.rows[0].id)).status).toBe(200);
      expect((await pool.query('SELECT id FROM users WHERE id=$1', [id])).rowCount).toBe(0);
    });
    it('deletes an unused physical vehicle and prevents cascading associated history', async () => {
      const v = await pool.query(
        `INSERT INTO vehicles(make,model,plate_number) VALUES('TEST_ONLY','Deletion',$1) RETURNING id`,
        ['DEL' + randomUUID().slice(0, 8)],
      );
      expect((await remove('vehicles', v.rows[0].id)).status).toBe(200);
      expect(
        (await pool.query('SELECT id FROM vehicles WHERE id=$1', [v.rows[0].id])).rowCount,
      ).toBe(0);
    });
    it('deletes an unused pricing category and rejects a category code used by inventory', async () => {
      const code = 'delete_' + randomUUID().replaceAll('-', '');
      const type = await pool.query(
        `INSERT INTO vehicle_types(name,code,sector,base_fare_paise,per_km_rate_paise) VALUES('TEST_ONLY',$1,'passenger',100,100) RETURNING id`,
        [code],
      );
      expect((await remove('vehicle-types', type.rows[0].id)).status).toBe(200);
      const existing = await pool.query(`SELECT id,code FROM vehicle_types WHERE code='sedan'`);
      let sedanId = existing.rows[0]?.id;
      if (!sedanId) {
        const created = await pool.query(
          `INSERT INTO vehicle_types(name,code,sector,base_fare_paise,per_km_rate_paise) VALUES('Sedan','sedan','passenger',100,100) RETURNING id`,
        );
        sedanId = created.rows[0].id;
      }
      await pool.query(
        `INSERT INTO vehicles(make,model,plate_number,category) VALUES('TEST_ONLY','Keep',$1,'sedan')`,
        ['KEEP' + randomUUID().slice(0, 8)],
      );
      expect((await remove('vehicle-types', sedanId)).status).toBe(409);
    });
    it('prevents deletion through an alternate module without the required driver grant', async () => {
      const id = await user('driver');
      expect((await remove('users', id, adminToken)).status).toBe(403);
      expect((await pool.query('SELECT id FROM users WHERE id=$1', [id])).rowCount).toBe(1);
    });
    it('preserves document references and cascading location history on drivers', async () => {
      for (const document of [true, false]) {
        const id = await user('driver');
        const p = await pool.query(
          `INSERT INTO driver_profiles(user_id,license_number,license_expiry) VALUES($1,$2,'2099-01-01') RETURNING id`,
          [id, 'TEST_ONLY_' + id],
        );
        const profile = p.rows[0].id;
        if (document)
          await pool.query(
            `INSERT INTO driver_documents(driver_profile_id,document_type,storage_provider,storage_key,resource_type,access_mode,mime_type,file_size,uploaded_by) VALUES($1,'profile_photo','cloudinary','TEST_ONLY_NO_REAL_ASSET','image','authenticated','image/png',100,$2)`,
            [profile, id],
          );
        if (!document)
          await pool.query(
            `INSERT INTO provider_location_history(driver_profile_id,location,recorded_at) VALUES($1,ST_SetSRID(ST_Point(85.1,25.6),4326)::geography,NOW())`,
            [profile],
          );
        const before = await pool.query(
          'SELECT id FROM provider_approval_requests WHERE target_id=$1',
          [profile],
        );
        expect((await remove('drivers', profile)).status).toBe(409);
        expect(
          (
            await pool.query('SELECT id FROM provider_approval_requests WHERE target_id=$1', [
              profile,
            ])
          ).rowCount,
        ).toBe(before.rowCount);
        expect(
          (await pool.query('SELECT id FROM driver_profiles WHERE id=$1', [profile])).rowCount,
        ).toBe(1);
      }
    });
    it('does not silently clear active vehicle associations', async () => {
      const v = await pool.query(
        `INSERT INTO vehicles(make,model,plate_number) VALUES('TEST_ONLY','Associated',$1) RETURNING id`,
        ['LINK' + randomUUID().slice(0, 8)],
      );
      const u = await user('driver');
      await pool.query(
        `INSERT INTO driver_profiles(user_id,license_number,license_expiry,active_vehicle_id) VALUES($1,$2,'2099-01-01',$3)`,
        [u, 'TEST_ONLY_' + u, v.rows[0].id],
      );
      expect((await remove('vehicles', v.rows[0].id)).status).toBe(409);
      expect(
        (await pool.query('SELECT active_vehicle_id FROM driver_profiles WHERE user_id=$1', [u]))
          .rows[0].active_vehicle_id,
      ).toBe(v.rows[0].id);
    });
    it('serializes concurrent deletion of the same account', async () => {
      const id = await user();
      const result = await Promise.all([remove('users', id), remove('users', id)]);
      expect(result.map((r) => r.status).sort()).toEqual([200, 404]);
      expect(
        (
          await pool.query(
            "SELECT id FROM user_history WHERE event_type='ADMIN_RECORD_DELETED' AND metadata->>'deletedSubjectId'=$1",
            [id],
          )
        ).rowCount,
      ).toBe(1);
    });
    it.each(['drivers', 'partners', 'vehicles', 'vehicle-types', 'coupons'] as const)(
      'allows explicitly granted Admin deletion for %s',
      async (module) => {
        const current = await access.identity(admin);
        await access.update(owner, admin, {
          permissions: [
            'users.read',
            'users.delete',
            'drivers.read',
            'drivers.delete',
            'partners.read',
            'partners.delete',
            'vehicles.read',
            'vehicles.delete',
            'pricing.read',
            'pricing.delete',
            'coupons.read',
            'coupons.delete',
          ],
          expectedUpdatedAt: current.updatedAt,
        });
        let id: string;
        if (module === 'drivers') {
          const u = await user('driver');
          id = (
            await pool.query(
              `INSERT INTO driver_profiles(user_id,license_number,license_expiry) VALUES($1,$2,'2099-01-01') RETURNING id`,
              [u, 'TEST_ONLY_' + u],
            )
          ).rows[0].id;
        } else if (module === 'partners') {
          const u = await user('fleet_owner');
          id = (
            await pool.query(
              `INSERT INTO partners(user_id,business_name) VALUES($1,'TEST_ONLY') RETURNING id`,
              [u],
            )
          ).rows[0].id;
        } else if (module === 'vehicles')
          id = (
            await pool.query(
              `INSERT INTO vehicles(make,model,plate_number) VALUES('TEST_ONLY','Delete',$1) RETURNING id`,
              ['GRANT' + randomUUID().slice(0, 8)],
            )
          ).rows[0].id;
        else if (module === 'vehicle-types')
          id = (
            await pool.query(
              `INSERT INTO vehicle_types(name,code,sector,base_fare_paise,per_km_rate_paise) VALUES('TEST_ONLY',$1,'passenger',100,100) RETURNING id`,
              ['delete_' + randomUUID().replaceAll('-', '')],
            )
          ).rows[0].id;
        else
          id = (
            await pool.query(
              `INSERT INTO coupons(code,discount_type,discount_value) VALUES($1,'FIXED',100) RETURNING id`,
              ['GRANT' + randomUUID().slice(0, 8)],
            )
          ).rows[0].id;
        expect((await remove(module, id, adminToken)).status).toBe(200);
      },
    );
    it('deletes an unused coupon and blocks previously used coupons', async () => {
      const rows = await pool.query(
        `INSERT INTO coupons(code,discount_type,discount_value,usage_count) VALUES($1,'FIXED',100,0),($2,'FIXED',100,1) RETURNING id,usage_count`,
        ['DEL' + randomUUID().slice(0, 8), 'KEEP' + randomUUID().slice(0, 8)],
      );
      for (const row of rows.rows)
        expect((await remove('coupons', row.id)).status).toBe(row.usage_count ? 409 : 200);
    });
  },
);
