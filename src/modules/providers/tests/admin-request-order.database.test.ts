import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { newestFirstSql } from '../../../common/utils/chronological-order.js';
import { requireDisposableAdministrativeDatabase } from '../../admin/tests/administrative-test-database.js';
import { PostgresAdminRepository } from '../../admin/repositories/admin.repository.js';
import { fixture } from './fleet-workflow-fixture.js';
import { PostgresProviderOperationsRepository } from '../repositories/provider-operations.repository.js';
import { FleetOwnerOverviewRepository } from '../repositories/fleet-owner-overview.repository.js';
import { createProviderApprovalRouter } from '../routes/provider-operations.routes.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { signAccessToken } from '../../auth/utils/jwt.js';

describe('chronological SQL identifiers', () => {
  it('shares descending creation and ID order and rejects request-supplied SQL', () => {
    expect(newestFirstSql()).toBe('created_at DESC, id DESC');
    expect(() => newestFirstSql('created_at; DELETE FROM users')).toThrow();
  });
});

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')('Admin newest-first lists on real PostgreSQL', () => {
  const repository = new PostgresProviderOperationsRepository(pool);
  const accounts = new PostgresAdminRepository(pool);
  const app = express();
  app.use(express.json());
  app.use('/provider-approvals', createProviderApprovalRouter(repository));
  app.use(errorMiddleware);
  const marker = 'SORT-' + randomUUID().slice(0, 8);
  const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
  const rows: { id: string; type: string; submitted_at: string }[] = [];
  let token: string;
  const times = ['2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z', '2026-01-01T12:00:00Z', '2026-01-01T12:00:00Z'];
  beforeAll(async () => {
    requireDisposableAdministrativeDatabase();
    const newest=(await pool.query(`SELECT GREATEST(COALESCE(max(submitted_at),NOW()),NOW()) AS stamp FROM provider_approval_requests`)).rows[0].stamp;
    // Keep all twelve owned rows inside the legacy endpoint's newest-100 page.
    for (let i=0;i<times.length;i++) times[i]=new Date(new Date(newest).getTime()+(Math.min(i,2)+1)*3600000).toISOString();
    for (let i = 0; i < times.length; i++) {
      const f = await fixture();
      fixtures.push(f);
      await pool.query('UPDATE users SET first_name=$2,created_at=$3 WHERE id=ANY($1::uuid[])', [[f.owner, f.driver], marker, times[i]]);
      await pool.query('UPDATE driver_profiles SET created_at=$2 WHERE id=$1', [f.profile, times[i]]);
      await pool.query('UPDATE partners SET created_at=$2 WHERE id=$1', [f.partner, times[i]]);
      await pool.query('UPDATE vehicles SET created_at=$2,plate_number=$3,sector=$4,category=$5 WHERE id=$1', [
        f.vehicle.id, times[i], marker + '-' + i,
        ['passenger', 'logistics', 'premium', 'service'][i], ['sedan', 'mini_truck', 'thar', 'ambulance'][i],
      ]);
      await pool.query('DELETE FROM provider_approval_requests WHERE target_id=ANY($1::uuid[])', [[f.profile, f.partner, f.vehicle.id]]);
      for (const [type, target, requester, role] of [
        ['driver_profile', f.profile, f.driver, 'driver'],
        ['vehicle', f.vehicle.id, f.owner, 'fleet_owner'],
        ['partner', f.partner, f.owner, 'fleet_owner'],
      ]) {
        const id = randomUUID();
        await pool.query(`INSERT INTO provider_approval_requests(id,requester_id,requester_role,fleet_id,request_type,target_type,target_id,submitted_at)
          VALUES($1,$2,$3,$4,'verification',$5,$6,$7)`, [id, requester, role, f.partner, type, target, times[i]]);
        rows.push({ id, type: type!, submitted_at: times[i]! });
      }
    }
    await pool.query("UPDATE users SET role='super_admin' WHERE id=$1", [fixtures[0]!.admin]);
    token = await signAccessToken({ sub: fixtures[0]!.admin, role: 'super_admin', type: 'access' });
  });
  afterAll(async () => { await pool.end(); });
  const sorted = (type?: string) => rows.filter(row => !type || row.type === type).sort((a, b) =>
    Date.parse(b.submitted_at) - Date.parse(a.submitted_at) || (a.id < b.id ? 1 : -1));
  async function get(query: string) {
    const response = await request(app).get('/provider-approvals?' + query).set('Authorization', 'Bearer ' + token);
    expect(response.status).toBe(200);
    return response.body.data;
  }
  for (const [kind, type] of [['driver', 'driver_profile'], ['vehicle', 'vehicle']]) {
    it(`${kind} requests retain newest-first order through refresh, search and page boundaries`, async () => {
      const query = `kind=${kind}&status=PENDING&search=${marker}&pageSize=2`;
      const first = await get(query + '&page=1');
      const second = await get(query + '&page=2');
      expect(first.total).toBe(4);
      expect([...first.items, ...second.items].map((row: { id: string }) => row.id)).toEqual(sorted(type).map((row: { id: string }) => row.id));
      expect((await get(query + '&page=1')).items).toEqual(first.items);
      expect((await get(query + '&page=3')).items).toEqual([]);
      const all = await get(`kind=${kind}&status=ALL&search=${marker}&pageSize=10`);
      expect(all.items.map((row: { id: string }) => row.id)).toEqual(sorted(type).map((row: { id: string }) => row.id));
    });
  }
  it('Approval Center and Fleet Owner requests use the same ordering for grouped and ungrouped reads', async () => {
    for (const group of ['', '&group=driver']) {
      const response = await get('status=PENDING' + group);
      const own = response.filter((row: { id: string }) => rows.some(seed => seed.id === row.id));
      expect(own.map((row: { id: string }) => row.id)).toEqual(sorted().map((row: { id: string }) => row.id));
      expect(own.filter((row: { target_type: string }) => row.target_type === 'partner').map((row: { id: string }) => row.id)).toEqual(sorted('partner').map((row: { id: string }) => row.id));
    }
  });
  it('vehicle status filters use creation time, including Logistics, Premium and Service vehicles', async () => {
    const ids = sorted('vehicle').map((row: { id: string }) => row.id);
    for (const status of ['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'PENDING']) {
      await pool.query(`UPDATE provider_approval_requests SET status=$2,reviewer_id=$3,reviewer_role='super_admin',reviewed_at=NOW(),rejection_reason='TEST_ONLY sorting filter' WHERE id=ANY($1::uuid[])`, [ids, status, fixtures[0]!.admin]);
      const response = await get(`kind=vehicle&status=${status}&search=${marker}&pageSize=10`);
      expect(response.items.map((row: { id: string }) => row.id)).toEqual(ids);
      expect(new Set(response.items.map((row: { sector: string }) => row.sector))).toEqual(new Set(['passenger', 'logistics', 'premium', 'service']));
    }
  });
  it('management records retain newest creation first with deterministic ties', async () => {
    const base = { page: 1, pageSize: 2, search: marker };
    for (const method of ['listUsers', 'listDrivers', 'listPartners', 'listVehicles', 'getLiveFleetVehicles'] as const) {
      const expected = (await accounts[method]({ ...base, pageSize: 25 })).items;
      for (let i = 1; i < expected.length; i++) {
        const a = expected[i - 1]!, b = expected[i]!;
        const timeA = new Date(a.createdAt).getTime(), timeB = new Date(b.createdAt).getTime();
        expect(timeA).toBeGreaterThanOrEqual(timeB);
        if (timeA === timeB) expect(a.id > b.id).toBe(true);
      }
      const page1 = await accounts[method](base), page2 = await accounts[method]({ ...base, page: 2 });
      expect([...page1.items, ...page2.items].map((row: { id: string }) => row.id)).toEqual(expected.slice(0, 4).map((row: { id: string }) => row.id));
    }
  });
  it('Fleet Owner workspace orders documents, drivers and vehicles by creation rather than later updates', async () => {
    const repo = new FleetOwnerOverviewRepository(pool);
    const owner = fixtures[0]!;
    for (const f of fixtures.slice(1)) {
      await pool.query('UPDATE vehicles SET owner_id=$2 WHERE id=$1', [f.vehicle.id, owner.owner]);
      await pool.query('INSERT INTO partner_drivers(partner_id,driver_profile_id) VALUES($1,$2)', [owner.partner, f.profile]);
    }
    for (const section of ['vehicles', 'drivers'] as const) {
      const table = section === 'vehicles' ? 'vehicles' : 'driver_profiles';
      const ids = fixtures.map(f => section === 'vehicles' ? f.vehicle.id : f.profile);
      // Editing an old record must not make it a new registration.
      await pool.query(`UPDATE ${table} SET updated_at=NOW() WHERE id=$1`, [ids[0]]);
      const expected = (await pool.query(`SELECT id FROM ${table} WHERE id=ANY($1::uuid[]) ORDER BY created_at DESC,id DESC`, [ids])).rows.map(row => row.id);
      const page1 = await repo.read(owner.admin, owner.partner, section, 2, 0, '', 'ALL');
      const page2 = await repo.read(owner.admin, owner.partner, section, 2, 2, '', 'ALL');
      expect([...page1.items, ...page2.items].map((row: { id: string }) => row.id)).toEqual(expected);
    }
  });
  it('a new request appears first on a fresh read without manual sorting', async () => {
    const f = await fixture();
    await pool.query('UPDATE users SET first_name=$2 WHERE id=$1', [f.owner, marker]);
    const created = await repository.requestApproval(f.owner, 'fleet_owner', {
      targetType: 'vehicle', targetId: f.vehicle.id, requestType: 'compliance_review',
    });
    await pool.query('UPDATE provider_approval_requests SET submitted_at=$2 WHERE id=$1',[created.id,new Date(Date.parse(times[times.length-1]!)+3600000).toISOString()]);
    for (let refresh = 0; refresh < 2; refresh++) {
      const response = await get(`kind=vehicle&status=PENDING&search=${marker}&pageSize=2&page=1`);
      expect(response.items[0].id).toBe(created.id);
    }
  });
  it('read-only listing leaves request records, timestamps and statuses unchanged', async () => {
    const snapshot = async () => (await pool.query('SELECT * FROM provider_approval_requests WHERE id=ANY($1::uuid[]) ORDER BY id', [rows.map((row: { id: string }) => row.id)])).rows;
    const before = await snapshot();
    await get('status=ALL');
    await get(`kind=vehicle&status=PENDING&search=${marker}&pageSize=2&page=2`);
    await get(`kind=driver&status=PENDING&search=${marker}&pageSize=2&page=1`);
    expect(await snapshot()).toEqual(before);
  });
});
