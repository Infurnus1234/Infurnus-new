import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app.js';
import { signAccessToken } from '../../auth/utils/jwt.js';

import type { AdminRepository } from '../repositories/admin.repository.js';

import type {
  AdminDriver,
  AdminDriverApplication,
  AdminDriverDetails,
  AdminPartner,
  AdminUser,
  AdminVehicle,
  FleetFilters,
  LiveFleetVehicle,
} from '../types/admin.js';

import type { DriverApplicationService } from '../../driver-applications/driver-application.service.js';

const adminId = '550e8400-e29b-41d4-a716-446655440000';
const userId = '650e8400-e29b-41d4-a716-446655440000';
const applicationId = '750e8400-e29b-41d4-a716-446655440000';
const vehicleId = '850e8400-e29b-41d4-a716-446655440000';

const missingId = '650e8400-e29b-41d4-a716-446655440001';

const tokenFor = (role: string) =>
  signAccessToken({
    sub: adminId,
    role,
    type: 'access',
  });

class Repository implements AdminRepository {
  listUsers = vi.fn().mockResolvedValue({
    items: [{} as AdminUser],
    page: 1,
    pageSize: 25,
    total: 1,
  });

  listDrivers = vi.fn().mockResolvedValue({
    items: [{} as AdminDriver],
    page: 1,
    pageSize: 25,
    total: 1,
  });

  listDriverApplications = vi.fn().mockResolvedValue({
    items: [] as AdminDriverApplication[],
    page: 1,
    pageSize: 25,
    total: 0,
  });

  getDriver = vi.fn().mockImplementation(async (id: string): Promise<AdminDriverDetails | null> => {
    if (id === userId) {
      return {
        id,
      } as AdminDriverDetails;
    }

    return null;
  });

  getUser = vi.fn().mockImplementation(async (id: string) => {
    if (id === userId) {
      return {
        id,
      } as AdminUser;
    }

    return null;
  });

  updateUserStatus = vi.fn().mockImplementation(async (id: string, status: string) => {
    if (id !== userId) {
      return null;
    }

    return {
      id: userId,
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      phone: '+919999999999',
      role: 'customer',
      status,
      createdAt: new Date(),
    } satisfies AdminUser;
  });

  listPartners = vi.fn().mockResolvedValue({
    items: [{} as AdminPartner],
    page: 1,
    pageSize: 25,
    total: 1,
  });

  getPartner = vi.fn().mockImplementation(async (id: string) => {
    if (id === userId) {
      return {
        id,
      } as AdminPartner;
    }

    return null;
  });

  listVehicles = vi.fn().mockResolvedValue({
    items: [{} as AdminVehicle],
    page: 1,
    pageSize: 25,
    total: 1,
  });

  getVehicle = vi.fn().mockImplementation(async (id: string) => {
    if (id === vehicleId) {
      return {
        id,
      } as AdminVehicle;
    }

    return null;
  });

  dashboard = vi.fn().mockResolvedValue({
    users: {
      total: 2,
      active: 1,
      suspended: 1,
    },

    drivers: {
      total: 1,
    },

    partners: {
      total: 1,
      approved: 1,
      pending: 0,
      active: 1,
    },

    pendingApprovals: 1,

    vehicles: {
      total: 1,
      active: 1,
    },

    kyc: {
      pending: 0,
      verified: 1,
      rejected: 0,
      expired: 0,
    },

    vehicleCompliance: {
      insuranceExpiringOrExpired: 0,
      permitsExpiringOrExpired: 0,
      fitnessExpiringOrExpired: 0,
    },
  });

  verifyDriver = vi.fn().mockResolvedValue(true);

  verifyVehicle = vi.fn().mockResolvedValue(true);

  verifyDocument = vi.fn().mockResolvedValue(true);

  getFleetAnalyticsSummary = vi.fn().mockImplementation(async (_filters: FleetFilters) => ({
    totalVehicles: 1,
    activeVehicles: 1,
    onTripVehicles: 0,
    offlineVehicles: 0,
    activePercentage: 100,
  }));

  getStateFleetAnalytics = vi.fn().mockImplementation(async (_filters: FleetFilters) => [
    {
      state: 'Bihar',
      total: 1,
      active: 1,
      onTrip: 0,
      offline: 0,
    },
  ]);

