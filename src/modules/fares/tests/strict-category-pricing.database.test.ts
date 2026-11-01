import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresVehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import { PostgresRideRepository } from '../../rides/repositories/ride.repository.js';
import { PostgresAdminRepository } from '../../admin/repositories/admin.repository.js';
import { AdminService } from '../../admin/services/admin.service.js';
import { AdminController } from '../../admin/controllers/admin.controller.js';
import { createAdminRouter } from '../../admin/routes/admin.routes.js';
import { FareCalculatorService } from '../services/fare-calculator.service.js';
import { FareEstimateService } from '../services/fare-estimate.service.js';
import { FareController } from '../controllers/fare.controller.js';
import { createFareRouter } from '../routes/fare.routes.js';
import { RideService } from '../../rides/services/ride.service.js';
import { RideController } from '../../rides/controllers/ride.controller.js';
import { createRideRouter } from '../../rides/routes/ride.routes.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import type { MapProvider } from '../../rides/providers/map.provider.js';

// This suite is executed only in the retained, disposable loopback PostgreSQL
// database. Only external road routing is deterministic, not prices or APIs.
describe.runIf(process.env.RIDE_DB_TESTS === 'true')(
  'exact category pricing over HTTP and PostgreSQL',
  () => {
    const vehicles = new PostgresVehicleRepository(pool);
    const calculator = new FareCalculatorService();
    const estimator = new FareEstimateService(
      {
        calculateRoute: async () => ({ distanceMeters: 10000, durationSeconds: 600 }),
        calculateMatrix: async () => [],
        geocode: async () => null,
        places: async () => [],
      } as MapProvider,
      calculator,
      undefined,
      vehicles,
    );
    const app = express();
    app.use(express.json());
    app.use(
      '/admin',
      createAdminRouter(
        new AdminController(new AdminService(new PostgresAdminRepository(pool), vehicles)),
      ),
    );
    app.use('/fares', createFareRouter(new FareController(estimator)));
    app.use(
      '/rides',
      createRideRouter(
        new RideController(
          new RideService(new PostgresRideRepository(pool), undefined, undefined, estimator),
        ),
      ),
    );
    app.use(errorMiddleware);
    let admin: string, customer: string;
    const input = {
      pickup: { latitude: 25.6, longitude: 85.1 },
      destination: { latitude: 25.61, longitude: 85.11 },
      sector: 'passenger',
      vehicleCategory: 'hatchback',
    };
    const auth = (value: string) => 'Bearer ' + value;
    beforeAll(async () => {
      const accounts = await pool.query(
        "INSERT INTO users(first_name,last_name,role) VALUES('Strict','TEST Admin','admin'),('Strict','TEST Customer','customer') RETURNING id,role",
      );
      admin = await signAccessToken({
        sub: accounts.rows.find((r) => r.role === 'admin').id,
        role: 'admin',
        type: 'access',
      });
      customer = await signAccessToken({
        sub: accounts.rows.find((r) => r.role === 'customer').id,
        role: 'customer',
        type: 'access',
      });
    });
    const estimate = (code: string) =>
      request(app)
        .post('/fares/estimate')
        .set('authorization', auth(customer))
        .send({ ...input, vehicleCategory: code });
    const book = (code: string, quote?: unknown) =>
      request(app)
        .post('/rides')
        .set('authorization', auth(customer))
        .send({ ...input, vehicleCategory: code, ...(quote ? { pricingQuote: quote } : {}) });
    async function configure(code: string, baseFare: number, perKmRate: number) {
      const t = await vehicles.findTypeByCode(code, 'passenger');
      if (!t) throw Error('Migration did not create ' + code);
      const result = await request(app)
        .patch('/admin/vehicle-types/' + t.id)
        .set('authorization', auth(admin))
        .send({
          baseFare: t.pricingReference?.demandPricing ? null : baseFare,
          perKmRate: t.pricingReference?.demandPricing ? null : perKmRate,
          pricingReference: t.pricingReference?.demandPricing
            ? {
                ...t.pricingReference,
                baseFare: { minimum: baseFare * 100, maximum: baseFare * 100 },
                perKmRate: { minimum: perKmRate * 100, maximum: perKmRate * 100 },
              }
            : null,
          active: true,
          expectedVersion: t.version,
        });
      expect(result.status, result.text).toBe(200);
      return result.body.data;
    }
    function binding(fare: {
      bookingFare: { vehicleConfiguration: { id: string }; grossAmount: number };
      pricingVersion: string;
    }) {
      return {
        vehicleTypeId: fare.bookingFare.vehicleConfiguration.id,
        pricingVersion: fare.pricingVersion,
        amountPaise: fare.bookingFare.grossAmount,
      };
    }
    it('lists every registration category, including unpriced rows, and rejects missing/inactive pricing', async () => {
      // Other suites may remove catalog fixtures. Repair missing rows first,
      // then prove another migration run preserves every existing record.
      await pool.query(
        readFileSync('migrations/088_complete_unpriced_vehicle_catalog.sql', 'utf8'),
      );
      const before = (await pool.query('SELECT * FROM vehicle_types ORDER BY id')).rows;
      await pool.query(
        readFileSync('migrations/088_complete_unpriced_vehicle_catalog.sql', 'utf8'),
      );
      expect((await pool.query('SELECT * FROM vehicle_types ORDER BY id')).rows).toEqual(before);
      const missing = await pool.query(
        'SELECT c.* FROM fleet_registration_vehicle_types c LEFT JOIN vehicle_types t USING(sector,code) WHERE t.id IS NULL',
      );
      expect(missing.rows).toEqual([]);
      const list = await request(app)
        .get('/admin/vehicle-types?limit=100')
        .set('authorization', auth(admin));
      expect(list.status).toBe(200);
      expect(
        list.body.data.find(
          (t: { code: string; sector: string }) =>
            t.code === 'hatchback' && t.sector === 'passenger',
        ),
      ).toMatchObject({ baseFare: null, perKmRate: null, active: false });
      expect((await estimate('hatchback')).status).toBe(422);
      expect((await book('hatchback')).status).toBe(422);
      expect((await estimate('unmapped_' + randomUUID())).status).toBe(422);
      await expect(vehicles.findTypeByCode('innova')).rejects.toMatchObject({
        code: 'VEHICLE_TYPE_AMBIGUOUS',
      });
    });
    it('configures three distinct actual types, binds quote/booking identity, and preserves historical fare', async () => {
      // Synthetic local prices only, never applied to production.
      await configure('sedan', 111, 11);
      await configure('suv', 222, 22);
      await configure('hatchback', 77, 7);
      const sedan = (await estimate('sedan')).body.data,
        suv = (await estimate('suv')).body.data,
        hatch = (await estimate('hatchback')).body.data;
      expect([
        sedan.bookingFare.grossAmount,
        suv.bookingFare.grossAmount,
        hatch.bookingFare.grossAmount,
      ]).toEqual([33100, 66200, 21700]);
      expect((await book('suv', binding(sedan))).status).toBe(409);
      expect(
        (await book('hatchback', { ...binding(hatch), vehicleTypeId: randomUUID() })).status,
      ).toBe(409);
      expect((await book('hatchback', { ...binding(hatch), amountPaise: 1 })).status).toBe(409);
      const booked = await book('hatchback', binding(hatch));
      expect(booked.status, booked.text).toBe(201);
      expect(booked.body.data.bookingVehicleTypeId).toBe(binding(hatch).vehicleTypeId);
      const before = (
        await pool.query('SELECT fare_estimate,route_metadata FROM rides WHERE id=$1', [
          booked.body.data.id,
        ])
      ).rows[0];
      expect(Number(before.fare_estimate)).toBe(217);
      expect(before.route_metadata.bookingFareSnapshot.vehicleConfiguration).toMatchObject({
        code: 'hatchback',
        id: binding(hatch).vehicleTypeId,
      });
      await configure('hatchback', 88, 8);
      expect((await book('hatchback', binding(hatch))).status).toBe(409);
      const updated = (await estimate('hatchback')).body.data;
      expect(updated.bookingFare.grossAmount).toBe(24800);
      expect(updated.pricingVersion).not.toBe(hatch.pricingVersion);
      expect((await estimate('sedan')).body.data.pricingVersion).toBe(sedan.pricingVersion);
      expect((await estimate('suv')).body.data.bookingFare.grossAmount).toBe(
        suv.bookingFare.grossAmount,
      );
      expect(
        (
          await pool.query('SELECT fare_estimate,route_metadata FROM rides WHERE id=$1', [
            booked.body.data.id,
          ])
        ).rows[0],
      ).toEqual(before);
      // Put the synthetic ride into its completion fixture state. Completion
      // must keep the accepted snapshot after the catalog price has changed.
      const driver = (
        await pool.query(
          "INSERT INTO users(first_name,last_name,role) VALUES('Strict','TEST Driver','driver') RETURNING id",
        )
      ).rows[0];
      const profile = (
        await pool.query(
          "INSERT INTO driver_profiles(user_id,license_number,license_expiry,verification_status) VALUES($1,$2,CURRENT_DATE+365,'approved') RETURNING id",
          [driver.id, randomUUID()],
        )
      ).rows[0];
      const vehicle = (
        await pool.query(
          "INSERT INTO vehicles(driver_profile_id,owner_id,make,model,plate_number,category,verification_status,is_active) VALUES($1,$2,'TEST','Hatchback',$3,'hatchback','approved',TRUE) RETURNING id",
          [profile.id, driver.id, randomUUID().slice(0, 18)],
        )
      ).rows[0];
      await pool.query('UPDATE driver_profiles SET active_vehicle_id=$2 WHERE id=$1', [
        profile.id,
        vehicle.id,
      ]);
      await pool.query(
        "UPDATE rides SET assigned_driver_id=$2,assigned_vehicle_id=$3,status='driver_assigned' WHERE id=$1",
        [booked.body.data.id, profile.id, vehicle.id],
      );
      await pool.query("UPDATE rides SET status='driver_arriving' WHERE id=$1", [
        booked.body.data.id,
      ]);
      await pool.query("UPDATE rides SET status='driver_arrived' WHERE id=$1", [
        booked.body.data.id,
      ]);
      await pool.query("UPDATE rides SET pin_verified=TRUE,status='in_progress' WHERE id=$1", [
        booked.body.data.id,
      ]);
      const completed = await new PostgresRideRepository(pool).complete(
        booked.body.data.id,
        profile.id,
      );
      expect(completed).toMatchObject({
        status: 'completed',
        finalFare: 217,
        bookingVehicleTypeId: binding(hatch).vehicleTypeId,
        bookingPricingVersion: hatch.pricingVersion,
      });
    });
    it('rejects deactivation, forbidden writes, invalid/duplicate configs, and forged scalar fares', async () => {
      const t = (await vehicles.findTypeByCode('hatchback', 'passenger'))!;
      expect(
        (
          await request(app)
            .patch('/admin/vehicle-types/' + t.id)
            .set('authorization', auth(customer))
            .send({ baseFare: 1, expectedVersion: t.version })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .patch('/admin/vehicle-types/' + t.id)
            .set('authorization', auth(admin))
            .send({ baseFare: -1, expectedVersion: t.version })
        ).status,
      ).toBe(400);
      expect(
        (
          await request(app).post('/admin/vehicle-types').set('authorization', auth(admin)).send({
            name: 'Duplicate',
            code: t.code,
            sector: t.sector,
            baseFare: 1,
            perKmRate: 1,
            active: true,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await request(app)
            .post('/rides')
            .set('authorization', auth(customer))
            .send({ ...input, fareEstimate: 1 })
        ).status,
      ).toBe(409);
      const off = await request(app)
        .patch('/admin/vehicle-types/' + t.id + '/status')
        .set('authorization', auth(admin))
        .send({ active: false, expectedVersion: t.version });
      expect(off.status).toBe(200);
      expect((await estimate('hatchback')).status).toBe(422);
      expect((await book('hatchback')).status).toBe(422);
      const empty = (await vehicles.findTypeByCode('winger', 'passenger'))!;
      expect(
        (
          await request(app)
            .patch('/admin/vehicle-types/' + empty.id + '/status')
            .set('authorization', auth(admin))
            .send({ active: true, expectedVersion: empty.version })
        ).status,
      ).toBe(422);
    });
    it('rejects a directly injected wrong-category configuration before calculation', async () => {
      const sedan = (await vehicles.findTypeByCode('sedan', 'passenger'))!;
      expect(() =>
        calculator.calculateEstimate(
          {
            distanceMeters: 1000,
            durationSeconds: 60,
            sector: 'passenger',
            vehicleCategory: 'suv',
          },
          sedan,
        ),
      ).toThrow();
    });
  },
);
