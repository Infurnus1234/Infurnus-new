import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import type { AdminRepository } from '../repositories/admin.repository.js';
import type { AdminFilters, AdminPartner, AdminUser, AdminVehicle, Page } from '../types/admin.js';

const adminId = '550e8400-e29b-41d4-a716-446655440000';
const userId = '650e8400-e29b-41d4-a716-446655440000';
const tokenFor = (role: string) => signAccessToken({ sub: adminId, role, type: 'access' });

class Repository implements AdminRepository {
  listUsers = async (_filters: AdminFilters): Promise<Page<AdminUser>> => ({
    items: [{} as AdminUser],
    page: 1,
    pageSize: 25,
    total: 1,
  });
  getUser = async (id: string) => (id === userId ? ({ id } as never) : null);
  listPartners = async (_filters: AdminFilters): Promise<Page<AdminPartner>> => ({
    items: [{} as AdminPartner],
    page: 1,
    pageSize: 25,
    total: 1,
  });
  getPartner = async (id: string) => (id === userId ? ({ id } as never) : null);
  listVehicles = async (_filters: AdminFilters): Promise<Page<AdminVehicle>> => ({
    items: [{} as AdminVehicle],
    page: 1,
    pageSize: 25,
    total: 1,
  });
  getVehicle = async (id: string) => (id === userId ? ({ id } as never) : null);
  dashboard = async () => ({
    users: { total: 2, active: 1, suspended: 1 },
    partners: { total: 1, approved: 1, pending: 0, active: 1 },
    vehicles: { total: 1, active: 1 },
    kyc: { pending: 0, verified: 1, rejected: 0, expired: 0 },
    vehicleCompliance: {
      insuranceExpiringOrExpired: 0,
      permitsExpiringOrExpired: 0,
      fitnessExpiringOrExpired: 0,
    },
  });
}

describe('Admin API route matrix', () => {
  const app = createApp(undefined, undefined, undefined, undefined, new Repository());

  it.each([
    '/admin/users',
    '/admin/partners',
    '/admin/vehicles',
    '/admin/dashboard',
    '/admin/reports/users',
    '/admin/reports/partners',
    '/admin/reports/vehicles',
  ])('returns 401 for unauthenticated %s', async (path) => {
    expect((await request(app).get(path)).status).toBe(401);
  });

  it.each(['customer', 'driver'])('returns 403 for non-admin role %s', async (role) => {
    const token = await tokenFor(role);
    expect(
      (await request(app).get('/admin/dashboard').set('authorization', `Bearer ${token}`)).status,
    ).toBe(403);
  });

  it.each(['admin', 'super_admin'])('allows admin role %s to read the dashboard', async (role) => {
    const token = await tokenFor(role);
    const response = await request(app)
      .get('/admin/dashboard')
      .set('authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.data.users.total).toBe(2);
  });

  it.each([
    ['/admin/users', 'role=driver&status=active&page=2&pageSize=10'],
    ['/admin/partners', 'approvalStatus=approved&documentStatus=VERIFIED'],
    ['/admin/vehicles', 'active=true&complianceStatus=expiring&plate=KA01'],
  ])('passes validated filters for %s', async (path, query) => {
    const token = await tokenFor('admin');
    const response = await request(app)
      .get(`${path}?${query}`)
      .set('authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
  });

  it.each(['/admin/users/not-a-uuid', '/admin/partners/not-a-uuid', '/admin/vehicles/not-a-uuid'])(
    'rejects invalid id %s',
    async (path) => {
      const token = await tokenFor('admin');
      expect((await request(app).get(path).set('authorization', `Bearer ${token}`)).status).toBe(
        400,
      );
    },
  );

  it.each([
    '/admin/users/650e8400-e29b-41d4-a716-446655440001',
    '/admin/partners/650e8400-e29b-41d4-a716-446655440001',
    '/admin/vehicles/650e8400-e29b-41d4-a716-446655440001',
  ])('returns 404 for missing resource %s', async (path) => {
    const token = await tokenFor('admin');
    expect((await request(app).get(path).set('authorization', `Bearer ${token}`)).status).toBe(404);
  });

  it.each([
    '/admin/users?pageSize=0',
    '/admin/partners?documentStatus=UNKNOWN',
    '/admin/vehicles?complianceStatus=UNKNOWN',
    '/admin/vehicles?from=2026-02-01&to=2026-01-01',
  ])('rejects invalid query %s', async (path) => {
    const token = await tokenFor('admin');
    expect((await request(app).get(path).set('authorization', `Bearer ${token}`)).status).toBe(400);
  });
});
