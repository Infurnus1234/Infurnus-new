import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireDisposableAdministrativeDatabase } from '../../admin/tests/administrative-test-database.js';
import type { Request, Response } from 'express';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresVehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import { PostgresRideRepository } from '../../rides/repositories/ride.repository.js';
import { RideService } from '../../rides/services/ride.service.js';
import { FareEstimateService } from '../services/fare-estimate.service.js';
import { FareCalculatorService } from '../services/fare-calculator.service.js';
import { PaymentController } from '../../payments/controllers/payment.controller.js';
import { PostgresPaymentRepository } from '../../payments/repositories/payment.repository.js';
import type { MapProvider } from '../../rides/providers/map.provider.js';
import type { PaymentProvider } from '../../payments/providers/payment.provider.js';

const routes: MapProvider = {
  calculateRoute: async () => ({ distanceMeters: 100000, durationSeconds: 10800 }),
  calculateMatrix: async () => [],
  geocode: async () => null,
  places: async () => [],
};

describe.runIf(process.env.RIDE_DB_TESTS === 'true')(
  'Saved Thar hourly tariff and payment consistency',
  () => {
    beforeAll(async () => {
      requireDisposableAdministrativeDatabase();
      await pool.query(`UPDATE vehicle_types SET fixed_hourly_rate_paise=50000,
        hourly_fuel_rate_paise=4500,hourly_fuel_unit='per_km' WHERE sector='premium' AND code='thar'`);
    });
    afterAll(async () => {
      requireDisposableAdministrativeDatabase();
      await pool.query(`UPDATE vehicle_types SET fixed_hourly_rate_paise=NULL,
        hourly_fuel_rate_paise=NULL,hourly_fuel_unit=NULL WHERE sector='premium' AND code='thar'`);
    });
    it.each([
      [5, 'round_trip', 11500, 2],
      [6, 'round_trip', 12000, 2],
      [7, 'round_trip', 12500, 2],
      [6, 'one_way', 12000, 2],
    ] as const)(
      'books %s hours %s and charges configured fuel once',
      async (hours, tripType, expectedFare, multiplier) => {
        const vehicles = new PostgresVehicleRepository(pool);
        const configured = await vehicles.findTypeByCode('thar', 'premium');
        expect(configured).toMatchObject({ baseFare: 500, perKmRate: 45, active: true });
        const customer = (
          await pool.query(
            "INSERT INTO users(first_name,last_name,email,role) VALUES('TEST_SAMPLE','Thar',$1,'customer') RETURNING id",
            [randomUUID() + '@example.invalid'],
          )
        ).rows[0].id;
        const rides = new PostgresRideRepository(pool);
        const estimator = new FareEstimateService(
          routes,
          new FareCalculatorService(),
          { allowFallback: false },
          vehicles,
        );
        const service = new RideService(rides, undefined, undefined, estimator);
        const input = {
          pickup: { latitude: 25.61275, longitude: 85.11883 },
          destination: { latitude: 26.2525481, longitude: 85.1608985 },
          sector: 'premium' as const,
          vehicleCategory: 'thar',
          rentalDetails: { hours, tripType },
        };
        const ride = await service.createRide(customer, input);
        expect(Number(ride.fareEstimate)).toBe(expectedFare);
        expect(ride.rentalDetails?.hours).toBe(hours);
        const snapshot = (
          await pool.query(
            "SELECT route_metadata->'bookingFareSnapshot' AS fare FROM rides WHERE id=$1",
            [ride.id],
          )
        ).rows[0].fare;
        expect(snapshot).toMatchObject({
          oneWayDistanceMeters: 100000,
          billableDistanceMeters: 100000 * multiplier,
          distanceMultiplier: multiplier,
          baseAmount: 50000 * hours,
          distanceAmount: 0,
          fuelAmount: 450000 * multiplier,
          grossAmount: expectedFare * 100,
          timeAmount: 0,
        });
        expect(snapshot.taxAmount).toBeUndefined();
        let expectedOrder = '';
        const provider: PaymentProvider = {
          providerName: 'cashfree',
          createOrder: vi.fn(async (p) => {
            expectedOrder = p.orderId;
            return {
              providerOrderId: p.orderId,
              paymentSessionId: 'test-session',
              orderStatus: 'ACTIVE',
              entity: 'order',
              orderAmount: p.amount,
              orderCurrency: p.currency,
            };
          }),
          getPaymentStatus: vi.fn(async () => ({
            providerOrderId: expectedOrder,
            orderStatus: 'PAID' as const,
            orderAmount: expectedFare,
            orderCurrency: 'INR',
            providerPaymentId: randomUUID(),
          })),
        };
        const payments = new PostgresPaymentRepository(pool);
        const controller = new PaymentController(payments, rides, undefined, provider);
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
        const next = vi.fn();
        const key = randomUUID();
        const req = {
          auth: { userId: customer, role: 'customer' },
          body: { rideId: ride.id, provider: 'cashfree', amount: 1, idempotencyKey: key },
        } as unknown as Request;
        await controller.initiate(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(provider.createOrder).toHaveBeenCalledWith(
          expect.objectContaining({ amount: expectedFare, customerId: customer }),
        );
        let saved = await payments.findByRideId(ride.id);
        expect(saved).toHaveLength(1);
        expect(Number(saved[0]!.amount)).toBe(expectedFare);
        await controller.initiate(req, res, next);
        saved = await payments.findByRideId(ride.id);
        expect(saved).toHaveLength(1);
        await controller.initiate(
          { ...req, body: { rideId: ride.id, provider: 'cashfree' } } as Request,
          res,
          next,
        );
        expect(await payments.findByRideId(ride.id)).toHaveLength(1);
        expect(
          (res.json as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0].data.paymentSessionId,
        ).toBe('test-session');
        await controller.capture(
          {
            auth: { userId: customer, role: 'customer' },
            params: { paymentId: saved[0]!.id },
            body: {},
          } as unknown as Request,
          res,
          next,
        );
        expect(next).not.toHaveBeenCalled();
        expect((await payments.findById(saved[0]!.id))?.status).toBe('CAPTURED');
      },
    );
    it('keeps repeat calculations one-way at input and rejects client fare tampering', async () => {
      const configured = await new PostgresVehicleRepository(pool).findTypeByCode(
        'thar',
        'premium',
      );
      const calculator = new FareCalculatorService();
      const input = {
        distanceMeters: 100000,
        durationSeconds: 21600,
        rentalHours: 6,
        sector: 'premium' as const,
        vehicleCategory: 'thar',
      };
      const first = calculator.calculateEstimate(input, configured!);
      expect(calculator.calculateEstimate(input, configured!)).toEqual(first);
      expect(input.distanceMeters).toBe(100000);
      expect(first.billableDistanceMeters).toBe(200000);
    });
  },
);
