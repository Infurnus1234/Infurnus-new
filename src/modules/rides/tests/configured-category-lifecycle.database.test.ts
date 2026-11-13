import { createLogisticsAdminRouter } from '../../admin/routes/logistics.routes.js';
import { VehicleService } from '../../vehicles/services/vehicle.service.js';
import { VehicleController } from '../../vehicles/controllers/vehicle.controller.js';
import { FareController } from '../../fares/controllers/fare.controller.js';
import { RENTAL_VEHICLE_CODES } from '../../vehicles/services/rental-inventory.js';
import express from 'express';
import request from 'supertest';
import { createRideRouter } from '../routes/ride.routes.js';
import { RideController } from '../controllers/ride.controller.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { DriverController } from '../controllers/driver.controller.js';
import { DriverService } from '../services/driver.service.js';
import type { DriverDocumentStorageService } from '../services/driver-document-storage.service.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { requireDisposableAdministrativeDatabase } from '../../admin/tests/administrative-test-database.js';
import { PostgresVehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import { FareEstimateService } from '../../fares/services/fare-estimate.service.js';
import { FareCalculatorService } from '../../fares/services/fare-calculator.service.js';
import { PostgresPaymentRepository } from '../../payments/repositories/payment.repository.js';
import { LogisticsPaymentService } from '../../payments/services/logistics-payment.service.js';
import { PostgresDriverRepository } from '../repositories/driver.repository.js';
import { PostgresRideRepository } from '../repositories/ride.repository.js';
import { RideService } from '../services/ride.service.js';
import { MatchingService } from '../services/matching.service.js';
import { RideDispatchService } from '../services/ride-dispatch.service.js';
import { dispatchPolicy } from '../services/dispatch-policy.js';
import { syntheticDispatchAreas, syntheticDispatchCity } from './dispatch-test-city.js';
import type { DriverCandidate } from '../types/driver.js';
import type { Ride } from '../types/ride.js';
import type { CreateRideInput } from '../schemas/ride.schemas.js';

// Canonical identifiers from the read-only production inventory on 1 November.
// Prices, accounts, coordinates and city below are synthetic LOCAL TEST data.
const categories: { sector: CreateRideInput['sector']; code: string }[] = JSON.parse(
  readFileSync(new URL('./configured-category-inventory.json', import.meta.url), 'utf8'),
);
const durationHours = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 24];
const premiumDurationHours = Array.from({ length: 24 }, (_, index) => index + 1);
const scenarios = [
  ...categories.flatMap(({ sector, code }) => [
    ...(sector === 'premium'
      ? []
      : [
          {
            sector,
            code,
            hours: undefined as number | undefined,
            tripType: 'round_trip',
            hourly: false,
          },
        ]),
    ...(['premium', 'passenger'].includes(sector)
      ? (sector === 'premium' ? premiumDurationHours : durationHours).flatMap((hours) =>
          (sector === 'premium' ? ['one_way', 'round_trip'] : ['round_trip']).flatMap(
            (tripType) => [
              {
                sector,
                code,
                hours,
                tripType,
                hourly: true,
              },
            ],
          ),
        )
      : []),
  ]),
  ...RENTAL_VEHICLE_CODES.flatMap((code) =>
    durationHours.map((hours) => ({
      sector: 'rental' as const,
      code,
      hours,
      tripType: 'round_trip',
      hourly: true,
    })),
  ),
];
const hourlySchedule = Object.fromEntries(
  [...Array.from({ length: 12 }, (_, i) => String(i + 1)), '12_plus'].map((key, i) => [
    key,
    10000 + i * 3700,
  ]),
);
const area = syntheticDispatchAreas.cities[0]!.area;
const drivers = new PostgresDriverRepository(pool, syntheticDispatchAreas);
const rides = new PostgresRideRepository(pool, syntheticDispatchAreas);
const matching = new MatchingService(drivers, undefined, area);
let routeDistanceMeters = 1000;
const estimator = new FareEstimateService(
  {
    calculateRoute: async () => ({ distanceMeters: routeDistanceMeters, durationSeconds: 300 }),
  } as never,
  new FareCalculatorService(),
  undefined,
  new PostgresVehicleRepository(pool),
);
const service = new RideService(
  rides,
  drivers,
  undefined,
  estimator,
  undefined,
  area,
  undefined,
  matching,
);
const app = express();
app.use(express.json());
app.use(
  '/rides',
  createRideRouter(
    new RideController(service),
    new DriverController(
      new DriverService(drivers, undefined, rides),
      service,
      {} as DriverDocumentStorageService,
    ),
  ),
);
app.post('/fares/estimate', new FareController(estimator).estimate);
app.get(
  '/vehicles/catalog',
  new VehicleController(new VehicleService(new PostgresVehicleRepository(pool))).catalog,
);
app.use('/admin/logistics', createLogisticsAdminRouter(pool));
app.use(errorMiddleware);
const payments = new PostgresPaymentRepository(pool);
const logistics = new LogisticsPaymentService(pool, payments);
let restore: Record<string, unknown> | undefined;
let addedTypeIdentity: { sector: string; code: string } | undefined;
let dispatch: RideDispatchService | undefined;
let fixtureIds: { customer: string; user: string; profile: string; vehicle: string } | undefined;

