import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../../app.js';
import { signAccessToken } from '../../auth/utils/jwt.js';

import type { AdminRepository } from '../repositories/admin.repository.js';

import type { AdminDriverApplication, AdminDriverDetails, AdminUser } from '../types/admin.js';

const emptyPage = {
  items: [],
  page: 1,
  pageSize: 25,
  total: 0,
};

const adminId = '550e8400-e29b-41d4-a716-446655440000';
const userId = '650e8400-e29b-41d4-a716-446655440000';
const missingUserId = '750e8400-e29b-41d4-a716-446655440000';

class InMemoryAdminRepository implements AdminRepository {
  updateUserStatusResult: AdminUser | null = {
    id: userId,
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
    phone: '+919999999999',
    role: 'customer',
    status: 'active',
    createdAt: new Date(),
  };

  listUsers() {
    return Promise.resolve(emptyPage);
  }

  listDrivers() {
    return Promise.resolve(emptyPage);
  }

  listDriverApplications() {
    return Promise.resolve(
      emptyPage as {
        items: AdminDriverApplication[];
        page: number;
        pageSize: number;
        total: number;
      },
    );
  }

  getDriver() {
    return Promise.resolve(null as AdminDriverDetails | null);
  }

  getUser() {
    return Promise.resolve(null);
  }

  updateUserStatus(_id: string, status: string) {
    if (_id !== userId) {
      return Promise.resolve(null);
    }

    return Promise.resolve({
      ...this.updateUserStatusResult!,
      status,
    });
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
      users: {
        total: 0,
        active: 0,
        suspended: 0,
      },

      drivers: {
        total: 0,
      },

      partners: {
        total: 0,
        approved: 0,
        pending: 0,
        active: 0,
      },

      pendingApprovals: 0,

      vehicles: {
        total: 0,
        active: 0,
      },

      kyc: {
        pending: 0,
        verified: 0,
        rejected: 0,
        expired: 0,
      },

      vehicleCompliance: {
        insuranceExpiringOrExpired: 0,
        permitsExpiringOrExpired: 0,
        fitnessExpiringOrExpired: 0,
      },
    });
  }

  verifyDriver() {
    return Promise.resolve(true);
  }

  verifyVehicle() {
    return Promise.resolve(true);
  }

  verifyDocument() {
    return Promise.resolve(true);
  }

  getFleetAnalyticsSummary() {
    return Promise.resolve({
      totalVehicles: 0,
      activeVehicles: 0,
      onTripVehicles: 0,
      offlineVehicles: 0,
      activePercentage: 0,
    });
  }

  getStateFleetAnalytics() {
    return Promise.resolve([]);
  }

  getCityFleetAnalytics() {
    return Promise.resolve([]);
  }

  getLiveFleetVehicles() {
    return Promise.resolve(emptyPage);
  }

  getLiveFleetVehicleDetails() {
    return Promise.resolve(null);
  }
}

describe('Admin API authorization', () => {
  const repository = new InMemoryAdminRepository();

  const app = createApp(undefined, undefined, undefined, undefined, repository);

  const adminToken = () =>
    signAccessToken({
      sub: adminId,
      role: 'admin',
      type: 'access',
    });

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
      sub: adminId,
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

  it('allows an admin to list drivers', async () => {
    const response = await request(app)
      .get('/admin/drivers')
      .set('authorization', `Bearer ${await adminToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual(emptyPage);
  });

  it('allows an admin to list drivers with filters', async () => {
    const response = await request(app)
      .get('/admin/drivers')
      .query({
        search: 'Rahul',
        verificationStatus: 'pending',
        availabilityStatus: 'available',
        city: 'Jaipur',
        state: 'Rajasthan',
        page: 1,
        pageSize: 10,
      })
      .set('authorization', `Bearer ${await adminToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual(emptyPage);
  });

  it('rejects invalid driver list filters', async () => {
    const response = await request(app)
      .get('/admin/drivers')
      .query({
        verificationStatus: 'invalid',
      })
      .set('authorization', `Bearer ${await adminToken()}`);

    expect(response.status).toBe(400);
  });

  it('rejects a malformed partner id in driver list filters', async () => {
    const response = await request(app)
      .get('/admin/drivers')
      .query({
        partnerId: 'not-a-uuid',
      })
      .set('authorization', `Bearer ${await adminToken()}`);

    expect(response.status).toBe(400);
  });

  it('allows an admin to suspend a user', async () => {
    const response = await request(app)
      .patch(`/admin/users/${userId}/status`)
      .set('authorization', `Bearer ${await adminToken()}`)
      .send({ status: 'suspended' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe(userId);
    expect(response.body.data.status).toBe('suspended');
    expect(response.body.message).toBe('User status updated to suspended');
  });

  it('allows an admin to activate a suspended user', async () => {
    const response = await request(app)
      .patch(`/admin/users/${userId}/status`)
      .set('authorization', `Bearer ${await adminToken()}`)
      .send({ status: 'active' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('active');
    expect(response.body.message).toBe('User status updated to active');
  });

  it('allows an admin to ban a user', async () => {
    const response = await request(app)
      .patch(`/admin/users/${userId}/status`)
      .set('authorization', `Bearer ${await adminToken()}`)
      .send({ status: 'banned' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('banned');
    expect(response.body.message).toBe('User status updated to banned');
  });

  it('rejects an invalid user status', async () => {
    const response = await request(app)
      .patch(`/admin/users/${userId}/status`)
      .set('authorization', `Bearer ${await adminToken()}`)
      .send({ status: 'invalid' });

    expect(response.status).toBe(400);
  });

  it('rejects a malformed user id', async () => {
    const response = await request(app)
      .patch('/admin/users/not-a-uuid/status')
      .set('authorization', `Bearer ${await adminToken()}`)
      .send({ status: 'suspended' });

    expect(response.status).toBe(400);
  });

  it('rejects a missing status body field', async () => {
    const response = await request(app)
      .patch(`/admin/users/${userId}/status`)
      .set('authorization', `Bearer ${await adminToken()}`)
      .send({});

    expect(response.status).toBe(400);
  });

  it('returns 404 when the user does not exist', async () => {
    const response = await request(app)
      .patch(`/admin/users/${missingUserId}/status`)
      .set('authorization', `Bearer ${await adminToken()}`)
      .send({ status: 'suspended' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('forbids non-admin users from changing user status', async () => {
    const token = await signAccessToken({
      sub: adminId,
      role: 'driver',
      type: 'access',
    });

    const response = await request(app)
      .patch(`/admin/users/${userId}/status`)
      .set('authorization', `Bearer ${token}`)
      .send({ status: 'suspended' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});
