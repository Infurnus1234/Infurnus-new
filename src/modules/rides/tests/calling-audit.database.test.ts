import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeAll, describe, it, expect } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { requireDisposableAdministrativeDatabase } from '../../admin/tests/administrative-test-database.js';
import { PostgresRideRepository } from '../repositories/ride.repository.js';
import { PostgresDriverRepository } from '../repositories/driver.repository.js';
import { RideService } from '../services/ride.service.js';
import { DriverService } from '../services/driver.service.js';
import { RideController } from '../controllers/ride.controller.js';
import { DriverController } from '../controllers/driver.controller.js';
import type { DriverDocumentStorageService } from '../services/driver-document-storage.service.js';
import { createRideRouter } from '../routes/ride.routes.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { AdminOperationsRepository } from '../../admin/repositories/operations.repository.js';
describe.runIf(process.env.RIDE_DB_TESTS === 'true')(
  'calling audit: four real sector API projections',
  () => {
    beforeAll(() => requireDisposableAdministrativeDatabase());
    it.each([
      ['rental', '11'],
      ['service', '22'],
      ['premium', '33'],
      ['logistics', '44'],
    ])(
      '%s hides peer contacts, exposes official configuration, and resolves same Admin reference',
      async (sector, prefix) => {
        const customer = randomUUID(),
          driver = randomUUID(),
          phone1 = '+917' + String(Date.now()).slice(-9),
          phone2 = '+918' + String(Date.now()).slice(-9);
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,role,phone) VALUES($1,'Audit','Customer','customer',$2),($3,'Audit','Driver','driver',$4)",
          [customer, phone1, driver, phone2],
        );
        const profile = (
          await pool.query(
            'INSERT INTO driver_profiles(user_id,license_number,license_expiry) VALUES($1,$2,CURRENT_DATE+365) RETURNING id',
            [driver, randomUUID()],
          )
        ).rows[0].id;
        const vehicle = (
          await pool.query(
            "INSERT INTO vehicles(owner_id,driver_profile_id,make,model,plate_number,category,sector,is_active,verification_status) VALUES($1,$2,'Audit','Vehicle',$3,'audit',$4,TRUE,'approved') RETURNING id",
            [driver, profile, randomUUID().slice(0, 18), sector],
          )
        ).rows[0].id;
        const row = (
          await pool.query(
            "INSERT INTO rides(customer_id,assigned_driver_id,assigned_vehicle_id,sector,status,pickup_location,destination_location) VALUES($1,$2,$3,$4,'driver_assigned',ST_SetSRID(ST_MakePoint(85,25),4326)::geography,ST_SetSRID(ST_MakePoint(85.2,25.2),4326)::geography) RETURNING id,booking_id",
            [customer, profile, vehicle, sector],
          )
        ).rows[0];
        const repository = new PostgresRideRepository(pool),
          drivers = new PostgresDriverRepository(pool),
          service = new RideService(repository, drivers),
          driverService = new DriverService(drivers, undefined, repository);
        const app = express();
        app.use(
          '/rides',
          createRideRouter(
            new RideController(service),
            new DriverController(driverService, service, {} as DriverDocumentStorageService),
          ),
        );
        app.use(errorMiddleware);
        const customerToken = await signAccessToken({
            sub: customer,
            role: 'customer',
            type: 'access',
          }),
          driverToken = await signAccessToken({ sub: driver, role: 'driver', type: 'access' });
        const customerResponse = await request(app)
          .get('/rides/' + row.id)
          .auth(customerToken, { type: 'bearer' });
        const driverResponse = await request(app)
          .get('/rides/driver/current-trip')
          .auth(driverToken, { type: 'bearer' });
        const contact = await request(app)
          .get('/rides/driver/rides/' + row.id + '/customer-contact')
          .auth(driverToken, { type: 'bearer' });
        for (const response of [customerResponse, driverResponse, contact]) {
          expect(response.status, response.text).toBe(200);
          expect(response.body.data.callingNumber).toBe('+919153787859');
        }
        expect(JSON.stringify(customerResponse.body)).not.toContain(phone2);
        expect(JSON.stringify(driverResponse.body)).not.toContain(phone1);
        expect(contact.body.data.phone).toBeNull();
        expect(row.booking_id).toMatch(new RegExp('^' + prefix + '[0-9]{5}$'));
        expect(driverResponse.body.data.bookingId).toBe(row.booking_id);
        expect(customerResponse.body.data.bookingId).toBe(row.booking_id);
        const admin = await new AdminOperationsRepository(pool).bookingReference(row.booking_id);
        expect(admin?.customer.phone).toBe(phone1);
        expect(admin?.driver.phone).toBe(phone2);
        expect(admin?.rideId).toBe(row.id);
      },
    );
  },
);
