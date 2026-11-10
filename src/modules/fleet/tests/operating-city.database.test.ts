import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresFleetRepository } from '../repositories/fleet.repository.js';
import { FleetController } from '../controllers/fleet.controller.js';
import { FleetService } from '../services/fleet.service.js';
import { createFleetRouter } from '../routes/fleet.routes.js';
import { PostgresVehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { PostgresRideRepository } from '../../rides/repositories/ride.repository.js';
import { MatchingService } from '../../rides/services/matching.service.js';
import { actor, fixture } from '../../providers/tests/fleet-workflow-fixture.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { requireDisposableAdministrativeDatabase } from '../../admin/tests/administrative-test-database.js';

describe.runIf(process.env.RIDE_DB_TESTS === 'true')(
  'Premium registration anywhere in Bihar with live-GPS pickup matching',
  () => {
    const fleet = new PostgresFleetRepository(pool),
      vehicles = new PostgresVehicleRepository(pool);
    let owner: string, token: string;
    const ownedUsers: string[] = [];
    const app = express();
    app.use(express.json());
    app.use('/fleet', createFleetRouter(new FleetController(new FleetService(fleet))));
    app.use(errorMiddleware);
    beforeEach(async () => {
      requireDisposableAdministrativeDatabase();
      owner = await actor('fleet_owner');
      ownedUsers.push(owner);
      token = await signAccessToken({ sub: owner, role: 'fleet_owner', type: 'access' });
    });
    afterEach(async () => {
      await pool.query('DELETE FROM rides WHERE customer_id=ANY($1::uuid[])', [ownedUsers]);
      await pool.query('DELETE FROM vehicles WHERE owner_id=ANY($1::uuid[])', [ownedUsers]);
      await pool.query(
        'DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[])',
        [ownedUsers],
      );
      await pool.query(
        'DELETE FROM partner_drivers WHERE partner_id IN (SELECT id FROM partners WHERE user_id=ANY($1::uuid[]))',
        [ownedUsers],
      );
      await pool.query('DELETE FROM partners WHERE user_id=ANY($1::uuid[])', [ownedUsers]);
      await pool.query('DELETE FROM driver_profiles WHERE user_id=ANY($1::uuid[])', [ownedUsers]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ownedUsers.splice(0)]);
    });
    const input = () => ({
      make: 'TEST',
      model: 'Thar',
      plateNumber: randomUUID().slice(0, 18),
      sector: 'premium',
      category: 'thar',
    });
    it.each([
      ['Patna', 25.5941, 85.1376],
      ['Muzaffarpur', 26.1226, 85.3906],
      ['Motihari', 26.65, 84.9167],
      ['Bettiah', 26.803, 84.5023],
      ['Gaya', 24.7955, 85.0],
    ] as const)(
      'registers in %s without requiring a configured city',
      async (address, latitude, longitude) => {
        const location = { address, latitude, longitude };
        const result = await request(app)
          .post('/fleet/vehicles')
          .auth(token, { type: 'bearer' })
          .send({ ...input(), operatingLocation: location });
        expect(result.status, result.text).toBe(201);
        expect(result.body.data).toMatchObject({
          operatingLocation: location,
          verificationStatus: 'pending',
          isActive: false,
        });
        expect((await vehicles.findById(result.body.data.id))?.operatingLocation).toEqual(location);
        await fleet.updateVehicle(owner, result.body.data.id, { color: 'White' });
        expect((await vehicles.findById(result.body.data.id))?.operatingLocation).toEqual(location);
      },
    );
    it('registers without any operating geography and keeps the vehicle pending approval', async () => {
      const response = await request(app)
        .post('/fleet/vehicles')
        .auth(token, { type: 'bearer' })
        .send(input());
      expect(response.status, response.text).toBe(201);
      expect(response.body.data).toMatchObject({
        operatingCityId: null,
        operatingLocation: null,
        verificationStatus: 'pending',
        isActive: false,
      });
      await fleet.updateVehicle(owner, response.body.data.id, { operatingCityId: 'unregistered' });
      expect(await vehicles.findById(response.body.data.id)).toMatchObject({
        operatingCityId: 'unregistered',
        operatingLocation: null,
      });
    });
    async function dispatchFixture(distance: number) {
      const f = await fixture();
      ownedUsers.push(f.admin, f.owner, f.driver);
      const customer = await actor('customer');
      ownedUsers.push(customer);
      const drivers = new PostgresDriverRepository(pool),
        rides = new PostgresRideRepository(pool);
      await drivers.claimAssignmentCode(f.code, f.driver, f.profile);
      const location = { address: 'Motihari operating point', latitude: 26.65, longitude: 84.9167 };
      await pool.query(
        "UPDATE vehicles SET sector='premium',category='thar',operating_city_id=NULL,operating_location=NULL WHERE id=$1",
        [f.vehicle.id],
      );
      await pool.query(
        "UPDATE vehicles SET verification_status='approved',verified_by=$2,verified_at=NOW(),is_active=TRUE WHERE id=$1",
        [f.vehicle.id, f.admin],
      );
      await pool.query(
        "UPDATE driver_profiles SET availability_status='available',last_location=ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,last_location_at=NOW() WHERE id=$1",
        [f.profile, location.longitude, location.latitude],
      );
      const point = (
        await pool.query(
          'SELECT ST_Y(p::geometry) AS latitude,ST_X(p::geometry) AS longitude FROM (SELECT ST_Project(ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,$3::float8,0::float8) p) s',
          [location.longitude, location.latitude, distance],
        )
      ).rows[0];
      const rideId = (
        await pool.query(
          "INSERT INTO rides(customer_id,sector,vehicle_category,status,pickup_location,destination_location) VALUES($1,'premium','thar','searching',ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography) RETURNING id",
          [customer, point.longitude, point.latitude],
        )
      ).rows[0].id;
      const ride = (await rides.findById(rideId))!;
      return { f, drivers, rides, ride, rideId, point, location };
    }
    it.each([0, 24999.99, 25000])(
      'matches, offers and accepts at %s metres from the driver’s live Motihari location',
      async (distance) => {
        const f = await dispatchFixture(distance);
        const candidates = await new MatchingService(f.drivers).findDispatchDrivers(f.ride, null);
        expect(candidates.map((v) => v.driverProfileId)).toContain(f.f.profile);
        expect(await f.rides.offerDispatch(f.rideId, f.f.profile, 60000)).toBe(true);
        expect(await f.rides.pendingDispatch(f.rideId)).not.toBeNull();
        expect(await f.rides.accept(f.rideId, f.f.profile)).not.toBeNull();
      },
      30_000,
    );
    it('matches a pickup at live GPS even beyond the saved operating area', async () => {
      const f = await dispatchFixture(25000.01);
      await pool.query(
        'UPDATE driver_profiles SET last_location=ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,last_location_at=NOW() WHERE id=$1',
        [f.f.profile, f.point.longitude, f.point.latitude],
      );
      const candidates = await new MatchingService(f.drivers).findDispatchDrivers(f.ride, null);
      expect(candidates.map((v) => v.driverProfileId)).toContain(f.f.profile);
      expect(await f.rides.offerDispatch(f.rideId, f.f.profile, 60000)).toBe(true);
    }, 30_000);
    it.each([
      ['pickup beyond proximity with driver at its live position', 25000.01, 0],
      ['driver beyond coverage with pickup inside coverage', 1000, 30000],
    ] as const)(
      'independently rejects %s',
      async (_label, pickupDistance, driverDistance) => {
        const f = await dispatchFixture(pickupDistance);
        await pool.query(
          'UPDATE driver_profiles SET last_location=ST_Project(ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,$4::float8,0::float8),last_location_at=NOW() WHERE id=$1',
          [f.f.profile, f.location.longitude, f.location.latitude, driverDistance],
        );
        const candidates = await new MatchingService(f.drivers).findDispatchDrivers(f.ride, null);
        expect(candidates.map((driver) => driver.driverProfileId)).not.toContain(f.f.profile);
        expect(await f.rides.offerDispatch(f.rideId, f.f.profile, 60000)).toBe(false);
      },
      30_000,
    );
    it('accepts using live GPS after saved operating coordinates change', async () => {
      const f = await dispatchFixture(1000);
      expect(await f.rides.offerDispatch(f.rideId, f.f.profile, 60000)).toBe(true);
      await vehicles.update(f.f.vehicle.id, {
        operatingLocation: {
          address: 'Bettiah moved operating point',
          latitude: 26.803,
          longitude: 84.5023,
        },
      });
      expect(await f.rides.accept(f.rideId, f.f.profile)).not.toBeNull();
      expect(await f.rides.pendingDispatch(f.rideId)).toBeNull();
    }, 30_000);
  },
);
