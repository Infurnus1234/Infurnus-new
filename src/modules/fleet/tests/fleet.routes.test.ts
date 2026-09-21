import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import type { FleetRepository } from '../repositories/fleet.repository.js';
import type { FleetDashboardMetrics } from '../types/fleet.js';

class MockFleetRepository implements FleetRepository {
  getDashboard = vi.fn().mockResolvedValue({
    totalVehicles: 2,
    activeVehicles: 2,
    availableVehicles: 1,
    maintenanceVehicles: 0,
    totalDrivers: 2,
    availableDrivers: 1,
    pendingDocuments: 0,
    activeTrips: 0,
    todayRevenue: 1000,
  } as FleetDashboardMetrics);
  listVehicles = vi.fn().mockResolvedValue([]);
  createVehicle = vi.fn().mockResolvedValue({} as never);
  updateVehicle = vi.fn().mockResolvedValue(null);
  deactivateVehicle = vi.fn().mockResolvedValue(true);
  generateAssignmentCode = vi.fn().mockResolvedValue({
    code: 'FLEET-12345',
    expiresAt: new Date(),
  });
  unassignDriver = vi.fn().mockResolvedValue(true);
  listDrivers = vi.fn().mockResolvedValue([]);
  listTrips = vi.fn().mockResolvedValue([]);
  getEarnings = vi.fn().mockResolvedValue({} as never);
}

describe('Fleet API authorization and routes', () => {
  const fleetRepo = new MockFleetRepository();
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
    fleetRepo,
  );

  const fleetOwnerId = '550e8400-e29b-41d4-a716-446655440000';
  const driverFleetOwnerId = '660e8400-e29b-41d4-a716-446655440000';
  const driverId = '770e8400-e29b-41d4-a716-446655440000';
  const customerId = '880e8400-e29b-41d4-a716-446655440000';

  it('rejects unauthenticated requests to fleet dashboard', async () => {
    const res = await request(app).get('/fleet/dashboard');
    expect(res.status).toBe(401);
  });

  it('forbids normal driver from accessing fleet dashboard', async () => {
    const token = await signAccessToken({ sub: driverId, role: 'driver', type: 'access' });
    const res = await request(app).get('/fleet/dashboard').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('forbids customer from accessing fleet dashboard', async () => {
    const token = await signAccessToken({ sub: customerId, role: 'customer', type: 'access' });
    const res = await request(app).get('/fleet/dashboard').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('allows fleet_owner to access fleet dashboard', async () => {
    const token = await signAccessToken({ sub: fleetOwnerId, role: 'fleet_owner', type: 'access' });
    const res = await request(app).get('/fleet/dashboard').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalVehicles).toBe(2);
  });

  it('allows driver_fleet_owner in fleet_owner mode to access fleet dashboard', async () => {
    const token = await signAccessToken({ sub: driverFleetOwnerId, role: 'driver_fleet_owner', type: 'access' });
    const res = await request(app)
      .get('/fleet/dashboard')
      .set('authorization', `Bearer ${token}`)
      .set('x-provider-mode', 'fleet_owner');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('forbids driver_fleet_owner when x-provider-mode is set to driver', async () => {
    const token = await signAccessToken({ sub: driverFleetOwnerId, role: 'driver_fleet_owner', type: 'access' });
    const res = await request(app)
      .get('/fleet/dashboard')
      .set('authorization', `Bearer ${token}`)
      .set('x-provider-mode', 'driver');
    expect(res.status).toBe(403);
  });
});