  getCityFleetAnalytics = vi
    .fn()
    .mockImplementation(async (state: string, _filters: FleetFilters) => [
      {
        state,
        city: 'Patna',
        total: 1,
        active: 1,
        onTrip: 0,
        offline: 0,
      },
    ]);

  getLiveFleetVehicles = vi.fn().mockResolvedValue({
    items: [{} as LiveFleetVehicle],
    page: 1,
    pageSize: 25,
    total: 1,
  });

  getLiveFleetVehicleDetails = vi.fn().mockImplementation(async (id: string) => {
    if (id === userId) {
      return {
        id,
      } as LiveFleetVehicle;
    }

    return null;
  });
}

const createDriverApplicationService = () => {
  return {
    review: vi.fn().mockImplementation(
      async (
        id: string,
        review: {
          status: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';
          reviewReason?: string;
        },
        reviewerId: string,
      ) => ({
        id,
        status: review.status,
        reviewReason: review.reviewReason ?? null,
        reviewedBy: reviewerId,
      }),
    ),
  } as unknown as DriverApplicationService;
};

const createTestApp = (
  repository: Repository,
  driverApplicationService?: DriverApplicationService,
) =>
  createApp(
    undefined,
    undefined,
    undefined,
    undefined,
    repository,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    driverApplicationService,
  );

