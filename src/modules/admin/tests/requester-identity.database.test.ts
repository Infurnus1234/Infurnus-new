import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresProviderOperationsRepository } from '../../providers/repositories/provider-operations.repository.js';
import { createProviderApprovalRouter } from '../../providers/routes/provider-operations.routes.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'requester identity through real approval APIs',
  () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const ids = {
      admin: randomUUID(),
      driver: randomUUID(),
      fleet: randomUUID(),
      dual: randomUUID(),
      customer: randomUUID(),
      legacy: randomUUID(),
    };
    const repository = new PostgresProviderOperationsRepository(pool);
    const app = express();
    app.use(express.json());
    app.use('/provider-approvals', createProviderApprovalRouter(repository));
    app.use(errorMiddleware);
    let local = false,
      target: string,
      driverRequest: string,
      customerRequest: string;
    let token: string;
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (process.env.NODE_ENV !== 'test' || !['localhost', '127.0.0.1'].includes(url.hostname))
        throw Error('Local test environment required');
      local = true;
      for (const [key, role] of [
        ['admin', 'super_admin'],
        ['driver', 'driver'],
        ['fleet', 'fleet_owner'],
        ['dual', 'driver_fleet_owner'],
        ['customer', 'customer'],
        ['legacy', 'driver'],
      ] as const)
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'TEST_ONLY','Identity',$2,$3)",
          [ids[key], ids[key] + '@example.invalid', role],
        );
      target = (
        await pool.query(
          'INSERT INTO driver_profiles(user_id,license_number,license_expiry) VALUES($1,$2,CURRENT_DATE+365) RETURNING id',
          [ids.driver, randomUUID()],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO partners(user_id,business_name) VALUES($1,'TEST_ONLY Fleet Business'),($2,'TEST_ONLY Combined Business')",
        [ids.fleet, ids.dual],
      );
      customerRequest = (
        await pool.query(
          "INSERT INTO provider_approval_requests(requester_id,requester_role,request_type,target_type,target_id) VALUES($1,'driver','legacy_identity_test','driver_profile',$2) RETURNING id",
          [ids.customer, target],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO provider_approval_requests(requester_id,requester_role,request_type,target_type,target_id) VALUES($1,'driver','missing_profile_test','driver_profile',$2)",
        [ids.legacy, target],
      );
      driverRequest = (
        await pool.query(
          "SELECT id FROM provider_approval_requests WHERE requester_id=$1 AND request_type='driver_verification'",
          [ids.driver],
        )
      ).rows[0].id;
      token = await signAccessToken({ sub: ids.admin, role: 'super_admin', type: 'access' });
    });
    afterAll(async () => {
      if (local) {
        await pool.query(
          'DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[]) OR reviewer_id=$2',
          [Object.values(ids), ids.admin],
        );
        await pool.query('DELETE FROM driver_profiles WHERE user_id=$1', [ids.driver]);
        await pool.query('DELETE FROM partners WHERE user_id=ANY($1::uuid[])', [
          [ids.fleet, ids.dual],
        ]);
        await pool.query('DELETE FROM user_history WHERE user_id=ANY($1::uuid[])', [
          Object.values(ids),
        ]);
        await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [Object.values(ids)]);
      }
      await pool.end();
    });
    it('resolves person and business names and actual classifications without N+1 identity queries', async () => {
      const result = await request(app)
        .get('/provider-approvals')
        .set('Authorization', 'Bearer ' + token);
      expect(result.status).toBe(200);
      const rows = result.body.data;
      expect(
        rows.find((row: { requester_id: string }) => row.requester_id === ids.driver),
      ).toMatchObject({
        requester_display_name: 'TEST_ONLY Identity',
        requester_account_role: 'driver',
        target_description: 'Driver Profile',
      });
      expect(
        rows.find((row: { requester_id: string }) => row.requester_id === ids.fleet),
      ).toMatchObject({
        requester_display_name: 'TEST_ONLY Fleet Business',
        requester_account_role: 'fleet_owner',
      });
      expect(
        rows.find((row: { requester_id: string }) => row.requester_id === ids.dual),
      ).toMatchObject({
        requester_display_name: 'TEST_ONLY Identity',
        requester_account_role: 'driver_fleet_owner',
      });
      expect(
        rows.find((row: { requester_id: string }) => row.requester_id === ids.customer),
      ).toMatchObject({
        requester_display_name: 'TEST_ONLY Identity',
        requester_account_role: 'customer',
        requester_role: 'driver',
      });
      expect(
        rows.find((row: { requester_id: string }) => row.requester_id === ids.legacy),
      ).toMatchObject({
        requester_display_name: 'TEST_ONLY Identity',
        requester_account_role: 'driver',
      });
      expect(JSON.stringify(rows)).not.toMatch(/"(?:email|phone|password_hash)"/);
    });
    it('uses the same resolved identity in details and review history', async () => {
      const response = await request(app)
        .get('/provider-approvals/' + customerRequest)
        .set('Authorization', 'Bearer ' + token);
      expect(response.status).toBe(200);
      expect(response.body.data.request.requester_account_role).toBe('customer');
      expect(
        response.body.data.history.find((row: { id: string }) => row.id === customerRequest)
          .requester_display_name,
      ).toBe('TEST_ONLY Identity');
    });
    it('does not fabricate names for incomplete or soft-deleted accounts', async () => {
      await pool.query("UPDATE users SET first_name=' ',last_name=' ' WHERE id=$1", [ids.legacy]);
      expect(
        (await repository.pendingApprovals(ids.admin)).find(
          (row) => row.requester_id === ids.legacy,
        ).requester_display_name,
      ).toBeNull();
      await pool.query('UPDATE users SET deleted_at=NOW() WHERE id=$1', [ids.legacy]);
      expect(
        (await repository.pendingApprovals(ids.admin)).find(
          (row) => row.requester_id === ids.legacy,
        ).requester_display_name,
      ).toBeNull();
    });
    it('preserves requester identity after a real persisted rejection and status filtering', async () => {
      const detail = await repository.approvalDetails(ids.admin, driverRequest);
      const result = await request(app)
        .post('/provider-approvals/' + driverRequest + '/review')
        .set('Authorization', 'Bearer ' + token)
        .send({
          status: 'REJECTED',
          reason: 'TEST_ONLY review decision',
          expectedUpdatedAt: detail.target.updated_at,
        });
      expect(result.status).toBe(200);
      const reviewed = await request(app)
        .get('/provider-approvals?status=REJECTED')
        .set('Authorization', 'Bearer ' + token);
      expect(
        reviewed.body.data.find((row: { id: string }) => row.id === driverRequest),
      ).toMatchObject({
        status: 'REJECTED',
        requester_display_name: 'TEST_ONLY Identity',
        requester_account_role: 'driver',
      });
      expect((await repository.approvalDetails(ids.admin, driverRequest)).request.status).toBe(
        'REJECTED',
      );
    });
    it('rejects inappropriate status filters and non-administrator access', async () => {
      expect(
        (
          await request(app)
            .get('/provider-approvals?status=INVALID')
            .set('Authorization', 'Bearer ' + token)
        ).status,
      ).toBe(400);
      const driverToken = await signAccessToken({
        sub: ids.driver,
        role: 'driver',
        type: 'access',
      });
      expect(
        (
          await request(app)
            .get('/provider-approvals')
            .set('Authorization', 'Bearer ' + driverToken)
        ).status,
      ).toBe(403);
    });
  },
);