describe.runIf(process.env.RIDE_DB_TESTS === 'true')(
  'Configured category lifecycle (isolated SQL, simulated Driver receiver)',
  () => {
    beforeAll(() => requireDisposableAdministrativeDatabase());
    afterEach(async () => {
      dispatch?.dispose();
      dispatch = undefined;
      if (fixtureIds) {
        const f = fixtureIds;
        await pool.query('DELETE FROM payments WHERE user_id=$1', [f.customer]);
        await pool.query('DELETE FROM rides WHERE customer_id=$1', [f.customer]);
        await pool.query('UPDATE driver_profiles SET active_vehicle_id=NULL WHERE id=$1', [
          f.profile,
        ]);
        await pool.query('DELETE FROM vehicles WHERE id=$1', [f.vehicle]);
        await pool.query('DELETE FROM driver_profiles WHERE id=$1', [f.profile]);
        await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[f.customer, f.user]]);
        fixtureIds = undefined;
      }
      if (restore) {
        const columns = [
          'active',
          'service_fixed_fare_paise',
          'service_radius_meters',
          'base_fare_paise',
          'per_km_rate_paise',
          'pricing_reference',
          'logistics_slabs',
          'hourly_base_fares_paise',
          'fixed_hourly_rate_paise',
          'hourly_fuel_rate_paise',
          'hourly_fuel_unit',
          'version',
          'extended_duration_policy',
          'hourly_missing_duration_policy',
        ];
        await pool.query(
          `UPDATE vehicle_types SET ${columns.map((c, i) => `${c}=$${i + 2}`).join(',')} WHERE id=$1`,
          [
            restore.id,
            ...columns.map((c) =>
              typeof restore![c] === 'object' && restore![c] !== null
                ? JSON.stringify(restore![c])
                : restore![c],
            ),
          ],
        );
        restore = undefined;
      } else if (addedTypeIdentity) {
        await pool.query('DELETE FROM vehicle_types WHERE sector=$1 AND code=$2', [
          addedTypeIdentity.sector,
          addedTypeIdentity.code,
        ]);
      }
      addedTypeIdentity = undefined;
    });
    it.each(scenarios)(
      '$sector/$code hours=$hours trip=$tripType hourly=$hourly: rejects unavailable supply, persists exact identity, dispatches once, accepts, completes and pays',
      async ({ sector, code, hours, tripType, hourly }) => {
        routeDistanceMeters =
          sector === 'premium'
            ? [50000, 100000, 300000][(hours! - 1) % 3]!
            : sector === 'logistics'
              ? 10025
              : 1000;
        const inventorySector = sector === 'rental' ? 'passenger' : sector;
        restore = (
          await pool.query('SELECT * FROM vehicle_types WHERE sector=$1 AND code=$2', [
            inventorySector,
            code,
          ])
        ).rows[0];
        if (!restore) addedTypeIdentity = { sector: inventorySector, code };
        const slabs =
          sector === 'logistics'
            ? {
                below_15: { baseFare: 100, perKmRate: 10 },
                from_15: { baseFare: 200, perKmRate: 20 },
              }
            : null;
        await pool.query(
          `INSERT INTO vehicle_types(name,code,sector,base_fare_paise,per_km_rate_paise,active,logistics_slabs,service_fixed_fare_paise)
      VALUES($1,$2,$3,$4,$5,TRUE,$6::jsonb,$7) ON CONFLICT(sector,code) DO UPDATE SET active=TRUE,
      base_fare_paise=EXCLUDED.base_fare_paise,per_km_rate_paise=EXCLUDED.per_km_rate_paise,
      pricing_reference=NULL,hourly_base_fares_paise=NULL,logistics_slabs=EXCLUDED.logistics_slabs,service_fixed_fare_paise=EXCLUDED.service_fixed_fare_paise`,
          [
            'TEST ONLY ' + code,
            code,
            inventorySector,
            slabs || sector === 'service' ? null : 10000,
            slabs || sector === 'service' ? null : 1000,
            slabs ? JSON.stringify(slabs) : null,
            sector === 'service' ? 10000 : null,
          ],
        );
        const fixed = sector === 'premium' || sector === 'rental';
        if (fixed)
          await pool.query(
            "UPDATE vehicle_types SET fixed_hourly_rate_paise=10000,hourly_fuel_rate_paise=2000,hourly_fuel_unit=CASE WHEN sector='premium' THEN 'per_km' ELSE 'per_hour' END WHERE sector=$1 AND code=$2",
            [inventorySector, code],
          );
        else if (hourly)
          await pool.query(
            "UPDATE vehicle_types SET hourly_base_fares_paise=$3::jsonb,hourly_missing_duration_policy='require_duration',extended_duration_policy='booked_duration' WHERE sector=$1 AND code=$2",
            [inventorySector, code, JSON.stringify(hourlySchedule)],
          );
        const customer = randomUUID(),
          user = randomUUID(),
          profile = randomUUID(),
          vehicle = randomUUID();
        fixtureIds = { customer, user, profile, vehicle };
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,role) VALUES($1,'TEST','Customer','customer'),($2,'TEST','Driver','driver')",
          [customer, user],
        );
        await pool.query(
          "INSERT INTO driver_profiles(id,user_id,license_number,license_expiry,verification_status) VALUES($1,$2,$3,CURRENT_DATE+365,'approved')",
          [profile, user, 'TEST-' + profile],
        );
        await pool.query(
          "INSERT INTO vehicles(id,owner_id,driver_profile_id,make,model,plate_number,sector,category,verification_status,is_active,operating_city_id) VALUES($1,$2,$3,'TEST','ONLY',$4,$5,$6,'approved',TRUE,$7)",
          [
            vehicle,
            user,
            profile,
            vehicle.slice(0, 20),
            inventorySector,
            code,
            syntheticDispatchCity.cityId,
          ],
        );
        await pool.query(
          "UPDATE driver_profiles SET active_vehicle_id=$2,availability_status='unavailable',last_location=ST_SetSRID(ST_MakePoint(77.5,13),4326)::geography,last_location_at=NOW() WHERE id=$1",
          [profile, vehicle],
        );
        if (sector === 'service')
          await pool.query(
            'UPDATE driver_profiles SET online_preference=TRUE,location_accuracy=8 WHERE id=$1',
            [profile],
          );
        const input: CreateRideInput = {
          sector,
          vehicleCategory: code,
          ...(sector === 'service' ? { clientRequestId: randomUUID() } : {}),
          pickup: { latitude: 13, longitude: 77.5 },
          destination: { latitude: 13.01, longitude: 77.51 },
          ...(hours === undefined ? {} : { bookingHours: hours }),
          ...(sector === 'premium' && hours !== undefined
            ? { rentalDetails: { hours, tripType: tripType as 'one_way' | 'round_trip' } }
            : {}),
          ...(sector === 'logistics' ? { goods: { weightKg: 1 } } : {}),
        };
        await pool.query('UPDATE vehicle_types SET active=FALSE WHERE sector=$1 AND code=$2', [
          inventorySector,
          code,
        ]);
        await expect(service.createRide(customer, input)).rejects.toMatchObject({
          code: 'FARE_CONFIGURATION_MISSING',
        });
        await pool.query('UPDATE vehicle_types SET active=TRUE WHERE sector=$1 AND code=$2', [
          inventorySector,
          code,
        ]);
        await expect(
          service.createRide(customer, { ...input, vehicleCategory: 'missing_' + code }),
        ).rejects.toMatchObject({ code: 'FARE_CONFIGURATION_MISSING' });
        await expect(
          service.createRide(customer, { ...input, destination: { latitude: 0, longitude: 0 } }),
        ).rejects.toMatchObject({ statusCode: 422 });
        const before = (
          await pool.query('SELECT count(*)::int n FROM rides WHERE customer_id=$1', [customer])
        ).rows[0].n;
        const token = await signAccessToken({ sub: customer, role: 'customer', type: 'access' });
        const unavailable = await request(app)
          .post('/rides')
          .auth(token, { type: 'bearer' })
          .send(input);
        if (sector === 'logistics') {
          expect(unavailable.status, unavailable.text).toBe(201);
          const waiting = unavailable.body.data as Ride;
          expect(waiting).toMatchObject({ status: 'searching', vehicleCategory: code });
          expect(waiting.bookingId).toBeTruthy();
          expect(
            Date.parse(String(waiting.logisticsFulfillmentDeadline)) -
              Date.parse(String(waiting.createdAt)),
          ).toBe(30 * 60 * 1000);
          const emptyDispatch = new RideDispatchService(rides, matching, vi.fn(), undefined, area);
          try {
            await emptyDispatch.dispatch(waiting);
            const persisted = await rides.findById(waiting.id);
            expect(persisted).toMatchObject({
              status: 'searching',
              logisticsSearchStatus: 'arranging',
            });
            const { rows } = await pool.query(
              'SELECT logistics_escalation_reason FROM rides WHERE id=$1',
              [waiting.id],
            );
            expect(rows[0]?.logistics_escalation_reason).toBe('search_exhausted');
          } finally {
            emptyDispatch.dispose();
          }
          const admin = randomUUID();
          await pool.query(
            "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'Logistics','Fixture',$2,'super_admin')",
            [admin, `${admin}@example.test`],
          );
          try {
            const adminToken = await signAccessToken({
              sub: admin,
              role: 'super_admin',
              type: 'access',
            });
            const dashboard = await request(app)
              .get('/admin/logistics/dispatch')
              .query({ search: waiting.bookingId, filter: 'escalated' })
              .auth(adminToken, { type: 'bearer' });
            expect(dashboard.status, dashboard.text).toBe(200);
            const row = dashboard.body.data.items.find(
              (item: { id: string }) => item.id === waiting.id,
            );
            expect(row).toMatchObject({
              escalationReason: 'search_exhausted',
              status: 'searching',
            });
            expect(Date.parse(row.deadline)).toBe(
              Date.parse(String(waiting.logisticsFulfillmentDeadline)),
            );
          } finally {
            await pool.query('DELETE FROM users WHERE id=$1', [admin]);
          }
          await service.cancelRide(customer, waiting.id, {
            reason: 'Zero-supply test fixture finished',
          });
          await pool.query(
            "UPDATE driver_profiles SET availability_status='available' WHERE id=$1",
            [profile],
          );
        } else {
          expect(unavailable.status, unavailable.text).toBe(409);
          expect(unavailable.body.error.code).toBe('NO_ELIGIBLE_DRIVERS');
          await expect(service.createRide(customer, input)).rejects.toMatchObject({
            code: 'NO_ELIGIBLE_DRIVERS',
          });
          expect(
            (await pool.query('SELECT count(*)::int n FROM rides WHERE customer_id=$1', [customer]))
              .rows[0].n,
          ).toBe(before);
          await pool.query(
            "UPDATE driver_profiles SET availability_status='available',last_location_at=NOW()-INTERVAL '1 day' WHERE id=$1",
            [profile],
          );
          await expect(service.createRide(customer, input)).rejects.toMatchObject({
            code: 'NO_ELIGIBLE_DRIVERS',
          });
          await pool.query(
            'UPDATE driver_profiles SET last_location=NULL,last_location_at=NULL WHERE id=$1',
            [profile],
          );
          await expect(service.createRide(customer, input)).rejects.toMatchObject({
            code: 'NO_ELIGIBLE_DRIVERS',
          });
        }
        await pool.query(
          'UPDATE driver_profiles SET last_location=ST_SetSRID(ST_MakePoint(77.5,13),4326)::geography,last_location_at=NOW() WHERE id=$1',
          [profile],
        );
        let booked: Ride;
        if (sector === 'rental' || sector === 'logistics') {
          const requestBody = input;
          const quote = await request(app).post('/fares/estimate').send(requestBody);
          expect(quote.status, quote.text).toBe(200);
          const bookingFare = quote.body.data.bookingFare;
          if (sector === 'logistics') {
            expect(quote.body.data.distanceMeters).toBe(10025);
            expect(quote.body.data).not.toHaveProperty('billableDistanceMeters');
            expect(bookingFare).toMatchObject({
              distanceMeters: 10025,
              baseAmount: 10000,
              distanceAmount: 20050,
              grossAmount: 30100,
              vehicleConfiguration: { logisticsSlab: 'below_15' },
            });
            expect(bookingFare).not.toHaveProperty('billableDistanceMeters');
          } else {
            const catalog = await request(app).get('/vehicles/catalog').query({ sector: 'rental' });
            expect(catalog.status, catalog.text).toBe(200);
            expect(catalog.body.data).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  id: bookingFare.vehicleConfiguration.id,
                  code,
                  sector: 'rental',
                }),
              ]),
            );
          }
          const response = await request(app)
            .post('/rides')
            .auth(token, { type: 'bearer' })
            .send({
              ...requestBody,
              pricingQuote: {
                vehicleTypeId: bookingFare.vehicleConfiguration.id,
                pricingVersion: bookingFare.pricingVersion,
                amountPaise: bookingFare.grossAmount,
              },
            });
          expect(response.status, response.text).toBe(201);
          booked = response.body.data as Ride;
        } else {
          booked = await service.createRide(customer, input);
        }
        expect(booked).toMatchObject({ sector, vehicleCategory: code, status: 'searching' });
        if (sector === 'logistics') expect(booked.fareEstimate).toBe(301);
        if (hourly) {
          const snapshot = (
            await pool.query(
              "SELECT route_metadata->'bookingFareSnapshot' snapshot,route_metadata->'rentalDetails' rental_details FROM rides WHERE id=$1",
              [booked.id],
            )
          ).rows[0];
          expect(snapshot.snapshot.vehicleConfiguration).toMatchObject({
            bookedHours: hours,
            ...(fixed
              ? { pricingModel: 'fixed_hourly' }
              : { durationBucket: hours! > 12 ? '12_plus' : String(hours) }),
            code,
          });
          expect(snapshot.snapshot.baseAmount).toBe(
            fixed ? 10000 * hours! : hourlySchedule[hours! > 12 ? '12_plus' : String(hours)],
          );
          if (fixed)
            expect(snapshot.snapshot.grossAmount).toBe(
              sector === 'premium'
                ? 10000 * hours! + (2 * routeDistanceMeters * 2000) / 1000
                : 12000 * hours!,
            );
          if (sector === 'premium')
            expect(snapshot.rental_details).toMatchObject({ hours, tripType });
          if (sector === 'rental') expect(snapshot.rental_details).toEqual({ hours });
        }
        const notify = vi.fn(async (candidate: DriverCandidate, ride: Ride) => {
          expect(candidate.driverProfileId).toBe(profile);
          expect(ride.sector).toBe(sector);
          expect(ride.vehicleCategory).toBe(code);
          await service.acceptRide(profile, ride.id);
        });
        dispatch = new RideDispatchService(rides, matching, notify, undefined, area);
        await Promise.all([dispatch.dispatch(booked), dispatch.dispatch(booked)]);
        expect(notify).toHaveBeenCalledTimes(1);
        expect((await rides.findById(booked.id))?.status).toBe('driver_assigned');
        const attempt = (
          await pool.query(
            'SELECT status,EXTRACT(EPOCH FROM(expires_at-offered_at))*1000 AS ms FROM ride_dispatch_attempts WHERE ride_id=$1',
            [booked.id],
          )
        ).rows;
        expect(attempt).toHaveLength(1);
        expect(attempt[0].status).toBe('accepted');
        expect(
          Math.abs(Number(attempt[0].ms) - dispatchPolicy(sector, code).responseMs),
        ).toBeLessThan(1000);
        const cash = async (stage: 'upfront' | 'final') => {
          const p = await logistics.initiate(booked.id, customer, 'customer', {
            provider: 'cash',
            stage,
          });
          expect(Number(p.amount)).toBe(stage === 'upfront' ? 120 : 181);
          await logistics.claim(p.id, customer);
          expect((await logistics.confirmCash(p.id, user, 'driver'))?.status).toBe('CAPTURED');
        };
        if (sector === 'logistics') await cash('upfront');
        await service.transitionRide(booked.id, 'driver_arriving', profile);
        await service.transitionRide(booked.id, 'driver_arrived', profile);
        await service.transitionRide(booked.id, 'in_progress', profile, booked.pin!);
        let endPin: string | undefined;
        if (sector === 'logistics') {
          const customerRide = await rides.findByIdForCustomer(booked.id, customer);
          endPin = customerRide?.endPin ?? undefined;
        }
        const driverToken = await signAccessToken({ sub: user, role: 'driver', type: 'access' });
        const complete = () =>
          request(app)
            .post('/rides/' + booked.id + '/complete')
            .auth(driverToken, { type: 'bearer' });
        const fix = async (distance: number, accuracy: number, age = 1) => {
          await pool.query(
            `UPDATE driver_profiles dp
               SET last_location=ST_SetSRID(ST_MakePoint(ST_X(r.destination_location::geometry),
                     ST_Y(r.destination_location::geometry)+degrees($3::float8/6371008.7714)),4326)::geography,
                   last_location_at=NOW()-($5::int * INTERVAL '1 second'),
                   location_accuracy=$4
               FROM rides r WHERE dp.id=$1 AND r.id=$2`,
            [profile, booked.id, distance, accuracy, age],
          );
        };
        const expectBlocked = async () => {
          const response = await complete().send({
            latitude: booked.destination.latitude,
            longitude: booked.destination.longitude,
            ...(endPin ? { endPin } : {}),
          });
          expect(response.status, response.text).toBe(409);
          expect(response.body.error.code).toBe('DESTINATION_NOT_REACHED');
          expect((await rides.findById(booked.id))?.status).toBe('in_progress');
        };
        if (sector !== 'passenger') {
          await expectBlocked();
          for (const distance of [10000, 1000, 500, 201]) {
            await fix(distance, 8);
            await expectBlocked();
          }
          await fix(50, 101);
          await expectBlocked();
          await fix(50, 8, 40);
          await expectBlocked();
          await fix(199, 65);
        }
        const response = await (endPin ? complete().send({ endPin }) : complete());
        expect(response.status, response.text).toBe(200);
        expect(response.body.data.status).toBe('completed');
        const completed = (await rides.findById(booked.id))!;
        expect(completed.status).toBe('completed');
        expect(completed.finalFare).toBe(booked.fareEstimate);
        if (sector === 'rental') {
          const history = await request(app).get('/rides').auth(token, { type: 'bearer' });
          expect(history.status, history.text).toBe(200);
          expect(history.body.data).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                id: booked.id,
                sector: 'rental',
                status: 'completed',
                rentalDetails: { hours },
              }),
            ]),
          );
        }
        if (sector === 'logistics') {
          await cash('final');
          expect((await logistics.summary(booked.id, customer, 'customer')).outstandingPaise).toBe(
            0,
          );
        } else {
          const p = await payments.initiate({
            userId: customer,
            rideId: booked.id,
            amount: completed.finalFare!,
            provider: 'cash',
            currency: 'INR',
          });
          expect((await payments.capture({ paymentId: p.id }))?.status).toBe('CAPTURED');
        }
        // Deterministic expiry of the persisted offer, rather than a wall-clock wait.
        await pool.query(
          "UPDATE driver_profiles SET availability_status='available',last_location_at=NOW() WHERE id=$1",
          [profile],
        );
        const expiring = await service.createRide(customer, {
          ...input,
          ...(sector === 'service' ? { clientRequestId: randomUUID() } : {}),
        });
        const policy = dispatchPolicy(sector, code);
        expect(
          await rides.offerDispatch(
            expiring.id,
            profile,
            policy.responseMs,
            sector === 'premium' ? syntheticDispatchCity : undefined,
          ),
        ).toBe(true);
        await pool.query(
          "UPDATE rides SET dispatch_expires_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",
          [expiring.id],
        );
        await pool.query(
          "UPDATE ride_dispatch_attempts SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE ride_id=$1 AND status='offered'",
          [expiring.id],
        );
        expect(await rides.finishDispatchAttempt(expiring.id, profile, 'timed_out')).toBe(true);
        expect(await rides.finishDispatchAttempt(expiring.id, profile, 'timed_out')).toBe(false);
        await dispatch.dispatch(expiring);
        const afterTimeout = await rides.findById(expiring.id);
        if (sector === 'logistics') {
          expect(afterTimeout?.status).toBe('searching');
          const recovery = await pool.query(
            'SELECT logistics_escalation_reason, logistics_retry_at > NOW() AS deferred FROM rides WHERE id=$1',
            [expiring.id],
          );
          expect(recovery.rows).toEqual([{ logistics_escalation_reason: null, deferred: true }]);
          await service.cancelRide(customer, expiring.id, { reason: 'Test fixture finished' });
        } else {
          expect(afterTimeout?.status).toBe('cancelled');
        }
        await pool.query(
          "UPDATE driver_profiles SET availability_status='unavailable' WHERE id=$1",
          [profile],
        );
      },
    );
  },
);
