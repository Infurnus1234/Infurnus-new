import { describe, expect, it, vi } from 'vitest';
import { RatingController } from '../controllers/rating.controller.js';
import type { RatingRepository } from '../repositories/rating.repository.js';
import type { CreateRatingData, DriverRatingSummary, Rating } from '../types/rating.js';

describe('INFURNUS Ratings Module', () => {
  const mockRating: Rating = {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    rideId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    customerId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    driverProfileId: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
    rating: 5,
    review: 'Excellent ride and very polite driver!',
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
  };

  const mockRepo: RatingRepository = {
    create: vi.fn().mockResolvedValue(mockRating),
    findByRideId: vi.fn().mockResolvedValue(mockRating),
    getDriverSummary: vi.fn().mockResolvedValue({
      driverProfileId: mockRating.driverProfileId,
      averageRating: 4.8,
      totalRatings: 25,
    }),
  };

  const controller = new RatingController(mockRepo);

  it('creates rating successfully through controller', async () => {
    const req: any = {
      auth: { userId: mockRating.customerId },
      body: {
        rideId: mockRating.rideId,
        rating: 5,
        review: 'Excellent ride and very polite driver!',
      },
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    await controller.create(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: mockRating,
      message: 'Rating submitted successfully',
    });
  });

  it('retrieves rating by rideId', async () => {
    const req: any = { params: { rideId: mockRating.rideId } };
    const res: any = { json: vi.fn() };
    const next = vi.fn();

    await controller.getByRide(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: mockRating,
    });
  });

  it('retrieves driver rating summary', async () => {
    const req: any = { params: { driverProfileId: mockRating.driverProfileId } };
    const res: any = { json: vi.fn() };
    const next = vi.fn();

    await controller.getDriverSummary(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        driverProfileId: mockRating.driverProfileId,
        averageRating: 4.8,
        totalRatings: 25,
      },
    });
  });
});
