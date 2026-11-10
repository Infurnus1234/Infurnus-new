import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { PostgresDriverDocumentRepository } from '../../rides/repositories/driver-document.repository.js';
import { administrativePermissionGate } from '../../admin/middleware/permission.middleware.js';
import { createProviderApprovalRouter } from '../routes/provider-operations.routes.js';
import { PostgresProviderOperationsRepository } from '../repositories/provider-operations.repository.js';
import { actor } from './fleet-workflow-fixture.js';

async function vehicles(ownerId: string, count: number) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO vehicles(owner_id,make,model,plate_number,category,sector,verification_status,is_active)
     SELECT $1,'Test','Sedan',left(gen_random_uuid()::text,18),'sedan','passenger','pending',false
     FROM generate_series(1,$2) RETURNING id`,
    [ownerId, count],
  );
  return rows.map(({ id }) => id);
}

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')('Fleet Owner request workspace', () => {
  const approvals = new PostgresProviderOperationsRepository(pool);
  const app = express();
  app.use(express.json());
  const grants = new Map<string, string[]>();
  app.use(
    administrativePermissionGate({
      identity: async (id) => ({ role: 'admin', permissions: grants.get(id) ?? [], scoped: false }),
    } as Parameters<typeof administrativePermissionGate>[0]),
  );
  app.use('/provider-approvals', createProviderApprovalRouter(approvals));
  app.use(errorMiddleware);
  const base = '/provider-approvals/fleet-owners';

  beforeAll(() => {
    if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
      throw Error('Owned disposable database required');
  });

  it('keeps 50 mixed requests under one canonical ID with audited, isolated and idempotent decisions', async () => {
    const admin = await actor('admin');
    const limited = await actor('admin');
    grants.set(admin, [
      'approvals.read',
      'approvals.detail',
      'approvals.documents',
      'approvals.approve',
      'approvals.reject',
    ]);
    grants.set(limited, ['approvals.read', 'approvals.detail']);
    const token = await signAccessToken({ sub: admin, role: 'admin', type: 'access' });
    const limitedToken = await signAccessToken({ sub: limited, role: 'admin', type: 'access' });
    const fleetUser = await actor('fleet_owner');
    const secondUser = await actor('fleet_owner');
    const makePartner = async (user: string) =>
      (
        await pool.query<{ id: string; key: string }>(
          "INSERT INTO partners(user_id,business_name) VALUES($1,'Shared test name') RETURNING id,provider_public_id(user_id) AS key",
          [user],
        )
      ).rows[0]!;
    const fleet = await makePartner(fleetUser);
    const second = await makePartner(secondUser);
    const vehicleIds = await vehicles(fleetUser, 25);
    const [foreignVehicle] = await vehicles(secondUser, 1);
    await pool.query('UPDATE vehicles SET registration_expiry=CURRENT_DATE-1 WHERE id=$1', [
      vehicleIds[2],
    ]);
    for (let i = 0; i < 23; i++) {
      const user = await actor('driver');
      await pool.query(
        'INSERT INTO driver_profiles(user_id,license_number,license_expiry) VALUES($1,$2,CURRENT_DATE+365)',
        [user, 'TEST-' + randomUUID()],
      );
      if (i === 0) {
        await pool.query(
          `INSERT INTO driver_onboarding_invitations(partner_id,driver_user_id,status,expires_at,consumed_at)
           VALUES($1,$2,'CONSUMED',NOW()+interval '1 day',NOW())`,
          [fleet.id, user],
        );
      } else {
        await pool.query(
          'INSERT INTO fleet_managed_driver_accounts(driver_user_id,partner_id,created_by) VALUES($1,$2,$3)',
          [user, fleet.id, fleetUser],
        );
      }
    }
    const applicant = await actor('driver');
    const {
      rows: [driver],
    } = await pool.query(
      `INSERT INTO driver_profiles(user_id,license_number,license_expiry,verification_status,verified_by,verified_at)
       VALUES($1,$2,CURRENT_DATE+365,'approved',$3,NOW()) RETURNING id`,
      [applicant, 'TEST-' + randomUUID(), admin],
    );
    const doc = await new PostgresDriverDocumentRepository(pool).create({
      driverProfileId: driver.id,
      documentType: 'driver_license',
      storageProvider: 'cloudinary',
      storageKey: 'synthetic/fleet-workspace-licence',
      resourceType: 'image',
      accessMode: 'authenticated',
      mimeType: 'image/jpeg',
      fileSize: 10,
      uploadedBy: applicant,
    });
    const {
      rows: [application],
    } = await pool.query(
      `INSERT INTO driver_applications(partner_id,driver_profile_id,requested_sector,requested_vehicle_category,vehicle_ownership_type,submitted_at)
       VALUES($1,$2,'passenger','sedan','DRIVER_ONLY',NOW()) RETURNING id`,
      [fleet.id, driver.id],
    );
    const dir = await request(app)
      .get(base)
      .query({ search: fleet.key })
      .auth(token, { type: 'bearer' });
    expect(dir.status, dir.text).toBe(200);
    expect(dir.body.data.items.map((entry: { public_id: string }) => entry.public_id)).toEqual([
      fleet.key,
    ]);
    const read = (key: string, query: Record<string, string | number> = {}) =>
      request(app).get(`${base}/${key}/requests`).query(query).auth(token, { type: 'bearer' });
    const first = await read(fleet.key);
    const next = await read(fleet.key, { offset: 25 });
    expect(first.status, first.text).toBe(200);
    expect(next.status, next.text).toBe(200);
    expect(first.body.data.counts).toEqual({ pending: 50, approved: 0, rejected: 0, total: 50 });
    expect(first.body.data.owner.email).toBeUndefined();
    expect(first.body.data.vehicle_count).toBe(25);
    expect(first.body.data.hasNext).toBe(true);
    expect(next.body.data.hasNext).toBe(false);
    const all = [...first.body.data.items, ...next.body.data.items];
    expect(new Set(all.map((row) => row.id)).size).toBe(50);
    expect(all.filter((row) => row.category === 'vehicle')).toHaveLength(25);
    expect(all.filter((row) => row.category === 'driver')).toHaveLength(23);
    expect(all.find((row) => row.id === application.id)).toMatchObject({
      source: 'application',
      category: 'association',
    });
    const evidencePath = `/provider-approvals/fleet-applications/${application.id}/evidence`;
    const evidence = await request(app).get(evidencePath).auth(token, { type: 'bearer' });
    expect(evidence.status, evidence.text).toBe(200);
    expect(evidence.body.data.documents).toEqual([
      expect.objectContaining({ id: doc.id, documentType: 'driver_license' }),
    ]);
    expect(JSON.stringify(evidence.body)).not.toContain(doc.storageKey);
    expect(
      (await request(app).get(evidencePath).auth(limitedToken, { type: 'bearer' })).status,
    ).toBe(403);
    const unrelated = await request(app)
      .get(
        `/provider-approvals/fleet-applications/${application.id}/documents/${randomUUID()}/access-url`,
      )
      .auth(token, { type: 'bearer' });
    expect(unrelated.status).toBe(404);
    const other = await read(second.key);
    expect(other.status, other.text).toBe(200);
    expect(other.body.data.items.map((row: { target_id: string }) => row.target_id)).toContain(
      foreignVehicle,
    );
    expect(
      other.body.data.items.some((row: { id: string }) => all.some((item) => item.id === row.id)),
    ).toBe(false);

    const select = (row: { id: string; source: string; expected_updated_at: string }) => ({
      id: row.id,
      source: row.source,
      expectedUpdatedAt: row.expected_updated_at,
    });
    const chosen = vehicleIds
      .slice(0, 3)
      .map((id) => select(all.find((row) => row.target_id === id)));
    const foreign = select(
      other.body.data.items.find((row: { target_id: string }) => row.target_id === foreignVehicle),
    );
    const review = (
      items: ReturnType<typeof select>[],
      status = 'APPROVED',
      credential = token,
      reason?: string,
    ) =>
      request(app)
        .post(`${base}/${fleet.key}/review`)
        .auth(credential, { type: 'bearer' })
        .send({ status, items, ...(reason ? { reason } : {}) });
    expect((await review(chosen, 'APPROVED', limitedToken)).status).toBe(403);
    expect((await review(chosen, 'REJECTED')).status).toBe(400);
    const bulk = await review([...chosen, foreign]);
    expect(bulk.status, bulk.text).toBe(200);
    expect(bulk.body.data.map((row: { outcome: string }) => row.outcome)).toEqual([
      'applied',
      'applied',
      'failed',
      'failed',
    ]);
    expect(bulk.body.data[2].code).toBe('DOCUMENT_EXPIRED');
    expect(bulk.body.data[3].code).toBe('FLEET_REQUEST_NOT_FOUND');
    const countAudits = async () =>
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM user_history WHERE user_id=$1 AND entity_type='provider_approval_requests' AND entity_id=$2",
          [admin, chosen[0]!.id],
        )
      ).rows[0].count;
    const audited = await countAudits();
    expect(audited).toBeGreaterThan(0);
    expect((await review([chosen[0]!])).body.data[0].outcome).toBe('unchanged');
    expect(await countAudits()).toBe(audited);
    const rejected = await review([chosen[2]!], 'REJECTED', token, 'Renew the registration');
    expect(rejected.body.data[0]).toMatchObject({ outcome: 'applied', status: 'REJECTED' });
    const applicationSelection = select(all.find((row) => row.id === application.id));
    const blockedApplication = await review([applicationSelection]);
    expect(blockedApplication.body.data[0]).toMatchObject({
      outcome: 'failed',
      code: 'DRIVER_NOT_ELIGIBLE',
    });
    const applicationResult = await review(
      [applicationSelection],
      'REJECTED',
      token,
      'Fleet declined',
    );
    expect(applicationResult.body.data[0]).toMatchObject({
      outcome: 'applied',
      status: 'REJECTED',
    });
    const concurrent = select(all.find((row) => row.target_id === vehicleIds[3]));
    const duplicates = await Promise.all([review([concurrent]), review([concurrent])]);
    expect(duplicates.map((res) => res.body.data[0].outcome).sort()).toEqual([
      'applied',
      'unchanged',
    ]);

    const individual = select(all.find((row) => row.target_id === vehicleIds[4]));
    const single = await request(app)
      .post(`/provider-approvals/${individual.id}/review`)
      .auth(token, { type: 'bearer' })
      .send({ status: 'APPROVED', expectedUpdatedAt: individual.expectedUpdatedAt });
    expect(single.status, single.text).toBe(200);
    expect(
      (await read(fleet.key, { category: 'vehicle', status: 'APPROVED' })).body.data.items,
    ).toHaveLength(4);
  });
});
