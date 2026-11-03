import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { requireDisposableAdministrativeDatabase } from '../../admin/tests/administrative-test-database.js';
import { createSocketServer } from '../../../infrastructure/socket/socket.server.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { ServiceAreaPolicy } from '../../maps/service-area.js';
import { CityRadiusPolicy } from '../../maps/city-radius.js';
import { PremiumCityAreas } from '../../maps/premium-city-areas.js';
import { RouteRecalculationService } from '../services/route-recalculation.service.js';
import { PostgresRideRepository } from '../repositories/ride.repository.js';
import { PostgresDriverRepository } from '../repositories/driver.repository.js';
import { RideService } from '../services/ride.service.js';
import { DriverService } from '../services/driver.service.js';
import { MatchingService } from '../services/matching.service.js';
import { FareEstimateService } from '../../fares/services/fare-estimate.service.js';
import { FareCalculatorService } from '../../fares/services/fare-calculator.service.js';
import { PostgresVehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import type { Ride } from '../types/ride.js';

const points = {
  Patna: { latitude: 25.6027, longitude: 85.1376 },
  Muzaffarpur: { latitude: 26.1197, longitude: 85.391 },
  Gaya: { latitude: 24.7955, longitude: 84.9994 },
  Motihari: { latitude: 26.6469, longitude: 84.9089 },
  Delhi: { latitude: 28.6139, longitude: 77.209 },
  Jaipur: { latitude: 26.9124, longitude: 75.7873 },
};
const scenarios = [
  ['Patna', 'Muzaffarpur', 'Gaya'],
  ['Muzaffarpur', 'Patna', 'Gaya'],
  ['Motihari', 'Gaya', 'Patna'],
  ['Delhi', 'Patna', 'Muzaffarpur'],
  ['Jaipur', 'Muzaffarpur', 'Patna'],
] as const;
const categories = [
  { label: 'Normal Ride', sector: 'passenger', code: 'sedan' },
  { label: 'Rental', sector: 'premium', code: 'thar' },
  { label: 'Logistics', sector: 'logistics', code: 'mini_truck' },
  { label: 'Premium', sector: 'premium', code: 'thar' },
] as const;
const columns = [
  'active',
  'base_fare_paise',
  'per_km_rate_paise',
  'pricing_reference',
  'hourly_base_fares_paise',
  'logistics_slabs',
  'service_fixed_fare_paise',
];
const saved: Record<string, unknown>[] = [];
const added: string[] = [];

describe.runIf(process.env.RIDE_DB_TESTS === 'true')(
  'remote booking: real PostGIS and authenticated Driver/Customer sockets',
  () => {
    beforeAll(async () => {
      requireDisposableAdministrativeDatabase();
      for (const { sector, code } of categories.slice(0, 3)) {
        const previous = (
          await pool.query('SELECT * FROM vehicle_types WHERE sector=$1 AND code=$2', [
            sector,
            code,
          ])
        ).rows[0];
        if (previous) saved.push(previous);
        const result = await pool.query(
          `INSERT INTO vehicle_types(name,code,sector,active,base_fare_paise,per_km_rate_paise)
        VALUES('TEST ONLY remote booking',$1,$2,TRUE,10000,1000)
        ON CONFLICT(sector,code) DO UPDATE SET active=TRUE,base_fare_paise=10000,per_km_rate_paise=1000,pricing_reference=NULL,hourly_base_fares_paise=NULL,logistics_slabs=NULL,service_fixed_fare_paise=NULL RETURNING id`,
          [code, sector],
        );
        if (!previous) added.push(result.rows[0].id);
        if (sector === 'logistics') {
          await pool.query(
            'UPDATE vehicle_types SET base_fare_paise=NULL,per_km_rate_paise=NULL,logistics_slabs=$2::jsonb WHERE id=$1',
            [
              result.rows[0].id,
              JSON.stringify({
                below_15: { baseFare: 100, perKmRate: 10 },
                from_15: { baseFare: 200, perKmRate: 20 },
              }),
            ],
          );
        }
      }
    });
    afterAll(async () => {
      for (const row of saved)
        await pool.query(
          `UPDATE vehicle_types SET ${columns.map((c, i) => `${c}=$${i + 2}`).join(',')} WHERE id=$1`,
          [
            row.id,
            ...columns.map((c) =>
              typeof row[c] === 'object' && row[c] !== null ? JSON.stringify(row[c]) : row[c],
            ),
          ],
        );
      if (added.length)
        await pool.query('DELETE FROM vehicle_types WHERE id=ANY($1::uuid[])', [added]);
    });
    for (const category of categories)
      for (const [physical, city, drop] of scenarios) {
        it(`${category.label}: GPS ${physical}, pickup ${city}, destination ${drop}`, async () => {
          const customer = randomUUID(),
            user = randomUUID(),
            profile = randomUUID(),
            vehicle = randomUUID();
          const pickup = points[city],
            destination = points[drop],
            gps = points[physical];
          const cityId = 'test-remote-' + randomUUID();
          const area = new ServiceAreaPolicy(
            JSON.parse(
              readFileSync(
                new URL('../../../../config/service-area/bihar.geojson', import.meta.url),
                'utf8',
              ),
            ),
            true,
          );
          const cities = new PremiumCityAreas();
          cities.cities.push({
            id: cityId,
            name: 'TEST ONLY configured pickup city',
            approvalReference: 'LOCAL TEST ONLY',
            area: new CityRadiusPolicy(cityId, { ...pickup, source: 'LOCAL TEST ONLY' }),
          });
          const rides = new PostgresRideRepository(pool, cities),
            drivers = new PostgresDriverRepository(pool);
          const maps = {
            calculateRoute: async () => ({ distanceMeters: 2000, durationSeconds: 300 }),
          };
          const estimator = new FareEstimateService(
            maps as never,
            new FareCalculatorService(),
            undefined,
            new PostgresVehicleRepository(pool),
          );
          const matching = new MatchingService(drivers, undefined, area, cities);
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
          const http = createServer();
          const io = createSocketServer(http, {
            driverService: new DriverService(drivers, undefined, rides),
            rideRepository: rides,
            rideService: service,
            matchingService: matching,
            routeRecalculationService: new RouteRecalculationService(maps as never),
          });
          const sockets: Socket[] = [];
          let rideId: string | undefined;
          const open = async (id: string, role: string) => {
            const address = http.address();
            if (!address || typeof address === 'string') throw Error('Missing socket address');
            const socket = connect('http://127.0.0.1:' + address.port, {
              autoConnect: false,
              auth: { token: await signAccessToken({ sub: id, role, type: 'access' }) },
              transports: ['websocket'],
              reconnection: false,
            });
            sockets.push(socket);
            const ready = new Promise<void>((resolve, reject) => {
              socket.once(role === 'driver' ? 'driver:ready' : 'connect', () => resolve());
              socket.once('connect_error', reject);
            });
            socket.connect();
            await ready;
            return socket;
          };
          const ack = (socket: Socket, event: string, body: unknown) =>
            new Promise<{ success: boolean }>((resolve) => socket.emit(event, body, resolve));
          try {
            await pool.query(
              "INSERT INTO users(id,first_name,last_name,role) VALUES($1,'TEST','Remote Customer','customer'),($2,'TEST','Pickup Driver','driver')",
              [customer, user],
            );
            await pool.query(
              "INSERT INTO driver_profiles(id,user_id,license_number,license_expiry,verification_status,availability_status,last_location,last_location_at) VALUES($1,$2,$3,CURRENT_DATE+365,'approved','available',ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,NOW())",
              [profile, user, 'TEST-' + profile, pickup.longitude, pickup.latitude],
            );
            await pool.query(
              "INSERT INTO vehicles(id,owner_id,driver_profile_id,make,model,plate_number,sector,category,verification_status,is_active,operating_city_id) VALUES($1,$2,$3,'TEST','ONLY',$4,$5,$6,'approved',TRUE,$7)",
              [
                vehicle,
                user,
                profile,
                vehicle.slice(0, 20),
                category.sector,
                category.code,
                cityId,
              ],
            );
            await pool.query('UPDATE driver_profiles SET active_vehicle_id=$2 WHERE id=$1', [
              profile,
              vehicle,
            ]);
            await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
            const driver = await open(user, 'driver'),
              customerSocket = await open(customer, 'customer');
            const incoming = new Promise<{ ride: Ride }>((resolve) =>
              driver.once('ride:incoming', resolve),
            );
            const ride = await service.createRide(customer, {
              pickup,
              destination,
              pickupAddress: city,
              destinationAddress: drop,
              sector: category.sector,
              vehicleCategory: category.code,
              bookingHours: 2,
              rentalDetails: {
                hours: 2,
                tripType: category.label === 'Rental' ? 'round_trip' : 'one_way',
              },
            });
            rideId = ride.id;
            expect((await incoming).ride.pickup).toEqual(pickup);
            expect(await ack(customerSocket, 'ride:join', ride.id)).toMatchObject({
              success: true,
            });
            const assigned = new Promise<unknown>((resolve) =>
              customerSocket.once('ride:driver_assigned', resolve),
            );
            expect(await ack(driver, 'driver:accept', ride.id)).toMatchObject({ success: true });
            await assigned;
            const stored = await rides.findById(ride.id);
            expect(stored).toMatchObject({
              pickup,
              destination,
              sector: category.sector,
              vehicleCategory: category.code,
              status: 'driver_assigned',
              assignedDriverId: profile,
            });
            expect((await service.getDriverCurrentRide(user))?.id).toBe(ride.id);
            expect((await service.getRide(customer, ride.id)).status).toBe('driver_assigned');
            await expect(
              service.updateUserLocation(customer, ride.id, {
                ...gps,
                timestamp: new Date(Date.now() - 1000),
              }),
            ).resolves.toMatchObject(gps);
            expect((await service.getUserMap(customer, ride.id)).pickup).toMatchObject(pickup);
            const persisted = await rides.findById(ride.id);
            expect(persisted?.pickup).toEqual(pickup);
            expect(persisted?.destination).toEqual(destination);
          } finally {
            for (const socket of sockets) socket.disconnect();
            await new Promise<void>((resolve) => io.close(() => resolve()));
            if (rideId)
              await service.cancelRide(customer, rideId, { reason: 'LOCAL TEST ONLY cleanup' });
            await pool.query('DELETE FROM rides WHERE customer_id=$1', [customer]);
            await pool.query('UPDATE driver_profiles SET active_vehicle_id=NULL WHERE id=$1', [
              profile,
            ]);
            await pool.query('DELETE FROM vehicles WHERE id=$1', [vehicle]);
            await pool.query('DELETE FROM driver_profiles WHERE id=$1', [profile]);
            await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[customer, user]]);
          }
        }, 20000);
      }
  },
);
