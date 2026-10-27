import { readFileSync } from 'node:fs';
import { vehicleModelSchema } from '../routes/provider-model.routes.js';
import { PostgresFleetRepository } from '../../fleet/repositories/fleet.repository.js';
import { createFleetVehicleSchema } from '../../fleet/schemas/fleet.schemas.js';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import {
  createProviderAccountRouter,
  customVehicleTypeSchema,
} from '../routes/provider-account.routes.js';

describe('custom vehicle input', () => {
  it('keeps model identity independent of sector and validates plain names', () => {
    expect(vehicleModelSchema.parse({ make: ' Tata ', model: ' 407  Cargo ' })).toEqual({
      make: 'Tata',
      model: '407 Cargo',
    });
    for (const model of ['', '<script>', 'bad\u0000name', 'x'.repeat(51)]) {
      expect(vehicleModelSchema.safeParse({ make: 'Tata', model }).success).toBe(false);
    }
    expect(vehicleModelSchema.safeParse({ make: 'Tata', model: '407', active: true }).success).toBe(
      false,
    );
  });
  it('normalizes whitespace and rejects HTML, control text and privilege fields', () => {
    expect(customVehicleTypeSchema.parse({ name: '  Tata   Ace ', sector: 'logistics' }).name).toBe(
      'Tata Ace',
    );
    for (const name of ['', 'x'.repeat(101), '<script>', 'Bad\u0000Name'])
      expect(customVehicleTypeSchema.safeParse({ name, sector: 'logistics' }).success).toBe(false);
    expect(
      customVehicleTypeSchema.safeParse({ name: 'Ace', sector: 'logistics', active: true }).success,
    ).toBe(false);
  });
});

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'provider contact and custom catalog persistence',
  () => {
    async function fixture(role = 'fleet_owner') {
      if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
        throw Error('Owned disposable database required');
      const email = `${randomUUID()}@example.test`;
      const user = (
        await pool.query(
          `INSERT INTO users(first_name,last_name,email,email_verified,role)
      VALUES('Test','Owner',$1,TRUE,$2) RETURNING id`,
          [email, role],
        )
      ).rows[0];
      const app = express();
      app.use(express.json());
      // Exercise repository SQL and routes with a trusted test principal. Production
      // authentication remains on the parent router and has its existing route suites.
      app.use((req, _res, next) => {
        req.auth = { userId: user.id, role } as NonNullable<typeof req.auth>;
        next();
      });
      app.use(createProviderAccountRouter(pool));
      app.use(errorMiddleware);
      return { app, id: user.id, email };
    }
    it('saves contacts without OTP while leaving verified login identity unchanged', async () => {
      const { app, id, email } = await fixture('driver');
      await request(app)
        .patch('/account')
        .send({ phone: '+919876543210', email: 'contact@example.test', firstName: 'Saved' })
        .expect(200);
      const displayed = await request(app).get('/account').expect(200);
      expect(displayed.body.data).toMatchObject({
        phone: '+919876543210',
        email: 'contact@example.test',
        firstName: 'Saved',
        emailVerified: false,
        phoneVerified: false,
      });
      const login = (
        await pool.query('SELECT email,email_verified,phone FROM users WHERE id=$1', [id])
      ).rows[0];
      expect(login).toMatchObject({ email, email_verified: true, phone: null });
      await request(app)
        .patch('/account')
        .send({ userId: randomUUID(), email: 'other@example.test' })
        .expect(400);
    });
    it('covers every literal Customer catalog code without changing its frontend', async () => {
      const { id } = await fixture();
      const catalog = await new PostgresFleetRepository(pool).catalog(id);
      const sources: Record<string, string> = {
        'passenger_rides_screen.dart': 'passenger',
        'logistics_screen.dart': 'logistics',
        'specialty_emergency_screen.dart': 'service',
        'concierge_fleet_screen.dart': 'premium',
        'rentals_screen.dart': 'rental',
      };
      for (const [file, sector] of Object.entries(sources)) {
        const text = readFileSync(
          new URL(
            '../../../../frontend/lib/features/customer/presentation/screens/' + file,
            import.meta.url,
          ),
          'utf8',
        );
        const codes = [...text.matchAll(/'category':\s*'([^']+)'/g)].map((match) => match[1]);
        expect(codes.length).toBeGreaterThan(0);
        for (const code of codes)
          expect(
            catalog.types.some((t) => t.code === code && t.sector === sector),
            `${sector}/${code}`,
          ).toBe(true);
      }
    });
    it('mobile accounts can add contact email without altering the verified phone', async () => {
      const { app, id } = await fixture('driver');
      const phone = '+91' + Date.now().toString();
      await pool.query(
        'UPDATE users SET email=NULL,email_verified=FALSE,phone=$2,phone_verified=TRUE WHERE id=$1',
        [id, phone],
      );
      await request(app).patch('/account').send({ email: 'added@example.test' }).expect(200);
      const view = await request(app).get('/account').expect(200);
      expect(view.body.data).toMatchObject({
        email: 'added@example.test',
        emailVerified: false,
        phone,
        phoneVerified: true,
      });
      expect(
        (await pool.query('SELECT email,phone,phone_verified FROM users WHERE id=$1', [id]))
          .rows[0],
      ).toMatchObject({ email: null, phone, phone_verified: true });
      await request(app).patch('/account').send({ phone: 'invalid' }).expect(400);
    });
    it('persists reusable models, deduplicates concurrent requests and isolates owners', async () => {
      const owner = await fixture();
      const other = await fixture();
      const driver = await fixture('driver');
      await request(driver.app)
        .post('/vehicle-models')
        .send({ make: 'Tata', model: 'QA 407' })
        .expect(403);
      const replies = await Promise.all(
        [' QA   407 ', 'qa 407'].map((model) =>
          request(owner.app).post('/vehicle-models').send({ make: 'Tata', model }).expect(201),
        ),
      );
      expect(replies[0]!.body.data.id).toBe(replies[1]!.body.data.id);
      const search = await request(owner.app)
        .get('/vehicle-models?search=Tata%20QA%20407')
        .expect(200);
      expect(search.body.data).toContainEqual({ make: 'Tata', model: 'QA 407' });
      const isolated = await request(other.app)
        .get('/vehicle-models?search=Tata%20QA%20407')
        .expect(200);
      expect(isolated.body.data).not.toContainEqual({ make: 'Tata', model: 'QA 407' });
      await request(owner.app)
        .post('/vehicle-models')
        .send({ make: 'Tata', model: 'QA 407', active: true })
        .expect(400);
      await request(owner.app).get('/vehicle-models?sector=logistics').expect(400);
    });
    it('rejects driver custom creation and deduplicates simultaneous owner requests', async () => {
      const driver = await fixture('driver');
      await request(driver.app)
        .post('/vehicle-catalog/custom')
        .send({ name: 'Truck', sector: 'logistics' })
        .expect(403);
      const owner = await fixture();
      const replies = await Promise.all(
        [' My   Truck ', 'my truck'].map((name) =>
          request(owner.app)
            .post('/vehicle-catalog/custom')
            .send({ name, sector: 'logistics' })
            .expect(201),
        ),
      );
      expect(replies[0]!.body.data.code).toBe(replies[1]!.body.data.code);
      expect(replies[0]!.body.data).toMatchObject({ active: false, custom: true });
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM fleet_custom_vehicle_types WHERE owner_id=$1',
            [owner.id],
          )
        ).rows[0].n,
      ).toBe(1);
      const fleet = new PostgresFleetRepository(pool);
      const code = replies[0]!.body.data.code;
      const input = createFleetVehicleSchema.parse({
        make: 'Test',
        model: 'Truck',
        plateNumber: randomUUID().slice(0, 20),
        sector: 'logistics',
        category: code,
      });
      const vehicle = await fleet.createVehicle(owner.id, input);
      expect(vehicle.ownerId).toBe(owner.id);
      expect((await fleet.listVehicles(owner.id)).some((v) => v.id === vehicle.id)).toBe(true);
      expect((await fleet.catalog(owner.id)).types.some((t) => t.code === code)).toBe(true);
      const other = await fixture();
      await expect(
        fleet.createVehicle(other.id, { ...input, plateNumber: randomUUID().slice(0, 20) }),
      ).rejects.toMatchObject({ code: 'INVALID_VEHICLE_CATEGORY' });
      expect((await fleet.catalog(other.id)).types.some((t) => t.code === code)).toBe(false);
      const independent = await request(other.app)
        .post('/vehicle-catalog/custom')
        .send({ name: 'My Truck', sector: 'logistics' })
        .expect(201);
      expect(independent.body.data.code).not.toBe(replies[0]!.body.data.code);
    });
  },
);
