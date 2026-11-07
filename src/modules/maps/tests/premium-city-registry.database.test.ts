import { readFileSync } from 'node:fs';
import { ServiceAreaPolicy } from '../service-area.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { PostgresRideRepository } from '../../rides/repositories/ride.repository.js';
import { MatchingService } from '../../rides/services/matching.service.js';
import { RideService } from '../../rides/services/ride.service.js';
import { FareEstimateService } from '../../fares/services/fare-estimate.service.js';
import { FareCalculatorService } from '../../fares/services/fare-calculator.service.js';
import { createRideSchema } from '../../rides/schemas/ride.schemas.js';
import { createFleetVehicleSchema } from '../../fleet/schemas/fleet.schemas.js';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { registerPremiumCity, loadPremiumCities } from '../premium-city-registry.js';
import { premiumCityAreas } from '../premium-city-areas.js';
import { PostgresFleetRepository } from '../../fleet/repositories/fleet.repository.js';
import { PostgresVehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import { VehicleController } from '../../vehicles/controllers/vehicle.controller.js';
import type { VehicleService } from '../../vehicles/services/vehicle.service.js';
import { createVehicleRouter } from '../../vehicles/routes/vehicle.routes.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { requiredPermissions } from '../../admin/services/permission-policy.js';

describe.runIf(process.env.RIDE_DB_TESTS === 'true')('dynamic Bihar Premium city registry', () => {
  const marker = 'city-' + randomUUID().slice(0, 8);
  let actor: string;
  let token: string;
  let customerToken: string;
  const cities: string[] = [];
  let vehicleId: string | undefined;
  let driverUser: string;
  let profile: string;
  let customer: string;
  let pricing: Record<string, unknown> | undefined;
  const app = express();
  app.use(express.json());
  app.use('/vehicles', createVehicleRouter(new VehicleController({} as VehicleService)));
  app.use(errorMiddleware);
  beforeAll(async () => {
    if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
      throw Error('Owned disposable database required');
    actor = (
      await pool.query(
        `INSERT INTO users(first_name,last_name,role,status) VALUES('CITY','TEST','super_admin','active') RETURNING id`,
      )
    ).rows[0].id;
    driverUser = (
      await pool.query(
        `INSERT INTO users(first_name,last_name,role,status) VALUES('CITY','DRIVER','driver','active') RETURNING id`,
      )
    ).rows[0].id;
    profile = (
      await pool.query(
        `INSERT INTO driver_profiles(user_id,license_number,license_expiry,verification_status) VALUES($1,$2,CURRENT_DATE+365,'approved') RETURNING id`,
        [driverUser, marker],
      )
    ).rows[0].id;
    customer = (
      await pool.query(
        `INSERT INTO users(first_name,last_name,role,status) VALUES('CITY','CUSTOMER','customer','active') RETURNING id`,
      )
    ).rows[0].id;
    token = await signAccessToken({ sub: actor, role: 'super_admin', type: 'access' });
    customerToken = await signAccessToken({ sub: actor, role: 'customer', type: 'access' });
  });
  afterAll(async () => {
    await pool.query('DELETE FROM rides WHERE customer_id=$1', [customer]);
    await pool.query('UPDATE driver_profiles SET active_vehicle_id=NULL WHERE id=$1', [profile]);
    if (vehicleId) await pool.query('DELETE FROM vehicles WHERE id=$1', [vehicleId]);
    await pool.query('DELETE FROM premium_service_cities WHERE created_by=$1', [actor]);
    await loadPremiumCities();
    await pool.query('DELETE FROM driver_profiles WHERE id=$1', [profile]);
    await pool.query('DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[])', [
      [actor, driverUser, customer],
    ]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[actor, driverUser, customer]]);
    if (pricing)
      await pool.query(
        'UPDATE vehicle_types SET active=$2,base_fare_paise=$3,per_km_rate_paise=$4,hourly_base_fares_paise=$5::jsonb WHERE id=$1',
        [
          pricing.id,
          pricing.active,
          pricing.base_fare_paise,
          pricing.per_km_rate_paise,
          pricing.hourly_base_fares_paise == null
            ? null
            : JSON.stringify(pricing.hourly_base_fares_paise),
        ],
      );
    await pool.end();
  });
  const input = (suffix: string, latitude: number, longitude: number) => ({
    id: marker + '-' + suffix,
    name: 'SYNTHETIC TEST ' + suffix,
    latitude,
    longitude,
    source: 'SYNTHETIC LOCAL FIXTURE',
    approvalReference: 'TEST ONLY, never production approval',
  });
  it('registers three distinct Bihar areas through the authenticated API and publishes them to Driver catalog', async () => {
    for (const [suffix, lat, lon] of [
      ['a', 25.6, 85.1],
      ['b', 26.12, 85.4],
      ['third', 24.78, 85.0],
    ] as const) {
      const city = input(suffix, lat, lon);
      const response = await request(app)
        .post('/vehicles/operating-cities')
        .set('Authorization', 'Bearer ' + token)
        .send(city);
      expect(response.status).toBe(201);
      cities.push(city.id);
    }
    const catalog = await new PostgresFleetRepository(pool).catalog();
    expect(catalog.operatingCities.filter((c) => cities.includes(c.id))).toHaveLength(3);
    const response = await request(app)
      .get('/vehicles/operating-cities')
      .set('Authorization', 'Bearer ' + customerToken);
    expect(response.status).toBe(200);
    expect(response.body.data.some((c: { id: string }) => c.id === cities[2])).toBe(true);
  });
  it('persists the third city for Admin and Fleet vehicle creation and keeps approval pending', async () => {
    const fleet = new PostgresFleetRepository(pool);
    const vehicle = await fleet.createVehicle(
      driverUser,
      createFleetVehicleSchema.parse({
        make: 'CITY TEST',
        model: 'Thar',
        plateNumber: marker,
        sector: 'premium',
        category: 'thar',
        operatingCityId: cities[2],
        operatingLocation: {
          address: 'Configured city operating point',
          latitude: 24.78,
          longitude: 85.0,
        },
      }),
    );
    vehicleId = vehicle.id;
    expect(vehicle.operatingCityId).toBe(cities[2]);
    expect(vehicle.verificationStatus).toBe('pending');
    expect((await new PostgresVehicleRepository(pool).findById(vehicle.id))?.operatingCityId).toBe(
      cities[2],
    );
    await loadPremiumCities();
    expect((await premiumCityAreas.resolve({ latitude: 24.78, longitude: 85.0 })).cityId).toBe(
      cities[2],
    );
  });
  it('matches an approved driver in the third configured city and persists an eligible Premium booking', async () => {
    pricing = (
      await pool.query(`SELECT * FROM vehicle_types WHERE sector='premium' AND code='thar'`)
    ).rows[0];
    await pool.query(
      `UPDATE vehicle_types SET active=TRUE,base_fare_paise=10000,per_km_rate_paise=1000,hourly_base_fares_paise=NULL WHERE sector='premium' AND code='thar'`,
    );
    await pool.query(
      `UPDATE vehicles SET driver_profile_id=$2,verification_status='approved',is_active=TRUE WHERE id=$1`,
      [vehicleId, profile],
    );
    await pool.query(
      `UPDATE driver_profiles SET active_vehicle_id=$2,availability_status='available',last_location=ST_SetSRID(ST_MakePoint(85.0,24.78),4326)::geography,last_location_at=NOW() WHERE id=$1`,
      [profile, vehicleId],
    );
    const bihar = new ServiceAreaPolicy(
      JSON.parse(
        readFileSync(
          new URL('../../../../config/service-area/bihar.geojson', import.meta.url),
          'utf8',
        ),
      ),
      true,
    );
    const drivers = new PostgresDriverRepository(pool);
    const rides = new PostgresRideRepository(pool, premiumCityAreas);
    const matching = new MatchingService(drivers, undefined, bihar, premiumCityAreas);
    const estimate = new FareEstimateService(
      { calculateRoute: async () => ({ distanceMeters: 1000, durationSeconds: 300 }) } as never,
      new FareCalculatorService(),
      undefined,
      new PostgresVehicleRepository(pool),
    );
    const service = new RideService(
      rides,
      drivers,
      undefined,
      estimate,
      undefined,
      bihar,
      undefined,
      matching,
    );
    const booked = await service.createRide(
      customer,
      createRideSchema.parse({
        sector: 'premium',
        vehicleCategory: 'thar',
        pickup: { latitude: 24.78, longitude: 85.0 },
        destination: { latitude: 24.79, longitude: 85.01 },
        bookingHours: 1,
        rentalDetails: { hours: 1, tripType: 'one_way' },
      }),
    );
    expect(booked).toMatchObject({
      sector: 'premium',
      vehicleCategory: 'thar',
      status: 'searching',
    });
    const candidates = await matching.findDispatchDrivers(booked, null);
    expect(candidates.some((c) => c.driverProfileId === profile)).toBe(true);
    expect((await rides.findById(booked.id))?.customerId).toBe(customer);
  });

  it('rejects outside-Bihar coordinates, duplicate cities and overlapping dispatch areas', async () => {
    await expect(registerPremiumCity(input('outside', 28.61, 77.2), actor)).rejects.toMatchObject({
      code: 'SERVICE_AREA_UNAVAILABLE',
    });
    await expect(registerPremiumCity(input('a', 25.6, 85.1), actor)).rejects.toMatchObject({
      code: 'PREMIUM_CITY_EXISTS',
    });
    await expect(registerPremiumCity(input('overlap', 24.79, 85.01), actor)).rejects.toMatchObject({
      code: 'PREMIUM_CITY_OVERLAP',
    });
  });
  it('requires administrative authority and the existing vehicle grants to configure cities', async () => {
    const response = await request(app)
      .post('/vehicles/operating-cities')
      .set('Authorization', 'Bearer ' + customerToken)
      .send(input('forbidden', 25.77, 87.47));
    expect(response.status).toBe(403);
    expect(requiredPermissions('POST', '/vehicles/operating-cities', {})).toEqual([
      'vehicles.read',
      'vehicles.create',
    ]);
  });
});
