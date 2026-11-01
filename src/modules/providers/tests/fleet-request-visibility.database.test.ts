import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { fixture } from './fleet-workflow-fixture.js';
import { PostgresProviderOperationsRepository } from '../repositories/provider-operations.repository.js';
import {
  createProviderApprovalRouter,
  createProviderOperationsRouter,
} from '../routes/provider-operations.routes.js';
import { PostgresDriverDocumentRepository } from '../../rides/repositories/driver-document.repository.js';
import { PostgresFleetRepository } from '../../fleet/repositories/fleet.repository.js';
import { FleetService } from '../../fleet/services/fleet.service.js';
import { FleetController } from '../../fleet/controllers/fleet.controller.js';
import { createFleetRouter } from '../../fleet/routes/fleet.routes.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Fleet submitted requests through actual HTTP and PostgreSQL',
  () => {
    const repo = new PostgresProviderOperationsRepository(pool);
    const app = express();
    app.use(express.json());
    app.use('/provider', createProviderOperationsRouter(repo));
    app.use('/provider-approvals', createProviderApprovalRouter(repo));
    app.use(
      '/fleet',
      createFleetRouter(new FleetController(new FleetService(new PostgresFleetRepository(pool)))),
    );
    app.use(errorMiddleware);
    let f: Awaited<ReturnType<typeof fixture>>,
      ownerToken: string,
      adminToken: string,
      driverId: string,
      driverRequest: string,
      vehicleId: string,
      vehicleRequest: string;
    const plate = 'TEST-FLEET-' + randomUUID().slice(0, 8);
    beforeAll(async () => {
      if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
        throw Error('Owned test database required');
      f = await fixture();
      await pool.query("UPDATE users SET first_name='TEST Fleet',last_name='Owner' WHERE id=$1", [
        f.owner,
      ]);
      ownerToken = await signAccessToken({ sub: f.owner, role: 'fleet_owner', type: 'access' });
      adminToken = await signAccessToken({ sub: f.admin, role: 'admin', type: 'access' });
    });
    it('submits a managed Driver and retains Fleet provenance when the trigger already created its pending request', async () => {
      const created = await request(app)
        .post('/provider/managed-drivers')
        .set('Authorization', 'Bearer ' + ownerToken)
        .send({
          firstName: 'TEST Fleet',
          lastName: 'Driver',
          email: randomUUID() + '@example.invalid',
          licenseNumber: 'TEST-' + randomUUID(),
          licenseExpiry: '2099-01-01',
        });
      expect(created.status).toBe(201);
      driverId = created.body.data.userId;
      await new PostgresDriverDocumentRepository(pool).saveBundle(
        {
          driverProfileId: created.body.data.profileId,
          documentType: 'driver_license',
          storageProvider: 'cloudinary',
          storageKey: 'TEST_ONLY/licence.png',
          resourceType: 'image',
          accessMode: 'authenticated',
          mimeType: 'image/png',
          fileSize: 100,
          uploadedBy: f.owner,
          documentMetadata: { expiresAt: '2099-01-01' },
        },
        [],
      );
      const submitted = await request(app)
        .post(`/provider/managed-drivers/${driverId}/submit`)
        .set('Authorization', 'Bearer ' + ownerToken)
        .send({});
      expect(submitted.status).toBe(200);
      driverRequest = submitted.body.data.id;
      expect(
        (
          await pool.query(
            'SELECT requester_id,fleet_id FROM provider_approval_requests WHERE id=$1',
            [driverRequest],
          )
        ).rows[0],
      ).toEqual({ requester_id: f.owner, fleet_id: f.partner });
      const listed = await request(app)
        .get('/provider-approvals?kind=driver&search=TEST%20Fleet%20Driver')
        .set('Authorization', 'Bearer ' + adminToken);
      expect(listed.status).toBe(200);
      expect(
        listed.body.data.items.find((row: { id: string }) => row.id === driverRequest),
      ).toMatchObject({
        driver_name: 'TEST Fleet Driver',
        fleet_owner_name: 'TEST Fleet Owner',
        fleet_owner_id: f.owner,
        status: 'PENDING',
      });
    });
    it('creates a vehicle through the Fleet API and lists it separately with registration and Fleet identity', async () => {
      const saved = await request(app)
        .post('/fleet/vehicles')
        .set('Authorization', 'Bearer ' + ownerToken)
        .send({
          make: 'TEST',
          model: 'Request',
          plateNumber: plate,
          sector: 'passenger',
          category: 'sedan',
        });
      expect(saved.status).toBe(201);
      vehicleId = saved.body.data.id;
      const submit = await request(app)
        .post('/provider/approval-requests')
        .set('Authorization', 'Bearer ' + ownerToken)
        .send({ targetType: 'vehicle', targetId: vehicleId, requestType: 'vehicle_verification' });
      expect(submit.status).toBe(201);
      vehicleRequest = submit.body.data.id;
      const response = await request(app)
        .get('/provider-approvals?kind=vehicle&search=' + plate)
        .set('Authorization', 'Bearer ' + adminToken);
      expect(response.status).toBe(200);
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0]).toMatchObject({
        id: vehicleRequest,
        plate_number: plate.toUpperCase(),
        vehicle_type: 'sedan',
        fleet_owner_name: 'TEST Fleet Owner',
        fleet_owner_id: f.owner,
      });
      expect(
        (
          await repo.requestPage(f.admin, 'ALL', {
            kind: 'driver',
            page: 1,
            pageSize: 100,
            search: plate,
          })
        ).items,
      ).toHaveLength(0);
    });
    it('filters rejected and approved requests correctly and paginates within each type', async () => {
      const detail = await repo.approvalDetails(f.admin, vehicleRequest);
      const rejected = await request(app)
        .post(`/provider-approvals/${vehicleRequest}/review`)
        .set('Authorization', 'Bearer ' + adminToken)
        .send({
          status: 'REJECTED',
          reason: 'TEST_ONLY correction required',
          expectedUpdatedAt: detail.target.updated_at,
        });
      expect(rejected.status).toBe(200);
      const rows = await repo.requestPage(f.admin, 'REJECTED', {
        kind: 'vehicle',
        page: 1,
        pageSize: 1,
        search: plate,
      });
      expect(rows.total).toBe(1);
      expect(rows.items[0]).toMatchObject({
        id: vehicleRequest,
        fleet_owner_id: f.owner,
        status: 'REJECTED',
      });
      expect(
        (
          await repo.requestPage(f.admin, 'PENDING', {
            kind: 'vehicle',
            page: 1,
            pageSize: 10,
            search: plate,
          })
        ).items,
      ).toHaveLength(0);
      const approved = await repo.requestPage(f.admin, 'APPROVED', {
        kind: 'vehicle',
        page: 1,
        pageSize: 10,
        search: f.vehicle.plateNumber,
      });
      expect(approved.items.some((row) => row.target_id === f.vehicle.id)).toBe(true);
      const all = await repo.requestPage(f.admin, 'ALL', {
        kind: 'vehicle',
        page: 1,
        pageSize: 1,
        search: f.owner,
      });
      const next = await repo.requestPage(f.admin, 'ALL', {
        kind: 'vehicle',
        page: 2,
        pageSize: 1,
        search: f.owner,
      });
      expect(all.total).toBeGreaterThan(1);
      expect(next.items).toHaveLength(1);
      expect(next.items[0].id).not.toBe(all.items[0].id);
      mkdirSync('docs/reports/evidence/fleet-request-fix-20261028', { recursive: true });
      writeFileSync(
        'docs/reports/evidence/fleet-request-fix-20261028/fleet-fixture.json',
        JSON.stringify({
          admin: f.admin,
          owner: f.owner,
          driver: driverId,
          driverRequest,
          vehicle: vehicleId,
          vehicleRequest,
          plate,
        }),
      );
    });
    it('repairs only recorded pending Fleet submissions and is safe to repeat', async()=>{
      await pool.query('UPDATE provider_approval_requests SET requester_id=$2,requester_role=\'driver\',fleet_id=NULL WHERE id=$1',[driverRequest,driverId]);
      const existing=(await pool.query('SELECT count(*)::int count FROM provider_approval_requests')).rows[0].count;
      const sql=readFileSync('migrations/087_fleet_request_submitter.sql','utf8');
      await pool.query(sql);await pool.query(sql);
      expect((await pool.query('SELECT requester_id,fleet_id,status FROM provider_approval_requests WHERE id=$1',[driverRequest])).rows[0]).toMatchObject({requester_id:f.owner,fleet_id:f.partner,status:'PENDING'});
      expect((await pool.query('SELECT count(*)::int count FROM provider_approval_requests')).rows[0].count).toBe(existing);
      expect((await pool.query('SELECT status FROM provider_approval_requests WHERE id=$1',[vehicleRequest])).rows[0].status).toBe('REJECTED');
    });
  },
);
