import { FareCalculatorService } from '../../fares/services/fare-calculator.service.js';
import { FareEstimateService } from '../../fares/services/fare-estimate.service.js';
import { RideService } from '../../rides/services/ride.service.js';
import type { VehicleRepository } from '../repositories/vehicle.repository.js';
import type { RideRepository } from '../../rides/repositories/ride.repository.js';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { createAdminRouter } from '../../admin/routes/admin.routes.js';
import { AdminController } from '../../admin/controllers/admin.controller.js';
import { AdminService } from '../../admin/services/admin.service.js';
import { PostgresAdminRepository } from '../../admin/repositories/admin.repository.js';
import { createVehicleRouter } from '../routes/vehicle.routes.js';
import { VehicleController } from '../controllers/vehicle.controller.js';
import { VehicleService } from '../services/vehicle.service.js';
import { PostgresVehicleRepository } from '../repositories/vehicle.repository.js';
import { createProviderOperationsRouter } from '../../providers/routes/provider-operations.routes.js';
import { PostgresProviderOperationsRepository } from '../../providers/repositories/provider-operations.repository.js';
import { createFleetRouter } from '../../fleet/routes/fleet.routes.js';
import { FleetController } from '../../fleet/controllers/fleet.controller.js';
import { FleetService } from '../../fleet/services/fleet.service.js';
import { PostgresFleetRepository } from '../../fleet/repositories/fleet.repository.js';
import { requireDisposableAdministrativeDatabase } from '../../admin/tests/administrative-test-database.js';
import { actor } from '../../providers/tests/fleet-workflow-fixture.js';
import { loadServiceCities } from '../../maps/service-city-registry.js';

