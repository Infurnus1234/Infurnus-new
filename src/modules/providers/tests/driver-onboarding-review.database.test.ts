import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { createApp } from '../../../app.js';
import { PostgresUserRepository } from '../../users/repositories/user.repository.js';
import { PostgresVehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import { PostgresRideRepository } from '../../rides/repositories/ride.repository.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { PostgresAdminRepository } from '../../admin/repositories/admin.repository.js';
import { AdminManagementService } from '../../admin/services/admin-management.service.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { storageService } from '../../../infrastructure/storage/index.js';
import { PostgresProviderOperationsRepository } from '../repositories/provider-operations.repository.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Consolidated Driver onboarding HTTP and PostgreSQL',
  () => {
    const app = createApp(
      new PostgresUserRepository(pool),
      undefined,
      new PostgresVehicleRepository(pool),
      undefined,
      new PostgresAdminRepository(pool),
      new PostgresRideRepository(pool),
      new PostgresDriverRepository(pool),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new PostgresProviderOperationsRepository(pool),
    );
    let admin: string,
      driver: string,
      profile: string,
      anchor: string,
      driverToken: string,
      adminToken: string;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=',
      'base64',
    );
    beforeAll(() => {
      const url = new URL(process.env.DATABASE_URL!);
      if (
        url.hostname !== 'localhost' ||
        url.port !== '5434' ||
        !/^\/admin_master_test_[a-f0-9]{32}$/.test(url.pathname)
      )
        throw Error('Owned disposable database required');
      // Only the external asset store is replaced. Multipart validation, submission,
      // queue triggers, authorization, review transactions and persistence are real.
      vi.spyOn(storageService, 'upload').mockImplementation(async (input) => ({
        storageProvider: 'cloudinary',
        storageKey: 'TEST_SAMPLE/' + randomUUID(),
        resourceType: input.resourceType,
        accessMode: input.accessMode,
        mimeType: input.file.mimeType,
        fileSize: input.file.fileSize,
      }));
      vi.spyOn(storageService, 'delete').mockResolvedValue(undefined);
    });
    afterAll(() => vi.restoreAllMocks());
    beforeEach(async () => {
      admin = randomUUID();
      driver = randomUUID();
      for (const [id, role] of [
        [admin, 'super_admin'],
        [driver, 'driver'],
      ])
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'TEST_SAMPLE','Onboarding',$2,$3)",
          [id, id + '@example.invalid', role],
        );
      profile = (
        await pool.query(
          "INSERT INTO driver_profiles(user_id,license_number,license_expiry) VALUES($1,$2,'2099-12-31') RETURNING id",
          [driver, 'TEST_ONLY_' + randomUUID()],
        )
      ).rows[0].id;
      anchor = (
        await pool.query(
          "SELECT id FROM provider_approval_requests WHERE target_type='driver_profile' AND target_id=$1 AND status='PENDING'",
          [profile],
        )
      ).rows[0].id;
      adminToken = await signAccessToken({ sub: admin, role: 'super_admin', type: 'access' });
      driverToken = await signAccessToken({ sub: driver, role: 'driver', type: 'access' });
    });
    const upload = async (type: string) => {
      const res = await request(app)
        .post('/rides/driver/documents/' + type)
        .set('Authorization', 'Bearer ' + driverToken)
        .field('uploadSource', 'FILE')
        .field('documentNumber', 'TEST_ONLY_SAMPLE')
        .field('expiresAt', '2099-12-31')
        .attach('file', png, { filename: 'TEST_SAMPLE_NOT_ID.png', contentType: 'image/png' });
      expect(res.status, res.body.error?.message).toBe(201);
      return res.body.data;
    };
    const detail = async () => {
      const res = await request(app)
        .get('/provider-approvals/' + anchor + '?group=driver')
        .set('Authorization', 'Bearer ' + adminToken)
        .expect(200);
      return res.body.data;
    };
    const decide = (data: any, status = 'APPROVED', token = adminToken) =>
      request(app)
        .post('/provider-approvals/' + anchor + '/review')
        .set('Authorization', 'Bearer ' + token)
        .send({
          status,
          reason: 'TEST_SAMPLE review',
          expectedUpdatedAt: data.target.updated_at,
          items: data.onboarding_items
            .filter((item: any) => item.status === 'PENDING')
            .map((item: any) => ({ id: item.id, expectedUpdatedAt: item.expected_updated_at })),
        });
    it('groups actual photo/licence/identity submissions once, includes all evidence and preserves legacy item APIs', async () => {
      await upload('profile_photo');
      await upload('driver_license');
      await upload('identity');
      const queue = await request(app)
        .get('/provider-approvals?group=driver')
        .set('Authorization', 'Bearer ' + adminToken)
        .expect(200);
      const own = queue.body.data.filter((row: any) => row.requester_id === driver);
      expect(own).toHaveLength(1);
      expect(own[0].item_count).toBe(4);
      const data = await detail();
      expect(data.documents).toHaveLength(3);
      expect(data.target.id).toBe(profile);
      expect(data.request.requester_email).toBe(driver + '@example.invalid');
      expect(data.onboarding_items).toHaveLength(4);
      const legacy = await request(app)
        .get('/provider-approvals')
        .set('Authorization', 'Bearer ' + adminToken)
        .expect(200);
      expect(legacy.body.data.filter((row: any) => row.requester_id === driver)).toHaveLength(4);
      await request(app)
        .get(
          '/provider-approvals/' +
            data.onboarding_items.find((item: any) => item.target_type === 'driver_document').id +
            '?group=driver',
        )
        .set('Authorization', 'Bearer ' + adminToken)
        .expect(200)
        .then((res) => expect(res.body.data.documents).toHaveLength(3));
    });
    it('approves all pending documents and the profile atomically and exposes the status to the Driver API', async () => {
      await upload('profile_photo');
      await upload('driver_license');
      const data = await detail();
      await decide(data).expect(200);
      const next = await detail();
      expect(next.target.verification_status).toBe('approved');
      expect(next.onboarding_items.every((item: any) => item.status === 'APPROVED')).toBe(true);
      await request(app)
        .get('/rides/driver/profile')
        .set('Authorization', 'Bearer ' + driverToken)
        .expect(200)
        .then((res) => expect(res.body.data.verificationStatus).toBe('approved'));
      await decide(data).expect(409);
    });
    it('rejects together with reason, then replacement returns to the same consolidated group without duplicate pending targets', async () => {
      await upload('profile_photo');
      await upload('driver_license');
      await decide(await detail(), 'REJECTED').expect(200);
      expect((await detail()).target.verification_status).toBe('rejected');
      await upload('driver_license');
      const data = await detail();
      expect(data.target.verification_status).toBe('pending');
      const pending = data.onboarding_items.filter((item: any) => item.status === 'PENDING');
      expect(new Set(pending.map((item: any) => item.target_id)).size).toBe(pending.length);
      expect(data.history.some((item: any) => item.status === 'REJECTED')).toBe(true);
    });
    it('rejects stale snapshots and newly submitted evidence without a partial decision', async () => {
      await upload('profile_photo');
      const old = await detail();
      await upload('identity');
      await decide(old).expect(409);
      const current = await detail();
      expect(current.onboarding_items.every((item: any) => item.status === 'PENDING')).toBe(true);
      await upload('profile_photo');
      await decide(current).expect(409);
    });
    it('rolls back document approval when configured required evidence is missing', async () => {
      await pool.query(
        "INSERT INTO provider_document_requirements(provider_role,vehicle_category,document_code,required,updated_by) VALUES('driver','*',$1,TRUE,$2)",
        ['test_required_' + randomUUID().replaceAll('-', ''), admin],
      );
      try {
        await upload('profile_photo');
        await decide(await detail()).expect(409);
        expect(
          (await detail()).onboarding_items.every((item: any) => item.status === 'PENDING'),
        ).toBe(true);
      } finally {
        await pool.query('DELETE FROM provider_document_requirements WHERE updated_by=$1', [admin]);
      }
    });
    it('keeps other drivers separate and rejects cross-driver snapshots and unauthorized reviews', async () => {
      await upload('profile_photo');
      const data = await detail();
      await decide(data, 'APPROVED', driverToken).expect(403);
      const first = driver;
      const other = randomUUID();
      await pool.query(
        "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'TEST_OTHER','Driver',$2,'driver')",
        [other, other + '@example.invalid'],
      );
      await pool.query(
        "INSERT INTO driver_profiles(user_id,license_number,license_expiry) VALUES($1,$2,'2099-12-31')",
        [other, randomUUID()],
      );
      const queue = await request(app)
        .get('/provider-approvals?group=driver')
        .set('Authorization', 'Bearer ' + adminToken)
        .expect(200);
      expect(
        queue.body.data.filter((row: any) => [first, other].includes(row.requester_id)),
      ).toHaveLength(2);
      const otherId = queue.body.data.find((row: any) => row.requester_id === other).id;
      data.onboarding_items[0].id = otherId;
      await decide(data).expect(409);
    });
    it('individual document decisions remain in one review while overall profile approval waits for required documents', async () => {
      await upload('profile_photo');
      await upload('driver_license');
      const data = await detail();
      const photo = data.onboarding_items.find((item: any) => item.label === 'profile_photo');
      await request(app)
        .post('/provider-approvals/' + photo.id + '/review')
        .set('Authorization', 'Bearer ' + adminToken)
        .send({
          status: 'REJECTED',
          reason: 'TEST_SAMPLE replace photo',
          expectedUpdatedAt: photo.expected_updated_at,
        })
        .expect(200);
      const next = await detail();
      expect(
        next.documents.find((doc: any) => doc.document_type === 'profile_photo')
          .verification_status,
      ).toBe('rejected');
      expect(next.target.verification_status).toBe('pending');
    });
    it('enforces saved Admin approval grants and keeps sensitive data redacted', async () => {
      await upload('profile_photo');
      const data = await detail();
      const limited = await new AdminManagementService(pool).create(admin, {
        email: randomUUID() + '@example.invalid',
        password: 'Local-test-only-password!',
        firstName: 'TEST_SAMPLE',
        lastName: 'Read Admin',
        permissions: ['approvals.read', 'approvals.detail'],
      });
      const token = await signAccessToken({ sub: limited.id, role: 'admin', type: 'access' });
      const read = await request(app)
        .get('/provider-approvals/' + anchor + '?group=driver')
        .set('Authorization', 'Bearer ' + token)
        .expect(200);
      expect(read.body.data.request.requester_email).toBeUndefined();
      expect(read.body.data.target.license_number).toBeUndefined();
      expect(read.body.data.documents).toEqual([]);
      await decide(data, 'APPROVED', token).expect(403);
      await request(app)
        .post('/provider-approvals/' + anchor + '/review')
        .send({ status: 'APPROVED', expectedUpdatedAt: data.target.updated_at })
        .expect(401);
    });
    it('serializes competing consolidated decisions without duplicate reviews', async () => {
      await upload('profile_photo');
      await upload('driver_license');
      const data = await detail();
      const results = await Promise.all([decide(data), decide(data)]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      expect(
        (await detail()).onboarding_items.filter((item: any) => item.status === 'APPROVED'),
      ).toHaveLength(3);
    });
    it('overall onboarding reflects required-document replacement/rejection even after profile approval', async () => {
      await pool.query(
        "INSERT INTO provider_document_requirements(provider_role,vehicle_category,document_code,required,updated_by) VALUES('driver','*','profile_photo',TRUE,$1)",
        [admin],
      );
      try {
        await upload('profile_photo');
        await upload('driver_license');
        await decide(await detail()).expect(200);
        expect((await detail()).onboarding_status).toBe('APPROVED');
        await upload('profile_photo');
        let current = await detail();
        expect(current.target.verification_status).toBe('approved');
        expect(current.onboarding_status).toBe('PENDING');
        const photo = current.onboarding_items.find(
          (item: any) => item.label === 'profile_photo' && item.status === 'PENDING',
        );
        await request(app)
          .post('/provider-approvals/' + photo.id + '/review')
          .set('Authorization', 'Bearer ' + adminToken)
          .send({
            status: 'REJECTED',
            reason: 'TEST_SAMPLE replace unreadable photo',
            expectedUpdatedAt: photo.expected_updated_at,
          })
          .expect(200);
        current = await detail();
        expect(current.onboarding_status).toBe('REJECTED');
        expect(current.request.status).toBe('REJECTED');
        for (const status of ['ALL', 'REJECTED', 'APPROVED']) {
          const queue = await request(app)
            .get('/provider-approvals?group=driver&status=' + status)
            .set('Authorization', 'Bearer ' + adminToken)
            .expect(200);
          const entry = queue.body.data.find((item: any) => item.requester_id === driver);
          if (status === 'APPROVED') expect(entry).toBeUndefined();
          else expect(entry?.status).toBe('REJECTED');
        }
        await request(app)
          .get('/rides/driver/documents')
          .set('Authorization', 'Bearer ' + driverToken)
          .expect(200)
          .then((res) =>
            expect(
              res.body.data.find((doc: any) => doc.documentType === 'profile_photo')
                .verificationStatus,
            ).toBe('rejected'),
          );
      } finally {
        await pool.query('DELETE FROM provider_document_requirements WHERE updated_by=$1', [admin]);
      }
    });
  },
);
