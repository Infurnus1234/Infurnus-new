import { describe, expect, it, vi } from 'vitest';
import { PostgresAdminRepository } from '../repositories/admin.repository.js';
import type { AdminFilters } from '../types/admin.js';

function poolForPage() {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    .mockResolvedValueOnce({ rows: [{ count: 0 }], rowCount: 1 });
  return { query, pool: { query } as never };
}

async function firstDataQuery(
  method: 'listUsers' | 'listPartners' | 'listVehicles',
  filters: AdminFilters,
) {
  const { pool, query } = poolForPage();
  await new PostgresAdminRepository(pool)[method](filters);
  return { sql: query.mock.calls[0]![0] as string, values: query.mock.calls[0]![1] as unknown[] };
}

describe('Admin repository filter matrix', () => {
  it.each([
    ['search', { search: 'Ada' }, ['%Ada%', 25, 0], 'ILIKE'],
    ['role', { role: 'driver' }, ['driver', 25, 0], 'role ='],
    ['status', { status: 'suspended' }, ['suspended', 25, 0], 'status ='],
    ['from', { from: '2026-01-01' }, ['2026-01-01', 25, 0], 'created_at >='],
    ['to', { to: '2026-01-31' }, ['2026-01-31', 25, 0], 'created_at <'],
  ] as const)('filters users by %s', async (_name, filters, expectedValues, fragment) => {
    const result = await firstDataQuery('listUsers', { page: 1, pageSize: 25, ...filters });
    expect(result.sql).toContain(fragment);
    expect(result.values).toEqual(expectedValues);
  });

  it('combines user search, role, status, date range, and pagination in order', async () => {
    const result = await firstDataQuery('listUsers', {
      page: 3,
      pageSize: 10,
      search: 'Ada',
      role: 'driver',
      status: 'active',
      from: '2026-01-01',
      to: '2026-01-31',
    });
    expect(result.sql).toContain('ILIKE');
    expect(result.sql).toContain('role = $2');
    expect(result.sql).toContain('status = $3');
    expect(result.sql).toContain('created_at >= $4::date');
    expect(result.sql).toContain('created_at < ($5::date');
    expect(result.values).toEqual([
      '%Ada%',
      'driver',
      'active',
      '2026-01-01',
      '2026-01-31',
      10,
      20,
    ]);
  });

  it.each([
    ['search', { search: 'Logistics' }, ['%Logistics%', 25, 0], 'p.business_name ILIKE'],
    ['approval', { approvalStatus: 'approved' }, ['approved', 25, 0], 'p.approval_status'],
    [
      'availability',
      { availabilityStatus: 'available' },
      ['available', 25, 0],
      'p.availability_status',
    ],
    ['document status', { documentStatus: 'VERIFIED' }, ['VERIFIED', 25, 0], 'partner_documents'],
    ['date from', { from: '2026-01-01' }, ['2026-01-01', 25, 0], 'p.created_at >='],
  ] as const)('filters partners by %s', async (_name, filters, expectedValues, fragment) => {
    const result = await firstDataQuery('listPartners', { page: 1, pageSize: 25, ...filters });
    expect(result.sql).toContain(fragment);
    expect(result.values).toEqual(expectedValues);
  });

  it.each([
    [
      'partner',
      { partnerId: '650e8400-e29b-41d4-a716-446655440000' },
      ['650e8400-e29b-41d4-a716-446655440000', 25, 0],
      'p.id =',
    ],
    ['active', { active: true }, [true, 25, 0], 'v.is_active ='],
    ['inactive', { active: false }, [false, 25, 0], 'v.is_active ='],
    ['plate', { plate: 'KA01' }, ['%KA01%', 25, 0], 'v.plate_number ILIKE'],
    ['make', { make: 'Toyota' }, ['%Toyota%', 25, 0], 'v.make ILIKE'],
    ['model', { model: 'Innova' }, ['%Innova%', 25, 0], 'v.model ILIKE'],
    ['document status', { documentStatus: 'EXPIRED' }, ['EXPIRED', 25, 0], 'pd.vehicle_id = v.id'],
    ['compliance', { complianceStatus: 'non_compliant' }, [25, 0], 'required(document_type)'],
  ] as const)('filters vehicles by %s', async (_name, filters, expectedValues, fragment) => {
    const result = await firstDataQuery('listVehicles', { page: 1, pageSize: 25, ...filters });
    expect(result.sql).toContain(fragment);
    expect(result.values).toEqual(expectedValues);
  });

  it('combines vehicle ownership, active state, plate, document, and date filters', async () => {
    const result = await firstDataQuery('listVehicles', {
      page: 2,
      pageSize: 5,
      partnerId: '650e8400-e29b-41d4-a716-446655440000',
      active: true,
      plate: 'KA01',
      documentStatus: 'VERIFIED',
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(result.sql).toContain('p.id = $1');
    expect(result.sql).toContain('v.is_active = $2');
    expect(result.sql).toContain('v.plate_number ILIKE $3');
    expect(result.sql).toContain('pd.status = $4');
    expect(result.values).toEqual([
      '650e8400-e29b-41d4-a716-446655440000',
      true,
      '%KA01%',
      'VERIFIED',
      '2026-01-01',
      '2026-12-31',
      5,
      5,
    ]);
  });
});
