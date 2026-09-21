import { describe, expect, it, vi } from 'vitest';
import { FleetService } from '../services/fleet.service.js';
import type { FleetRepository } from '../repositories/fleet.repository.js';
import type { FleetDashboardMetrics, FleetVehicle, FleetEarningsSummary } from '../types/fleet.js';

const ownerId = '550e8400-e29b-41d4-a716-446655440000';
const vehicleId = '660e8400-e29b-41d4-a716-446655440000';

function createMockRepo(overrides: Partial<FleetRepository> = {}): FleetRepository {
  return {
    getDashboard: vi.fn().mockResolvedValue({
      totalVehicles: 5,
      activeVehicles: 4,
      availableVehicles: 3,
      maintenanceVehicles: 1,
      totalDrivers: 4,
      availableDrivers: 2,
      pendingDocuments: 0,
      activeTrips: 1,
      todayRevenue: 2500,
    } as FleetDashboardMetrics),
    listVehicles: vi.fn().mockResolvedValue([]),
    createVehicle: vi.fn().mockResolvedValue({
      id: vehicleId,
      ownerId,
      make: 'Toyota',
      model: 'Innova',
      plateNumber: 'KA-01-AB-1234',
    } as unknown as FleetVehicle),
    updateVehicle: vi.fn().mockResolvedValue(null),
    deactivateVehicle: vi.fn().mockResolvedValue(true),
    generateAssignmentCode: vi.fn().mockResolvedValue({
      code: 'FLEET-54321',
      expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
    }),
    unassignDriver: vi.fn().mockResolvedValue(true),
    listDrivers: vi.fn().mockResolvedValue([]),
    listTrips: vi.fn().mockResolvedValue([]),
    getEarnings: vi.fn().mockResolvedValue({
      todayRevenue: 2500,
      thisWeekRevenue: 15000,
      thisMonthRevenue: 60000,
      totalTrips: 45,
      platformCommission: 6000,
      netPayout: 54000,
    } as FleetEarningsSummary),
    ...overrides,
  };
}

describe('FleetService', () => {
  it('retrieves fleet dashboard metrics', async () => {
    const repo = createMockRepo();
    const service = new FleetService(repo);
    const metrics = await service.getDashboard(ownerId);

    expect(repo.getDashboard).toHaveBeenCalledWith(ownerId);
    expect(metrics.totalVehicles).toBe(5);
    expect(metrics.todayRevenue).toBe(2500);
  });

  it('generates an assignment code for a vehicle', async () => {
    const repo = createMockRepo();
    const service = new FleetService(repo);
    const result = await service.generateAssignmentCode(ownerId, vehicleId);

    expect(repo.generateAssignmentCode).toHaveBeenCalledWith(ownerId, vehicleId);
    expect(result.code).toBe('FLEET-54321');
  });

  it('unassigns driver from a vehicle', async () => {
    const repo = createMockRepo();
    const service = new FleetService(repo);
    const ok = await service.unassignDriver(ownerId, vehicleId);

    expect(repo.unassignDriver).toHaveBeenCalledWith(ownerId, vehicleId);
    expect(ok).toBe(true);
  });

  it('retrieves fleet earnings summary', async () => {
    const repo = createMockRepo();
    const service = new FleetService(repo);
    const earnings = await service.getEarnings(ownerId);

    expect(repo.getEarnings).toHaveBeenCalledWith(ownerId);
    expect(earnings.netPayout).toBe(54000);
  });
});