describe.skipIf(process.env.PROVIDER_DB_TESTS !== 'true')(
  'shared Admin/Customer/Fleet selection catalog',
  () => {
    const vehicles = new PostgresVehicleRepository(pool);
    let app: ReturnType<typeof express>;
    let adminId: string, ownerId: string, customerId: string;
    let adminToken: string, ownerToken: string, customerToken: string;
    let cityId: string | undefined;
    const typeIds: string[] = [];
    beforeEach(async () => {
      requireDisposableAdministrativeDatabase();
      cityId = undefined;
      adminId = await actor('admin');
      ownerId = await actor('fleet_owner');
      customerId = await actor('customer');
      adminToken = await signAccessToken({ sub: adminId, role: 'admin', type: 'access' });
      ownerToken = await signAccessToken({ sub: ownerId, role: 'fleet_owner', type: 'access' });
      customerToken = await signAccessToken({ sub: customerId, role: 'customer', type: 'access' });
      app = express();
      app.use(express.json());
      app.use(
        '/admin',
        createAdminRouter(
          new AdminController(new AdminService(new PostgresAdminRepository(pool), vehicles)),
        ),
      );
      app.use(
        '/vehicles',
        createVehicleRouter(new VehicleController(new VehicleService(vehicles))),
      );
      app.use(
        '/provider',
        createProviderOperationsRouter(new PostgresProviderOperationsRepository(pool)),
      );
      app.use(
        '/fleet',
        createFleetRouter(new FleetController(new FleetService(new PostgresFleetRepository(pool)))),
      );
      app.use(errorMiddleware);
    });
    afterEach(async () => {
      await pool.query('DELETE FROM vehicles WHERE owner_id=$1', [ownerId]);
      await pool.query('DELETE FROM vehicle_types WHERE id=ANY($1::uuid[])', [typeIds.splice(0)]);
      await pool.query(
        'DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[])',
        [[adminId, ownerId, customerId]],
      );
      if (cityId) {
        await pool.query('DELETE FROM premium_service_cities WHERE id=$1', [cityId]);
        await loadServiceCities();
      }
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [
        [adminId, ownerId, customerId],
      ]);
    });
    it('publishes the existing identifiers, including Towing Van and Crane independently', async () => {
      const expected: Record<string, string[]> = {
        passenger: ['hatchback', 'mini', 'sedan', 'innova'],
        logistics: ['tata_407', 'cargo_207', 'tata_magic', 'piaggio_ape'],
        premium: ['scorpio', 'thar', 'innova', 'mercedes', 'helicopter', 'traveller'],
        service: ['ambulance', 'crane', 'jcb', 'towing'],
      };
      for (const [sector, codes] of Object.entries(expected)) {
        const configured = await pool.query(
          'SELECT code FROM vehicle_types WHERE sector=$1 AND catalog_visible AND code=ANY($2::text[]) ORDER BY catalog_order',
          [sector, codes],
        );
        expect(configured.rows.map((type) => type.code)).toEqual(codes);
        const published = await new VehicleService(vehicles).catalog(
          sector === 'passenger' ? 'rental' : (sector as 'logistics' | 'premium' | 'service'),
          100,
          0,
        );
        expect(
          published.filter((type) => codes.includes(type.code)).map((type) => type.code),
        ).toEqual(codes);
        if (sector === 'service') {
          expect(published.find((type) => type.code === 'towing')).toMatchObject({
            name: 'Towing Van',
            active: false,
            serviceFixedFare: null,
          });
          expect(published.find((type) => type.code === 'crane')?.id).not.toBe(
            published.find((type) => type.code === 'towing')?.id,
          );
        }
      }
      const retired = await pool.query(
        "SELECT code FROM vehicle_types WHERE sector='logistics' AND code IN ('three_wheeler','mini_truck','cargo_407') AND catalog_visible",
      );
      expect(retired.rows).toEqual([]);
    });

    it('publishes the approved payload limits by stable Logistics code', async () => {
      const response = await request(app)
        .get('/vehicles/catalog?sector=logistics')
        .auth(customerToken, { type: 'bearer' });
      expect(response.status, response.text).toBe(200);
      expect(
        response.body.data.map((row: { code: string; loadCapacityKg: number }) => [
          row.code,
          row.loadCapacityKg,
        ]),
      ).toEqual([
        ['tata_407', 3000],
        ['cargo_207', 2000],
        ['tata_magic', 1000],
        ['piaggio_ape', 750],
      ]);
    });

    it.each([
      ['piaggio_ape', 750],
      ['tata_magic', 1000],
      ['cargo_207', 2000],
      ['tata_407', 3000],
    ])(
      'accepts %s at %s kg and rejects overweight estimates and bookings',
      async (code, weightKg) => {
        const type = (await vehicles.findTypeByCode(code, 'logistics'))!;
        expect(type.loadCapacityKg).toBe(weightKg);
        const fixtureTariff = {
          ...type,
          active: true,
          pricingReference: null,
          baseFare: null,
          perKmRate: null,
          logisticsSlabs: {
            below_15: { baseFare: 100, perKmRate: 10 },
            from_15: { baseFare: 120, perKmRate: 12 },
          },
        };
        const estimator = new FareEstimateService(
          {
            calculateRoute: async () => ({
              distanceMeters: 2000,
              durationSeconds: 600,
              encodedPolyline: '',
            }),
            calculateMatrix: async () => [],
            geocode: async () => null,
            places: async () => [],
          },
          new FareCalculatorService(),
          undefined,
          {
            findTypeByCode: async () => fixtureTariff,
          } as unknown as VehicleRepository,
        );
        const pickup = { latitude: 25.5941, longitude: 85.1376 };
        const destination = { latitude: 25.605, longitude: 85.14 };
        const options = {
          sector: 'logistics',
          vehicleCategory: code,
          pricingMode: 'vehicle_range',
        } as const;
        await expect(
          estimator.estimate(pickup, destination, { ...options, weightKg }),
        ).resolves.toMatchObject({ bookable: true });
        await expect(
          estimator.estimate(pickup, destination, { ...options, weightKg: weightKg + 0.01 }),
        ).rejects.toMatchObject({ code: 'LOGISTICS_CAPACITY_EXCEEDED' });
        const rides = new RideService({} as RideRepository, undefined, undefined, estimator);
        await expect(
          rides.createRide(customerId, {
            pickup,
            destination,
            sector: 'logistics',
            vehicleCategory: code,
            goods: { weightKg: weightKg + 1 },
          }),
        ).rejects.toMatchObject({ code: 'LOGISTICS_CAPACITY_EXCEEDED' });
      },
    );

    it('Admin must explicitly activate future registrations and disabling preserves historical vehicles', async () => {
      const code = 'future_' + randomUUID().replaceAll('-', '').slice(0, 20);
      const created = await request(app)
        .post('/admin/vehicle-types')
        .auth(adminToken, { type: 'bearer' })
        .send({
          name: 'Future Admin vehicle',
          code,
          sector: 'logistics',
          baseFare: null,
          perKmRate: null,
          catalogVisible: true,
          registrationActive: false,
        });
      expect(created.status, created.text).toBe(201);
      let type = created.body.data;
      typeIds.push(type.id);
      const catalog = () =>
        request(app).get('/provider/vehicle-catalog').auth(ownerToken, { type: 'bearer' });
      const body = {
        make: 'Synthetic',
        model: 'Future',
        plateNumber: randomUUID().slice(0, 18),
        sector: 'logistics',
        category: code,
      };
      expect((await catalog()).body.data.types.some((t: { id: string }) => t.id === type.id)).toBe(
        false,
      );
      expect(
        (await request(app).post('/fleet/vehicles').auth(ownerToken, { type: 'bearer' }).send(body))
          .status,
      ).toBe(400);
      const on = await request(app)
        .patch('/admin/vehicle-types/' + type.id)
        .auth(adminToken, { type: 'bearer' })
        .send({ expectedVersion: type.version, registrationActive: true });
      expect(on.status, on.text).toBe(200);
      type = on.body.data;
      expect((await catalog()).body.data.types.some((t: { id: string }) => t.id === type.id)).toBe(
        true,
      );
      const registered = await request(app)
        .post('/fleet/vehicles')
        .auth(ownerToken, { type: 'bearer' })
        .send(body);
      expect(registered.status, registered.text).toBe(201);
      const off = await request(app)
        .patch('/admin/vehicle-types/' + type.id)
        .auth(adminToken, { type: 'bearer' })
        .send({ expectedVersion: type.version, registrationActive: false });
      expect(off.status, off.text).toBe(200);
      expect(
        (
          await request(app)
            .post('/fleet/vehicles')
            .auth(ownerToken, { type: 'bearer' })
            .send({ ...body, plateNumber: randomUUID().slice(0, 18) })
        ).status,
      ).toBe(400);
      expect(
        (await pool.query('SELECT id FROM vehicles WHERE id=$1', [registered.body.data.id]))
          .rowCount,
      ).toBe(1);
    });

    it('publishes exactly eleven active non-Premium options and registers each existing backend ID', async () => {
      const response = await request(app)
        .get('/provider/vehicle-catalog')
        .auth(ownerToken, { type: 'bearer' });
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.data.selectionCatalogVersion).toBe(2);
      const expected = {
        passenger: ['Hatchback', 'Mini Cab', 'Sedan', 'Innova Crysta'],
        logistics: ['Tata 407', 'Tata 207', 'Tata Magic', 'Piaggio Ape'],
        service: ['Ambulance', 'Crane', 'JCB'],
      };
      for (const [sector, names] of Object.entries(expected)) {
        const options = response.body.data.types.filter(
          (t: { sector: string }) => t.sector === sector,
        );
        expect(options.map((t: { name: string }) => t.name)).toEqual(names);
        for (const type of options) {
          const registered = await request(app)
            .post('/fleet/vehicles')
            .auth(ownerToken, { type: 'bearer' })
            .send({
              make: 'Local Catalog QA',
              model: type.name,
              plateNumber: randomUUID().slice(0, 18),
              sector,
              category: type.code,
            });
          expect(registered.status, registered.text).toBe(201);
          expect(registered.body.data.category).toBe(type.code);
        }
      }
      const legacy = (
        await pool.query(
          "SELECT code,sector FROM vehicle_types WHERE sector IN ('passenger','logistics','service') AND NOT catalog_visible",
        )
      ).rows;
      expect(legacy.length).toBeGreaterThan(0);
      for (const type of legacy) {
        const denied = await request(app)
          .post('/fleet/vehicles')
          .auth(ownerToken, { type: 'bearer' })
          .send({
            make: 'Local QA',
            model: 'Legacy',
            plateNumber: randomUUID().slice(0, 18),
            sector: type.sector,
            category: type.code,
          });
        expect(denied.status, denied.text).toBe(400);
      }
    }, 30000);

    it.each(['rental', 'logistics', 'premium', 'service'] as const)(
      '%s published types without any price can register but cannot receive a booking fare',
      async (sector) => {
        const inventorySector = sector === 'rental' ? 'passenger' : sector;
        const code = 'unpriced_' + randomUUID().replaceAll('-', '').slice(0, 20);
        const created = await request(app)
          .post('/admin/vehicle-types')
          .auth(adminToken, { type: 'bearer' })
          .send({
            name: 'Unpriced published vehicle',
            code,
            sector: inventorySector,
            currency: 'INR',
            baseFare: null,
            perKmRate: null,
            active: false,
            catalogVisible: true,
            registrationActive: true,
          });
        expect(created.status, created.text).toBe(201);
        const type = created.body.data;
        typeIds.push(type.id);
        const customer = await request(app)
          .get('/vehicles/catalog?sector=' + sector + '&limit=100')
          .auth(customerToken, { type: 'bearer' });
        const fleet = await request(app)
          .get('/provider/vehicle-catalog')
          .auth(ownerToken, { type: 'bearer' });
        expect(customer.status).toBe(200);
        expect(fleet.status).toBe(200);
        expect(customer.body.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: type.id,
              code,
              active: false,
              pricingStatus: 'needs_pricing',
            }),
          ]),
        );
        expect(fleet.body.data.types).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: type.id, code, sector: inventorySector, active: false }),
          ]),
        );
        if (sector === 'premium') {
          cityId = 'catalog_test_' + randomUUID().replaceAll('-', '');
          const city = await request(app)
            .post('/vehicles/operating-cities')
            .auth(adminToken, { type: 'bearer' })
            .send({
              id: cityId,
              name: 'Unpriced catalog test city',
              latitude: 25.6,
              longitude: 85.1,
              source: 'Synthetic isolated test',
              approvalReference: 'LOCAL_TEST_ONLY',
            });
          expect(city.status, city.text).toBe(201);
        }
        const registered = await request(app)
          .post('/fleet/vehicles')
          .auth(ownerToken, { type: 'bearer' })
          .send({
            make: 'Synthetic',
            model: 'Unpriced',
            plateNumber: randomUUID().slice(0, 18),
            sector: inventorySector,
            category: code,
            ...(sector === 'premium'
              ? {
                  operatingCityId: cityId,
                  operatingLocation: {
                    address: 'Test operating point',
                    latitude: 25.6,
                    longitude: 85.1,
                  },
                }
              : {}),
          });
        expect(registered.status, registered.text).toBe(201);
        expect(registered.body.data).toMatchObject({
          category: code,
          verificationStatus: 'pending',
        });
        expect(() =>
          new FareCalculatorService().calculateEstimate(
            {
              sector,
              vehicleCategory: code,
              bookingHours: 2,
              tripType: 'round_trip',
              distanceMeters: 10000,
              durationSeconds: 1200,
            },
            type,
          ),
        ).toThrow(expect.objectContaining({ code: 'FARE_CONFIGURATION_MISSING' }));
      },
      30_000,
    );

    it.each(['rental', 'logistics', 'premium', 'service'] as const)(
      '%s Admin publication and pricing availability stay independent and identical in both applications and preserves registrations',
      async (sector) => {
        const inventorySector = sector === 'rental' ? 'passenger' : sector;
        const code = 'dynamic_' + randomUUID().replaceAll('-', '').slice(0, 20);
        const schedule = Object.fromEntries(
          [...Array.from({ length: 12 }, (_, i) => String(i + 1)), '12_plus'].map((key) => [
            key,
            100,
          ]),
        );
        const created = await request(app)
          .post('/admin/vehicle-types')
          .auth(adminToken, { type: 'bearer' })
          .send({
            name: 'Published test vehicle',
            code,
            sector: inventorySector,
            currency: 'INR',
            baseFare: null,
            perKmRate: null,
            active: false,
            catalogVisible: false,
            registrationActive: true,
            ...(sector === 'service'
              ? { serviceFixedFare: 100 }
              : sector === 'logistics'
                ? {
                    logisticsSlabs: {
                      below_15: { baseFare: 100, perKmRate: 2 },
                      from_15: { baseFare: 200, perKmRate: 3 },
                    },
                  }
                : {
                    baseFare: 100,
                    perKmRate: 2,
                    hourlyBaseFares: schedule,
                    extendedDurationPolicy: 'booked_duration',
                  }),
          });
        expect(created.status, created.text).toBe(201);
        let type = created.body.data;
        typeIds.push(type.id);
        async function change(input: Record<string, unknown>) {
          const result = await request(app)
            .patch('/admin/vehicle-types/' + type.id)
            .auth(adminToken, { type: 'bearer' })
            .send({ ...input, expectedVersion: type.version });
          expect(result.status, result.text).toBe(200);
          type = result.body.data;
        }
        async function assertCatalog(visible: boolean) {
          const customer = await request(app)
            .get('/vehicles/catalog?sector=' + sector + '&limit=100')
            .auth(customerToken, { type: 'bearer' });
          const fleet = await request(app)
            .get('/provider/vehicle-catalog')
            .auth(ownerToken, { type: 'bearer' });
          expect(customer.status, customer.text).toBe(200);
          expect(fleet.status, fleet.text).toBe(200);
          expect(customer.headers['cache-control']).toBe('no-store');
          expect(fleet.headers['cache-control']).toBe('no-store');
          const customerOptions = customer.body.data.map(
            (v: { id: string; code: string; name: string }) => ({
              id: v.id,
              code: v.code,
              name: v.name,
            }),
          );
          const fleetOptions = fleet.body.data.types
            .filter((v: { sector: string }) => v.sector === inventorySector)
            .map((v: { id: string; code: string; name: string }) => ({
              id: v.id,
              code: v.code,
              name: v.name,
            }));
          expect(fleet.body.data.sectors).toEqual(['passenger', 'logistics', 'premium', 'service']);
          // Towing is published to customers while its existing registration policy stays disabled.
          const expectedFleetOptions =
            sector === 'service'
              ? customerOptions.filter((v: { code: string }) => v.code !== 'towing')
              : customerOptions;
          expect(fleetOptions).toEqual(expectedFleetOptions);
          expect(customerOptions.some((v: { id: string }) => v.id === type.id)).toBe(visible);
        }
        if (sector === 'premium') {
          cityId = 'catalog_test_' + randomUUID().replaceAll('-', '');
          const city = await request(app)
            .post('/vehicles/operating-cities')
            .auth(adminToken, { type: 'bearer' })
            .send({
              id: cityId,
              name: 'Local catalog test city',
              latitude: 25.6,
              longitude: 85.1,
              source: 'Synthetic isolated test',
              approvalReference: 'LOCAL_TEST_ONLY',
            });
          expect(city.status, city.text).toBe(201);
        }
        const registration = {
          make: 'Test',
          model: 'Published',
          plateNumber: randomUUID().slice(0, 18),
          sector: inventorySector,
          category: code,
          ...(sector === 'premium'
            ? {
                operatingCityId: cityId,
                operatingLocation: {
                  address: 'Test operating point',
                  latitude: 25.6,
                  longitude: 85.1,
                },
              }
            : {}),
        };
        await assertCatalog(false);
        const inactive = await request(app)
          .post('/fleet/vehicles')
          .auth(ownerToken, { type: 'bearer' })
          .send(registration);
        expect(inactive.status).toBe(400);
        await change({ catalogVisible: true });
        await assertCatalog(true);
        const unpriced = await request(app)
          .post('/fleet/vehicles')
          .auth(ownerToken, { type: 'bearer' })
          .send({ ...registration, plateNumber: randomUUID().slice(0, 18) });
        expect(unpriced.status, unpriced.text).toBe(201);
        await change({ active: true });
        await assertCatalog(true);
        if (sector === 'rental') {
          await change({
            expectedRentalPricingVersion: type.rentalPricingVersion,
            fixedHourlyPricing: { hourlyRate: 50, fuelRate: 40, fuelUnit: 'per_booking' },
          });
          const quote = new FareCalculatorService().calculateEstimate(
            {
              sector: 'rental',
              vehicleCategory: code,
              bookingHours: 2,
              tripType: 'round_trip',
              distanceMeters: 10000,
              durationSeconds: 1200,
            },
            type,
          );
          expect(quote).toMatchObject({
            bookable: true,
            bookingFare: {
              grossAmount: 14000,
              vehicleConfiguration: {
                id: type.id,
                code,
                bookedHours: 2,
                pricingModel: 'fixed_hourly',
              },
            },
          });
        }
        await change({ name: 'Renamed test vehicle' });
        await assertCatalog(true);
        const registered = await request(app)
          .post('/fleet/vehicles')
          .auth(ownerToken, { type: 'bearer' })
          .send(registration);
        expect(registered.status, registered.text).toBe(201);
        const id = registered.body.data.id;
        await change({ active: false });
        await assertCatalog(true);
        const denied = await request(app)
          .post('/fleet/vehicles')
          .auth(ownerToken, { type: 'bearer' })
          .send({ ...registration, plateNumber: randomUUID().slice(0, 18) });
        expect(denied.status, denied.text).toBe(201);
        const corrected = await request(app)
          .put('/fleet/vehicles/' + id)
          .auth(ownerToken, { type: 'bearer' })
          .send({ color: 'Black', sector: inventorySector, category: code });
        expect(corrected.status, corrected.text).toBe(200);
        expect(
          (await pool.query('SELECT category,verification_status FROM vehicles WHERE id=$1', [id]))
            .rows[0],
        ).toMatchObject({ category: code, verification_status: 'pending' });
        await change({ active: true });
        await assertCatalog(true);
        await change({ catalogVisible: false });
        await assertCatalog(false);
        const hidden = await request(app)
          .post('/fleet/vehicles')
          .auth(ownerToken, { type: 'bearer' })
          .send({ ...registration, plateNumber: randomUUID().slice(0, 18) });
        expect(hidden.status).toBe(400);
        expect(hidden.body.error.code).toBe('INVALID_VEHICLE_CATEGORY');
        await change({ catalogVisible: true });
        await assertCatalog(true);
      },
      // This lifecycle performs more than 30 real authenticated requests and Premium
      // boundary validation. Allow the same workload to finish on a loaded CI host.
      30_000,
    );
  },
);
