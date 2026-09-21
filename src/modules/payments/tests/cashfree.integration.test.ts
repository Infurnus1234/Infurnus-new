import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { PaymentController } from '../controllers/payment.controller.js';
import type { PaymentRepository } from '../repositories/payment.repository.js';
import type { Payment } from '../types/payment.js';
import type { RideRepository } from '../../rides/repositories/ride.repository.js';
import type { Ride } from '../../rides/types/ride.js';
import type { RentalRepository } from '../../rentals/repositories/rental.repository.js';
import type { PaymentProvider } from '../providers/payment.provider.js';

describe('INFURNUS Payments - Cashfree Provider Integration', () => {
  const customerId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
  const otherCustomerId = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';
  const driverUserId = 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55';
  const rideId = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';

  const mockPayment: Payment = {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    userId: customerId,
    rideId,
    rentalId: null,
    logisticsOrderId: null,
    status: 'INITIATED',
    amount: 450.0,
    currency: 'INR',
    provider: 'cashfree',
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

  const createMockRide = (overrides: Partial<Ride> = {}): Ride => ({
    id: rideId,
    customerId,
    assignedDriverId: 'driver-profile-1',
    assignedVehicleId: 'vehicle-1',
    pickup: { latitude: 12.9716, longitude: 77.5946 },
    destination: { latitude: 12.9352, longitude: 77.6245 },
    pickupAddress: 'MG Road, Bengaluru',
    destinationAddress: 'Koramangala, Bengaluru',
    status: 'in_progress',
    fareEstimate: 450.0,
    finalFare: null,
    actualDistanceMeters: 8500,
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
      name: 'Driver Suresh',
      phone: '+919876543210',
      rating: 4.9,
      photoUrl: null,
    },
    vehicleDetails: {
      make: 'Hyundai',
      model: 'Verna',
      plateNumber: 'KA01AB1234',
      color: 'White',
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
  let mockRentalRepo: RentalRepository;
  let mockProvider: PaymentProvider;
  let controller: PaymentController;

  const mockResponse = () => {
    const res: Partial<Response> = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res as Response & {
      status: ReturnType<typeof vi.fn>;
      json: ReturnType<typeof vi.fn>;
    };
  };

  const mockRequest = (overrides: Partial<Request> = {}): Request =>
    ({
      auth: { userId: customerId, role: 'customer' },
      body: {},
      params: {},
      ...overrides,
    }) as unknown as Request;

  beforeEach(() => {
    mockRepo = {
      initiate: vi.fn().mockImplementation((data) =>
        Promise.resolve({
          ...mockPayment,
          ...data,
          id: 'pay-uuid-created',
          status: 'INITIATED',
        }),
      ),
      updateProviderOrder: vi.fn().mockImplementation((id, orderId) =>
        Promise.resolve({
          ...mockPayment,
          id,
          providerOrderId: orderId,
        }),
      ),
      capture: vi.fn().mockImplementation((data) =>
        Promise.resolve({
          ...mockPayment,
          status: 'CAPTURED',
          capturedAt: new Date(),
          providerPaymentId: data.providerPaymentId ?? 'cf_pay_default',
        }),
      ),
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

    mockProvider = {
      providerName: 'cashfree',
      createOrder: vi.fn().mockResolvedValue({
        providerOrderId: 'order_pay-uuid-created',
        paymentSessionId: 'session_cf_xyz789',
        orderStatus: 'ACTIVE',
        entity: 'order',
        orderAmount: 450.0,
        orderCurrency: 'INR',
      }),
      getPaymentStatus: vi.fn().mockResolvedValue({
        providerOrderId: 'order_pay-uuid-created',
        orderStatus: 'PAID',
        orderAmount: 450.0,
        orderCurrency: 'INR',
        providerPaymentId: 'cf_pay_998877',
      }),
    };

    mockRentalRepo = {
      create: vi.fn(),
      findByIdForUser: vi.fn().mockResolvedValue({
        id: 'rental-12345',
        userId: customerId,
        vehicleId: 'veh-1',
        startAt: new Date(),
        endAt: new Date(),
        totalAmount: 4800.0,
        currency: 'INR',
        status: 'ACTIVE',
        cancellationReason: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      listForUser: vi.fn().mockResolvedValue([]),
      cancel: vi.fn(),
      transition: vi.fn(),
      findByIdempotencyKey: vi.fn(),
    };

    controller = new PaymentController(mockRepo, mockRideRepo, mockRentalRepo, mockProvider);
  });

  describe('Initiate Payment with Cashfree', () => {
    it('uses authoritative server fare, creates Cashfree order, and returns session ID', async () => {
      const req = mockRequest({
        body: {
          rideId,
          provider: 'cashfree',
          // Client attempts to pass arbitrary low amount
          amount: 50.0,
        },
      });
      const res = mockResponse();
      const next = vi.fn();

      await controller.initiate(req, res, next);

      // 1. Authoritative pricing enforced: 450.0 is charged, client 50.0 is ignored
      expect(mockRepo.initiate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: customerId,
          rideId,
          amount: 450.0,
          provider: 'cashfree',
        }),
      );

      // 2. Cashfree createOrder called with server fare
      expect(mockProvider.createOrder).toHaveBeenCalledWith({
        orderId: 'order_pay-uuid-created',
        amount: 450.0,
        currency: 'INR',
        customerId,
        orderNote: `INFURNUS Ride ${rideId}`,
      });

      // 3. Provider order id saved to DB
      expect(mockRepo.updateProviderOrder).toHaveBeenCalledWith(
        'pay-uuid-created',
        'order_pay-uuid-created',
      );

      // 4. Response includes paymentSessionId and providerOrderId
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          amount: 450.0,
          providerOrderId: 'order_pay-uuid-created',
          paymentSessionId: 'session_cf_xyz789',
        }),
        message: 'Payment initiated successfully',
      });
    });

    it('returns 503 if provider is cashfree but CashfreePaymentProvider is not configured', async () => {
      const unconfiguredController = new PaymentController(
        mockRepo,
        mockRideRepo,
        undefined,
        undefined,
      );

      const req = mockRequest({
        body: {
          rideId,
          provider: 'cashfree',
        },
      });
      const res = mockResponse();
      const next = vi.fn();

      await unconfiguredController.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Payment provider cashfree is not configured or unavailable',
      });
      expect(mockRepo.initiate).not.toHaveBeenCalled();
    });

    it('returns 502 Bad Gateway if Cashfree order creation fails', async () => {
      vi.mocked(mockProvider.createOrder).mockRejectedValueOnce(
        new Error('Payment gateway order creation failed: Rate limit exceeded'),
      );

      const req = mockRequest({
        body: {
          rideId,
          provider: 'cashfree',
        },
      });
      const res = mockResponse();
      const next = vi.fn();

      await controller.initiate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Payment gateway order creation failed: Rate limit exceeded',
      });
    });

    it('prevents driver or other customer from initiating Cashfree payment for ride', async () => {
      // Driver attempt
      const driverReq = mockRequest({
        auth: { userId: driverUserId, role: 'driver' },
        body: { rideId, provider: 'cashfree' },
      });
      const driverRes = mockResponse();
      await controller.initiate(driverReq, driverRes, vi.fn());

      expect(driverRes.status).toHaveBeenCalledWith(403);
      expect(driverRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Forbidden: You can only initiate payment for your own ride',
        }),
      );

      // Other customer attempt
      const otherReq = mockRequest({
        auth: { userId: otherCustomerId, role: 'customer' },
        body: { rideId, provider: 'cashfree' },
      });
      const otherRes = mockResponse();
      await controller.initiate(otherReq, otherRes, vi.fn());

      expect(otherRes.status).toHaveBeenCalledWith(403);
      expect(mockProvider.createOrder).not.toHaveBeenCalled();
    });

    it('rejects Cashfree initiation for cancelled rides', async () => {
      vi.mocked(mockRideRepo.findById).mockResolvedValueOnce(
        createMockRide({ status: 'cancelled' }),
      );

      const req = mockRequest({
        body: { rideId, provider: 'cashfree' },
      });
      const res = mockResponse();
      await controller.initiate(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Cannot initiate payment for a cancelled ride',
        }),
      );
      expect(mockProvider.createOrder).not.toHaveBeenCalled();
    });
  });

  describe('Capture Payment with Cashfree Status Verification', () => {
    it('verifies PAID status with Cashfree before capturing', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValueOnce({
        ...mockPayment,
        provider: 'cashfree',
        providerOrderId: 'order_pay-uuid-created',
      });

      const req = mockRequest({
        params: { paymentId: mockPayment.id },
        body: {},
      });
      const res = mockResponse();
      const next = vi.fn();

      await controller.capture(req, res, next);

      expect(mockProvider.getPaymentStatus).toHaveBeenCalledWith('order_pay-uuid-created');
      expect(mockRepo.capture).toHaveBeenCalledWith({
        paymentId: mockPayment.id,
        providerPaymentId: 'cf_pay_998877',
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Payment captured successfully',
        }),
      );
    });

    it('refuses to capture when Cashfree status is still ACTIVE/unpaid', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValueOnce({
        ...mockPayment,
        provider: 'cashfree',
        providerOrderId: 'order_pay-uuid-created',
      });

      vi.mocked(mockProvider.getPaymentStatus).mockResolvedValueOnce({
        providerOrderId: 'order_pay-uuid-created',
        orderStatus: 'ACTIVE',
        orderAmount: 450.0,
        orderCurrency: 'INR',
      });

      const req = mockRequest({
        params: { paymentId: mockPayment.id },
        body: {},
      });
      const res = mockResponse();
      const next = vi.fn();

      await controller.capture(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Payment cannot be captured: Cashfree order status is ACTIVE',
      });
      expect(mockRepo.capture).not.toHaveBeenCalled();
    });

    it('returns 502 Bad Gateway if Cashfree status check throws an error', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValueOnce({
        ...mockPayment,
        provider: 'cashfree',
        providerOrderId: 'order_pay-uuid-created',
      });

      vi.mocked(mockProvider.getPaymentStatus).mockRejectedValueOnce(
        new Error('Gateway timeout contacting Cashfree'),
      );

      const req = mockRequest({
        params: { paymentId: mockPayment.id },
        body: {},
      });
      const res = mockResponse();
      const next = vi.fn();

      await controller.capture(req, res, next);

      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Gateway timeout contacting Cashfree',
      });
      expect(mockRepo.capture).not.toHaveBeenCalled();
    });
  });

  describe('Phase 9: Amount Tampering Protection Across All Sectors & Rental', () => {
    it('Passenger Sector: client sending amount=1 is ignored; authoritative fareEstimate=500 is charged', async () => {
      vi.mocked(mockRideRepo.findById).mockResolvedValueOnce(
        createMockRide({ sector: 'passenger', fareEstimate: 500.0, finalFare: null }),
      );

      const req = mockRequest({
        body: { rideId, provider: 'cashfree', amount: 1.0 },
      });
      const res = mockResponse();

      await controller.initiate(req, res, vi.fn());

      expect(mockRepo.initiate).toHaveBeenCalledWith(expect.objectContaining({ amount: 500.0 }));
      expect(mockProvider.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 500.0 }),
      );
    });

    it('Logistics Sector: client sending amount=1 is ignored; authoritative fareEstimate=850 is charged', async () => {
      vi.mocked(mockRideRepo.findById).mockResolvedValueOnce(
        createMockRide({ sector: 'logistics', fareEstimate: 850.0, finalFare: null }),
      );

      const req = mockRequest({
        body: { rideId, provider: 'cashfree', amount: 1.0 },
      });
      const res = mockResponse();

      await controller.initiate(req, res, vi.fn());

      expect(mockRepo.initiate).toHaveBeenCalledWith(expect.objectContaining({ amount: 850.0 }));
      expect(mockProvider.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 850.0 }),
      );
    });

    it('Service Vehicle Sector: client sending amount=1 is ignored; authoritative fareEstimate=1200 is charged', async () => {
      vi.mocked(mockRideRepo.findById).mockResolvedValueOnce(
        createMockRide({ sector: 'service', fareEstimate: 1200.0, finalFare: null }),
      );

      const req = mockRequest({
        body: { rideId, provider: 'cashfree', amount: 1.0 },
      });
      const res = mockResponse();

      await controller.initiate(req, res, vi.fn());

      expect(mockRepo.initiate).toHaveBeenCalledWith(expect.objectContaining({ amount: 1200.0 }));
      expect(mockProvider.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 1200.0 }),
      );
    });

    it('Premium Sector with GPS & fuel reconciliation: client sending amount=1 is ignored; reconciled total is charged', async () => {
      // 3 booked hours @ 1000/hr = 3000. actualFuelCost = 450. Subtotal = 3450. 5% Tax = 172.5. Total = 3622.5
      vi.mocked(mockRideRepo.findById).mockResolvedValueOnce(
        createMockRide({
          sector: 'premium',
          rentalDetails: { rentalHours: 3 } as any,
          actualFuelCost: 450.0,
          finalFare: null,
        }),
      );

      const req = mockRequest({
        body: { rideId, provider: 'cashfree', amount: 1.0 },
      });
      const res = mockResponse();

      await controller.initiate(req, res, vi.fn());

      expect(mockRepo.initiate).toHaveBeenCalledWith(expect.objectContaining({ amount: 3622.5 }));
      expect(mockProvider.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 3622.5 }),
      );
    });

    it('Rental: client sending amount=1 is ignored; rental totalAmount=4800 is charged', async () => {
      const rentalId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
      vi.mocked(mockRentalRepo.findByIdForUser).mockResolvedValueOnce({
        id: rentalId,
        userId: customerId,
        vehicleId: 'veh-1',
        startAt: new Date(),
        endAt: new Date(),
        totalAmount: 4800.0,
        currency: 'INR',
        status: 'ACTIVE',
        cancellationReason: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const req = mockRequest({
        body: { rentalId, provider: 'cashfree', amount: 1.0 },
      });
      const res = mockResponse();

      await controller.initiate(req, res, vi.fn());

      expect(mockRepo.initiate).toHaveBeenCalledWith(
        expect.objectContaining({ rentalId, amount: 4800.0 }),
      );
      expect(mockProvider.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 4800.0 }),
      );
    });
  });
});
