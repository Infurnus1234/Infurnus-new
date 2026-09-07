import { describe, expect, it, vi } from 'vitest';
import { PostgresAdminRepository } from '../repositories/admin.repository.js';

function createPool() {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    .mockResolvedValueOnce({ rows: [{ count: 0 }], rowCount: 1 });
  return { query, pool: { query } as never };
}

describe('PostgresAdminRepository', () => {
  it('uses explicit projections and parameterized pagination/filter values', async () => {
    const { pool, query } = createPool();
    const repository = new PostgresAdminRepository(pool);
    await repository.listUsers({ page: 2, pageSize: 10, search: 'Ada', role: 'driver' });
    const dataSql = query.mock.calls[0]![0] as string;
    const values = query.mock.calls[0]![1] as unknown[];
    expect(dataSql).not.toContain('SELECT *');
    expect(dataSql).toContain('LIMIT $3 OFFSET $4');
    expect(values).toEqual(['%Ada%', 'driver', 10, 10]);
  });

  it('uses DB-side aggregation for the dashboard', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{}], rowCount: 1 });
    const pool = { query } as never;
    const repository = new PostgresAdminRepository(pool);
    await repository.dashboard();
    expect(query.mock.calls.length).toBe(7);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('FILTER (WHERE'))).toBe(true);
    expect(query.mock.calls.every(([sql]) => !String(sql).includes('SELECT *'))).toBe(true);
  });

  it('filters partner reports by document and compliance status', async () => {
    const { pool, query } = createPool();
    const repository = new PostgresAdminRepository(pool);
    await repository.listPartners({
      page: 1,
      pageSize: 25,
      documentStatus: 'VERIFIED',
      complianceStatus: 'expiring',
    });
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toContain('partner_documents');
    expect(sql).toContain('CURRENT_DATE + INTERVAL');
    expect(query.mock.calls[0]![1]).toEqual(['VERIFIED', 25, 0]);
  });

  it('filters vehicle reports by document and compliance status', async () => {
    const { pool, query } = createPool();
    const repository = new PostgresAdminRepository(pool);
    await repository.listVehicles({
      page: 1,
      pageSize: 25,
      documentStatus: 'EXPIRED',
      complianceStatus: 'non_compliant',
    });
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toContain('pd.vehicle_id = v.id');
    expect(sql).toContain('required(document_type)');
    expect(query.mock.calls[0]![1]).toEqual(['EXPIRED', 25, 0]);
  });

  it('projects separate partner KYC statuses', async () => {
    const { pool, query } = createPool();
    await new PostgresAdminRepository(pool).getPartner('650e8400-e29b-41d4-a716-446655440000');
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toContain('aadhaarStatus');
    expect(sql).toContain('panStatus');
    expect(sql).toContain('drivingLicenceStatus');
    expect(sql).toContain('profilePhotoStatus');
    expect(sql).toContain('addressProofStatus');
  });
});
