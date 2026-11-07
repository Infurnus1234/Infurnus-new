import type { VehicleType } from '../../vehicles/types/vehicle.js';
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  wholeRupees,
  wholeRupeePaise,
  logisticsSplit,
  rupeesToPaise,
} from '../../../common/utils/whole-rupee.js';
import { FareCalculatorService } from '../../fares/services/fare-calculator.service.js';
import { PaymentController } from '../controllers/payment.controller.js';
import type { PaymentRepository } from '../repositories/payment.repository.js';
import type { RideRepository } from '../../rides/repositories/ride.repository.js';
import type { PaymentProvider } from '../providers/payment.provider.js';
const examples = [
  ['2000.30', 2000],
  ['1000.50', 1001],
  ['550.75', 551],
  ['249.20', 249],
  ['999.49', 999],
  ['999.50', 1000],
  ['1250.90', 1251],
] as const;
describe('authoritative whole-rupee boundaries', () => {
  it.each(examples)('%s rupees becomes %s', (value, expected) =>
    expect(wholeRupees(value)).toBe(expected),
  );
  it('uses exact decimal ties and avoids intermediate decimal/double rounding', () => {
    expect(wholeRupees('999.499999999999999999')).toBe(999);
    expect(wholeRupees('999.500000000000000001')).toBe(1000);
    expect(wholeRupees('2.492e2')).toBe(249);
    expect(rupeesToPaise('1.005')).toBe(101);
    for (const bad of [NaN, Infinity, -1, 'secret', '1e200'])
      expect(() => wholeRupees(bad)).toThrow();
  });
  it('rounds advance first and derives remaining by subtraction for every rupee in a broad range', () => {
    expect(logisticsSplit(200300)).toEqual({
      totalPaise: 200300,
      upfrontPaise: 80100,
      finalPaise: 120200,
      currency: 'INR',
    });
    for (let rupees = 1; rupees <= 10000; rupees++) {
      const p = logisticsSplit(rupees * 100);
      expect(p.upfrontPaise + p.finalPaise).toBe(p.totalPaise);
      expect(p.upfrontPaise % 100).toBe(0);
      expect(p.finalPaise % 100).toBe(0);
      expect(logisticsSplit(p.totalPaise)).toEqual(p);
    }
  });
  it.each(['rental', 'logistics', 'premium', 'service'] as const)(
    '%s finalizes once without altering configured component rates',
    (sector) => {
      const calc = new FareCalculatorService();
      const configuration: VehicleType = {
        id: 'test-type',
        code: 'audit',
        name: 'Audit',
        sector: sector === 'rental' ? 'passenger' : sector,
        active: true,
        version: 1,
        baseFare: 1000.5,
        perKmRate: 0,
        currency: 'INR',
        createdAt: new Date(0),
        updatedAt: new Date(0),
        ...(sector === 'rental'
          ? {
              hourlyBaseFares: Object.fromEntries(
                ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '12_plus'].map(
                  (key) => [key, 1000.5],
                ),
              ),
            }
          : {}),
        ...(sector === 'service'
          ? {
              baseFare: null,
              perKmRate: null,
              serviceFixedFare: 1000.5,
              serviceRadiusMeters: 10000,
            }
          : {}),
        ...(sector === 'logistics'
          ? {
              logisticsSlabs: {
                below_15: { baseFare: 1000.5, perKmRate: 0 },
                from_15: { baseFare: 1000.5, perKmRate: 0 },
              },
            }
          : {}),
      };
      const estimate = calc.calculateEstimate(
        {
          sector,
          vehicleCategory: 'audit',
          bookingHours: 1,
          rentalHours: 1,
          distanceMeters: 12345,
          durationSeconds: 127,
        },
        configuration,
      );
      if (!('bookingFare' in estimate) || !estimate.bookingFare)
        throw Error('Missing booking fare');
      const result = estimate.bookingFare;
      expect(result.grossAmount).toBe(100100);
      expect(result.driverEarnings! + result.commissionAmount!).toBe(result.grossAmount);
      expect(wholeRupeePaise(result.grossAmount)).toBe(result.grossAmount);
      expect(result.roundingAdjustmentPaise).toBe(50);
      expect(configuration.perKmRate).toBe(sector === 'service' ? null : 0);
    },
  );
  it.each(['rental', 'logistics', 'premium', 'service'])(
    '%s persists and sends the exact same rounded charge to gateway',
    async (sector) => {
      const id = '11111111-1111-4111-8111-111111111111';
      const initiate = vi.fn(async (data) => ({
        ...data,
        id,
        status: 'INITIATED',
        paymentStage: null,
      }));
      const payments = {
        findByRideId: vi.fn().mockResolvedValue([]),
        initiate,
        updateProviderOrder: vi.fn(),
      } as unknown as PaymentRepository;
      const rides = {
        findById: vi.fn().mockResolvedValue({
          id,
          customerId: 'customer',
          status: sector === 'logistics' ? 'driver_assigned' : 'completed',
          sector,
          bookingPricingVersion: 'vehicle-type:test:v1',
          fareEstimate: 2003.3,
          finalFare: 2003.3,
        }),
      } as unknown as RideRepository;
      const createOrder = vi.fn(async (data) => ({
        providerOrderId: data.orderId,
        paymentSessionId: 'local-test-session',
        orderAmount: data.amount,
        orderCurrency: 'INR',
        orderStatus: 'ACTIVE',
        entity: 'order',
      }));
      const provider = { createOrder } as unknown as PaymentProvider;
      const controller = new PaymentController(payments, rides, undefined, provider);
      const req = {
        auth: { userId: 'customer', role: 'customer' },
        body: { rideId: id, provider: 'cashfree', amount: 1 },
      } as unknown as Request;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
      const next = vi.fn();
      await controller.initiate(req, res, next);
      expect(next).not.toHaveBeenCalled();
      const expected = sector === 'logistics' ? 801 : 2003;
      expect(initiate).toHaveBeenCalledWith(expect.objectContaining({ amount: expected }));
      expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ amount: expected }));
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: expected }) }),
      );
    },
  );
});
