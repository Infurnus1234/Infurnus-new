import { beforeAll, describe, it, expect } from 'vitest';
import { recordDestinationArrival } from './destination-arrival.fixture.js';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import request from 'supertest';
import { io as connect, type Socket } from 'socket.io-client';
import { pool } from '../../../infrastructure/database/postgres.js';
import { env } from '../../../config/env.js';
import { requireDisposableAdministrativeDatabase } from '../../admin/tests/administrative-test-database.js';
import { PostgresRideRepository } from '../repositories/ride.repository.js';
import { PostgresDriverRepository } from '../repositories/driver.repository.js';
import { PostgresVehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import { PostgresPaymentRepository } from '../../payments/repositories/payment.repository.js';
import { LogisticsPaymentService } from '../../payments/services/logistics-payment.service.js';
import { RideService } from '../services/ride.service.js';
import { DriverService } from '../services/driver.service.js';
import { MatchingService } from '../services/matching.service.js';
import { RouteRecalculationService } from '../services/route-recalculation.service.js';
import { RideController } from '../controllers/ride.controller.js';
import { DriverController } from '../controllers/driver.controller.js';
import { createRideRouter } from '../routes/ride.routes.js';
import { createSocketServer } from '../../../infrastructure/socket/socket.server.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { ServiceAreaPolicy } from '../../maps/service-area.js';
import { CommonMapService } from '../../maps/map.service.js';
import { mapConfig } from '../../maps/map.config.js';
import { FareEstimateService } from '../../fares/services/fare-estimate.service.js';
import { FareCalculatorService } from '../../fares/services/fare-calculator.service.js';
import type { MapProvider } from '../providers/map.provider.js';
import type { DriverDocumentStorageService } from '../services/driver-document-storage.service.js';
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const area = new ServiceAreaPolicy(
  {
    type: 'Polygon',
    coordinates: [
      [
        [82, 23],
        [89, 23],
        [89, 28],
        [82, 28],
        [82, 23],
      ],
    ],
  },
  true,
);
const registry = {
  cities: [
    {
      id: 'TEST_LOGISTICS_DISTRICT',
      name: 'TEST ONLY',
      boundaryFile: 'SYNTHETIC',
      approvalReference: 'LOCAL TEST ONLY',
      area,
    },
  ],
};
describe.runIf(process.env.RIDE_DB_TESTS === 'true')(
  'Logistics district HTTP/socket/PIN/payment integration',
  () => {
    beforeAll(() => requireDisposableAdministrativeDatabase());
    it.each([
      ['Muzaffarpur', 26.122, 85.39, 'Selected building, Muzaffarpur'],
      ['Gaya', 24.795, 85.0, 'Selected building, Gaya'],
      ['Patna', 25.6022, 85.1371, 'Patna Junction, Patna'],
    ])(
      'pickup Patna → %s: district through accept/reconnect/failed PIN, full address after verified PIN',
      async (name, latitude, longitude, address) => {
        const customer = randomUUID(),
          driver = randomUUID(),
          category = 'district_' + randomUUID().replaceAll('-', '');
        await pool.query(
          "INSERT INTO vehicle_types(name,code,sector,base_fare_paise,per_km_rate_paise,logistics_slabs,active,catalog_visible) VALUES('TEST ONLY Logistics District',$1,'logistics',NULL,NULL,$2::jsonb,TRUE,FALSE)",
          [
            category,
            JSON.stringify({
              below_15: { baseFare: 100, perKmRate: 20 },
              from_15: { baseFare: 200, perKmRate: 25 },
            }),
          ],
        );
        const previous = [env.DISPATCH_TEST_CUSTOMER_ID, env.DISPATCH_TEST_DRIVER_USER_ID];
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'Local','Customer',$2,'customer'),($3,'Local','Driver',$4,'driver')",
          [customer, customer + '@example.invalid', driver, driver + '@example.invalid'],
        );
        const profile = (
          await pool.query(
            "INSERT INTO driver_profiles(user_id,license_number,license_expiry,verification_status,verified_at) VALUES($1,$2,CURRENT_DATE+365,'approved',NOW()) RETURNING id",
            [driver, driver],
          )
        ).rows[0].id;
        await pool.query(
          'INSERT INTO provider_onboarding(user_id,role_flow_active,dashboard_deferred_at) VALUES($1,TRUE,NOW())',
          [driver],
        );
        const vehicle = (
          await pool.query(
            "INSERT INTO vehicles(owner_id,driver_profile_id,make,model,plate_number,category,sector,verification_status,is_active) VALUES($1,$2,'TEST ONLY','District',$3,$4,'logistics','approved',TRUE) RETURNING id",
            [driver, profile, randomUUID().slice(0, 20), category],
          )
        ).rows[0].id;
        await pool.query(
          "UPDATE driver_profiles SET active_vehicle_id=$2,availability_status='available',last_location=ST_SetSRID(ST_MakePoint(85.144,25.612),4326)::geography,last_location_at=NOW()-INTERVAL '1 second' WHERE id=$1",
          [profile, vehicle],
        );
        env.DISPATCH_TEST_CUSTOMER_ID = customer;
        env.DISPATCH_TEST_DRIVER_USER_ID = driver;
        const provider: MapProvider = {
          providerName: 'LOCAL_TEST_ONLY',
          calculateRoute: async () => ({
            distanceMeters: 42000,
            durationSeconds: 3600,
            encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
          }),
          calculateMatrix: async () => [],
          geocode: async () => null,
          places: async () => [],
          resolveDistrict: async (point) => {
            expect(point).toEqual({ latitude, longitude });
            return {
              name,
              countryCode: 'IN',
              state: 'Bihar',
              level: 3,
              source: 'google_geocoding',
            };
          },
        };
        const maps = new CommonMapService(provider, undefined, mapConfig, Date.now, () => {}, area),
          repo = new PostgresRideRepository(pool, registry),
          drivers = new PostgresDriverRepository(pool);
        const fares = new FareEstimateService(
          maps,
          new FareCalculatorService(),
          { allowFallback: false },
          new PostgresVehicleRepository(pool),
        );
        const service = new RideService(repo, drivers, undefined, fares, undefined, area, maps);
        const driverService = new DriverService(drivers, undefined, repo, undefined, (r) =>
          service.prepareDriverRide(r),
        );
        const app = express();
        app.use(express.json());
        app.use(
          '/rides',
          createRideRouter(
            new RideController(service),
            new DriverController(driverService, service, {} as DriverDocumentStorageService),
          ),
        );
        app.use(errorMiddleware);
        const http = createServer(app),
          io = createSocketServer(http, {
            driverService,
            rideRepository: repo,
            rideService: service,
            routeRecalculationService: new RouteRecalculationService(maps),
            matchingService: new MatchingService(drivers, maps, area),
          });
        await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
        const port = (http.address() as { port: number }).port;
        const driverToken = await signAccessToken({ sub: driver, role: 'driver', type: 'access' }),
          customerToken = await signAccessToken({
            sub: customer,
            role: 'customer',
            type: 'access',
          });
        const clients: Socket[] = [];
        const socket = async (token: string, ready = 'connect') => {
          const s = connect('http://127.0.0.1:' + port, {
            auth: { token },
            transports: ['websocket'],
            autoConnect: false,
            reconnection: false,
          });
          clients.push(s);
          await new Promise<void>((resolve, reject) => {
            s.once(ready, () => resolve());
            s.once('connect_error', reject);
            s.connect();
          });
          return s;
        };
        const event = (s: Socket, type: string) =>
          new Promise<any>((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('Expected socket event ' + type)), 8000);
            s.once(type, (p) => {
              clearTimeout(timer);
              resolve(p);
            });
          });
        const api = (
          method: 'get' | 'post' | 'patch',
          path: string,
          body?: object,
          token = driverToken,
        ) => {
          const q = request(app)[method](path).auth(token, { type: 'bearer' });
          return body ? q.send(body) : q;
        };
        const privateView = (r: any) => {
          expect(r.destinationAddress).toBe(name);
          expect(r.destination).toBeNull();
          expect(r.rideInformation.drop).toEqual({ address: name });
          expect(r.destinationVisibility).toBe('district_only');
          const text = JSON.stringify(r);
          expect(text).not.toContain(address);
          expect(text).not.toContain(String(latitude));
          expect(text).not.toMatch(
            new RegExp('"longitude":' + String(longitude).replaceAll('.', '\\.') + '[,}]'),
          );
          expect(text).not.toContain('destinationDistrictLookup');
        };
        try {
          let ds = await socket(driverToken, 'driver:ready');
          const cs = await socket(customerToken);
          const offered = event(ds, 'ride:incoming');
          const payload = {
            pickup: { latitude: 25.612, longitude: 85.144 },
            destination: { latitude, longitude },
            pickupAddress: 'Gandhi Maidan, Patna',
            destinationAddress: address,
            sector: 'logistics',
            vehicleCategory: category,
            goods: { weightKg: 100 },
          };
          expect(
            (
              await api(
                'post',
                '/rides',
                { ...payload, destinationDistrict: 'Client spoof' },
                customerToken,
              )
            ).status,
          ).toBe(400);
          const created = await api('post', '/rides', payload, customerToken);
          expect(created.status, JSON.stringify(created.body)).toBe(201);
          const id = created.body.data.id;
          expect(created.body.data.destinationAddress).toBe(address);
          expect(created.body.data.destination).toEqual({ latitude, longitude });
          privateView((await offered).ride);
          const available = await api('get', '/rides/driver/available');
          privateView(available.body.data.find((r: any) => r.id === id));
          const accepted = await api('post', '/rides/' + id + '/accept');
          expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
          privateView(accepted.body.data);
          const amount = accepted.body.data.rideInformation.fare.amount;
          expect((await api('post', '/rides/' + id + '/accept')).status).toBe(409);
          await ds.timeout(2000).emitWithAck('ride:join', id);
          await cs.timeout(2000).emitWithAck('ride:join', id);
          const leaked: any[] = [];
          ds.on('ride:user_location_updated', (p) => leaked.push(p));
          const customerLocation = event(cs, 'ride:user_location_updated');
          expect(
            (
              await api(
                'post',
                '/rides/' + id + '/location',
                { latitude, longitude, timestamp: new Date(Date.now() - 1).toISOString() },
                customerToken,
              )
            ).status,
          ).toBe(200);
          await customerLocation;
          await pause(40);
          expect(leaked).toEqual([]);
          const preMap = await api('get', '/rides/driver/rides/' + id + '/map');
          expect(preMap.body.data.drop).toEqual({ address: name });
          expect(preMap.body.data.userLocation).toBeNull();
          expect(preMap.body.data.segment).toBe('pickup');
          // Existing ride missing district metadata is lazily backfilled, without changing its exact destination.
          await pool.query(
            "UPDATE rides SET route_metadata=route_metadata-'logisticsDestinationDistrict' WHERE id=$1",
            [id],
          );
          ds.disconnect();
          ds = await socket(driverToken, 'driver:ready');
          await ds.timeout(2000).emitWithAck('ride:join', id);
          privateView((await api('get', '/rides/driver/current-trip')).body.data);
          expect((await repo.findById(id))?.destinationAddress).toBe(address);
          expect((await repo.findById(id))?.destination).toEqual({ latitude, longitude });
          for (const status of ['driver_arriving', 'driver_arrived']) {
            const r = await api('post', '/rides/' + id + '/status', { status });
            expect(r.status, JSON.stringify(r.body)).toBe(200);
            privateView(r.body.data);
          }
          const customerRide = await api('get', '/rides/' + id, undefined, customerToken),
            pin = customerRide.body.data.pin;
          expect((await api('post', '/rides/' + id + '/verify-pin', { pin })).status).toBe(409);
          const paymentService = new LogisticsPaymentService(
            pool,
            new PostgresPaymentRepository(pool),
          );
          const upfront = await paymentService.initiate(id, customer, 'customer', {
            provider: 'cash',
            stage: 'upfront',
          });
          await paymentService.claim(upfront.id, customer);
          await paymentService.confirmCash(upfront.id, driver, 'driver');
          const plan = await paymentService.summary(id, driver, 'driver');
          expect(plan.upfrontPaise).toBe(Math.round(plan.totalPaise * 0.4));
          expect(plan.finalPaise + plan.upfrontPaise).toBe(plan.totalPaise);
          expect(Number(upfront.amount)).toBe(plan.upfrontPaise / 100);
          const failed = await api('post', '/rides/' + id + '/verify-pin', {
            pin: pin === '9999' ? '0000' : '9999',
          });
          expect(failed.status).toBe(400);
          privateView((await api('get', '/rides/driver/current-trip')).body.data);
          const updated = event(ds, 'ride:lifecycle_updated');
          const verified = await api('post', '/rides/' + id + '/verify-pin', { pin });
          expect(verified.status, JSON.stringify(verified.body)).toBe(200);
          expect(verified.body.data.ride.destinationAddress).toBe(address);
          expect(verified.body.data.ride.destination).toEqual({ latitude, longitude });
          expect((await updated).ride.destinationAddress).toBe(address);
          expect(verified.body.data.ride.rideInformation.fare.amount).toBe(amount);
          const fullMap = await api('get', '/rides/driver/rides/' + id + '/map');
          expect(fullMap.body.data.drop).toEqual({ latitude, longitude, address });
          await recordDestinationArrival(pool, id, profile);
          const endPin =
            (await api('get', '/rides/' + id, undefined, customerToken)).body.data.endPin ??
            (await repo.findByIdForCustomer(id, customer))?.endPin;
          const complete = await api('post', '/rides/' + id + '/complete', { endPin });
          expect(complete.status, JSON.stringify(complete.body)).toBe(200);
          const final = await paymentService.initiate(id, customer, 'customer', {
            provider: 'cash',
            stage: 'final',
          });
          expect(Number(final.amount)).toBe(plan.finalPaise / 100);
          await paymentService.claim(final.id, customer);
          await paymentService.confirmCash(final.id, driver, 'driver');
          expect((await paymentService.summary(id, driver, 'driver')).settlementStatus).toBe(
            'settled',
          );
          const history = await api('get', '/rides/driver/history');
          expect(history.body.data.rides.find((r: any) => r.id === id).destinationAddress).toBe(
            address,
          );
        } finally {
          for (const s of clients) s.disconnect();
          await new Promise<void>((resolve) => io.close(() => resolve()));
          if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
          [env.DISPATCH_TEST_CUSTOMER_ID, env.DISPATCH_TEST_DRIVER_USER_ID] = previous;
        }
      },
      60000,
    );
  },
);
