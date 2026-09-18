import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentController } from '../controllers/payment.controller.js';
import type { PaymentRepository } from '../repositories/payment.repository.js';
import type { Payment } from '../types/payment.js';
import type { RideRepository } from '../../rides/repositories/ride.repository.js';
import type { Ride } from '../../rides/types/ride.js';

describe('INFURNUS Payments Module - Security & Reconciliation', () => {
  const customerId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
  const otherCustomerId = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';
  const driverUserId = 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55';
  const adminUserId = 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66';

  const mockPayment: Payment = {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    userId: customerId,
    rideId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    rentalId: null,
    logisticsOrderId: null,
    status: 'INITIATED',
    amount: 350.0,
    currency: 'INR',
    provider: 'wallet',
    providerOrderId: null,
    providerPaymentId: null,
    idempotencyKey: null,
    initiatedAt: new Date('2026-03-01T10:00:00.000Z'),
    authorizedAt: null,
    capturedAt: null,
    refundedAt: null,
    failedAt: null,
    failureReason: null,
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-01T10:00:00.000Z'),
  };

  const mockCaptured: Payment = {
    ...mockPayment,
    status: 'CAPTURED',
    capturedAt: new Date('2026-03-01T10:01:00.000Z'),
    providerPaymentId: 'pay_test_12345',
  };

  const createMockRide = (overrides: Partial<Ride> = {}): Ride => ({
    id: mockPayment.rideId!,
    customerId,
    assignedDriverId: 'driver-profile-1',
    assignedVehicleId: 'vehicle-1',
    pickup: { latitude: 12.9716, longitude: 77.5946 },
    destination: { latitude: 12.9352, longitude: 77.6245 },
    pickupAddress: 'MG Road, Bengaluru',
    destinationAddress: 'Koramangala, Bengaluru',
    status: 'in_progress',
    fareEstimate: 350.0,
    finalFare: null,
    actualDistanceMeters: 5200,
    actualFuelCost: null,
    sector: 'passenger',
    vehicleCategory: 'sedan',
    goods: null,
    serviceDetails: null,
    rentalDetails: null,
    pin: null,
    pinVerified: true,
    driverDetails: {
      id: 'driver-1',
      name: 'Driver Ramesh',
      phone: '+919876543210',
      rating: 4.8,
      photoUrl: null,
    },
    vehicleDetails: {
      make: 'Maruti Suzuki',
      model: 'Dzire',
      color: 'White',
      plateNumber: 'KA-01-AB-1234',
    },
    cancellationReason: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: new Date('2026-03-01T09:30:00.000Z'),
    updatedAt: new Date('2026-03-01T09:45:00.000Z'),
    ...overrides,
  });

  let mockRepo: PaymentRepository;
  let mockRideRepo: RideRepository;
  let controller: PaymentController;

  beforeEach(() => {
    mockRepo = {
      initiate: vi.fn().mockImplementation((data) =>
        Promise.resolve({
          ...mockPayment,
          ...data,
          id: 'pay-created-uuid',
          status: 'INITIATED',
        }),
      ),
      capture: vi.fn().mockResolvedValue(mockCaptured),
      findById: vi.fn().mockResolvedValue(mockPayment),
      findByRideId: vi.fn().mockResolvedValue([]),
      findActiveByRideId: vi.fn().mockResolvedValue(null),
      listForUser: vi.fn().mockResolvedValue([mockPayment]),
    };

    mockRideRepo = {
      create: vi.fn(),
      findById: vi.fn().mockResolvedValue(createMockRide()),
      findByIdForCustomer: vi.fn(),
      listForCustomer: vi.fn(),
      cancel: vi.fn(),
      accept: vi.fn(),
      transition: vi.fn(),
      complete: vi.fn(),
      isParticipant: vi.fn(),
      isAssignedDriver: vi.fn(),
      isAssignedDriverProfile: vi.fn(),
      getRouteMetadata: vi.fn(),
      getDestination: vi.fn(),
      updateRouteMetadata: vi.fn(),
      getRidePin: vi.fn(),
      markPinVerified: vi.fn(),
      isPinVerified: vi.fn(),
      listAvailable: vi.fn(),
      listForDriver: vi.fn(),
      recordBreadcrumbAndAccumulateDistance: vi.fn(),
    };

    controller = new PaymentController(mockRepo, mockRideRepo);
  });

  // ============================================================
  // 1. Secure Payment Creation & Amount Tampering Immunity
  // ============================================================

  describe('Secure Payment Creation & Fare Derivation', () => {
    it('ignores client-submitted amount and uses authoritative estimated fare for active ride', async () => {
      (mockRideRepo.findById as any).mockResolvedValue(
        createMockRide({ fareEstimate: 420.0, finalFare: null }),
      );

      const req: any = {
        auth: { userId: customerId, role: 'customer' },
        body: {
          rideId: mockPayment.rideId,
          amount: 10.0, // Client tries to pay ₹10 instead of ₹420!
          provider: 'wallet',
        },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(mockRepo.initiate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 420.0, // Authoritative server fare
          rideId: mockPayment.rideId,
          userId: customerId,
        }),
      );
    });

    it('uses finalized server-side finalFare for completed ride', async () => {
      (mockRideRepo.findById as any).mockResolvedValue(
        createMockRide({
          status: 'completed',
          fareEstimate: 350.0,
          finalFare: 490.5,
          completedAt: new Date(),
        }),
      );

      const req: any = {
        auth: { userId: customerId, role: 'customer' },
        body: {
          rideId: mockPayment.rideId,
          amount: 99.0, // Client tampered amount
          provider: 'upi',
        },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(mockRepo.initiate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 490.5,
        }),
      );
    });

    it('reconciles Premium ride fare with actual GPS distance fuel cost', async () => {
      // Premium ride: 3 hours booked, 48 km actual GPS distance, ₹720 fuel cost
      // Base: 3 * 1000 = 3000. Fuel: 720. Subtotal: 3720. Tax (5%): 186. Total: 3906.
      (mockRideRepo.findById as any).mockResolvedValue(
        createMockRide({
          sector: 'premium',
          vehicleCategory: 'Rolls-Royce Phantom',
          rentalDetails: { rentalHours: 3 },
          actualDistanceMeters: 48000,
          actualFuelCost: 720.0,
          finalFare: null,
          fareEstimate: 3150.0,
        }),
      );

      const req: any = {
        auth: { userId: customerId, role: 'customer' },
        body: {
          rideId: mockPayment.rideId,
          amount: 50.0, // Tampered amount
          provider: 'card',
        },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(mockRepo.initiate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 3906.0, // Reconciled fare: (3000 + 720) * 1.05
        }),
      );
    });

    it('uses stored finalFare for completed Premium ride when already reconciled', async () => {
      (mockRideRepo.findById as any).mockResolvedValue(
        createMockRide({
          sector: 'premium',
          status: 'completed',
          finalFare: 5145.0,
          actualDistanceMeters: 60000,
          actualFuelCost: 900.0,
        }),
      );

      const req: any = {
        auth: { userId: customerId, role: 'customer' },
        body: {
          rideId: mockPayment.rideId,
          provider: 'wallet',
        },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(mockRepo.initiate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 5145.0,
        }),
      );
    });

    it('derives authoritative fare for Logistics cargo deliveries', async () => {
      // Logistics cargo delivery fare includes base + weight surcharge + loading assistance
      (mockRideRepo.findById as any).mockResolvedValue(
        createMockRide({
          sector: 'logistics',
          vehicleCategory: 'Tata Ace',
          goods: {
            category: 'Building Materials',
            weightKg: 650,
            hasLoadingAssistance: true,
          },
          fareEstimate: 850.0,
          finalFare: 850.0,
        }),
      );

      const req: any = {
        auth: { userId: customerId, role: 'customer' },
        body: {
          rideId: mockPayment.rideId,
          provider: 'wallet',
        },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(mockRepo.initiate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 850.0,
        }),
      );
    });

    it('derives authoritative fare for trip-based Service Vehicles (Ambulance, Towing, JCB)', async () => {
      (mockRideRepo.findById as any).mockResolvedValue(
        createMockRide({
          sector: 'service',
          vehicleCategory: 'JCB',
          serviceDetails: { serviceType: 'Excavation / Earthmoving' },
          fareEstimate: 3500.0,
          finalFare: 3500.0,
        }),
      );

      const req: any = {
        auth: { userId: customerId, role: 'customer' },
        body: {
          rideId: mockPayment.rideId,
          provider: 'wallet',
        },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(mockRepo.initiate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 3500.0,
        }),
      );
    });

    it('rejects initiation with 400 when authoritative fare is 0 or unavailable', async () => {
      (mockRideRepo.findById as any).mockResolvedValue(
        createMockRide({ fareEstimate: 0, finalFare: null }),
      );

      const req: any = {
        auth: { userId: customerId, role: 'customer' },
        body: { rideId: mockPayment.rideId, provider: 'wallet' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Authoritative ride fare could not be determined',
        }),
      );
    });
  });

  // ============================================================
  // 2. Ownership & Authorization Enforcement
  // ============================================================

  describe('Ownership & Authorization Enforcement', () => {
    it('forbids a customer from initiating payment for another customer ride (403)', async () => {
      (mockRideRepo.findById as any).mockResolvedValue(
        createMockRide({ customerId: otherCustomerId }),
      );

      const req: any = {
        auth: { userId: customerId, role: 'customer' },
        body: { rideId: mockPayment.rideId, provider: 'wallet' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Forbidden: You can only initiate payment for your own ride',
        }),
      );
    });

    it('forbids a driver from initiating payment for a customer ride (403)', async () => {
      (mockRideRepo.findById as any).mockResolvedValue(createMockRide({ customerId }));

      const req: any = {
        auth: { userId: driverUserId, role: 'driver' },
        body: { rideId: mockPayment.rideId, provider: 'wallet' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Forbidden: You can only initiate payment for your own ride',
        }),
      );
    });

    it('permits an admin to initiate payment for a ride', async () => {
      (mockRideRepo.findById as any).mockResolvedValue(createMockRide({ customerId }));

      const req: any = {
        auth: { userId: adminUserId, role: 'admin' },
        body: { rideId: mockPayment.rideId, provider: 'wallet' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('forbids reading payment record belonging to another user (403)', async () => {
      (mockRepo.findById as any).mockResolvedValue(mockPayment);

      const req: any = {
        params: { paymentId: mockPayment.id },
        auth: { userId: otherCustomerId, role: 'customer' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.getById(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Forbidden: Access denied to payment record',
        }),
      );
    });

    it('allows owner customer to read their own payment record', async () => {
      (mockRepo.findById as any).mockResolvedValue(mockPayment);

      const req: any = {
        params: { paymentId: mockPayment.id },
        auth: { userId: customerId, role: 'customer' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.getById(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockPayment,
      });
    });

    it('allows admin to read any payment record', async () => {
      (mockRepo.findById as any).mockResolvedValue(mockPayment);

      const req: any = {
        params: { paymentId: mockPayment.id },
        auth: { userId: adminUserId, role: 'admin' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.getById(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockPayment,
      });
    });

    it('forbids capturing another user payment (403)', async () => {
      (mockRepo.findById as any).mockResolvedValue(mockPayment);

      const req: any = {
        params: { paymentId: mockPayment.id },
        body: { providerPaymentId: 'pay_tamper' },
        auth: { userId: driverUserId, role: 'driver' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.capture(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Forbidden: Access denied to capture this payment',
        }),
      );
    });
  });

  // ============================================================
  // 3. Database & Lifecycle Integrity Checks
  // ============================================================

  describe('Database & Lifecycle Integrity', () => {
    it('rejects initiation for non-existent ride with 404', async () => {
      (mockRideRepo.findById as any).mockResolvedValue(null);

      const req: any = {
        auth: { userId: customerId, role: 'customer' },
        body: { rideId: '00000000-0000-0000-0000-000000000000', provider: 'wallet' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Ride not found',
        }),
      );
    });

    it('rejects payment initiation for cancelled ride with 409', async () => {
      (mockRideRepo.findById as any).mockResolvedValue(
        createMockRide({ status: 'cancelled', cancellationReason: 'Customer requested' }),
      );

      const req: any = {
        auth: { userId: customerId, role: 'customer' },
        body: { rideId: mockPayment.rideId, provider: 'wallet' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Cannot initiate payment for a cancelled ride',
        }),
      );
    });

    it('rejects payment initiation if ride has already been CAPTURED (409)', async () => {
      (mockRepo.findByRideId as any).mockResolvedValue([mockCaptured]);

      const req: any = {
        auth: { userId: customerId, role: 'customer' },
        body: { rideId: mockPayment.rideId, provider: 'wallet' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Payment has already been captured for this ride',
        }),
      );
    });

    it('rejects duplicate active payment initiation for the same ride (409)', async () => {
      (mockRepo.findByRideId as any).mockResolvedValue([mockPayment]); // Existing INITIATED

      const req: any = {
        auth: { userId: customerId, role: 'customer' },
        body: { rideId: mockPayment.rideId, provider: 'wallet' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'An active payment already exists for this ride',
        }),
      );
    });

    it('returns existing payment idempotently when exact idempotencyKey is supplied', async () => {
      const paymentWithKey: Payment = {
        ...mockPayment,
        idempotencyKey: 'key-test-12345',
      };
      (mockRepo.findByRideId as any).mockResolvedValue([paymentWithKey]);

      const req: any = {
        auth: { userId: customerId, role: 'customer' },
        body: {
          rideId: mockPayment.rideId,
          provider: 'wallet',
          idempotencyKey: 'key-test-12345',
        },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: paymentWithKey,
        message: 'Payment already initiated',
      });
    });

    it('handles idempotent capture of already CAPTURED payment', async () => {
      (mockRepo.findById as any).mockResolvedValue(mockCaptured);

      const req: any = {
        params: { paymentId: mockCaptured.id },
        body: { providerPaymentId: 'pay_test_12345' },
        auth: { userId: customerId, role: 'customer' },
      };
      const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      const next = vi.fn();

      await controller.capture(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockCaptured,
        message: 'Payment captured successfully',
      });
      expect(mockRepo.capture).not.toHaveBeenCalled();
    });

    it('rejects capture of a FAILED payment with 409', async () => {
      (mockRepo.findById as any).mockResolvedValue({
        ...mockPayment,
        status: 'FAILED',
        failureReason: 'Insufficient funds',
      });

      const req: any = {
        params: { paymentId: mockPayment.id },
        body: {},
        auth: { userId: customerId, role: 'customer' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.capture(req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Cannot capture a failed payment',
        }),
      );
    });

    it('rejects capture of a REFUNDED payment with 409', async () => {
      (mockRepo.findById as any).mockResolvedValue({
        ...mockPayment,
        status: 'REFUNDED',
        refundedAt: new Date(),
      });

      const req: any = {
        params: { paymentId: mockPayment.id },
        body: {},
        auth: { userId: customerId, role: 'customer' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.capture(req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Cannot capture a refunded payment',
        }),
      );
    });
  });

  // ============================================================
  // 4. Capture & History Operations
  // ============================================================

  describe('Capture & History Operations', () => {
    it('captures an initiated payment successfully', async () => {
      (mockRepo.findById as any).mockResolvedValue(mockPayment);

      const req: any = {
        params: { paymentId: mockPayment.id },
        body: { providerPaymentId: 'pay_test_12345' },
        auth: { userId: customerId, role: 'customer' },
      };
      const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      const next = vi.fn();

      await controller.capture(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockCaptured,
        message: 'Payment captured successfully',
      });
    });

    it('returns 404 when capturing non-existent payment', async () => {
      (mockRepo.findById as any).mockResolvedValue(null);

      const req: any = {
        params: { paymentId: 'unknown-payment' },
        body: {},
        auth: { userId: customerId, role: 'customer' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.capture(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('lists user payment transaction history isolated to current user', async () => {
      const req: any = { auth: { userId: customerId } };
      const res: any = { json: vi.fn() };
      const next = vi.fn();

      await controller.listHistory(req, res, next);

      expect(mockRepo.listForUser).toHaveBeenCalledWith(customerId);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [mockPayment],
      });
    });

    it('returns 401 when authentication is missing across endpoints', async () => {
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate({ body: { rideId: mockPayment.rideId } } as any, res, next);
      expect(res.status).toHaveBeenCalledWith(401);

      await controller.getById({ params: { paymentId: mockPayment.id } } as any, res, next);
      expect(res.status).toHaveBeenCalledWith(401);

      await controller.capture(
        { params: { paymentId: mockPayment.id }, body: {} } as any,
        res,
        next,
      );
      expect(res.status).toHaveBeenCalledWith(401);

      await controller.listHistory({} as any, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('handles database 23505 unique constraint violation gracefully with 409', async () => {
      (mockRepo.initiate as any).mockRejectedValueOnce({ code: '23505', message: 'duplicate key' });

      const req: any = {
        auth: { userId: customerId, role: 'customer' },
        body: { rideId: mockPayment.rideId, provider: 'wallet' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'An active payment already exists for this ride or idempotency key',
        }),
      );
    });

    it('allows client to omit amount completely and derives it server-side', async () => {
      (mockRideRepo.findById as any).mockResolvedValue(
        createMockRide({ fareEstimate: 500.0, finalFare: null }),
      );

      const req: any = {
        auth: { userId: customerId, role: 'customer' },
        body: {
          rideId: mockPayment.rideId,
          // Notice: no amount provided in body!
          provider: 'wallet',
        },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(mockRepo.initiate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 500.0,
        }),
      );
    });

    it('derives rental payment amount from rentalRepository when rentalId is provided', async () => {
      const mockRentalRepo: any = {
        findByIdForUser: vi.fn().mockResolvedValue({
          id: 'rental-uuid-1',
          userId: customerId,
          totalAmount: 2400.0,
          status: 'CONFIRMED',
        }),
      };
      const rentalController = new PaymentController(mockRepo, mockRideRepo, mockRentalRepo);

      const req: any = {
        auth: { userId: customerId, role: 'customer' },
        body: {
          rentalId: '11111111-1111-4111-a111-111111111111',
          amount: 100.0, // Client tries to send 100 instead of 2400
          provider: 'wallet',
        },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await rentalController.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(mockRepo.initiate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 2400.0,
        }),
      );
    });
  });
});
