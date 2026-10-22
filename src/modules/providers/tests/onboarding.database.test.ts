import express from 'express';
import request from 'supertest';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { createProviderOperationsRouter } from '../routes/provider-operations.routes.js';
import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresProviderOperationsRepository } from '../repositories/provider-operations.repository.js';
import { PostgresDriverDocumentRepository } from '../../rides/repositories/driver-document.repository.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Flexible onboarding persisted receipts',
  () => {
    const repo = new PostgresProviderOperationsRepository(pool);
    let user: string, profile: string;
    beforeEach(async () => {
      user = (
        await pool.query(
          "INSERT INTO users(first_name,last_name,phone,role) VALUES('Fixture','Onboarding',$1,'driver') RETURNING id",
          ['+95' + randomUUID().replaceAll('-', '').slice(0, 10)],
        )
      ).rows[0].id;
      profile = (
        await pool.query(
          'INSERT INTO driver_profiles(user_id,license_number,license_expiry) VALUES($1,$2,CURRENT_DATE+365) RETURNING id',
          [user, randomUUID()],
        )
      ).rows[0].id;
    });
    afterEach(async () => {
      await pool.query('DELETE FROM provider_onboarding WHERE user_id=$1', [user]);
      await pool.query('DELETE FROM provider_approval_requests WHERE requester_id=$1', [user]);
      await pool.query(
        'DELETE FROM partner_documents WHERE partner_id IN (SELECT id FROM partners WHERE user_id=$1)',
        [user],
      );
      await pool.query('DELETE FROM vehicles WHERE owner_id=$1', [user]);
      await pool.query('DELETE FROM partners WHERE user_id=$1', [user]);
      await pool.query('DELETE FROM driver_profiles WHERE id=$1', [profile]);
      await pool.query('DELETE FROM user_history WHERE user_id=$1', [user]);
      await pool.query('DELETE FROM users WHERE id=$1', [user]);
    });
    async function upload() {
      return new PostgresDriverDocumentRepository(pool).saveBundle(
        {
          driverProfileId: profile,
          documentType: 'driver_license',
          storageProvider: 'cloudinary',
          storageKey: 'fixture/licence',
          resourceType: 'image',
          accessMode: 'authenticated',
          mimeType: 'image/jpeg',
          fileSize: 100,
          uploadedBy: user,
        },
        [
          {
            storageKey: 'fixture/licence',
            resourceType: 'image',
            mimeType: 'image/jpeg',
            fileSize: 100,
            side: 'FRONT',
          },
        ],
      );
    }
    it('requires uploaded licence, forbids licence skip and preserves draft after failed submit', async () => {
      await expect(
        repo.onboarding(user, 'driver', { defer: 'driver_license' }),
      ).rejects.toMatchObject({ code: 'REQUIRED_ONBOARDING_STEP' });
      await repo.onboarding(user, 'driver', { defer: 'vehicle' });
      await expect(repo.onboarding(user, 'driver', { submit: true })).rejects.toMatchObject({
        code: 'DOCUMENT_REQUIRED',
      });
      const progress = await repo.onboarding(user, 'driver');
      expect(progress.dashboardAccessible).toBe(false);
      expect(progress.deferred_codes).toEqual(['vehicle']);
    });
    it('accepts pending licence without vehicle, survives reload and remains operationally blocked', async () => {
      const document = await upload();
      await repo.onboarding(user, 'driver', { defer: 'vehicle' });
      const first = await repo.onboarding(user, 'driver', { submit: true });
      expect(first.dashboardAccessible).toBe(true);
      expect(first.receipt_id).toBeTruthy();
      expect((await repo.onboarding(user, 'driver')).receipt_id).toBe(first.receipt_id);
      expect(
        (
          await pool.query('SELECT verification_status FROM driver_documents WHERE id=$1', [
            document.document.id,
          ])
        ).rows[0].verification_status,
      ).toBe('pending');
      expect(
        await new PostgresDriverRepository(pool).updateAvailability(profile, 'available'),
      ).toBe(false);
    });
    it('serializes concurrent retries and reuses pending target reviews', async () => {
      await upload();
      const [a, b] = await Promise.all([
        repo.onboarding(user, 'driver', { submit: true }),
        repo.onboarding(user, 'driver', { submit: true }),
      ]);
      expect(a.receipt_id).toBe(b.receipt_id);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM provider_approval_requests WHERE requester_id=$1 AND status='PENDING'",
            [user],
          )
        ).rows[0].n,
      ).toBe(2);
    });
    it('requires an actual owned front image for vehicle review, while deferring retains the draft', async () => {
      await upload();
      const partner = (
        await pool.query(
          "INSERT INTO partners(user_id,business_name) VALUES($1,'Fixture business') RETURNING id",
          [user],
        )
      ).rows[0].id;
      const vehicle = (
        await pool.query(
          "INSERT INTO vehicles(owner_id,make,model,plate_number) VALUES($1,'Fixture','Car',$2) RETURNING id",
          [user, randomUUID().slice(0, 18)],
        )
      ).rows[0].id;
      await expect(repo.onboarding(user, 'driver', { submit: true })).rejects.toMatchObject({
        code: 'VEHICLE_PHOTO_REQUIRED',
      });
      await repo.onboarding(user, 'driver', { defer: 'vehicle' });
      expect((await repo.onboarding(user, 'driver', { submit: true })).dashboardAccessible).toBe(
        true,
      );
      expect(
        (await pool.query('SELECT id FROM vehicles WHERE id=$1', [vehicle])).rows,
      ).toHaveLength(1);
      await repo.onboarding(user, 'driver', { resume: 'vehicle' });
      await pool.query(
        `INSERT INTO partner_documents(partner_id,vehicle_id,document_type,metadata) VALUES($1,$2,'OTHER',$3::jsonb)`,
        [
          partner,
          vehicle,
          JSON.stringify({
            documentCode: 'vehicle_front_photo',
            storage: { storageKey: 'fixture/front', mimeType: 'image/jpeg' },
          }),
        ],
      );
      expect((await repo.onboarding(user, 'driver', { submit: true })).dashboardAccessible).toBe(
        true,
      );
      expect(
        (await pool.query('SELECT verification_status FROM vehicles WHERE id=$1', [vehicle]))
          .rows[0].verification_status,
      ).toBe('pending');
    });
    it('protects direct API submission against missing authentication and forged approval fields', async () => {
      const app = express();
      app.use(express.json());
      app.use('/provider', createProviderOperationsRouter(repo));
      app.use(errorMiddleware);
      expect((await request(app).get('/provider/onboarding')).status).toBe(401);
      const token = await signAccessToken({ sub: user, role: 'driver', type: 'access' });
      expect(
        (
          await request(app)
            .post('/provider/approval-requests')
            .set('Authorization', 'Bearer ' + token)
            .send({ requestType: 'onboarding_submission', status: 'APPROVED' })
        ).status,
      ).toBe(400);
      const rejected = await request(app)
        .post('/provider/approval-requests')
        .set('Authorization', 'Bearer ' + token)
        .send({ requestType: 'onboarding_submission' });
      expect(rejected.status).toBe(400);
      expect(rejected.body.error.code).toBe('DOCUMENT_REQUIRED');
      expect((await repo.onboarding(user, 'driver')).dashboardAccessible).toBe(false);
    });
    it('rejects inactive identities and role spoofing', async () => {
      await expect(repo.onboarding(user, 'fleet_owner')).rejects.toMatchObject({ statusCode: 403 });
      await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [user]);
      await expect(repo.onboarding(user, 'driver')).rejects.toMatchObject({ statusCode: 403 });
    });
  },
);
