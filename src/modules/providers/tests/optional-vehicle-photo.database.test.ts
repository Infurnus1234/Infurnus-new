import { describe, expect, it, beforeAll } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { fixture } from './fleet-workflow-fixture.js';
import { PostgresProviderOperationsRepository } from '../repositories/provider-operations.repository.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Optional vehicle photograph review',
  () => {
    const repo = new PostgresProviderOperationsRepository(pool);
    beforeAll(() => {
      if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
        throw Error('Owned disposable database required');
    });
    it.each([false, true])(
      'approves an otherwise eligible vehicle with photo=%s',
      async (photo) => {
        const f = await fixture();
        await pool.query(
          "UPDATE vehicles SET verification_status='pending',verified_by=NULL,verified_at=NULL,is_active=FALSE WHERE id=$1",
          [f.vehicle.id],
        );
        if (photo)
          await pool.query(
            `INSERT INTO partner_documents(partner_id,vehicle_id,document_type,metadata) VALUES($1,$2,'OTHER',$3::jsonb)`,
            [
              f.partner,
              f.vehicle.id,
              JSON.stringify({
                documentCode: 'vehicle_front_photo',
                storage: { storageKey: 'synthetic/fixture', mimeType: 'image/png' },
              }),
            ],
          );
        const approval = await repo.requestApproval(f.owner, 'fleet_owner', {
          targetType: 'vehicle',
          targetId: f.vehicle.id,
          requestType: 'vehicle_verification',
        });
        const version = (
          await pool.query('SELECT updated_at::text AS version FROM vehicles WHERE id=$1', [
            f.vehicle.id,
          ])
        ).rows[0].version;
        await repo.reviewApproval(f.admin, approval.id, {
          status: 'APPROVED',
          expectedUpdatedAt: version,
        });
        expect(
          (await pool.query('SELECT verification_status FROM vehicles WHERE id=$1', [f.vehicle.id]))
            .rows[0].verification_status,
        ).toBe('approved');
        expect(
          (
            await pool.query('SELECT status FROM provider_approval_requests WHERE id=$1', [
              approval.id,
            ])
          ).rows[0].status,
        ).toBe('APPROVED');
      },
    );
    it('still rejects expired registration and leaves the request pending', async () => {
      const f = await fixture();
      await pool.query(
        "UPDATE vehicles SET verification_status='pending',verified_by=NULL,verified_at=NULL,is_active=FALSE,registration_expiry=CURRENT_DATE-1 WHERE id=$1",
        [f.vehicle.id],
      );
      const approval = await repo.requestApproval(f.owner, 'fleet_owner', {
        targetType: 'vehicle',
        targetId: f.vehicle.id,
        requestType: 'vehicle_verification',
      });
      const version = (
        await pool.query('SELECT updated_at::text AS version FROM vehicles WHERE id=$1', [
          f.vehicle.id,
        ])
      ).rows[0].version;
      await expect(
        repo.reviewApproval(f.admin, approval.id, {
          status: 'APPROVED',
          expectedUpdatedAt: version,
        }),
      ).rejects.toMatchObject({ code: 'DOCUMENT_EXPIRED' });
      expect(
        (
          await pool.query('SELECT status FROM provider_approval_requests WHERE id=$1', [
            approval.id,
          ])
        ).rows[0].status,
      ).toBe('PENDING');
    });
  },
);
