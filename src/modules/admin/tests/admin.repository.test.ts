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

    await repository.listUsers({
      page: 2,
      pageSize: 10,
      search: 'Ada',
      role: 'driver',
    });

    const dataSql = query.mock.calls[0]![0] as string;
    const values = query.mock.calls[0]![1] as unknown[];

    expect(dataSql).not.toContain('SELECT *');
    expect(dataSql).toContain('LIMIT $3 OFFSET $4');
    expect(values).toEqual(['%Ada%', 'driver', 10, 10]);
  });

  it('uses DB-side aggregation for the dashboard', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{}],
      rowCount: 1,
    });

    const pool = { query } as never;
    const repository = new PostgresAdminRepository(pool);

    const result = await repository.dashboard();

    expect(query.mock.calls.length).toBe(9);

    expect(result).toEqual({
      users: {},
      drivers: {},
      partners: {},
      pendingApprovals: 0,
      vehicles: {},
      kyc: {},
      vehicleCompliance: {
        insuranceExpiringOrExpired: 0,
        permitsExpiringOrExpired: 0,
        fitnessExpiringOrExpired: 0,
      },
    });

    expect(query.mock.calls.some(([sql]) => String(sql).includes('FILTER (WHERE'))).toBe(true);

    const driverQuery = query.mock.calls[1]![0] as string;

    expect(driverQuery).toContain('FROM driver_profiles dp');
    expect(driverQuery).toContain('INNER JOIN users u ON u.id = dp.user_id');
    expect(driverQuery).toContain('u.deleted_at IS NULL');
    expect(driverQuery).toContain("u.role = 'driver'");

    const pendingApprovalQuery = query.mock.calls[3]![0] as string;

    expect(pendingApprovalQuery).toContain('FROM driver_applications da');
    expect(pendingApprovalQuery).toContain('INNER JOIN driver_profiles dp');
    expect(pendingApprovalQuery).toContain('INNER JOIN users u');
    expect(pendingApprovalQuery).toContain(
      "da.status IN ('PENDING', 'UNDER_REVIEW', 'CHANGES_REQUESTED')",
    );
    expect(pendingApprovalQuery).toContain('u.deleted_at IS NULL');
    expect(pendingApprovalQuery).toContain("u.role = 'driver'");

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

    const repository = new PostgresAdminRepository(pool);

    await repository.getPartner('650e8400-e29b-41d4-a716-446655440000');

    const sql = query.mock.calls[0]![0] as string;

    expect(sql).toContain('aadhaarStatus');
    expect(sql).toContain('panStatus');
    expect(sql).toContain('drivingLicenceStatus');
    expect(sql).toContain('profilePhotoStatus');
    expect(sql).toContain('addressProofStatus');
  });

  it('projects partner drivers in the fleet detail response', async () => {
    const { pool, query } = createPool();

    const repository = new PostgresAdminRepository(pool);

    await repository.getPartner('650e8400-e29b-41d4-a716-446655440000');

    const sql = query.mock.calls[0]![0] as string;

    expect(sql).toContain('AS "drivers"');
    expect(sql).toContain('FROM partner_drivers pd');
    expect(sql).toContain('INNER JOIN driver_profiles d ON d.id = pd.driver_profile_id');
    expect(sql).toContain('INNER JOIN users u ON u.id = d.user_id');
    expect(sql).toContain('pd.partner_id = p.id');
    expect(sql).toContain("pd.status = 'ACTIVE'");
    expect(sql).toContain("u.role = 'driver'");
    expect(sql).toContain('u.deleted_at IS NULL');

    expect(sql).toContain("'id', d.id");
    expect(sql).toContain("'userId', d.user_id");
    expect(sql).toContain("'firstName', u.first_name");
    expect(sql).toContain("'lastName', u.last_name");
    expect(sql).toContain("'email', u.email");
    expect(sql).toContain("'phone', u.phone");
    expect(sql).toContain("'verificationStatus', d.verification_status");
    expect(sql).toContain("'availabilityStatus', d.availability_status");
    expect(sql).toContain("'licenseNumber', d.license_number");
    expect(sql).toContain("'licenseExpiry', d.license_expiry");
    expect(sql).toContain("'city', d.city");
    expect(sql).toContain("'state', d.state");
    expect(sql).toContain("'pinCode', d.pin_code");
  });

  it('filters fleet drivers by partnerId', async () => {
    const { pool, query } = createPool();

    const repository = new PostgresAdminRepository(pool);

    const partnerId = '750e8400-e29b-41d4-a716-446655440000';

    await repository.listDrivers({
      page: 1,
      pageSize: 25,
      partnerId,
    });

    const sql = query.mock.calls[0]![0] as string;
    const values = query.mock.calls[0]![1] as unknown[];

    expect(sql).toContain('partner.id = $1');
    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).toContain('partner_drivers pd');
    expect(sql).toContain("pd.status = 'ACTIVE'");

    expect(values).toEqual([partnerId, 25, 0]);
  });

  it('filters fleet vehicles by partnerId', async () => {
    const { pool, query } = createPool();

    const repository = new PostgresAdminRepository(pool);

    const partnerId = '850e8400-e29b-41d4-a716-446655440000';

    await repository.listVehicles({
      page: 1,
      pageSize: 25,
      partnerId,
    });

    const sql = query.mock.calls[0]![0] as string;
    const values = query.mock.calls[0]![1] as unknown[];

    expect(sql).toContain('LEFT JOIN partners p ON p.user_id = d.user_id');
    expect(sql).toContain('p.id = $1');

    expect(values).toEqual([partnerId, 25, 0]);
  });

  it('updates user status with a parameterized query and returns the updated user', async () => {
    const userId = '650e8400-e29b-41d4-a716-446655440000';

    const updatedUser = {
      id: userId,
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      phone: '+919999999999',
      role: 'customer',
      status: 'suspended',
      createdAt: new Date(),
    };

    const query = vi.fn().mockResolvedValue({
      rows: [updatedUser],
      rowCount: 1,
    });

    const pool = { query } as never;
    const repository = new PostgresAdminRepository(pool);

    const result = await repository.updateUserStatus(userId, 'suspended');

    expect(result).toEqual(updatedUser);

    const sql = query.mock.calls[0]![0] as string;
    const values = query.mock.calls[0]![1] as unknown[];

    expect(sql).toContain('UPDATE users');
    expect(sql).toContain('SET status = $1');
    expect(sql).toContain('updated_at = NOW()');
    expect(sql).toContain('WHERE id = $2');
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('RETURNING');
    expect(sql).not.toContain('SELECT *');

    expect(values).toEqual(['suspended', userId]);
  });

  it('returns null when updating status for a missing or deleted user', async () => {
    const userId = '750e8400-e29b-41d4-a716-446655440000';

    const query = vi.fn().mockResolvedValue({
      rows: [],
      rowCount: 0,
    });

    const pool = { query } as never;
    const repository = new PostgresAdminRepository(pool);

    const result = await repository.updateUserStatus(userId, 'banned');

    expect(result).toBeNull();

    const values = query.mock.calls[0]![1] as unknown[];

    expect(values).toEqual(['banned', userId]);
  });
});