describe('Admin API route matrix', () => {
  const repository = new Repository();
  const driverApplicationService = createDriverApplicationService();

  const app = createTestApp(repository, driverApplicationService);

  it.each([
    '/admin/users',
    '/admin/drivers',
    '/admin/drivers/applications',
    '/admin/partners',
    '/admin/vehicles',
    '/admin/dashboard',
    '/admin/reports/users',
    '/admin/reports/partners',
    '/admin/reports/vehicles',
    '/admin/fleet/analytics',
    '/admin/fleet/states',
    '/admin/fleet/map',
    '/admin/fleet/vehicles',
  ])('returns 401 for unauthenticated %s', async (path) => {
    const response = await request(app).get(path);

    expect(response.status).toBe(401);
  });

  it('returns 401 for unauthenticated user status update', async () => {
    const response = await request(app)
      .patch(`/admin/users/${userId}/status`)
      .send({ status: 'suspended' });

    expect(response.status).toBe(401);
  });

  it('returns 401 for unauthenticated driver details', async () => {
    const response = await request(app).get(`/admin/drivers/${userId}`);

    expect(response.status).toBe(401);
  });

  it('returns 401 for unauthenticated driver application review', async () => {
    const response = await request(app)
      .post(`/admin/drivers/applications/${applicationId}/review`)
      .send({
        status: 'APPROVED',
      });

    expect(response.status).toBe(401);
  });

  it('returns 401 for unauthenticated vehicle verification', async () => {
    const response = await request(app).post(`/admin/vehicles/${vehicleId}/verify`).send({
      status: 'APPROVED',
    });

    expect(response.status).toBe(401);
  });

  it.each(['customer', 'driver'])('returns 403 for non-admin role %s', async (role) => {
    const token = await tokenFor(role);

    const response = await request(app)
      .get('/admin/dashboard')
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it.each(['customer', 'driver'])(
    'returns 403 when non-admin role %s attempts user status update',
    async (role) => {
      const token = await tokenFor(role);

      const response = await request(app)
        .patch(`/admin/users/${userId}/status`)
        .set('authorization', `Bearer ${token}`)
        .send({ status: 'suspended' });

      expect(response.status).toBe(403);
    },
  );

  it.each(['customer', 'driver'])(
    'returns 403 when non-admin role %s attempts driver list',
    async (role) => {
      const token = await tokenFor(role);

      const response = await request(app)
        .get('/admin/drivers')
        .set('authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
    },
  );

  it.each(['customer', 'driver'])(
    'returns 403 when non-admin role %s attempts driver applications list',
    async (role) => {
      const token = await tokenFor(role);

      const response = await request(app)
        .get('/admin/drivers/applications')
        .set('authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
    },
  );

  it.each(['customer', 'driver'])(
    'returns 403 when non-admin role %s attempts driver details',
    async (role) => {
      const token = await tokenFor(role);

      const response = await request(app)
        .get(`/admin/drivers/${userId}`)
        .set('authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
    },
  );

  it.each(['customer', 'driver'])(
    'returns 403 when non-admin role %s attempts driver application review',
    async (role) => {
      const token = await tokenFor(role);

      const response = await request(app)
        .post(`/admin/drivers/applications/${applicationId}/review`)
        .set('authorization', `Bearer ${token}`)
        .send({
          status: 'APPROVED',
        });

      expect(response.status).toBe(403);
    },
  );

  it.each(['customer', 'driver'])(
    'returns 403 when non-admin role %s attempts vehicle verification',
    async (role) => {
      const token = await tokenFor(role);

      const response = await request(app)
        .post(`/admin/vehicles/${vehicleId}/verify`)
        .set('authorization', `Bearer ${token}`)
        .send({
          status: 'APPROVED',
        });

      expect(response.status).toBe(403);
    },
  );

  it.each(['admin', 'super_admin'])('allows admin role %s to read the dashboard', async (role) => {
    const token = await tokenFor(role);

    const response = await request(app)
      .get('/admin/dashboard')
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.users.total).toBe(2);
    expect(response.body.data.drivers.total).toBe(1);
    expect(response.body.data.pendingApprovals).toBe(1);
  });

  it.each(['admin', 'super_admin'])('allows admin role %s to list drivers', async (role) => {
    const token = await tokenFor(role);

    const response = await request(app)
      .get('/admin/drivers')
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.page).toBe(1);
    expect(response.body.data.pageSize).toBe(25);
    expect(response.body.data.total).toBe(1);
  });

  it.each(['admin', 'super_admin'])(
    'allows admin role %s to list driver applications',
    async (role) => {
      const token = await tokenFor(role);

      const response = await request(app)
        .get('/admin/drivers/applications')
        .set('authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
      });
    },
  );

  it.each(['admin', 'super_admin'])('allows admin role %s to view driver details', async (role) => {
    const token = await tokenFor(role);

    const response = await request(app)
      .get(`/admin/drivers/${userId}`)
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe(userId);

    expect(repository.getDriver).toHaveBeenCalledWith(userId);
  });

  it.each(['admin', 'super_admin'])(
    'allows admin role %s to approve a driver application',
    async (role) => {
      const token = await tokenFor(role);

      const response = await request(app)
        .post(`/admin/drivers/applications/${applicationId}/review`)
        .set('authorization', `Bearer ${token}`)
        .send({
          status: 'APPROVED',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(applicationId);
      expect(response.body.data.status).toBe('APPROVED');
      expect(response.body.message).toBe('Driver application approved.');

      expect(driverApplicationService.review as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        applicationId,
        {
          status: 'APPROVED',
          reviewReason: undefined,
        },
        adminId,
      );
    },
  );

  it.each(['admin', 'super_admin'])(
    'allows admin role %s to reject a driver application',
    async (role) => {
      const token = await tokenFor(role);

      const response = await request(app)
        .post(`/admin/drivers/applications/${applicationId}/review`)
        .set('authorization', `Bearer ${token}`)
        .send({
          status: 'REJECTED',
          reviewReason: 'Invalid driver documents',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(applicationId);
      expect(response.body.data.status).toBe('REJECTED');
      expect(response.body.data.reviewReason).toBe('Invalid driver documents');
      expect(response.body.message).toBe('Driver application rejected.');
    },
  );

  it.each(['admin', 'super_admin'])(
    'allows admin role %s to request changes on a driver application',
    async (role) => {
      const token = await tokenFor(role);

      const response = await request(app)
        .post(`/admin/drivers/applications/${applicationId}/review`)
        .set('authorization', `Bearer ${token}`)
        .send({
          status: 'CHANGES_REQUESTED',
          reviewReason: 'Please upload a clearer license image',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(applicationId);
      expect(response.body.data.status).toBe('CHANGES_REQUESTED');
      expect(response.body.data.reviewReason).toBe('Please upload a clearer license image');
      expect(response.body.message).toBe('Driver application changes_requested.');
    },
  );

  it.each(['admin', 'super_admin'])(
    'rejects driver application review without reason for %s',
    async (role) => {
      const token = await tokenFor(role);

      const response = await request(app)
        .post(`/admin/drivers/applications/${applicationId}/review`)
        .set('authorization', `Bearer ${token}`)
        .send({
          status: 'REJECTED',
        });

      expect(response.status).toBe(400);
    },
  );

  it.each(['admin', 'super_admin'])(
    'rejects change request without reason for %s',
    async (role) => {
      const token = await tokenFor(role);

      const response = await request(app)
        .post(`/admin/drivers/applications/${applicationId}/review`)
        .set('authorization', `Bearer ${token}`)
        .send({
          status: 'CHANGES_REQUESTED',
        });

      expect(response.status).toBe(400);
    },
  );

  it('rejects invalid driver application review status', async () => {
    const token = await tokenFor('admin');

    const response = await request(app)
      .post(`/admin/drivers/applications/${applicationId}/review`)
      .set('authorization', `Bearer ${token}`)
      .send({
        status: 'PENDING',
      });

    expect(response.status).toBe(400);
  });

  it('rejects invalid driver application review id', async () => {
    const token = await tokenFor('admin');

    const response = await request(app)
      .post('/admin/drivers/applications/not-a-uuid/review')
      .set('authorization', `Bearer ${token}`)
      .send({
        status: 'APPROVED',
      });

    expect(response.status).toBe(400);
  });

  it('returns 404 when requested driver does not exist', async () => {
    const token = await tokenFor('admin');

    const response = await request(app)
      .get(`/admin/drivers/${missingId}`)
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });

  it('rejects invalid driver details id', async () => {
    const token = await tokenFor('admin');

    const response = await request(app)
      .get('/admin/drivers/not-a-uuid')
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
  });

  it.each(['admin', 'super_admin'])('allows admin role %s to list vehicles', async (role) => {
    const token = await tokenFor(role);

    const response = await request(app)
      .get('/admin/vehicles')
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({
      items: [{}],
      page: 1,
      pageSize: 25,
      total: 1,
    });

    expect(repository.listVehicles).toHaveBeenCalled();
  });

  it.each(['admin', 'super_admin'])(
    'allows admin role %s to view vehicle details',
    async (role) => {
      const token = await tokenFor(role);

      const response = await request(app)
        .get(`/admin/vehicles/${vehicleId}`)
        .set('authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(vehicleId);

      expect(repository.getVehicle).toHaveBeenCalledWith(vehicleId);
    },
  );

  it.each(['admin', 'super_admin'])('allows admin role %s to approve a vehicle', async (role) => {
    const token = await tokenFor(role);

    const response = await request(app)
      .post(`/admin/vehicles/${vehicleId}/verify`)
      .set('authorization', `Bearer ${token}`)
      .send({
        status: 'APPROVED',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.vehicleId).toBe(vehicleId);
    expect(response.body.data.status).toBe('APPROVED');

    expect(repository.verifyVehicle).toHaveBeenCalledWith(
      vehicleId,
      'APPROVED',
      undefined,
      adminId,
    );
  });

  it.each(['admin', 'super_admin'])(
    'allows admin role %s to reject a vehicle with a reason',
    async (role) => {
      const token = await tokenFor(role);
      const rejectionReason = 'Vehicle documents are invalid';

      const response = await request(app)
        .post(`/admin/vehicles/${vehicleId}/verify`)
        .set('authorization', `Bearer ${token}`)
        .send({
          status: 'REJECTED',
          rejectionReason,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.vehicleId).toBe(vehicleId);
      expect(response.body.data.status).toBe('REJECTED');

      expect(repository.verifyVehicle).toHaveBeenCalledWith(
        vehicleId,
        'REJECTED',
        rejectionReason,
        adminId,
      );
    },
  );

  it('rejects invalid vehicle verification id', async () => {
    const token = await tokenFor('admin');

    const response = await request(app)
      .post('/admin/vehicles/not-a-uuid/verify')
      .set('authorization', `Bearer ${token}`)
      .send({
        status: 'APPROVED',
      });

    expect(response.status).toBe(400);
  });

  it('rejects invalid vehicle verification status', async () => {
    const token = await tokenFor('admin');

    const response = await request(app)
      .post(`/admin/vehicles/${vehicleId}/verify`)
      .set('authorization', `Bearer ${token}`)
      .send({
        status: 'PENDING',
      });

    expect(response.status).toBe(400);
  });

  it.each(['admin', 'super_admin'])(
    'allows admin role %s to filter vehicles by partnerId',
    async (role) => {
      const token = await tokenFor(role);
      const partnerId = '950e8400-e29b-41d4-a716-446655440000';

      const response = await request(app)
        .get(`/admin/vehicles?partnerId=${partnerId}`)
        .set('authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.total).toBe(1);

      expect(repository.listVehicles).toHaveBeenCalled();
    },
  );

  it.each(['admin', 'super_admin'])('allows admin role %s to update user status', async (role) => {
    const token = await tokenFor(role);

    const response = await request(app)
      .patch(`/admin/users/${userId}/status`)
      .set('authorization', `Bearer ${token}`)
      .send({ status: 'suspended' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe(userId);
    expect(response.body.data.status).toBe('suspended');
    expect(response.body.message).toBe('User status updated to suspended');
  });

  it.each([
    ['/admin/users', 'role=driver&status=active&page=2&pageSize=10'],
    [
      '/admin/drivers',
      'search=Rahul&verificationStatus=pending&availabilityStatus=available&page=2&pageSize=10',
    ],
    ['/admin/drivers/applications', 'status=PENDING&page=2&pageSize=10'],
    ['/admin/partners', 'approvalStatus=approved&documentStatus=VERIFIED'],
    ['/admin/vehicles', 'active=true&complianceStatus=expiring&plate=KA01'],
    ['/admin/fleet/analytics', 'state=Bihar&sector=passenger'],
    ['/admin/fleet/states', 'sector=logistics'],
    ['/admin/fleet/map', 'status=active&sector=passenger'],
  ])('passes validated filters for %s', async (path, query) => {
    const token = await tokenFor('admin');

    const response = await request(app)
      .get(`${path}?${query}`)
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  it.each(['/admin/users/not-a-uuid', '/admin/partners/not-a-uuid', '/admin/vehicles/not-a-uuid'])(
    'rejects invalid id %s',
    async (path) => {
      const token = await tokenFor('admin');

      const response = await request(app).get(path).set('authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
    },
  );

  it('rejects invalid user status update id', async () => {
    const token = await tokenFor('admin');

    const response = await request(app)
      .patch('/admin/users/not-a-uuid/status')
      .set('authorization', `Bearer ${token}`)
      .send({ status: 'suspended' });

    expect(response.status).toBe(400);
  });

  it.each([
    '/admin/users/650e8400-e29b-41d4-a716-446655440001',
    '/admin/partners/650e8400-e29b-41d4-a716-446655440001',
    '/admin/vehicles/650e8400-e29b-41d4-a716-446655440001',
    '/admin/fleet/vehicles/650e8400-e29b-41d4-a716-446655440001',
  ])('returns 404 for missing resource %s', async (path) => {
    const token = await tokenFor('admin');

    const response = await request(app).get(path).set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });

  it.each([
    '/admin/users?pageSize=0',
    '/admin/drivers?verificationStatus=invalid',
    '/admin/drivers?availabilityStatus=invalid',
    '/admin/drivers?partnerId=not-a-uuid',
    '/admin/drivers/applications?status=invalid',
    '/admin/drivers/applications?partnerId=not-a-uuid',
    '/admin/partners?documentStatus=UNKNOWN',
    '/admin/vehicles?complianceStatus=UNKNOWN',
    '/admin/vehicles?from=2026-02-01&to=2026-01-01',
    '/admin/fleet/analytics?sector=INVALID',
  ])('rejects invalid query %s', async (path) => {
    const token = await tokenFor('admin');

    const response = await request(app).get(path).set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
  });

  it('rejects invalid user status', async () => {
    const token = await tokenFor('admin');

    const response = await request(app)
      .patch(`/admin/users/${userId}/status`)
      .set('authorization', `Bearer ${token}`)
      .send({ status: 'invalid' });

    expect(response.status).toBe(400);
  });

  it('rejects missing user status', async () => {
    const token = await tokenFor('admin');

    const response = await request(app)
      .patch(`/admin/users/${userId}/status`)
      .set('authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
  });
});
