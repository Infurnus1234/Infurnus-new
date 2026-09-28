import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import type { DriverApplicationService } from '../driver-application.service.js';
import type { DriverApplication } from '../driver-application.types.js';

const partnerId = '550e8400-e29b-41d4-a716-446655440000';

const driverProfileId = '660e8400-e29b-41d4-a716-446655440000';

const applicationId = '750e8400-e29b-41d4-a716-446655440000';

const reviewerId = '850e8400-e29b-41d4-a716-446655440000';

const application: DriverApplication = {
  id: applicationId,
  partnerId,
  driverProfileId,
  requestedSector: 'passenger',
  requestedVehicleCategory: 'sedan',
  vehicleOwnershipType: 'PARTNER_OWNED',
  status: 'PENDING',
  submittedAt: new Date('2026-09-25T10:00:00.000Z'),
  reviewedAt: null,
  reviewedBy: null,
  reviewReason: null,
  approvedAt: null,
  approvedBy: null,
  createdAt: new Date('2026-09-25T10:00:00.000Z'),
  updatedAt: new Date('2026-09-25T10:00:00.000Z'),
};

async function tokenFor(id: string, role: string = 'driver') {
  return signAccessToken({
    sub: id,
    role,
    type: 'access',
  });
}

function createTestApp() {
  const create = vi.fn().mockResolvedValue(application);

  const list = vi.fn().mockResolvedValue({
    items: [application],
    total: 1,
  });

  const getById = vi.fn().mockResolvedValue(application);

  const getByDriverProfileId = vi.fn().mockResolvedValue(application);

  const review = vi.fn().mockResolvedValue({
    ...application,
    status: 'APPROVED',
    reviewedAt: new Date('2026-09-26T10:00:00.000Z'),
    reviewedBy: reviewerId,
    approvedAt: new Date('2026-09-26T10:00:00.000Z'),
    approvedBy: reviewerId,
  });

  const service = {
    create,
    list,
    getById,
    getByDriverProfileId,
    review,
  } as unknown as DriverApplicationService;

  const app = createApp(
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
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    service,
  );

  return {
    app,
    create,
    list,
    getById,
    getByDriverProfileId,
    review,
  };
}

