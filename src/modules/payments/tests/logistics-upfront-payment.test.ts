import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { PaymentController } from '../controllers/payment.controller.js';
import type { PaymentRepository } from '../repositories/payment.repository.js';
import type { Payment } from '../types/payment.js';
import type { RideRepository } from '../../rides/repositories/ride.repository.js';
import type { Ride } from '../../rides/types/ride.js';
import { RideService } from '../../rides/services/ride.service.js';
import type { PaymentProvider } from '../providers/payment.provider.js';

describe('Logistics 40% Upfront Payment Confirmation Flow', () => {
  const customerId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
  const driverProfileId = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
  const rideId = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';

  const createLogisticsRide = (overrides: Partial<Ride> = {}): Ride => ({
    id: rideId,
    customerId,
    assignedDriverId: driverProfileId,
    assignedVehicleId: 'v-1',
    pickup: { latitude: 12.9716, longitude: 77.5946 },
    destination: { latitude: 12.9352, longitude: 77.6245 },
    pickupAddress: 'Warehouse A',
    destinationAddress: 'Distribution Hub B',
    status: 'driver_arrived',
    fareEstimate: 850.0,
    finalFare: null,
    actualDistanceMeters: 12000,
    actualFuelCost: null,
    sector: 'logistics',
    vehicleCategory: 'tempo',
    goods: { category: 'Hardware', weightKg: 500 },
    serviceDetails: null,
    rentalDetails: null,
    pin: '1234',
    pinVerified: false,
    upfrontPaymentStatus: 'PENDING',
    logisticsPayment: {
      totalFare: 850.0,
      upfrontAmount: 340.0,
      remainingAmount: 510.0,
      status: 'PENDING',
    },
    cancellationReason: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-01T10:05:00.000Z'),
    ...overrides,
  });

  const createPassengerRide = (overrides: Partial<Ride> = {}): Ride => ({
    id: 'pass-ride-1',
    customerId,
    assignedDriverId: driverProfileId,
    assignedVehicleId: 'v-2',
    pickup: { latitude: 12.9716, longitude: 77.5946 },
    destination: { latitude: 12.9352, longitude: 77.6245 },
    pickupAddress: 'Home',
    destinationAddress: 'Office',
    status: 'driver_arrived',
    fareEstimate: 500.0,
    finalFare: null,
    actualDistanceMeters: 8000,
    actualFuelCost: null,
    sector: 'passenger',
    vehicleCategory: 'sedan',
    goods: null,
    serviceDetails: null,
    rentalDetails: null,
    pin: '4321',
    pinVerified: false,
    upfrontPaymentStatus: 'NOT_REQUIRED',
    logisticsPayment: null,
    cancellationReason: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-01T10:05:00.000Z'),
    ...overrides,
  });

  let mockPaymentRepo: PaymentRepository;
  let mockRideRepo: RideRepository;
  let mockProvider: PaymentProvider;
  let paymentController: PaymentController;
  let rideService: RideService;

  beforeEach(() => {
    mockPaymentRepo = {
      findActiveByRideId: vi.fn(),
      initiate: vi.fn().mockImplementation((input) =>
        Promise.resolve({
          id: 'pay-1',
          userId: input.userId,
          rideId: input.rideId ?? null,
          rentalId: null,
          logisticsOrderId: null,
          status: 'INITIATED',
          amount: input.amount,
          currency: input.currency ?? 'INR',
          provider: input.provider ?? 'wallet',
          providerOrderId: null,
          providerPaymentId: null,
          idempotencyKey: input.idempotencyKey ?? null,
          initiatedAt: new Date(),
          authorizedAt: null,
          capturedAt: null,
          refundedAt: null,
          failedAt: null,
          failureReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      findById: vi.fn(),
      findByRideId: vi.fn().mockResolvedValue([]),
      findByProviderOrderId: vi.fn(),
      capture: vi.fn(),
      markFailed: vi.fn(),
      listForUser: vi.fn(),
      updateProviderOrder: vi.fn().mockResolvedValue(undefined),
    };

    mockRideRepo = {
      findById: vi.fn(),
      transition: vi.fn(),
      isAssignedDriver: vi.fn().mockResolvedValue(false),
      verifyPinAttempt: vi.fn().mockResolvedValue('verified'),
      create: vi.fn(),
      findActiveForDriver: vi.fn(),
      cancel: vi.fn(),
      complete: vi.fn(),
    } as unknown as RideRepository;

    mockProvider = {
      providerName: 'cashfree',
      createOrder: vi.fn().mockResolvedValue({
        providerOrderId: 'order_pay-1',
        paymentSessionId: 'sess_123',
      }),
      getPaymentStatus: vi.fn().mockResolvedValue({
        orderStatus: 'PAID',
        orderAmount: 340.0,
        providerPaymentId: 'cf_pay_999',
      }),
      verifyWebhookSignature: vi.fn().mockReturnValue(true),
    };

    paymentController = new PaymentController(
      mockPaymentRepo,
      mockRideRepo,
      undefined,
      mockProvider,
    );

    rideService = new RideService(mockRideRepo);
  });

  describe('STEP 2: Backend Authoritative Fare & Rounding Rules', () => {
    it('calculates exact 40% upfront and 60% remaining without rounding drift', () => {
      // Test cases with various amounts
      const testCases = [
        { total: 850.0, expectedUpfront: 340.0, expectedRemaining: 510.0 },
        { total: 105.55, expectedUpfront: 42.22, expectedRemaining: 63.33 },
        { total: 333.33, expectedUpfront: 133.33, expectedRemaining: 200.0 },
        { total: 99.99, expectedUpfront: 40.0, expectedRemaining: 59.99 },
      ];

      for (const tc of testCases) {
        const total = Math.round(tc.total * 100) / 100;
        const upfront = Math.round(total * 0.4 * 100) / 100;
        const remaining = Math.round((total - upfront) * 100) / 100;

        expect(upfront).toBe(tc.expectedUpfront);
        expect(remaining).toBe(tc.expectedRemaining);
        expect(Math.round((upfront + remaining) * 100) / 100).toBe(total);
      }
    });

    it('initiates 40% upfront payment (340.0) ignoring client submitted amount (amount: 1)', async () => {
      const logisticsRide = createLogisticsRide({ fareEstimate: 850.0 });
      vi.mocked(mockRideRepo.findById).mockResolvedValue(logisticsRide);

      const req = {
        auth: { userId: customerId, role: 'customer' },
        body: { rideId, provider: 'cashfree', amount: 1.0 },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      await paymentController.initiate(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(mockPaymentRepo.initiate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 340.0,
          rideId,
        }),
      );
      expect(mockProvider.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 340.0,
        }),
      );
    });

    it('idempotency: re-initiating upfront payment when already CAPTURED returns existing 200 OK without re-billing', async () => {
      const logisticsRide = createLogisticsRide({ fareEstimate: 850.0 });
      vi.mocked(mockRideRepo.findById).mockResolvedValue(logisticsRide);

      const capturedUpfrontPayment: Payment = {
        id: 'pay-captured-1',
        userId: customerId,
        rideId,
        rentalId: null,
        logisticsOrderId: null,
        status: 'CAPTURED',
        amount: 340.0,
        currency: 'INR',
        provider: 'cashfree',
        providerOrderId: 'order_1',
        providerPaymentId: 'cf_1',
        idempotencyKey: 'idem-1',
        initiatedAt: new Date(),
        authorizedAt: new Date(),
        capturedAt: new Date(),
        refundedAt: null,
        failedAt: null,
        failureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(mockPaymentRepo.findByRideId).mockResolvedValue([capturedUpfrontPayment]);

      const req = {
        auth: { userId: customerId, role: 'customer' },
        body: { rideId, provider: 'cashfree' },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      await paymentController.initiate(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: capturedUpfrontPayment,
          message: 'Upfront payment already verified',
        }),
      );
      // Gateway order must NOT be created again
      expect(mockProvider.createOrder).not.toHaveBeenCalled();
    });
  });

  describe('STEP 2 & 4: Ride-Start Endpoint Enforcement', () => {
    it('blocks driver from starting ride when upfront payment is PENDING (rejects with 409 UPFRONT_PAYMENT_REQUIRED)', async () => {
      const logisticsRide = createLogisticsRide({
        status: 'driver_arrived',
        upfrontPaymentStatus: 'PENDING',
        logisticsPayment: {
          totalFare: 850.0,
          upfrontAmount: 340.0,
          remainingAmount: 510.0,
          status: 'PENDING',
        },
      });

      vi.mocked(mockRideRepo.findById).mockResolvedValue(logisticsRide);

      await expect(
        rideService.transitionRide(rideId, 'in_progress', driverProfileId, '1234'),
      ).rejects.toMatchObject({
        code: 'UPFRONT_PAYMENT_REQUIRED',
        statusCode: 409,
      });

      // PIN verification must NOT have occurred
      expect(mockRideRepo.verifyPinAttempt).not.toHaveBeenCalled();
    });

    it('blocks driver from starting ride when upfront payment is FAILED', async () => {
      const logisticsRide = createLogisticsRide({
        status: 'driver_arrived',
        upfrontPaymentStatus: 'FAILED',
        logisticsPayment: {
          totalFare: 850.0,
          upfrontAmount: 340.0,
          remainingAmount: 510.0,
          status: 'FAILED',
        },
      });

      vi.mocked(mockRideRepo.findById).mockResolvedValue(logisticsRide);

      await expect(
        rideService.transitionRide(rideId, 'in_progress', driverProfileId, '1234'),
      ).rejects.toMatchObject({
        code: 'UPFRONT_PAYMENT_REQUIRED',
        statusCode: 409,
      });
    });

    it('allows driver to start ride when upfront payment is PAID_VERIFIED', async () => {
      const logisticsRide = createLogisticsRide({
        status: 'driver_arrived',
        upfrontPaymentStatus: 'PAID_VERIFIED',
        logisticsPayment: {
          totalFare: 850.0,
          upfrontAmount: 340.0,
          remainingAmount: 510.0,
          status: 'PAID_VERIFIED',
        },
      });

      const inProgressRide = {
        ...logisticsRide,
        status: 'in_progress' as const,
        pinVerified: true,
      };

      vi.mocked(mockRideRepo.findById)
        .mockResolvedValueOnce(logisticsRide)
        .mockResolvedValueOnce(inProgressRide);

      const result = await rideService.transitionRide(
        rideId,
        'in_progress',
        driverProfileId,
        '1234',
      );

      expect(mockRideRepo.verifyPinAttempt).toHaveBeenCalledWith(rideId, driverProfileId, '1234');
      expect(result.status).toBe('in_progress');
    });

    it('REGRESSION GUARD: non-logistics passenger ride starts normally without requiring upfront payment', async () => {
      const passengerRide = createPassengerRide({
        status: 'driver_arrived',
      });

      const inProgressPassengerRide = {
        ...passengerRide,
        status: 'in_progress' as const,
        pinVerified: true,
      };

      vi.mocked(mockRideRepo.findById)
        .mockResolvedValueOnce(passengerRide)
        .mockResolvedValueOnce(inProgressPassengerRide);

      const result = await rideService.transitionRide(
        'pass-ride-1',
        'in_progress',
        driverProfileId,
        '4321',
      );

      expect(mockRideRepo.verifyPinAttempt).toHaveBeenCalledWith(
        'pass-ride-1',
        driverProfileId,
        '4321',
      );
      expect(result.status).toBe('in_progress');
    });
  });

  describe('STEP 5: Webhook & Verification Security', () => {
    it('rejects Cashfree webhook if signature is invalid (401)', async () => {
      vi.mocked(mockProvider.verifyWebhookSignature!).mockReturnValue(false);

      const req = {
        headers: {
          'x-webhook-signature': 'invalid_sig',
          'x-webhook-timestamp': '1234567890',
        },
        body: { type: 'PAYMENT_SUCCESS_WEBHOOK' },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      await paymentController.handleCashfreeWebhook(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Invalid webhook signature',
        }),
      );
    });

    it('rejects capture if Cashfree reports status other than PAID (400)', async () => {
      const payment: Payment = {
        id: 'pay-pending-1',
        userId: customerId,
        rideId,
        rentalId: null,
        logisticsOrderId: null,
        status: 'INITIATED',
        amount: 340.0,
        currency: 'INR',
        provider: 'cashfree',
        providerOrderId: 'order_pending_1',
        providerPaymentId: null,
        idempotencyKey: null,
        initiatedAt: new Date(),
        authorizedAt: null,
        capturedAt: null,
        refundedAt: null,
        failedAt: null,
        failureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(mockPaymentRepo.findById).mockResolvedValue(payment);
      vi.mocked(mockProvider.getPaymentStatus).mockResolvedValue({
        providerOrderId: 'order_pay-1',
        orderCurrency: 'INR',
        orderStatus: 'ACTIVE',
        orderAmount: 340.0,
      });

      const req = {
        params: { paymentId: 'pay-pending-1' },
        auth: { userId: customerId, role: 'customer' },
        body: {},
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      await paymentController.capture(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Payment cannot be captured: Cashfree order status is ACTIVE',
        }),
      );
      expect(mockPaymentRepo.capture).not.toHaveBeenCalled();
    });

    it('post-delivery phase: allows initiating remaining 60% payment after trip completion', async () => {
      const completedRide = createLogisticsRide({
        status: 'completed',
        fareEstimate: 850.0,
        finalFare: 850.0,
      });
      vi.mocked(mockRideRepo.findById).mockResolvedValue(completedRide);

      const capturedUpfront: Payment = {
        id: 'pay-upfront',
        userId: customerId,
        rideId,
        rentalId: null,
        logisticsOrderId: null,
        status: 'CAPTURED',
        amount: 340.0,
        currency: 'INR',
        provider: 'cashfree',
        providerOrderId: 'order_upfront',
        providerPaymentId: 'cf_upfront',
        idempotencyKey: null,
        initiatedAt: new Date(),
        authorizedAt: new Date(),
        capturedAt: new Date(),
        refundedAt: null,
        failedAt: null,
        failureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(mockPaymentRepo.findByRideId).mockResolvedValue([capturedUpfront]);

      const req = {
        auth: { userId: customerId, role: 'customer' },
        body: { rideId, provider: 'cashfree' },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      await paymentController.initiate(req, res, vi.fn());

      // Must charge remaining 60% = 510.0
      expect(res.status).toHaveBeenCalledWith(201);
      expect(mockPaymentRepo.initiate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 510.0,
          rideId,
        }),
      );
    });
  });
});
