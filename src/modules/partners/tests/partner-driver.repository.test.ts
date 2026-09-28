import { describe, expect, it, vi } from 'vitest';

import { PostgresPartnerDriverRepository } from '../repositories/partner-driver.repository.js';

describe('PostgresPartnerDriverRepository', () => {
  function createRepository() {
    const pool = {
      query: vi.fn(),
    } as any;

    return {
      pool,
      repository: new PostgresPartnerDriverRepository(pool),
    };
  }

  it('creates a partner-driver relationship', async () => {
    const { pool, repository } = createRepository();

    const relationship = {
      id: 'relationship-1',
      partnerId: 'partner-1',
      driverProfileId: 'driver-1',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    pool.query.mockResolvedValueOnce({
      rows: [relationship],
    });

    const result = await repository.create({
      partnerId: 'partner-1',
      driverProfileId: 'driver-1',
    });

    expect(result).toEqual(relationship);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('finds a relationship by id', async () => {
    const { pool, repository } = createRepository();

    const relationship = {
      id: 'relationship-1',
      partnerId: 'partner-1',
      driverProfileId: 'driver-1',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    pool.query.mockResolvedValueOnce({
      rows: [relationship],
    });

    const result = await repository.findById('relationship-1');

    expect(result).toEqual(relationship);
  });

  it('returns null when relationship does not exist', async () => {
    const { pool, repository } = createRepository();

    pool.query.mockResolvedValueOnce({
      rows: [],
    });

    const result = await repository.findById('missing-relationship');

    expect(result).toBeNull();
  });

  it('finds relationship by partner and driver', async () => {
    const { pool, repository } = createRepository();

    const relationship = {
      id: 'relationship-1',
      partnerId: 'partner-1',
      driverProfileId: 'driver-1',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    pool.query.mockResolvedValueOnce({
      rows: [relationship],
    });

    const result = await repository.findByPartnerAndDriver('partner-1', 'driver-1');

    expect(result).toEqual(relationship);
  });

  it('lists all drivers for a partner', async () => {
    const { pool, repository } = createRepository();

    const relationships = [
      {
        id: 'relationship-1',
        partnerId: 'partner-1',
        driverProfileId: 'driver-1',
        status: 'ACTIVE',
      },
      {
        id: 'relationship-2',
        partnerId: 'partner-1',
        driverProfileId: 'driver-2',
        status: 'ACTIVE',
      },
    ];

    pool.query.mockResolvedValueOnce({
      rows: relationships,
    });

    const result = await repository.listByPartner('partner-1');

    expect(result).toEqual(relationships);
  });

  it('lists partner drivers filtered by status', async () => {
    const { pool, repository } = createRepository();

    pool.query.mockResolvedValueOnce({
      rows: [],
    });

    await repository.listByPartner('partner-1', 'ACTIVE');

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('AND status = $2'), [
      'partner-1',
      'ACTIVE',
    ]);
  });

  it('lists relationships for a driver', async () => {
    const { pool, repository } = createRepository();

    const relationships = [
      {
        id: 'relationship-1',
        partnerId: 'partner-1',
        driverProfileId: 'driver-1',
        status: 'ACTIVE',
      },
    ];

    pool.query.mockResolvedValueOnce({
      rows: relationships,
    });

    const result = await repository.listByDriver('driver-1');

    expect(result).toEqual(relationships);
  });

  it('updates relationship status', async () => {
    const { pool, repository } = createRepository();

    const relationship = {
      id: 'relationship-1',
      partnerId: 'partner-1',
      driverProfileId: 'driver-1',
      status: 'INACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    pool.query.mockResolvedValueOnce({
      rows: [relationship],
    });

    const result = await repository.updateStatus('relationship-1', 'INACTIVE');

    expect(result).toEqual(relationship);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('SET status = $1'), [
      'INACTIVE',
      'relationship-1',
    ]);
  });
});
