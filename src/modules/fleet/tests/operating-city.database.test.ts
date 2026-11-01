import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresFleetRepository } from '../repositories/fleet.repository.js';
import { PostgresVehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import { createFleetVehicleSchema } from '../schemas/fleet.schemas.js';

// Approved configuration fixture only; this never changes deployed city boundaries.
vi.mock('../../maps/premium-city-areas.js', () => ({
  premiumCityAreas: {
    cities: [
      { id: 'patna', name: 'Patna' },
      { id: 'muzaffarpur', name: 'Muzaffarpur' },
    ],
  },
}));

describe.runIf(process.env.RIDE_DB_TESTS === 'true')('Explicit vehicle operating city', () => {
  it('persists owner/admin configuration and rejects unconfigured cities without changing approval', async () => {
    const owner = (
      await pool.query(
        "INSERT INTO users(first_name,last_name,role) VALUES('CITY TEST','ONLY','fleet_owner') RETURNING id",
      )
    ).rows[0].id;
    const fleet = new PostgresFleetRepository(pool),
      admin = new PostgresVehicleRepository(pool);
    const input = createFleetVehicleSchema.parse({
      make: 'City Test',
      model: 'Thar',
      plateNumber: 'CT' + randomUUID().slice(0, 8),
      sector: 'premium',
      category: 'thar',
      operatingCityId: 'patna',
    });
    try {
      expect((await fleet.catalog(owner)).operatingCities).toEqual([
        { id: 'patna', name: 'Patna' },
        { id: 'muzaffarpur', name: 'Muzaffarpur' },
      ]);
      const v = await fleet.createVehicle(owner, input);
      expect(v.operatingCityId).toBe('patna');
      expect(v.verificationStatus).toBe('pending');
      expect(v.isActive).toBe(false);
      await expect(
        fleet.updateVehicle(owner, v.id, { operatingCityId: 'unknown' }),
      ).rejects.toMatchObject({ code: 'INVALID_OPERATING_CITY' });
      await fleet.updateVehicle(owner, v.id, { operatingCityId: 'muzaffarpur' });
      expect((await admin.findById(v.id))?.operatingCityId).toBe('muzaffarpur');
      await expect(admin.update(v.id, { operatingCityId: 'unknown' })).rejects.toMatchObject({
        code: 'INVALID_OPERATING_CITY',
      });
      const saved = await admin.update(v.id, { operatingCityId: 'patna' });
      expect(saved).toMatchObject({
        operatingCityId: 'patna',
        verificationStatus: 'pending',
        isActive: false,
      });
    } finally {
      await pool.query('DELETE FROM vehicles WHERE owner_id=$1', [owner]);
      await pool.query('DELETE FROM provider_approval_requests WHERE requester_id=$1', [owner]);
      await pool.query('DELETE FROM users WHERE id=$1', [owner]);
    }
  });
});