describe('Driver Application HTTP integration', () => {
  describe('POST /driver-applications', () => {
    it('rejects unauthenticated requests', async () => {
      const { app, create } = createTestApp();

      const response = await request(app).post('/driver-applications').send({
        partnerId,
        driverProfileId,
        requestedSector: 'passenger',
        requestedVehicleCategory: 'sedan',
        vehicleOwnershipType: 'PARTNER_OWNED',
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(create).not.toHaveBeenCalled();
    });

    it('creates a driver application for an authenticated driver', async () => {
      const { app, create } = createTestApp();

      const token = await tokenFor(driverProfileId, 'driver');

      const response = await request(app)
        .post('/driver-applications')
        .set('authorization', `Bearer ${token}`)
        .send({
          partnerId,
          driverProfileId,
          requestedSector: 'passenger',
          requestedVehicleCategory: 'sedan',
          vehicleOwnershipType: 'PARTNER_OWNED',
        });

      expect(response.status).toBe(201);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: applicationId,
          partnerId,
          driverProfileId,
          requestedSector: 'passenger',
          requestedVehicleCategory: 'sedan',
          vehicleOwnershipType: 'PARTNER_OWNED',
          status: 'PENDING',
        },
      });

      expect(create).toHaveBeenCalledTimes(1);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: driverProfileId,
          role: 'driver',
        }),
        expect.objectContaining({
          partnerId,
          driverProfileId,
          requestedSector: 'passenger',
          requestedVehicleCategory: 'sedan',
          vehicleOwnershipType: 'PARTNER_OWNED',
        }),
      );
    });

    it('rejects missing required fields', async () => {
      const { app, create } = createTestApp();

      const token = await tokenFor(driverProfileId, 'driver');

      const response = await request(app)
        .post('/driver-applications')
        .set('authorization', `Bearer ${token}`)
        .send({
          partnerId,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects invalid partnerId', async () => {
      const { app, create } = createTestApp();

      const token = await tokenFor(driverProfileId, 'driver');

      const response = await request(app)
        .post('/driver-applications')
        .set('authorization', `Bearer ${token}`)
        .send({
          partnerId: 'not-a-uuid',
          driverProfileId,
          requestedSector: 'passenger',
          requestedVehicleCategory: 'sedan',
          vehicleOwnershipType: 'PARTNER_OWNED',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects invalid driverProfileId', async () => {
      const { app, create } = createTestApp();

      const token = await tokenFor(driverProfileId, 'driver');

      const response = await request(app)
        .post('/driver-applications')
        .set('authorization', `Bearer ${token}`)
        .send({
          partnerId,
          driverProfileId: 'not-a-uuid',
          requestedSector: 'passenger',
          requestedVehicleCategory: 'sedan',
          vehicleOwnershipType: 'PARTNER_OWNED',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects invalid sector', async () => {
      const { app, create } = createTestApp();

      const token = await tokenFor(driverProfileId, 'driver');

      const response = await request(app)
        .post('/driver-applications')
        .set('authorization', `Bearer ${token}`)
        .send({
          partnerId,
          driverProfileId,
          requestedSector: 'invalid-sector',
          requestedVehicleCategory: 'sedan',
          vehicleOwnershipType: 'PARTNER_OWNED',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects invalid vehicle ownership type', async () => {
      const { app, create } = createTestApp();

      const token = await tokenFor(driverProfileId, 'driver');

      const response = await request(app)
        .post('/driver-applications')
        .set('authorization', `Bearer ${token}`)
        .send({
          partnerId,
          driverProfileId,
          requestedSector: 'passenger',
          requestedVehicleCategory: 'sedan',
          vehicleOwnershipType: 'INVALID',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects unexpected request fields', async () => {
      const { app, create } = createTestApp();

      const token = await tokenFor(driverProfileId, 'driver');

      const response = await request(app)
        .post('/driver-applications')
        .set('authorization', `Bearer ${token}`)
        .send({
          partnerId,
          driverProfileId,
          requestedSector: 'passenger',
          requestedVehicleCategory: 'sedan',
          vehicleOwnershipType: 'PARTNER_OWNED',
          admin: true,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('GET /driver-applications/:id', () => {
    it('rejects unauthenticated requests', async () => {
      const { app, getById } = createTestApp();

      const response = await request(app).get(`/driver-applications/${applicationId}`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(getById).not.toHaveBeenCalled();
    });

    it('returns a driver application for an authenticated user', async () => {
      const { app, getById } = createTestApp();

      const token = await tokenFor(driverProfileId, 'driver');

      const response = await request(app)
        .get(`/driver-applications/${applicationId}`)
        .set('authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: applicationId,
          partnerId,
          driverProfileId,
          status: 'PENDING',
        },
      });

      expect(getById).toHaveBeenCalledTimes(1);

      expect(getById).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: driverProfileId,
          role: 'driver',
        }),
        applicationId,
      );
    });

    it('rejects invalid application id', async () => {
      const { app, getById } = createTestApp();

      const token = await tokenFor(driverProfileId, 'driver');

      const response = await request(app)
        .get('/driver-applications/not-a-uuid')
        .set('authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(getById).not.toHaveBeenCalled();
    });
  });

  describe('GET /driver-applications/driver/:driverProfileId', () => {
    it('returns an application by driver profile id', async () => {
      const { app, getByDriverProfileId } = createTestApp();

      const token = await tokenFor(driverProfileId, 'driver');

      const response = await request(app)
        .get(`/driver-applications/driver/${driverProfileId}`)
        .set('authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: applicationId,
          driverProfileId,
        },
      });

      expect(getByDriverProfileId).toHaveBeenCalledTimes(1);

      expect(getByDriverProfileId).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: driverProfileId,
          role: 'driver',
        }),
        driverProfileId,
      );
    });
  });

  describe('GET /driver-applications', () => {
    it('rejects unauthenticated requests', async () => {
      const { app, list } = createTestApp();

      const response = await request(app).get('/driver-applications');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(list).not.toHaveBeenCalled();
    });

    it('lists driver applications for an authenticated user', async () => {
      const { app, list } = createTestApp();

      const token = await tokenFor(driverProfileId, 'driver');

      const response = await request(app)
        .get('/driver-applications')
        .set('authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);

      expect(response.body).toMatchObject({
        success: true,
        data: [
          {
            id: applicationId,
            partnerId,
            driverProfileId,
            status: 'PENDING',
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
        },
      });

      expect(list).toHaveBeenCalledTimes(1);

      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: driverProfileId,
          role: 'driver',
        }),
        expect.objectContaining({
          page: 1,
          limit: 20,
        }),
      );
    });

    it('accepts supported query filters', async () => {
      const { app, list } = createTestApp();

      const token = await tokenFor(driverProfileId, 'driver');

      const response = await request(app)
        .get('/driver-applications')
        .query({
          status: 'PENDING',
          requestedSector: 'passenger',
          requestedVehicleCategory: 'sedan',
          vehicleOwnershipType: 'PARTNER_OWNED',
          partnerId,
          driverProfileId,
          reviewedBy: reviewerId,
          approvedBy: reviewerId,
          page: '2',
          limit: '10',
        })
        .set('authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);

      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: driverProfileId,
          role: 'driver',
        }),
        expect.objectContaining({
          status: 'PENDING',
          requestedSector: 'passenger',
          requestedVehicleCategory: 'sedan',
          vehicleOwnershipType: 'PARTNER_OWNED',
          partnerId,
          driverProfileId,
          reviewedBy: reviewerId,
          approvedBy: reviewerId,
          page: 2,
          limit: 10,
        }),
      );
    });
  });

  describe('POST /driver-applications/:id/review', () => {
    it('rejects unauthenticated requests', async () => {
      const { app, review } = createTestApp();

      const response = await request(app)
        .post(`/driver-applications/${applicationId}/review`)
        .send({
          status: 'APPROVED',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(review).not.toHaveBeenCalled();
    });

    it('rejects review by a regular driver', async () => {
      const { app, review } = createTestApp();

      const token = await tokenFor(driverProfileId, 'driver');

      const response = await request(app)
        .post(`/driver-applications/${applicationId}/review`)
        .set('authorization', `Bearer ${token}`)
        .send({
          status: 'APPROVED',
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(review).not.toHaveBeenCalled();
    });

    it('allows admin to review a driver application', async () => {
      const { app, review } = createTestApp();

      const token = await tokenFor(reviewerId, 'admin');

      const response = await request(app)
        .post(`/driver-applications/${applicationId}/review`)
        .set('authorization', `Bearer ${token}`)
        .send({
          status: 'APPROVED',
        });

      expect(response.status).toBe(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: applicationId,
          status: 'APPROVED',
          reviewedBy: reviewerId,
          approvedBy: reviewerId,
        },
      });

      expect(review).toHaveBeenCalledTimes(1);

      expect(review).toHaveBeenCalledWith(
        applicationId,
        {
          status: 'APPROVED',
        },
        reviewerId,
      );
    });

    it('allows super admin to review a driver application', async () => {
      const { app, review } = createTestApp();

      const token = await tokenFor(reviewerId, 'super_admin');

      const response = await request(app)
        .post(`/driver-applications/${applicationId}/review`)
        .set('authorization', `Bearer ${token}`)
        .send({
          status: 'APPROVED',
        });

      expect(response.status).toBe(200);

      expect(review).toHaveBeenCalledTimes(1);

      expect(review).toHaveBeenCalledWith(
        applicationId,
        {
          status: 'APPROVED',
        },
        reviewerId,
      );
    });

    it('rejects review with an invalid status', async () => {
      const { app, review } = createTestApp();

      const token = await tokenFor(reviewerId, 'admin');

      const response = await request(app)
        .post(`/driver-applications/${applicationId}/review`)
        .set('authorization', `Bearer ${token}`)
        .send({
          status: 'PENDING',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(review).not.toHaveBeenCalled();
    });

    it('rejects unexpected review fields', async () => {
      const { app, review } = createTestApp();

      const token = await tokenFor(reviewerId, 'admin');

      const response = await request(app)
        .post(`/driver-applications/${applicationId}/review`)
        .set('authorization', `Bearer ${token}`)
        .send({
          status: 'APPROVED',
          admin: true,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(review).not.toHaveBeenCalled();
    });
  });
});
