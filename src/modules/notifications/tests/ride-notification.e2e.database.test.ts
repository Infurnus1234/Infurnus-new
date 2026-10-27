import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { io as connect, type Socket } from 'socket.io-client';
import { describe, it, expect, afterEach } from 'vitest';
import { env } from '../../../config/env.js';
import { pool } from '../../../infrastructure/database/postgres.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { createAuthController } from '../../auth/controllers/auth.controller.js';
import { createAuthRouter } from '../../auth/routes/auth.routes.js';
import type { OtpProvider } from '../../auth/providers/otp.provider.js';
import { createDeviceTokenRouter } from '../device-tokens/routes/device-token.routes.js';
import { PostgresRideRepository } from '../../rides/repositories/ride.repository.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { PostgresVehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import { RideService } from '../../rides/services/ride.service.js';
import { DriverService } from '../../rides/services/driver.service.js';
import { MatchingService } from '../../rides/services/matching.service.js';
import { RouteRecalculationService } from '../../rides/services/route-recalculation.service.js';
import { RideController } from '../../rides/controllers/ride.controller.js';
import { DriverController } from '../../rides/controllers/driver.controller.js';
import type { DriverDocumentStorageService } from '../../rides/services/driver-document-storage.service.js';
import { createRideRouter } from '../../rides/routes/ride.routes.js';
import { createSocketServer } from '../../../infrastructure/socket/socket.server.js';
import { FareEstimateService } from '../../fares/services/fare-estimate.service.js';
import { FareCalculatorService } from '../../fares/services/fare-calculator.service.js';
import { DEFAULT_FARE_PRICING } from '../../fares/config/fare.config.js';
import type { MapProvider } from '../../rides/providers/map.provider.js';
import { syntheticDispatchAreas } from '../../rides/tests/dispatch-test-city.js';

