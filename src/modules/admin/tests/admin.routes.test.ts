import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import type { AdminRepository } from '../repositories/admin.repository.js';

const emptyPage = { items: [], page: 1, pageSize: 25, total: 0 };

class InMemoryAdminRepository implements AdminRepository {
  listUsers() {
    return Promise.resolve(emptyPage);
  }
  getUser() {
    return Promise.resolve(null);
  }
  listPartners() {
    return Promise.resolve(emptyPage);
  }
  getPartner() {
    return Promise.resolve(null);
  }
  listVehicles() {
    return Promise.resolve(emptyPage);
  }
  getVehicle() {
    return Promise.resolve(null);
  }
  dashboard() {
    return Promise.resolve({
      users: { total: 0, active: 0, suspended: 0 },
      partners: { total: 0, approved: 0, pending: 0, active: 0 },
      vehicles: { total: 0, active: 0 },
      kyc: { pending: 0, verified: 0, rejected: 0, expired: 0 },
      vehicleCompliance: {
        insuranceExpiringOrExpired: 0,
        permitsExpiringOrExpired: 0,
        fitnessExpiringOrExpired: 0,
      },
    });
  }
}

describe('Admin API authorization', () => {
  const app = createApp(undefined, undefined, undefined, undefined, new InMemoryAdminRepository());

  it('requires authentication for every admin surface', async () => {
    const response = await request(app).get('/admin/dashboard');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects malformed access tokens before reaching the repository', async () => {
    const response = await request(app).get('/admin/users').set('authorization', 'Bearer invalid');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('forbids authenticated non-admin users', async () => {
    const token = await signAccessToken({
      sub: '550e8400-e29b-41d4-a716-446655440000',
      role: 'customer',
      type: 'access',
    });
    const response = await request(app)
      .get('/admin/dashboard')
      .set('authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('validates admin route identifiers after authorization', async () => {
    const response = await request(app).get('/admin/users/not-a-uuid');
    expect(response.status).toBe(401);
  });
});
