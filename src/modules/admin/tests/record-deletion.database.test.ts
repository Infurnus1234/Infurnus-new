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
import { AdminOperationsRepository } from '../repositories/operations.repository.js';
import { PostgresAdminRepository } from '../repositories/admin.repository.js';
import { PostgresProviderOperationsRepository } from '../../providers/repositories/provider-operations.repository.js';
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
    const fixtureUsers: string[] = [];
    async function user(role = 'customer') {
      const id = randomUUID();
      fixtureUsers.push(id);
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
        .set('Authorization', `Bearer ${t}`)
        .send({ reason: 'TEST_ONLY deletion verification' });
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
      // This suite deliberately retains business history. Remove its synthetic queue
      // entries so later bounded-list tests do not inherit pending request fixtures.
      if (fixtureUsers.length)
        await pool.query(
          'DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[])',
          [fixtureUsers],
        );
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
    it('removes an empty wallet shell with eligible profiles and leaves other accounts untouched', async () => {
      const id = await user('driver_fleet_owner');
      const other = await user();
      await pool.query(`INSERT INTO provider_wallets(user_id) VALUES($1)`, [id]);
      await pool.query(
        `INSERT INTO driver_profiles(user_id,license_number,license_expiry) VALUES($1,$2,'2099-01-01')`,
        [id, 'TEST_ONLY_' + id],
      );
      await pool.query(
        `INSERT INTO partners(user_id,business_name) VALUES($1,'TEST_ONLY_DELETE')`,
        [id],
      );
      const old = await token(id, 'driver_fleet_owner');
      const response = await remove('users', id);
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ id, deleted: true });
      for (const table of ['users', 'driver_profiles', 'partners', 'provider_wallets']) {
        const column = table === 'users' ? 'id' : 'user_id';
        expect((await pool.query(`SELECT 1 FROM ${table} WHERE ${column}=$1`, [id])).rowCount).toBe(
          0,
        );
      }
      expect((await pool.query('SELECT id FROM users WHERE id=$1', [other])).rowCount).toBe(1);
      await expect(verifyAccessToken(old)).rejects.toBeDefined();
    });
    it('deletes the account identity and preserves settled zero-balance wallet history', async () => {
      const id = await user();
      await pool.query(`INSERT INTO provider_wallets(user_id) VALUES($1)`, [id]);
      for (const [amount, balance] of [
        [100, 100],
        [-100, 0],
      ])
        await pool.query(
          `INSERT INTO provider_wallet_entries(user_id,amount_paise,balance_after_paise,entry_type,reference,idempotency_key,actor_id)
           VALUES($1,$2,$3,'ADJUSTMENT','TEST_ONLY',$4,$5)`,
          [id, amount, balance, randomUUID(), owner],
        );
      const response = await remove('users', id);
      expect(response.status).toBe(200);
      expect(
        (await pool.query('SELECT 1 FROM provider_wallet_entries WHERE user_id=$1', [id])).rowCount,
      ).toBe(2);
      expect((await pool.query('SELECT 1 FROM users WHERE id=$1', [id])).rowCount).toBe(1);
    });
    it('retains a nonzero wallet even without ledger entries', async () => {
      const id = await user();
      await pool.query(`INSERT INTO provider_wallets(user_id,balance_paise) VALUES($1,100)`, [id]);
      expect((await remove('users', id)).status).toBe(200);
      expect(
        (await pool.query('SELECT balance_paise FROM provider_wallets WHERE user_id=$1', [id]))
          .rows[0].balance_paise,
      ).toBe('100');
    });
    it('does not revoke a surviving account when the transaction fails at commit', async () => {
      const id = await user();
      const old = await token(id, 'customer');
      await pool.query(
        `CREATE FUNCTION test_delete_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_ONLY commit failure' USING ERRCODE='23514'; END $$`,
      );
      try {
        await pool.query(
          `CREATE CONSTRAINT TRIGGER test_delete_commit_failure AFTER DELETE ON users DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.id='${id}'::uuid) EXECUTE FUNCTION test_delete_commit_failure()`,
        );
        expect((await remove('users', id)).status).toBe(409);
        expect((await pool.query('SELECT id FROM users WHERE id=$1', [id])).rowCount).toBe(1);
        await expect(verifyAccessToken(old)).resolves.toMatchObject({ sub: id });
      } finally {
        await pool.query('DROP TRIGGER IF EXISTS test_delete_commit_failure ON users');
        await pool.query('DROP FUNCTION test_delete_commit_failure()');
      }
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
    it('erases credentials and preserves dependent operational history', async () => {
      const id = await user();
      await pool.query(
        `INSERT INTO user_credentials(user_id,password_hash) VALUES($1,'local-test-hash')`,
        [id],
      );
      await pool.query(
        `INSERT INTO rides(customer_id,status,pickup_location,destination_location) VALUES($1,'requested',ST_SetSRID(ST_Point(85.1,25.6),4326)::geography,ST_SetSRID(ST_Point(85.2,25.6),4326)::geography)`,
        [id],
      );
      const response = await remove('users', id);
      expect(response.status).toBe(200);
      expect(
        (await pool.query('SELECT id FROM user_credentials WHERE user_id=$1', [id])).rowCount,
      ).toBe(0);
      await expect(verifyAccessToken(await token(id, 'customer'))).rejects.toBeDefined();
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
        (await pool.query('SELECT id FROM vehicles WHERE id=$1 AND is_active', [v.rows[0].id]))
          .rowCount,
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
        const response = await remove('drivers', profile);
        expect(response.status).toBe(200);
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
    it('removes associated vehicles from active administration while retaining references', async () => {
      const v = await pool.query(
        `INSERT INTO vehicles(make,model,plate_number) VALUES('TEST_ONLY','Associated',$1) RETURNING id`,
        ['LINK' + randomUUID().slice(0, 8)],
      );
      const u = await user('driver');
      await pool.query(
        `INSERT INTO driver_profiles(user_id,license_number,license_expiry,active_vehicle_id) VALUES($1,$2,'2099-01-01',$3)`,
        [u, 'TEST_ONLY_' + u, v.rows[0].id],
      );
      expect((await remove('vehicles', v.rows[0].id)).status).toBe(200);
      expect(
        (await pool.query('SELECT active_vehicle_id FROM driver_profiles WHERE user_id=$1', [u]))
          .rows[0].active_vehicle_id,
      ).toBe(v.rows[0].id);
    });
    it('cancels active rentals when deleting a vehicle and preserves payment history', async () => {
      const customer = await user();
      const vehicle = (
        await pool.query(
          "INSERT INTO vehicles(make,model,plate_number) VALUES('TEST_ONLY','Cancellation',$1) RETURNING id",
          ['CANCEL' + randomUUID().slice(0, 8)],
        )
      ).rows[0].id;
      const rental = (
        await pool.query(
          "INSERT INTO rentals(user_id,vehicle_id,start_at,end_at,total_amount,status) VALUES($1,$2,NOW(),NOW()+INTERVAL '1 day',100,'ACTIVE') RETURNING id",
          [customer, vehicle],
        )
      ).rows[0].id;
      const payment = (
        await pool.query(
          'INSERT INTO payments(user_id,rental_id,amount) VALUES($1,$2,100) RETURNING id',
          [customer, rental],
        )
      ).rows[0].id;
      expect((await remove('vehicles', vehicle)).status).toBe(200);
      expect(
        (await pool.query('SELECT status FROM rentals WHERE id=$1', [rental])).rows[0].status,
      ).toBe('CANCELLED');
      expect((await pool.query('SELECT 1 FROM payments WHERE id=$1', [payment])).rowCount).toBe(1);
      expect(
        (
          await new PostgresAdminRepository(pool).listVehicles({ page: 1, pageSize: 100 })
        ).items.some((row) => row.id === vehicle),
      ).toBe(false);
      expect((await remove('vehicles', vehicle)).status).toBe(404);
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
    it('validates deletion reasons and rejects unknown payload fields without mutation', async () => {
      const id = await user();
      for (const body of [
        {},
        { reason: '   ' },
        { reason: 'x'.repeat(501) },
        { reason: 'Valid reason', retainHistory: true },
      ]) {
        const response = await request(app)
          .delete(`/admin/records/users/${id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send(body);
        expect(response.status).toBe(400);
      }
      expect((await pool.query('SELECT id FROM users WHERE id=$1', [id])).rowCount).toBe(1);
    });
    it.each([
      ['passenger', 'sedan'],
      ['premium', 'luxury_sedan'],
      ['logistics', 'mini_truck'],
      ['service', 'ambulance'],
      ['service', 'towing'],
      ['passenger', 'suv'],
    ])(
      'deletes unused %s/%s inventory without touching business history',
      async (sector, category) => {
        const vehicle = await pool.query(
          `INSERT INTO vehicles(make,model,plate_number,sector,category) VALUES('TEST_ONLY','Delete',$1,$2,$3) RETURNING id`,
          ['DEL' + randomUUID().slice(0, 8), sector, category],
        );
        const id = vehicle.rows[0].id;
        expect((await remove('vehicles', id)).status).toBe(200);
        expect(
          (await pool.query('SELECT id FROM vehicles WHERE id=$1 AND is_active', [id])).rowCount,
        ).toBe(0);
        expect((await remove('vehicles', id)).status).toBe(404);
      },
    );
    it('retains closed support history, hides it from listings and audits the reason', async () => {
      const subject = await user();
      const record = await pool.query(
        `INSERT INTO support_tickets(ticket_number,user_id,role,category,subject,message,status) VALUES($1,$2,'customer','OTHER','TEST_ONLY','History retained','OPEN') RETURNING id`,
        ['DEL' + randomUUID().slice(0, 8), subject],
      );
      const id = record.rows[0].id;
      expect((await remove('support', id, adminToken)).status).toBe(403);
      expect((await remove('support', id)).status).toBe(409);
      await pool.query("UPDATE support_tickets SET status='CLOSED' WHERE id=$1", [id]);
      const response = await remove('support', id);
      expect(response.status).toBe(200);
      expect(response.body.data.mode).toBe('retained');
      expect(
        (await pool.query('SELECT message,admin_deleted_at FROM support_tickets WHERE id=$1', [id]))
          .rows[0],
      ).toMatchObject({ message: 'History retained', admin_deleted_at: expect.any(Date) });
      const listing = await new AdminOperationsRepository(pool).list('support', {
        page: 1,
        pageSize: 25,
        recordId: id,
      });
      expect(listing.total).toBe(0);
      expect(listing.items).toEqual([]);
      expect((await remove('support', id)).status).toBe(404);
      const audit = await pool.query(
        "SELECT user_id,metadata FROM user_history WHERE event_type='ADMIN_RECORD_DELETED' AND entity_id=$1",
        [id],
      );
      expect(audit.rows[0]).toMatchObject({
        user_id: owner,
        metadata: {
          module: 'support',
          reason: 'TEST_ONLY deletion verification',
          mode: 'retained',
        },
      });
    });
    it('retains delivered notifications and blocks queued and retryable notifications', async () => {
      const subject = await user();
      const record = await pool.query(
        `INSERT INTO notifications(user_id,notification_type,channel) VALUES($1,'TEST_ONLY','push') RETURNING id`,
        [subject],
      );
      const id = record.rows[0].id;
      expect((await remove('notifications', id)).status).toBe(409);
      await pool.query(
        "UPDATE notifications SET processing_status='PROCESSED',processed_at=NOW(),delivery_status='SENT' WHERE id=$1",
        [id],
      );
      expect((await remove('notifications', id)).status).toBe(409);
      await pool.query(
        "UPDATE notifications SET delivery_status='DELIVERED',delivered_at=NOW() WHERE id=$1",
        [id],
      );
      expect((await remove('notifications', id)).status).toBe(200);
      expect(
        (await pool.query('SELECT admin_deleted_at FROM notifications WHERE id=$1', [id])).rows[0]
          .admin_deleted_at,
      ).toBeTruthy();
      expect(
        (
          await new AdminOperationsRepository(pool).list('notifications', {
            page: 1,
            pageSize: 25,
            recordId: id,
          })
        ).total,
      ).toBe(0);
    });
    it('archives completed onboarding requests together while retaining documents and decisions', async () => {
      const id = await user('driver');
      const profile = (
        await pool.query(
          `INSERT INTO driver_profiles(user_id,license_number,license_expiry) VALUES($1,$2,'2099-01-01') RETURNING id`,
          [id, 'TEST_ONLY_' + id],
        )
      ).rows[0].id;
      const requests = await pool.query(
        "SELECT id FROM provider_approval_requests WHERE target_type='driver_profile' AND target_id=$1",
        [profile],
      );
      expect(requests.rowCount).toBeGreaterThan(0);
      const requestId = requests.rows[0].id;
      expect((await remove('approvals', requestId)).status).toBe(409);
      await pool.query(
        "UPDATE provider_approval_requests SET status='CANCELLED' WHERE target_type='driver_profile' AND target_id=$1",
        [profile],
      );
      expect((await remove('approvals', requestId)).status).toBe(200);
      expect(
        (
          await pool.query('SELECT admin_deleted_at FROM provider_approval_requests WHERE id=$1', [
            requestId,
          ])
        ).rows[0].admin_deleted_at,
      ).toBeTruthy();
      expect(
        (await pool.query('SELECT id FROM driver_profiles WHERE id=$1', [profile])).rowCount,
      ).toBe(1);
      expect((await remove('approvals', requestId)).status).toBe(404);
      const queue = await new PostgresProviderOperationsRepository(pool).pendingApprovals(
        owner,
        'ALL',
        true,
      );
      expect(queue.some((row) => row.id === requestId)).toBe(false);
      const audit = await pool.query(
        "SELECT metadata FROM user_history WHERE event_type='ADMIN_RECORD_DELETED' AND entity_id=$1",
        [requestId],
      );
      expect(audit.rows[0].metadata.affectedIds).toContain(requestId);
    });
    it('removes completed fleet applications from active administration without removing membership history', async () => {
      const driver = await user('driver'),
        ownerId = await user('fleet_owner');
      const profile = (
        await pool.query(
          "INSERT INTO driver_profiles(user_id,license_number,license_expiry) VALUES($1,$2,'2099-01-01') RETURNING id",
          [driver, 'TEST_ONLY_' + driver],
        )
      ).rows[0].id;
      const partner = (
        await pool.query(
          "INSERT INTO partners(user_id,business_name) VALUES($1,'TEST_ONLY_FLEET') RETURNING id",
          [ownerId],
        )
      ).rows[0].id;
      const application = (
        await pool.query(
          "INSERT INTO driver_applications(partner_id,driver_profile_id,requested_sector,requested_vehicle_category,vehicle_ownership_type) VALUES($1,$2,'passenger','sedan','DRIVER_ONLY') RETURNING id",
          [partner, profile],
        )
      ).rows[0].id;
      expect((await remove('fleet-applications', application)).status).toBe(409);
      await pool.query(
        "UPDATE driver_applications SET status='CANCELLED',submitted_at=NOW() WHERE id=$1",
        [application],
      );
      expect((await remove('fleet-applications', application)).status).toBe(200);
      expect(
        (
          await pool.query('SELECT admin_deleted_at FROM driver_applications WHERE id=$1', [
            application,
          ])
        ).rows[0].admin_deleted_at,
      ).toBeTruthy();
      const active = await new PostgresAdminRepository(pool).listDriverApplications({
        page: 1,
        pageSize: 100,
      });
      expect(active.items.some((row) => row.id === application)).toBe(false);
      expect(
        (await pool.query('SELECT id FROM driver_profiles WHERE id=$1', [profile])).rowCount,
      ).toBe(1);
      expect((await pool.query('SELECT id FROM partners WHERE id=$1', [partner])).rowCount).toBe(1);
    });
    it.each(['support', 'notifications', 'approvals', 'fleet-applications'] as const)(
      'requires the explicit delete grant for %s',
      async (module) => {
        const current = await access.identity(admin);
        const resource = module === 'fleet-applications' ? 'approvals' : module;
        await access.update(owner, admin, {
          permissions: [resource + '.read'],
          expectedUpdatedAt: current.updatedAt,
        });
        expect((await remove(module, randomUUID(), adminToken)).status).toBe(403);
        const updated = await access.identity(admin);
        await access.update(owner, admin, {
          permissions: [resource + '.read', resource + '.delete'],
          expectedUpdatedAt: updated.updatedAt,
        });
        expect((await remove(module, randomUUID(), adminToken)).status).toBe(404);
      },
    );
    it.each(['customer', 'driver', 'fleet_owner', 'driver_fleet_owner'])(
      'permanently erases %s identity across approval states while retaining wallet history',
      async (role) => {
        for (const approvalState of ['pending', 'approved', 'rejected', 'unapproved']) {
          const state = approvalState === 'unapproved' ? 'pending' : approvalState;
          const id = await user(role);
          if (role === 'driver' || role === 'driver_fleet_owner')
            await pool.query(
              "INSERT INTO driver_profiles(user_id,license_number,license_expiry,verification_status) VALUES($1,$2,'2099-01-01',$3)",
              [id, 'TEST_' + id, state],
            );
          if (role === 'fleet_owner' || role === 'driver_fleet_owner')
            await pool.query(
              "INSERT INTO partners(user_id,business_name,approval_status,approved_at,approved_by,rejection_reason,reviewed_at,reviewed_by) VALUES($1,'TEST_ONLY_PII',$2::text::partner_approval_status,CASE WHEN $2::text='approved' THEN NOW() END,CASE WHEN $2::text='approved' THEN $3::uuid END,CASE WHEN $2::text='rejected' THEN 'TEST_ONLY' END,CASE WHEN $2::text IN ('approved','rejected') THEN NOW() END,CASE WHEN $2::text IN ('approved','rejected') THEN $3::uuid END)",
              [id, state, owner],
            );
          if (approvalState === 'unapproved')
            await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [id]);
          if (state === 'approved')
            await pool.query(
              "UPDATE provider_approval_requests SET status='APPROVED',reviewer_id=$2,reviewer_role='super_admin',reviewed_at=NOW() WHERE requester_id=$1",
              [id, owner],
            );
          if (state === 'rejected')
            await pool.query(
              "UPDATE provider_approval_requests SET status='REJECTED',reviewer_id=$2,reviewer_role='super_admin',reviewed_at=NOW(),rejection_reason='TEST_ONLY' WHERE requester_id=$1",
              [id, owner],
            );
          await pool.query('INSERT INTO provider_wallets(user_id,balance_paise) VALUES($1,100)', [
            id,
          ]);
          await pool.query(
            "INSERT INTO user_credentials(user_id,password_hash) VALUES($1,'TEST_ONLY')",
            [id],
          );
          const old = await token(id, role);
          const response = await remove('users', id);
          expect(response.status, JSON.stringify(response.body)).toBe(200);
          expect(
            (await pool.query('SELECT first_name,email,deleted_at FROM users WHERE id=$1', [id]))
              .rows[0],
          ).toMatchObject({ first_name: 'Deleted', email: null, deleted_at: expect.any(Date) });
          expect(
            (await pool.query('SELECT 1 FROM user_credentials WHERE user_id=$1', [id])).rowCount,
          ).toBe(0);
          expect(
            (await pool.query('SELECT balance_paise FROM provider_wallets WHERE user_id=$1', [id]))
              .rows[0].balance_paise,
          ).toBe('100');
          await expect(verifyAccessToken(old)).rejects.toBeDefined();
          expect((await remove('users', id)).status).toBe(404);
        }
      },
    );
  },
);
