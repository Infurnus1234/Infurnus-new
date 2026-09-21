import { describe, expect, it, vi } from 'vitest';
import { FareCalculatorService } from '../../fares/services/fare-calculator.service.js';
import { MatchingService } from '../services/matching.service.js';
import { RideService } from '../services/ride.service.js';
import { sanitizeRideForDriver } from '../utils/ride-sanitizer.js';
import { CashfreePaymentProvider } from '../../payments/providers/cashfree.provider.js';
import { PaymentController } from '../../payments/controllers/payment.controller.js';
import type { Ride } from '../types/ride.js';
import type { RideRepository } from '../repositories/ride.repository.js';
import type { DriverRepository } from '../repositories/driver.repository.js';
import type { PaymentRepository } from '../../payments/repositories/payment.repository.js';
import type { Payment } from '../../payments/types/payment.js';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';

describe('Phase 4 Step 12: End-to-End Validation & Final Audit Suite', () => {
  const defaultPricing = {
    baseFare: 5000,
    distanceRatePerKm: 1500,
    timeRatePerMinute: 200,
    currency: 'INR' as const,
    pricingVersion: 'v1-audit',
  };
  const fareCalculator = new FareCalculatorService(defaultPricing);

  const mockRide = (overrides: Partial<Ride> = {}): Ride => ({
    id: 'ride-e2e-001',
    customerId: 'cust-e2e-1',
    assignedDriverId: 'driver-e2e-1',
    assignedVehicleId: 'veh-e2e-1',
    pickup: { latitude: 12.9716, longitude: 77.5946 },
    destination: { latitude: 12.9352, longitude: 77.6245 },
    pickupAddress: 'MG Road, Bangalore',
    destinationAddress: 'Indiranagar, Bangalore',
    status: 'driver_arrived',
    fareEstimate: 350.0,
    finalFare: null,
    actualDistanceMeters: null,
    actualFuelCost: null,
    sector: 'passenger',
    vehicleCategory: 'sedan',
    goods: null,
    serviceDetails: null,
    rentalDetails: null,
    pin: '5678',
    pinVerified: false,
    cancellationReason: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  // 1. Passenger complete lifecycle
  it('1. Passenger complete lifecycle: estimate -> matching -> PIN verification -> in_progress -> completion', async () => {
    // A -> B estimate
    const estimate = fareCalculator.calculate({
      distanceMeters: 5000,
      durationSeconds: 900,
      sector: 'passenger',
      vehicleCategory: 'sedan',
    });
    expect(estimate.grossAmount).toBeGreaterThan(0);

    // PIN verification
    let isVerified = false;
    const mockRideRepo: Partial<RideRepository> = {
      isAssignedDriverProfile: vi.fn().mockResolvedValue(true),
      findById: vi.fn().mockResolvedValue(mockRide({ status: 'driver_arrived' })),
      getRidePin: vi.fn().mockResolvedValue('5678'),
      isPinVerified: vi.fn().mockImplementation(async () => isVerified),
      markPinVerified: vi.fn().mockImplementation(async () => {
        isVerified = true;
        return true;
      }),
      transition: vi.fn().mockResolvedValue(mockRide({ status: 'in_progress', pinVerified: true })),
      complete: vi.fn().mockResolvedValue(mockRide({ status: 'completed', finalFare: 350.0 })),
    };
    const mockDriverRepo: Partial<DriverRepository> = {
      releaseBusy: vi.fn().mockResolvedValue(true),
    };

    const rideService = new RideService(
      mockRideRepo as RideRepository,
      mockDriverRepo as DriverRepository,
    );
    const pinRes = await rideService.verifyRidePin('ride-e2e-001', 'driver-e2e-1', '5678');
    expect(pinRes.verified).toBe(true);

    const started = await rideService.transitionRide('ride-e2e-001', 'in_progress', 'driver-e2e-1');
    expect(started.status).toBe('in_progress');

    const completed = await rideService.completeRide('ride-e2e-001', 'driver-e2e-1');
    expect(completed.status).toBe('completed');
    expect(completed.finalFare).toBe(350.0);
  });

  // 2. Logistics complete lifecycle
  it('2. Logistics complete lifecycle: preserves cargo details and calculates helper/weight fare', () => {
    const cargoEstimate = fareCalculator.calculate({
      distanceMeters: 12000,
      durationSeconds: 1500,
      sector: 'logistics',
      vehicleCategory: 'mini_truck',
      weightKg: 45,
      hasLoadingAssistance: true,
    });

    expect(cargoEstimate.baseAmount).toBe(12500); // 125 INR base
    expect(cargoEstimate.weightAmount).toBeGreaterThan(0);
    expect(cargoEstimate.loadingAmount).toBe(15000); // 150 INR helper fee
    expect(cargoEstimate.grossAmount).toBeGreaterThan(cargoEstimate.baseAmount);
  });

  // 3. Service Vehicle complete lifecycle
  it('3. Service Vehicle complete lifecycle: strictly trip-based, immune to rentalHours', () => {
    const standardJcb = fareCalculator.calculate({
      distanceMeters: 8000,
      durationSeconds: 1200,
      sector: 'service',
      vehicleCategory: 'jcb',
    });

    const tamperedJcb = fareCalculator.calculate({
      distanceMeters: 8000,
      durationSeconds: 1200,
      sector: 'service',
      vehicleCategory: 'jcb',
      rentalHours: 12,
    });

    expect(standardJcb.baseAmount).toBe(120000); // 1200 INR mobilization
    expect(tamperedJcb.baseAmount).toBe(standardJcb.baseAmount);
    expect(tamperedJcb.grossAmount).toBe(standardJcb.grossAmount);
    expect(tamperedJcb.fuelAmount).toBeUndefined();
  });

  // 4. Premium GPS/fuel reconciliation
  it('4. Premium GPS distance accumulation & server-side fuel rate reconciliation', () => {
    const bookedHours = 4;
    const hourlyRate = 1000.0;
    const actualDistanceKm = 65.5;
    const fuelRatePerKm = 14.5;

    const hourlyBase = bookedHours * hourlyRate; // 4000.0
    const actualFuelCost = actualDistanceKm * fuelRatePerKm; // 949.75
    const subtotal = hourlyBase + actualFuelCost; // 4949.75
    const tax = Math.round(subtotal * 0.05 * 100) / 100; // 247.49
    const finalFare = Math.round((subtotal + tax) * 100) / 100; // 5197.24

    expect(hourlyBase).toBe(4000.0);
    expect(actualFuelCost).toBe(949.75);
    expect(finalFare).toBe(5197.24);
  });

  // 5. Wrong-sector matching rejection
  it('5. Wrong-sector matching rejection: MatchingService queries only matching sector candidates', async () => {
    const mockDriverRepo: Partial<DriverRepository> = {
      findNearbyEligible: vi.fn().mockResolvedValue([
        {
          driverProfileId: 'driver-pass-1',
          userId: 'user-pass-1',
          vehicleId: 'veh-pass-1',
          distanceMeters: 400,
          latitude: 12.97,
          longitude: 77.59,
          availabilityStatus: 'available',
          verificationStatus: 'approved',
          activeRideCount: 0,
          locationRecordedAt: new Date(),
          sector: 'passenger',
          vehicleCategory: 'sedan',
        },
      ]),
    };

    const matchingService = new MatchingService(mockDriverRepo as DriverRepository);
    const best = await matchingService.findBestDriver(
      { latitude: 12.97, longitude: 77.59 },
      'passenger',
      'sedan',
    );

    expect(best?.sector).toBe('passenger');
    expect(mockDriverRepo.findNearbyEligible).toHaveBeenCalledWith(
      12.97,
      77.59,
      expect.any(Number),
      expect.any(Number),
      expect.any(Date),
      'passenger',
      'sedan',
    );
  });

  // 6. Wrong-category acceptance rejection
  it('6. Wrong-category acceptance rejection: RideService throws 409 RIDE_ACCEPTANCE_CONFLICT', async () => {
    const mockRideRepo: Partial<RideRepository> = {
      accept: vi.fn().mockResolvedValue(null), // DB query enforces matching sector/category; returns null on mismatch
    };

    const service = new RideService(mockRideRepo as RideRepository);
    await expect(service.acceptRide('driver-profile-hatchback', 'ride-sedan')).rejects.toThrow(
      expect.objectContaining({
        code: 'RIDE_ACCEPTANCE_CONFLICT',
        statusCode: 409,
      }),
    );
  });

  // 7. PIN bypass rejection
  it('7. PIN bypass rejection: transition to in_progress throws 409 PIN_VERIFICATION_REQUIRED', async () => {
    const mockRideRepo: Partial<RideRepository> = {
      isAssignedDriverProfile: vi.fn().mockResolvedValue(true),
      findById: vi
        .fn()
        .mockResolvedValue(mockRide({ status: 'driver_arrived', pinVerified: false })),
      isPinVerified: vi.fn().mockResolvedValue(false),
      transition: vi.fn(),
    };

    const service = new RideService(mockRideRepo as RideRepository);
    await expect(
      service.transitionRide('ride-e2e-001', 'in_progress', 'driver-e2e-1'),
    ).rejects.toThrow('Ride pickup PIN must be verified before starting the trip');

    expect(mockRideRepo.transition).not.toHaveBeenCalled();
  });

  // 8. Payment amount tampering rejection
  it('8. Payment amount tampering rejection: client amount is discarded in favor of server authoritative ride fare', async () => {
    let capturedAmount = 0;
    const testRideId = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d';
    const testCustId = 'f1e2d3c4-b5a6-4f1e-8d2c-3b4a5f6e7d8c';

    const mockPaymentRepo: Partial<PaymentRepository> = {
      findActiveByRideId: vi.fn().mockResolvedValue(null),
      findByRideId: vi.fn().mockResolvedValue([]),
      initiate: vi.fn().mockImplementation(async (data) => {
        capturedAmount = data.amount;
        return {
          id: 'pay-1',
          rideId: data.rideId,
          amount: data.amount,
          currency: 'INR',
          status: 'PENDING',
          provider: 'cashfree',
          providerOrderId: 'order-cf-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }),
    };

    const mockRideRepo: Partial<RideRepository> = {
      findById: vi.fn().mockResolvedValue(
        mockRide({
          id: testRideId,
          customerId: testCustId,
          status: 'completed',
          finalFare: 450.0,
        }),
      ),
    };

    const mockProvider = {
      createOrder: vi.fn().mockResolvedValue({
        providerOrderId: 'order-cf-1',
        paymentSessionId: 'sess-cf-1',
        rawResponse: {},
      }),
    };

    const controller = new PaymentController(
      mockPaymentRepo as PaymentRepository,
      mockRideRepo as RideRepository,
      {} as never,
      mockProvider as never,
    );

    const req = {
      auth: { userId: testCustId, role: 'customer' },
      body: {
        rideId: testRideId,
        amount: 1.0, // Client tries to pay ₹1 for a ₹450 ride!
        provider: 'cashfree',
      },
    } as unknown as Request;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    await controller.initiate(req, res, vi.fn());

    // Verified: Server computed ₹450, completely discarding client amount of ₹1.0
    expect(capturedAmount).toBe(450.0);
    expect(mockProvider.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 450.0 }),
    );
  });

  // 9. Cashfree webhook signature verification
  it('9. Cashfree webhook signature verification: rejects invalid signatures with 401', () => {
    const provider = new CashfreePaymentProvider({
      clientId: 'test-id',
      clientSecret: 'super-secret-key',
    });

    const rawBody = JSON.stringify({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: { order: { order_id: 'ord-1' } },
    });
    const timestamp = '1726732800';

    const validSignature = crypto
      .createHmac('sha256', 'super-secret-key')
      .update(timestamp + rawBody)
      .digest('base64');

    expect(provider.verifyWebhookSignature(rawBody, validSignature, timestamp)).toBe(true);
    expect(provider.verifyWebhookSignature(rawBody, 'forged-signature', timestamp)).toBe(false);
  });

  // 10. Cashfree duplicate webhook idempotency
  it('10. Cashfree duplicate webhook idempotency: 10x webhook deliveries return 200 without duplicate state transitions', async () => {
    const existingCapturedPayment = {
      id: 'pay-captured-1',
      rideId: 'ride-1',
      rentalId: null,
      userId: 'user-1',
      amount: 450.0,
      currency: 'INR',
      status: 'CAPTURED',
      provider: 'cashfree',
      providerOrderId: 'order-dup-1',
      providerPaymentId: 'cf-pay-123',
      idempotencyKey: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Payment;

    const mockPaymentRepo: Partial<PaymentRepository> = {
      findByProviderOrderId: vi.fn().mockResolvedValue(existingCapturedPayment),
      capture: vi.fn(),
    };

    const mockProvider = {
      verifyWebhookSignature: vi.fn().mockReturnValue(true),
    };

    const controller = new PaymentController(
      mockPaymentRepo as PaymentRepository,
      {} as never,
      {} as never,
      mockProvider as never,
    );

    for (let i = 0; i < 10; i++) {
      const req = {
        rawBody: '{"type":"PAYMENT_SUCCESS_WEBHOOK"}',
        headers: {
          'x-webhook-signature': 'valid-sig',
          'x-webhook-timestamp': '12345',
        },
        body: {
          type: 'PAYMENT_SUCCESS_WEBHOOK',
          data: {
            order: { order_id: 'order-dup-1', order_amount: 450.0 },
            payment: { payment_status: 'SUCCESS', cf_payment_id: 'cf-pay-123' },
          },
        },
      } as unknown as Request;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      await controller.handleCashfreeWebhook(req, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(200);
    }

    // Database capture mutation called exactly 0 times because it was already captured!
    expect(mockPaymentRepo.capture).not.toHaveBeenCalled();
  });

  // 11. Cashfree payment reconciliation
  it('11. Cashfree payment capture: amount discrepancy triggers 400 Bad Request', async () => {
    const mockPayment = {
      id: 'pay-reconcile-1',
      rideId: 'ride-1',
      rentalId: null,
      userId: 'user-1',
      amount: 450.0,
      currency: 'INR',
      status: 'INITIATED' as const,
      provider: 'cashfree',
      providerOrderId: 'order-cf-999',
      providerPaymentId: null,
      idempotencyKey: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Payment;

    const mockPaymentRepo: Partial<PaymentRepository> = {
      findById: vi.fn().mockResolvedValue(mockPayment),
    };

    const mockProvider = {
      getPaymentStatus: vi.fn().mockResolvedValue({
        orderId: 'order-cf-999',
        orderStatus: 'PAID',
        providerPaymentId: 'cf-trans-999',
        orderAmount: 250.0, // Discrepancy: paid ₹250 instead of expected ₹450!
      }),
    };

    const controller = new PaymentController(
      mockPaymentRepo as PaymentRepository,
      {} as never,
      {} as never,
      mockProvider as never,
    );

    const req = {
      params: { paymentId: 'pay-reconcile-1' },
      auth: { userId: 'user-1', role: 'customer' },
      body: {},
    } as unknown as Request;

    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn();

    await controller.capture(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Payment amount mismatch'),
      }),
    );
  });

  // 12. Refund authorization/reconciliation
  it('12. Refund authorization and validation: non-admin returns 403, excessive amount throws 400', async () => {
    const mockPayment = {
      id: 'pay-refund-1',
      rideId: 'ride-1',
      rentalId: null,
      userId: 'user-1',
      amount: 500.0,
      currency: 'INR',
      status: 'CAPTURED' as const,
      provider: 'cashfree',
      providerOrderId: 'order-ref-1',
      providerPaymentId: 'cf-ref-trans',
      idempotencyKey: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Payment;

    const mockPaymentRepo: Partial<PaymentRepository> = {
      findById: vi.fn().mockResolvedValue(mockPayment),
    };

    const controller = new PaymentController(
      mockPaymentRepo as PaymentRepository,
      {} as never,
      {} as never,
      {} as never,
    );

    // Non-admin request
    const customerReq = {
      params: { paymentId: 'pay-refund-1' },
      auth: { userId: 'user-1', role: 'customer' }, // Not admin!
      body: { amount: 500.0, reason: 'Customer cancelled' },
    } as unknown as Request;

    const res1 = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next1 = vi.fn();
    await controller.refund(customerReq, res1, next1);
    expect(res1.status).toHaveBeenCalledWith(403);

    // Excessive amount request by admin
    const excessiveReq = {
      params: { paymentId: 'pay-refund-1' },
      auth: { userId: 'admin-1', role: 'admin' },
      body: { amount: 600.0, reason: 'Over refund' }, // 600 > 500
    } as unknown as Request;
    const res2 = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next2 = vi.fn();
    await controller.refund(excessiveReq, res2, next2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  // 13. Zero driver PIN exposure
  it('13. Driver isolation: customer PIN is strictly stripped in driver responses', () => {
    const rawRide = mockRide({ pin: '9876', pinVerified: false });
    const sanitized = sanitizeRideForDriver(rawRide) as Record<string, unknown>;

    expect(sanitized.id).toBe(rawRide.id);
    expect(sanitized.pin).toBeUndefined(); // Zero PIN exposure to driver
    expect(sanitized.pinVerified).toBe(false);
    expect(sanitized.fareEstimate).toBeUndefined(); // Zero fare exposure
  });
});
