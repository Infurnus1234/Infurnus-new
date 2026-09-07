import { describe, expect, it, vi } from 'vitest';
import { AdminService } from '../services/admin.service.js';
import type { AdminRepository } from '../repositories/admin.repository.js';

const repository = (overrides: Partial<AdminRepository> = {}): AdminRepository => ({
  listUsers: vi.fn().mockResolvedValue({ items: [], page: 2, pageSize: 10, total: 0 }),
  getUser: vi.fn().mockResolvedValue(null),
  listPartners: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 25, total: 0 }),
  getPartner: vi.fn().mockResolvedValue(null),
  listVehicles: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 25, total: 0 }),
  getVehicle: vi.fn().mockResolvedValue(null),
  dashboard: vi.fn().mockResolvedValue({}),
  ...overrides,
});

describe('AdminService', () => {
  it('passes validated pagination and filters to the repository', async () => {
    const listUsers = vi.fn().mockResolvedValue({ items: [], page: 2, pageSize: 10, total: 0 });
    const service = new AdminService(repository({ listUsers }));
    const filters = { page: 2, pageSize: 10, search: 'Ada', role: 'driver' as const };
    await expect(service.listUsers(filters)).resolves.toEqual({
      items: [],
      page: 2,
      pageSize: 10,
      total: 0,
    });
    expect(listUsers).toHaveBeenCalledWith(filters);
  });

  it('returns a not-found error for missing admin resources', async () => {
    const service = new AdminService(repository());
    await expect(service.getUser('550e8400-e29b-41d4-a716-446655440001')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
      statusCode: 404,
    });
    await expect(service.getPartner('650e8400-e29b-41d4-a716-446655440001')).rejects.toMatchObject({
      code: 'PARTNER_NOT_FOUND',
      statusCode: 404,
    });
    await expect(service.getVehicle('750e8400-e29b-41d4-a716-446655440001')).rejects.toMatchObject({
      code: 'VEHICLE_NOT_FOUND',
      statusCode: 404,
    });
  });
});
