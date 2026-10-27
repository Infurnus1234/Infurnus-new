import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { DriverController } from '../controllers/driver.controller.js';
import { RideController } from '../controllers/ride.controller.js';
import { createRideRouter } from '../routes/ride.routes.js';
import type { DriverRepository } from '../repositories/driver.repository.js';
import type { RideCustomerContactRow } from '../repositories/ride-customer-contact.repository.js';
import { DriverService } from '../services/driver.service.js';
import type { DriverDocumentStorageService } from '../services/driver-document-storage.service.js';
import type { RideService } from '../services/ride.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const rideId = '22222222-2222-4222-8222-222222222222';
function setup() {
  const repository = {
    forAssignedDriver: vi
      .fn<(rideId: string, userId: string) => Promise<RideCustomerContactRow | null>>()
      .mockResolvedValue({
        rideId,
        customerId: 'customer',
        firstName: 'Actual',
        lastName: 'Customer',
        phone: '+919876543210',
      }),
  };
  const service = new DriverService({} as DriverRepository, undefined, undefined, repository);
  const controller = new DriverController(
    service,
    {} as RideService,
    {} as DriverDocumentStorageService,
  );
  const app = express();
  app.use('/rides', createRideRouter(new RideController({} as RideService), controller));
  app.use(errorMiddleware);
  return { app, repository, service };
}

describe('driver customer-contact HTTP boundary', () => {
  it('preserves a national number instead of inventing a country calling code', async () => {
    const { service, repository } = setup();
    repository.forAssignedDriver.mockResolvedValue({
      rideId,
      customerId: 'customer',
      firstName: 'Actual',
      lastName: 'Customer',
      phone: '9876543210',
    });
    expect((await service.getCustomerContact(userId, rideId)).phone).toBe('9876543210');
  });
  it('uses the verified token user, not a supplied driver ID, and returns only the allowed projection', async () => {
    const { app, repository } = setup();
    const token = await signAccessToken({ sub: userId, role: 'driver', type: 'access' });
    const response = await request(app)
      .get(`/rides/driver/rides/${rideId}/customer-contact?driverId=someone-else`)
      .auth(token, { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(repository.forAssignedDriver).toHaveBeenCalledExactlyOnceWith(rideId, userId);
    expect(response.body).toEqual({
      success: true,
      data: { rideId, name: 'Actual Customer', phone: '+919876543210' },
    });
  });
  it('rejects unauthenticated callers', async () => {
    const { app, repository } = setup();
    expect((await request(app).get(`/rides/driver/rides/${rideId}/customer-contact`)).status).toBe(
      401,
    );
    expect(repository.forAssignedDriver).not.toHaveBeenCalled();
  });
  it.each(['customer', 'fleet_owner', 'admin', 'super_admin'] as const)(
    'rejects %s accounts',
    async (role) => {
      const { app, repository } = setup();
      const token = await signAccessToken({ sub: userId, role, type: 'access' });
      expect(
        (
          await request(app)
            .get(`/rides/driver/rides/${rideId}/customer-contact`)
            .auth(token, { type: 'bearer' })
        ).status,
      ).toBe(403);
      expect(repository.forAssignedDriver).not.toHaveBeenCalled();
    },
  );
  it('validates ride IDs before querying the database', async () => {
    const { app, repository } = setup();
    const token = await signAccessToken({ sub: userId, role: 'driver', type: 'access' });
    expect(
      (
        await request(app)
          .get('/rides/driver/rides/not-a-uuid/customer-contact')
          .auth(token, { type: 'bearer' })
      ).status,
    ).toBe(400);
    expect(repository.forAssignedDriver).not.toHaveBeenCalled();
  });
  it('uses the same safe 404 when ownership/state/customer checks fail', async () => {
    const { app, repository } = setup();
    repository.forAssignedDriver.mockResolvedValue(null);
    const token = await signAccessToken({ sub: userId, role: 'driver', type: 'access' });
    const response = await request(app)
      .get(`/rides/driver/rides/${rideId}/customer-contact`)
      .auth(token, { type: 'bearer' });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('RIDE_CONTACT_UNAVAILABLE');
    expect(response.body.data).toBeUndefined();
  });
  it('does not expose database error details', async () => {
    const { app, repository } = setup();
    repository.forAssignedDriver.mockRejectedValue(new Error('sensitive query details'));
    const token = await signAccessToken({ sub: userId, role: 'driver', type: 'access' });
    const response = await request(app)
      .get(`/rides/driver/rides/${rideId}/customer-contact`)
      .auth(token, { type: 'bearer' });
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('sensitive');
  });
  it.each([null, '', 'tel:+919876543210;extra', 'not-a-phone'])(
    'disables missing or unsafe phone %s',
    async (phone) => {
      const { service, repository } = setup();
      repository.forAssignedDriver.mockResolvedValue({
        rideId,
        customerId: 'customer',
        firstName: 'Actual',
        lastName: 'Customer',
        phone,
      });
      expect((await service.getCustomerContact(userId, rideId)).phone).toBeNull();
    },
  );
});