describe.runIf(process.env.RIDE_DB_TESTS === 'true')(
  'Actual OTP-authenticated customer booking → Driver socket receipt → acceptance → customer receipt',
  () => {
    const previousPair = [env.DISPATCH_TEST_CUSTOMER_ID, env.DISPATCH_TEST_DRIVER_USER_ID];
    afterEach(() => {
      [env.DISPATCH_TEST_CUSTOMER_ID, env.DISPATCH_TEST_DRIVER_USER_ID] = previousPair;
    });
    it('targets the eligible Driver, persists one acceptance, delivers customer update and denies outsiders', async () => {
      if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
        throw Error('Disposable database required');
      const codes = new Map<string, string>();
      let sent = 0;
      const send = async () => {
        const token = randomUUID();
        codes.set(token, String(200000 + sent++));
        return {
          sessionId: randomUUID(),
          sessionToken: token,
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        };
      };
      const verify = async (token: string, code: string) => ({
        verified: codes.get(token) === code,
        attemptsRemaining: 4,
      });
      const provider = {
        sendSmsOtp: send,
        sendEmailOtp: send,
        verifySmsOtp: verify,
        verifyEmailOtp: verify,
        resendSmsOtp: send,
        resendEmailOtp: send,
      } as OtpProvider;
      const app = express();
      app.use(express.json(), cookieParser());
      app.use('/auth', createAuthRouter(createAuthController(provider)));
      app.use('/notifications/devices', createDeviceTokenRouter());
      const category = 'notify_' + randomUUID().replaceAll('-', '');
      await pool.query(
        "INSERT INTO vehicle_types(name,code,sector,base_fare_paise,per_km_rate_paise,active) VALUES('TEST_SAMPLE Notification',$1,'passenger',1800,600,TRUE)",
        [category],
      );
      const routes: MapProvider = {
        calculateRoute: async () => ({ distanceMeters: 10000, durationSeconds: 1200 }),
        calculateMatrix: async () => [],
        geocode: async () => null,
        places: async () => [],
      };
      const repository = new PostgresRideRepository(pool, syntheticDispatchAreas),
        drivers = new PostgresDriverRepository(pool);
      const area = syntheticDispatchAreas.cities[0]!.area;
      const fares = new FareEstimateService(
        routes,
        new FareCalculatorService(DEFAULT_FARE_PRICING),
        undefined,
        new PostgresVehicleRepository(pool),
      );
      const rides = new RideService(repository, drivers, undefined, fares, undefined, area),
        driverService = new DriverService(drivers, undefined, repository);
      app.use(
        '/rides',
        createRideRouter(
          new RideController(rides),
          new DriverController(driverService, rides, {} as DriverDocumentStorageService),
        ),
      );
      app.use(errorMiddleware);
      async function account(role: string) {
        const start = await request(app)
          .post('/auth/signup')
          .send({
            firstName: 'Notification',
            lastName: 'Fixture',
            email: randomUUID() + '@example.test',
            role,
            ...(role === 'driver'
              ? { licenseNumber: randomUUID(), licenseExpiry: '2035-12-31' }
              : {}),
          });
        expect(start.status).toBe(201);
        expect(typeof start.body.data.accessToken === 'string').toBe(false);
        const code = String(200000 + sent - 1);
        const valid = await request(app)
          .post('/auth/signup/verify')
          .send({ signupId: start.body.data.signupId, otp: code });
        expect(valid.status).toBe(200);
        return {
          id: valid.body.data.userId as string,
          token: valid.body.data.accessToken as string,
        };
      }
      const customer = await account('customer'),
        driver = await account('driver'),
        outsider = await account('customer');
      const otherDriver = await account('driver');
      await pool.query('UPDATE users SET phone=$2 WHERE id=$1', [customer.id, '+919876543210']);
      env.DISPATCH_TEST_CUSTOMER_ID = customer.id;
      env.DISPATCH_TEST_DRIVER_USER_ID = driver.id;
      const profile = (
        await pool.query('SELECT id FROM driver_profiles WHERE user_id=$1', [driver.id])
      ).rows[0].id;
      await pool.query(
        "UPDATE driver_profiles SET verification_status='approved',verified_at=NOW() WHERE id=$1",
        [profile],
      );
      await pool.query(
        'UPDATE provider_onboarding SET dashboard_deferred_at=NOW() WHERE user_id=$1',
        [driver.id],
      );
      const vehicle = (
        await pool.query(
          "INSERT INTO vehicles(owner_id,driver_profile_id,make,model,plate_number,category,sector,verification_status,is_active) VALUES($1,$2,'TEST_SAMPLE','Notification',$3,$4,'passenger','approved',TRUE) RETURNING id",
          [driver.id, profile, randomUUID().slice(0, 20), category],
        )
      ).rows[0].id;
      await pool.query(
        "UPDATE driver_profiles SET active_vehicle_id=$2,availability_status='available',last_location=ST_SetSRID(ST_MakePoint(77.5946,12.9716),4326)::geography,last_location_at=NOW() WHERE id=$1",
        [profile, vehicle],
      );
      const device = await request(app)
        .post('/notifications/devices')
        .set('Authorization', 'Bearer ' + driver.token)
        .send({
          fcmToken: 'TEST_ONLY_NON_DELIVERABLE_DEVICE',
          deviceId: randomUUID(),
          platform: 'ANDROID',
        });
      expect(device.status).toBe(200);
      const http = createServer(app),
        io = createSocketServer(http, {
          driverService,
          rideRepository: repository,
          rideService: rides,
          routeRecalculationService: new RouteRecalculationService(routes),
          matchingService: new MatchingService(drivers, undefined, area),
        });
      await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
      const address = http.address();
      if (!address || typeof address === 'string') throw Error('Test server missing');
      const clients: Socket[] = [];
      async function socket(a: { token: string }, isDriver = false) {
        const s = connect('http://127.0.0.1:' + (address as { port: number }).port, {
          auth: { token: a.token },
          transports: ['websocket'],
          autoConnect: false,
          reconnection: false,
        });
        clients.push(s);
        await new Promise<void>((resolve, reject) => {
          s.once(isDriver ? 'driver:ready' : 'connect', () => resolve());
          s.once('connect_error', reject);
          s.connect();
        });
        return s;
      }
      const event = (s: Socket, name: string) =>
        new Promise<Record<string, any>>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error('Expected socket event was not received: ' + name)),
            8000,
          );
          s.once(name, (p) => {
            clearTimeout(timer);
            resolve(p);
          });
        });
      try {
        const ds = await socket(driver, true),
          cs = await socket(customer),
          os = await socket(outsider);
        const leaked: unknown[] = [];
        os.on('ride:driver_assigned', (p) => leaked.push(p));
        os.on('ride:incoming', (p) => leaked.push(p));
        const offered = event(ds, 'ride:incoming');
        const booking = await request(app)
          .post('/rides')
          .set('Authorization', 'Bearer ' + customer.token)
          .send({
            pickup: { latitude: 12.9716, longitude: 77.5946 },
            destination: { latitude: 12.9352, longitude: 77.6245 },
            sector: 'passenger',
            vehicleCategory: category,
          });
        expect(booking.status).toBe(201);
        const id = booking.body.data.id as string,
          offer = await offered;
        expect(offer.ride.id === id).toBe(true);
        expect(offer.ride.pin).toBeUndefined();
        expect(offer.ride.billing).toBeUndefined();
        expect(offer.ride.destination).toBeNull();
        expect(
          (
            await request(app)
              .get(`/rides/driver/rides/${id}/customer-contact`)
              .auth(driver.token, { type: 'bearer' })
          ).status,
        ).toBe(404);
        expect(JSON.stringify(offer)).not.toContain('+919876543210');
        const available = await request(app)
          .get('/rides/driver/available')
          .set('Authorization', 'Bearer ' + driver.token);
        expect(available.status).toBe(200);
        const currentOffer = available.body.data.find((r: { id: string }) => r.id === id);
        expect(Date.parse(currentOffer.dispatchExpiresAt)).toBeGreaterThan(Date.now());
        expect(available.body.data.some((r: { id: string }) => r.id === id)).toBe(true);
        expect((await cs.timeout(2000).emitWithAck('ride:join', id)).success).toBe(true);
        expect((await os.timeout(2000).emitWithAck('ride:join', id)).success).toBe(false);
        const acceptance = event(cs, 'ride:driver_assigned');
        const accepted = await request(app)
          .post('/rides/' + id + '/accept')
          .set('Authorization', 'Bearer ' + driver.token);
        expect(accepted.status).toBe(200);
        const contact = await request(app)
          .get(`/rides/driver/rides/${id}/customer-contact`)
          .auth(driver.token, { type: 'bearer' });
        expect(contact.status).toBe(200);
        expect(contact.body.data).toMatchObject({ rideId: id, phone: '+919876543210' });
        expect(
          (
            await request(app)
              .get(`/rides/driver/rides/${id}/customer-contact`)
              .auth(otherDriver.token, { type: 'bearer' })
          ).status,
        ).toBe(404);
        expect(
          (
            await request(app)
              .get(`/rides/driver/rides/${id}/customer-contact`)
              .auth(outsider.token, { type: 'bearer' })
          ).status,
        ).toBe(403);
        expect(JSON.stringify(accepted.body)).not.toContain('+919876543210');
        const update = await acceptance;
        expect(update.ride.id === id && update.ride.status === 'driver_assigned').toBe(true);
        const repeat = await request(app)
          .post('/rides/' + id + '/accept')
          .set('Authorization', 'Bearer ' + driver.token);
        expect(repeat.status).toBe(409);
        const counts = (
          await pool.query(
            "SELECT count(*)::int AS n FROM ride_dispatch_attempts WHERE ride_id=$1 AND status='accepted'",
            [id],
          )
        ).rows[0];
        expect(counts.n).toBe(1);
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(leaked).toHaveLength(0);
        const current = await request(app)
          .get('/rides/' + id)
          .set('Authorization', 'Bearer ' + customer.token);
        expect(current.status).toBe(200);
        await rides.cancelRide(customer.id, id, { reason: 'Customer contact lifecycle test' });
        expect(
          (
            await request(app)
              .get(`/rides/driver/rides/${id}/customer-contact`)
              .auth(driver.token, { type: 'bearer' })
          ).status,
        ).toBe(404);
        expect(
          (
            await request(app)
              .get('/rides/' + id)
              .set('Authorization', 'Bearer ' + outsider.token)
          ).status,
        ).toBe(404);
        // Fixture-only sanitized domain data for separate real app-handler/render tests.
        // Never write JWTs, cookies, OTPs or customer-private acceptance payloads.
        await mkdir('tmp', { recursive: true });
        await writeFile(
          'tmp/notification-ride-receipt-evidence.json',
          JSON.stringify(
            {
              stages: [
                'otpAuthenticated',
                'deviceRegisteredFixture',
                'customerBooked',
                'driverSocketReceived',
                'driverApiObservedOffer',
                'driverAccepted',
                'customerSocketReceived',
                'duplicateDenied',
                'outsiderDenied',
              ],
              offer,
              available: available.body.data,
              assignedDriverView: accepted.body.data,
              customerStatus: update.ride.status,
              bookingRide: Object.fromEntries(
                [
                  'id',
                  'customerId',
                  'pickup',
                  'destination',
                  'status',
                  'createdAt',
                  'updatedAt',
                ].map((key) => [key, booking.body.data[key]]),
              ),
              customerRide: Object.fromEntries(
                [
                  'id',
                  'customerId',
                  'assignedDriverId',
                  'assignedVehicleId',
                  'pickup',
                  'destination',
                  'status',
                  'createdAt',
                  'updatedAt',
                  'driverDetails',
                  'vehicleDetails',
                ].map((key) => [key, update.ride[key]]),
              ),
            },
            null,
            2,
          ),
        );
      } finally {
        for (const s of clients) s.disconnect();
        await new Promise<void>((resolve) => io.close(() => resolve()));
        if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
      }
    }, 20000);
  },
);
