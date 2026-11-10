import express from 'express';
import { writeFileSync } from 'node:fs';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fixture, actor } from './fleet-workflow-fixture.js';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresProviderOperationsRepository } from '../repositories/provider-operations.repository.js';
import { PostgresDriverDocumentRepository } from '../../rides/repositories/driver-document.repository.js';
import { createProviderOperationsRouter } from '../routes/provider-operations.routes.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Fleet batch submission and independent Admin decisions',
  () => {
    const repo = new PostgresProviderOperationsRepository(pool);
    const app = express();
    app.use(express.json());
    app.use('/provider', createProviderOperationsRouter(repo));
    app.use(errorMiddleware);
    it('submits pending Fleet, managed Driver licence/profile and vehicle together; retries preserve rows and decisions remain independent', async () => {
      const f = await fixture(),
        other = await fixture();
      await pool.query("UPDATE partners SET approval_status='under_review' WHERE id=$1", [
        f.partner,
      ]);
      await pool.query(
        "UPDATE vehicles SET verification_status='pending',is_active=FALSE WHERE id=$1",
        [f.vehicle.id],
      );
      const driver = await repo.managedDrivers.create(f.owner, 'fleet_owner', {
        firstName: 'TEST_SAMPLE',
        lastName: 'Batch Driver',
        email: randomUUID() + '@example.invalid',
        licenseNumber: 'TEST-' + randomUUID(),
        licenseExpiry: '2090-01-01',
      });
      const doc = await new PostgresDriverDocumentRepository(pool).saveBundle(
        {
          driverProfileId: driver.profileId,
          documentType: 'driver_license',
          storageProvider: 'cloudinary',
          storageKey: 'test/batch/licence',
          resourceType: 'image',
          accessMode: 'authenticated',
          mimeType: 'image/jpeg',
          fileSize: 100,
          uploadedBy: f.owner,
        },
        [
          {
            storageKey: 'test/batch/licence',
            resourceType: 'image',
            mimeType: 'image/jpeg',
            fileSize: 100,
            side: 'FRONT',
          },
        ],
      );
      // The SUBMITTED lifecycle transition queues this review itself. The app
      // must not add a second document_reverification request after upload.
      const partnerDocument = (
        await pool.query(
          `INSERT INTO partner_documents(partner_id,vehicle_id,document_type,status,metadata)
         VALUES($1,$2,'OTHER','PENDING',$3::jsonb) RETURNING id`,
          [
            f.partner,
            f.vehicle.id,
            JSON.stringify({
              documentCode: 'vehicle_front_photo',
              storage: { storageKey: 'test/batch/front' },
            }),
          ],
        )
      ).rows[0].id;
      for (let attempt = 0; attempt < 2; attempt++)
        await pool.query("UPDATE partner_documents SET status='SUBMITTED' WHERE id=$1", [
          partnerDocument,
        ]);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM provider_approval_requests WHERE target_id=$1 AND status='PENDING'",
            [partnerDocument],
          )
        ).rows[0].n,
      ).toBe(1);
      const token = await signAccessToken({ sub: f.owner, role: 'fleet_owner', type: 'access' });
      const submit = () =>
        request(app)
          .post('/provider/approval-requests')
          .set('authorization', 'Bearer ' + token)
          .send({ requestType: 'fleet_submission' });
      const first = await submit();
      expect(first.status, first.text).toBe(200);
      const ids = first.body.data.requests.map((r: { id: string }) => r.id).sort();
      const pairs = first.body.data.requests.map((r: { target_id: string }) => r.target_id);
      expect(pairs).toEqual(
        expect.arrayContaining([
          f.partner,
          driver.profileId,
          doc.document.id,
          partnerDocument,
          f.vehicle.id,
        ]),
      );
      const concurrent = await Promise.all([submit(), submit()]);
      for (const retry of concurrent) {
        expect(retry.status, retry.text).toBe(200);
        expect(retry.body.data.requests.map((r: { id: string }) => r.id).sort()).toEqual(ids);
      }
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM provider_approval_requests WHERE id=ANY($1::uuid[]) AND status<>'PENDING'",
            [ids],
          )
        ).rows[0].n,
      ).toBe(0);
      for (const kind of ['driver', 'vehicle'] as const) {
        const page = await repo.requestPage(f.admin, 'PENDING', {
          kind,
          page: 1,
          pageSize: 100,
          search: f.owner,
        });
        expect(
          page.items.some(
            (r) => r.fleet_owner_id === f.owner && r.fleet_owner_name === 'TEST_SAMPLE Fleet',
          ),
        ).toBe(true);
        expect(page.items.every((r) => r.fleet_owner_id !== other.owner)).toBe(true);
      }
      const vehicleRequest = first.body.data.requests.find(
        (r: { target_id: string }) => r.target_id === f.vehicle.id,
      );
      const details = await repo.approvalDetails(f.admin, vehicleRequest.id);
      await repo.reviewApproval(f.admin, vehicleRequest.id, {
        status: 'REJECTED',
        reason: 'Correct the model',
        expectedUpdatedAt: details.target.updated_at,
      });
      const docRequest = first.body.data.requests.find(
        (r: { target_id: string }) => r.target_id === doc.document.id,
      );
      const documentDetails = await repo.approvalDetails(f.admin, docRequest.id);
      await repo.reviewApproval(f.admin, docRequest.id, {
        status: 'APPROVED',
        expectedUpdatedAt: documentDetails.target.updated_at,
      });
      expect(
        (
          await pool.query('SELECT verification_status FROM driver_profiles WHERE id=$1', [
            driver.profileId,
          ])
        ).rows[0].verification_status,
      ).toBe('pending');
      expect(
        (
          await pool.query('SELECT status FROM provider_approval_requests WHERE id=$1', [
            vehicleRequest.id,
          ])
        ).rows[0].status,
      ).toBe('REJECTED');
      await pool.query(
        "UPDATE vehicles SET model='TEST Corrected',verification_status='pending',updated_at=clock_timestamp() WHERE id=$1",
        [f.vehicle.id],
      );
      const corrected = await submit();
      expect(corrected.status, corrected.text).toBe(200);
      expect(
        corrected.body.data.requests.some(
          (r: { target_id: string; id: string }) =>
            r.target_id === f.vehicle.id && r.id !== vehicleRequest.id,
        ),
      ).toBe(true);
      expect(
        (await pool.query('SELECT count(*)::int n FROM vehicles WHERE id=$1', [f.vehicle.id]))
          .rows[0].n,
      ).toBe(1);
      writeFileSync(
        'tmp/priority-ui-fixture.json',
        JSON.stringify({
          ...f,
          managedDriver: driver,
          database: new URL(process.env.DATABASE_URL!).pathname.slice(1),
        }),
      );
    });
    it('rejects unauthenticated/forged submissions and skips incomplete profiles with a useful reason', async () => {
      expect(
        (
          await request(app)
            .post('/provider/approval-requests')
            .send({ requestType: 'fleet_submission' })
        ).status,
      ).toBe(401);
      const f = await fixture();
      const driver = await repo.managedDrivers.create(f.owner, 'fleet_owner', {
        firstName: 'TEST_SAMPLE',
        lastName: 'Incomplete',
        email: randomUUID() + '@example.invalid',
        licenseNumber: 'TEST-' + randomUUID(),
        licenseExpiry: '2090-01-01',
      });
      const result = await repo.submitFleetApprovals(f.owner, 'fleet_owner');
      expect(result.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            targetId: driver.profileId,
            reason: expect.stringContaining('licence'),
          }),
        ]),
      );
      await expect(repo.submitFleetApprovals(f.owner, 'driver')).rejects.toMatchObject({
        statusCode: 403,
      });
      await expect(
        repo.submitFleetApprovals(await actor('fleet_owner'), 'fleet_owner'),
      ).rejects.toMatchObject({ code: 'BUSINESS_PROFILE_REQUIRED' });
      const token = await signAccessToken({ sub: f.owner, role: 'fleet_owner', type: 'access' });
      expect(
        (
          await request(app)
            .post('/provider/approval-requests')
            .set('authorization', 'Bearer ' + token)
            .send({ requestType: 'fleet_submission', status: 'APPROVED' })
        ).status,
      ).toBe(400);
    });
  },
);
